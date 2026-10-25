import { RELAY_HELLO_INTERVAL_MS, RELAY_RESEND_MS } from '../../../config';
import type { RelayMsg } from './messages';

export const HELLO_SLOW_AFTER_MS = 10 * 60_000;
export const HELLO_SLOW_INTERVAL_MS = 10_000;
export const HELLO_REPLY_MIN_GAP_MS = 2000;

export interface RoomState {
  myId: string;
  /** `left`: we said bye (or the peer did). Nothing more happens. */
  phase: 'waiting' | 'paired' | 'left';
  peer: string | null;
  /** Lower instance id is the caller. */
  role: 'caller' | 'callee' | null;
  sid: string | null;
  /** Caller: the offer being re-sent until answered. */
  offerToken: string | null;
  answered: boolean;
  /** Callee: the answer we published for `sid`, re-published on duplicate offers. */
  answer: { sid: string; token: string } | null;
  connected: boolean;
  startedAt: number;
  lastHelloReplyAt: number;
  thirdPartyNotified: boolean;
}

export type TimerName = 'hello' | 'resend';

export type RoomEvent =
  | { type: 'join'; now: number }
  | { type: 'timer'; name: TimerName; now: number }
  | { type: 'message'; msg: RelayMsg; now: number }
  | { type: 'offer-ready'; peer: string; sid: string; token: string }
  | { type: 'answer-ready'; peer: string; sid: string; token: string }
  | { type: 'session-connected' }
  | { type: 'session-failed'; now: number }
  | { type: 'leave' };

export type RoomEffect =
  | { kind: 'publish'; msg: RelayMsg }
  | { kind: 'set-timer'; name: TimerName; ms: number }
  | { kind: 'clear-timer'; name: TimerName }
  | { kind: 'create-offer'; peer: string }
  | { kind: 'accept-offer'; peer: string; sid: string; token: string }
  | { kind: 'apply-answer'; token: string }
  | { kind: 'dispose-session' }
  | { kind: 'notify'; what: 'peer-found' | 'third-party' | 'peer-left' };

export interface Step {
  state: RoomState;
  effects: RoomEffect[];
}

export function initialRoom(myId: string): RoomState {
  return {
    myId,
    phase: 'waiting',
    peer: null,
    role: null,
    sid: null,
    offerToken: null,
    answered: false,
    answer: null,
    connected: false,
    startedAt: 0,
    lastHelloReplyAt: -Infinity,
    thirdPartyNotified: false,
  };
}

const hello = (s: RoomState, now: number): RelayMsg => ({
  v: 1,
  t: 'hello',
  from: s.myId,
  ts: now,
});
const helloInterval = (s: RoomState, now: number) =>
  now - s.startedAt >= HELLO_SLOW_AFTER_MS ? HELLO_SLOW_INTERVAL_MS : RELAY_HELLO_INTERVAL_MS;

/** Back to "looking for someone", forgetting the previous peer and session. */
function resetToWaiting(s: RoomState): RoomState {
  return {
    ...s,
    phase: 'waiting',
    peer: null,
    role: null,
    sid: null,
    offerToken: null,
    answered: false,
    answer: null,
    connected: false,
  };
}

function pair(s: RoomState, peer: string, role: 'caller' | 'callee'): RoomState {
  return {
    ...s,
    phase: 'paired',
    peer,
    role,
    sid: null,
    offerToken: null,
    answered: false,
    answer: null,
    connected: false,
  };
}

function replyHello(s: RoomState, now: number): { state: RoomState; effects: RoomEffect[] } {
  if (now - s.lastHelloReplyAt < HELLO_REPLY_MIN_GAP_MS) return { state: s, effects: [] };
  return {
    state: { ...s, lastHelloReplyAt: now },
    effects: [{ kind: 'publish', msg: hello(s, now) }],
  };
}

function onHello(s: RoomState, msg: Extract<RelayMsg, { t: 'hello' }>, now: number): Step {
  if (s.phase === 'waiting') {
    const role = s.myId < msg.from ? 'caller' : 'callee';
    const reply = replyHello(pair(s, msg.from, role), now);
    return {
      state: reply.state,
      effects: [
        { kind: 'clear-timer', name: 'hello' },
        { kind: 'notify', what: 'peer-found' },
        ...reply.effects,
        ...(role === 'caller' ? [{ kind: 'create-offer', peer: msg.from } as const] : []),
      ],
    };
  }
  if (s.phase !== 'paired') return { state: s, effects: [] };
  if (msg.from === s.peer) return replyHello(s, now); // the peer has not heard us yet
  if (s.thirdPartyNotified) return { state: s, effects: [] };
  return {
    state: { ...s, thirdPartyNotified: true },
    effects: [{ kind: 'notify', what: 'third-party' }],
  };
}

function onOffer(s: RoomState, msg: Extract<RelayMsg, { t: 'offer' }>): Step {
  if (msg.to !== s.myId || s.phase === 'left') return { state: s, effects: [] };
  // An offer can beat the peer's hello: it names us, so we are the callee.
  const base = s.phase === 'waiting' ? pair(s, msg.from, 'callee') : s;
  const effects: RoomEffect[] =
    s.phase === 'waiting'
      ? [
          { kind: 'clear-timer', name: 'hello' },
          { kind: 'notify', what: 'peer-found' },
        ]
      : [];
  if (base.peer !== msg.from || base.role !== 'callee') return { state: s, effects: [] };
  if (base.sid === msg.sid && base.answer?.sid === msg.sid) {
    // Duplicate offer (the caller's re-send): repeat the same answer.
    return {
      state: base,
      effects: [
        {
          kind: 'publish',
          msg: {
            v: 1,
            t: 'answer',
            from: s.myId,
            to: msg.from,
            sid: msg.sid,
            token: base.answer.token,
          },
        },
      ],
    };
  }
  if (base.sid === msg.sid) return { state: base, effects }; // answer still being prepared
  return {
    state: { ...base, sid: msg.sid, answer: null, connected: false },
    effects: [
      ...effects,
      { kind: 'dispose-session' },
      { kind: 'accept-offer', peer: msg.from, sid: msg.sid, token: msg.token },
    ],
  };
}

function onAnswer(s: RoomState, msg: Extract<RelayMsg, { t: 'answer' }>): Step {
  const ok =
    s.phase === 'paired' &&
    s.role === 'caller' &&
    msg.to === s.myId &&
    msg.from === s.peer &&
    msg.sid === s.sid &&
    !s.answered;
  if (!ok) return { state: s, effects: [] };
  return {
    state: { ...s, answered: true },
    effects: [
      { kind: 'clear-timer', name: 'resend' },
      { kind: 'apply-answer', token: msg.token },
    ],
  };
}

function onBye(s: RoomState, msg: Extract<RelayMsg, { t: 'bye' }>): Step {
  if (s.phase !== 'paired' || msg.from !== s.peer) return { state: s, effects: [] };
  return {
    state: { ...resetToWaiting(s), phase: 'left' },
    effects: [
      { kind: 'clear-timer', name: 'resend' },
      { kind: 'dispose-session' },
      { kind: 'notify', what: 'peer-left' },
    ],
  };
}

/** The whole pairing/negotiation protocol of §7.4, as a pure function. */
export function roomReduce(s: RoomState, e: RoomEvent): Step {
  switch (e.type) {
    case 'join':
      return {
        state: { ...s, startedAt: e.now },
        effects: [
          { kind: 'publish', msg: hello(s, e.now) },
          { kind: 'set-timer', name: 'hello', ms: RELAY_HELLO_INTERVAL_MS },
        ],
      };

    case 'timer': {
      if (e.name === 'hello') {
        if (s.phase !== 'waiting') return { state: s, effects: [] };
        return {
          state: s,
          effects: [
            { kind: 'publish', msg: hello(s, e.now) },
            { kind: 'set-timer', name: 'hello', ms: helloInterval(s, e.now) },
          ],
        };
      }
      if (
        s.phase !== 'paired' ||
        s.role !== 'caller' ||
        s.answered ||
        s.connected ||
        !s.offerToken ||
        !s.sid ||
        !s.peer
      ) {
        return { state: s, effects: [] };
      }
      return {
        state: s,
        effects: [
          {
            kind: 'publish',
            msg: { v: 1, t: 'offer', from: s.myId, to: s.peer, sid: s.sid, token: s.offerToken },
          },
          { kind: 'set-timer', name: 'resend', ms: RELAY_RESEND_MS },
        ],
      };
    }

    case 'message': {
      const m = e.msg;
      if (m.from === s.myId || s.phase === 'left') return { state: s, effects: [] };
      if (m.t === 'hello') return onHello(s, m, e.now);
      if (m.t === 'offer') return onOffer(s, m);
      if (m.t === 'answer') return onAnswer(s, m);
      return onBye(s, m);
    }

    case 'offer-ready': {
      if (s.phase !== 'paired' || s.role !== 'caller' || s.peer !== e.peer)
        return { state: s, effects: [] };
      return {
        state: { ...s, sid: e.sid, offerToken: e.token, answered: false },
        effects: [
          {
            kind: 'publish',
            msg: { v: 1, t: 'offer', from: s.myId, to: e.peer, sid: e.sid, token: e.token },
          },
          { kind: 'set-timer', name: 'resend', ms: RELAY_RESEND_MS },
        ],
      };
    }

    case 'answer-ready': {
      if (s.phase !== 'paired' || s.role !== 'callee' || s.peer !== e.peer || s.sid !== e.sid)
        return { state: s, effects: [] };
      return {
        state: { ...s, answer: { sid: e.sid, token: e.token } },
        effects: [
          {
            kind: 'publish',
            msg: { v: 1, t: 'answer', from: s.myId, to: e.peer, sid: e.sid, token: e.token },
          },
        ],
      };
    }

    case 'session-connected':
      if (s.phase !== 'paired') return { state: s, effects: [] };
      return {
        state: { ...s, connected: true },
        effects: [{ kind: 'clear-timer', name: 'resend' }],
      };

    case 'session-failed':
      // The auto-reconnect: forget the peer, say hello again and accept anyone (a refreshed peer has a new id).
      if (s.phase === 'left') return { state: s, effects: [] };
      return {
        state: resetToWaiting(s),
        effects: [
          { kind: 'clear-timer', name: 'resend' },
          { kind: 'dispose-session' },
          { kind: 'publish', msg: hello(s, e.now) },
          { kind: 'set-timer', name: 'hello', ms: RELAY_HELLO_INTERVAL_MS },
        ],
      };

    case 'leave':
      if (s.phase === 'left') return { state: s, effects: [] };
      return {
        state: { ...s, phase: 'left' },
        effects: [
          { kind: 'publish', msg: { v: 1, t: 'bye', from: s.myId } },
          { kind: 'clear-timer', name: 'hello' },
          { kind: 'clear-timer', name: 'resend' },
          { kind: 'dispose-session' },
        ],
      };
  }
}
