import { describe, expect, it } from 'vitest';
import { RELAY_HELLO_INTERVAL_MS, RELAY_RESEND_MS } from '../../src/config';
import {
  HELLO_REPLY_MIN_GAP_MS,
  HELLO_SLOW_AFTER_MS,
  HELLO_SLOW_INTERVAL_MS,
  initialRoom,
  roomReduce,
  type RoomEffect,
  type RoomEvent,
  type RoomState,
} from '../../src/core/signaling/relay/relay-room';
import type { RelayMsg } from '../../src/core/signaling/relay/messages';

const LOW = '1'.repeat(16); // lower id → caller
const HIGH = '9'.repeat(16); // higher id → callee
const THIRD = '5'.repeat(16);
const SID = '0a0b0c0d';

/** Runs events through the reducer, collecting every effect. */
function run(state: RoomState, ...events: RoomEvent[]) {
  const effects: RoomEffect[] = [];
  for (const e of events) {
    const step = roomReduce(state, e);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}
const kinds = (fx: RoomEffect[]) => fx.map((e) => e.kind);
const published = (fx: RoomEffect[]) =>
  fx
    .filter((e): e is Extract<RoomEffect, { kind: 'publish' }> => e.kind === 'publish')
    .map((e) => e.msg);
const msg = (m: RelayMsg, now = 0): RoomEvent => ({ type: 'message', msg: m, now });
const helloFrom = (from: string, ts = 0): RelayMsg => ({ v: 1, t: 'hello', from, ts });
const offerTo = (to: string, from: string, sid = SID, token = 'OFFER'): RelayMsg => ({
  v: 1,
  t: 'offer',
  from,
  to,
  sid,
  token,
});
const answerTo = (to: string, from: string, sid = SID, token = 'ANSWER'): RelayMsg => ({
  v: 1,
  t: 'answer',
  from,
  to,
  sid,
  token,
});

describe('joining and the hello loop', () => {
  it('join: say hello now and again every 3 s', () => {
    const { state, effects } = run(initialRoom(LOW), { type: 'join', now: 100 });
    expect(published(effects)).toEqual([helloFrom(LOW, 100)]);
    expect(effects).toContainEqual({
      kind: 'set-timer',
      name: 'hello',
      ms: RELAY_HELLO_INTERVAL_MS,
    });
    expect(state.phase).toBe('waiting');
  });
  it('the hello timer re-publishes while unpaired and re-arms itself', () => {
    const { effects } = run(
      initialRoom(LOW),
      { type: 'join', now: 0 },
      { type: 'timer', name: 'hello', now: 3000 },
    );
    expect(published(effects)).toHaveLength(2);
    expect(effects.at(-1)).toEqual({
      kind: 'set-timer',
      name: 'hello',
      ms: RELAY_HELLO_INTERVAL_MS,
    });
  });
  it('after 10 minutes it slows to every 10 s, and keeps going', () => {
    const joined = run(initialRoom(LOW), { type: 'join', now: 0 }).state;
    const { effects } = run(joined, { type: 'timer', name: 'hello', now: HELLO_SLOW_AFTER_MS + 1 });
    expect(effects.at(-1)).toEqual({
      kind: 'set-timer',
      name: 'hello',
      ms: HELLO_SLOW_INTERVAL_MS,
    });
  });
  it('the hello timer does nothing once paired or left', () => {
    const paired = run(initialRoom(HIGH), msg(helloFrom(LOW))).state;
    expect(run(paired, { type: 'timer', name: 'hello', now: 5 }).effects).toEqual([]);
    const left = run(paired, { type: 'leave' }).state;
    expect(run(left, { type: 'timer', name: 'hello', now: 5 }).effects).toEqual([]);
  });
});

describe('pairing and roles', () => {
  it('the LOWER id becomes the caller and starts an offer; the higher is the callee', () => {
    const low = run(initialRoom(LOW), msg(helloFrom(HIGH), 1000));
    expect(low.state).toMatchObject({ phase: 'paired', peer: HIGH, role: 'caller' });
    expect(low.effects).toContainEqual({ kind: 'create-offer', peer: HIGH });
    const high = run(initialRoom(HIGH), msg(helloFrom(LOW), 1000));
    expect(high.state).toMatchObject({ phase: 'paired', peer: LOW, role: 'callee' });
    expect(kinds(high.effects)).not.toContain('create-offer');
  });
  it('both sides always agree on exactly one caller', () => {
    const a = run(initialRoom(LOW), msg(helloFrom(HIGH))).state.role;
    const b = run(initialRoom(HIGH), msg(helloFrom(LOW))).state.role;
    expect([a, b].sort()).toEqual(['callee', 'caller']);
  });
  it('pairing stops the hello loop, announces the peer and replies once', () => {
    const { effects } = run(initialRoom(HIGH), msg(helloFrom(LOW), 5000));
    expect(effects).toContainEqual({ kind: 'clear-timer', name: 'hello' });
    expect(effects).toContainEqual({ kind: 'notify', what: 'peer-found' });
    expect(published(effects)).toEqual([helloFrom(HIGH, 5000)]);
  });
  it('replies to a repeating peer, but at most once per 2 s', () => {
    const paired = run(initialRoom(HIGH), msg(helloFrom(LOW), 10_000)).state;
    expect(
      published(run(paired, msg(helloFrom(LOW), 10_000 + HELLO_REPLY_MIN_GAP_MS - 1)).effects),
    ).toEqual([]);
    expect(
      published(run(paired, msg(helloFrom(LOW), 10_000 + HELLO_REPLY_MIN_GAP_MS)).effects),
    ).toHaveLength(1);
  });
  it('ignores its own messages, whatever they are', () => {
    const s = initialRoom(LOW);
    for (const m of [
      helloFrom(LOW),
      offerTo(HIGH, LOW),
      { v: 1, t: 'bye', from: LOW } as RelayMsg,
    ]) {
      expect(run(s, msg(m))).toEqual({ state: s, effects: [] });
    }
  });
});

describe('caller: offer, resend, answer', () => {
  const paired = () => run(initialRoom(LOW), msg(helloFrom(HIGH))).state;

  it('publishes the offer when the session has made it, and re-sends every 4 s', () => {
    const { state, effects } = run(paired(), {
      type: 'offer-ready',
      peer: HIGH,
      sid: SID,
      token: 'OFFER',
    });
    expect(published(effects)).toEqual([offerTo(HIGH, LOW)]);
    expect(effects).toContainEqual({ kind: 'set-timer', name: 'resend', ms: RELAY_RESEND_MS });
    const again = run(state, { type: 'timer', name: 'resend', now: 4000 });
    expect(published(again.effects)).toEqual([offerTo(HIGH, LOW)]);
    expect(again.effects).toContainEqual({
      kind: 'set-timer',
      name: 'resend',
      ms: RELAY_RESEND_MS,
    });
  });
  it('a matching answer is applied once and stops the re-sending', () => {
    const s = run(paired(), { type: 'offer-ready', peer: HIGH, sid: SID, token: 'OFFER' }).state;
    const got = run(s, msg(answerTo(LOW, HIGH)));
    expect(got.effects).toEqual([
      { kind: 'clear-timer', name: 'resend' },
      { kind: 'apply-answer', token: 'ANSWER' },
    ]);
    expect(run(got.state, msg(answerTo(LOW, HIGH))).effects).toEqual([]); // the duplicate is ignored
    expect(run(got.state, { type: 'timer', name: 'resend', now: 9000 }).effects).toEqual([]);
  });
  it('ignores answers for another session, another recipient, or from a stranger', () => {
    const s = run(paired(), { type: 'offer-ready', peer: HIGH, sid: SID, token: 'OFFER' }).state;
    for (const m of [
      answerTo(LOW, HIGH, 'ffffffff'),
      answerTo(THIRD, HIGH),
      answerTo(LOW, THIRD),
    ]) {
      expect(run(s, msg(m)).effects).toEqual([]);
    }
  });
  it('stops re-sending once the session is connected', () => {
    const s = run(
      paired(),
      { type: 'offer-ready', peer: HIGH, sid: SID, token: 'OFFER' },
      { type: 'session-connected' },
    );
    expect(s.effects.at(-1)).toEqual({ kind: 'clear-timer', name: 'resend' });
    expect(run(s.state, { type: 'timer', name: 'resend', now: 9000 }).effects).toEqual([]);
  });
  it('a late offer-ready for a peer we have since dropped is discarded', () => {
    expect(
      run(paired(), { type: 'offer-ready', peer: THIRD, sid: SID, token: 'OFFER' }).effects,
    ).toEqual([]);
    expect(
      run(initialRoom(LOW), { type: 'offer-ready', peer: HIGH, sid: SID, token: 'OFFER' }).effects,
    ).toEqual([]);
  });
  it('the resend timer is inert before there is an offer', () => {
    expect(run(paired(), { type: 'timer', name: 'resend', now: 1 }).effects).toEqual([]);
  });
});

describe('callee: offer → answer', () => {
  const paired = () => run(initialRoom(HIGH), msg(helloFrom(LOW))).state;

  it('a new offer disposes any old session and asks the host to answer it', () => {
    const { state, effects } = run(paired(), msg(offerTo(HIGH, LOW)));
    expect(effects).toEqual([
      { kind: 'dispose-session' },
      { kind: 'accept-offer', peer: LOW, sid: SID, token: 'OFFER' },
    ]);
    expect(state.sid).toBe(SID);
  });
  it('publishes the answer when it is ready', () => {
    const s = run(paired(), msg(offerTo(HIGH, LOW))).state;
    const { effects, state } = run(s, {
      type: 'answer-ready',
      peer: LOW,
      sid: SID,
      token: 'ANSWER',
    });
    expect(published(effects)).toEqual([answerTo(LOW, HIGH)]);
    expect(state.answer).toEqual({ sid: SID, token: 'ANSWER' });
  });
  it('a duplicate offer (the caller re-sending) repeats the SAME answer and creates no new session', () => {
    const s = run(paired(), msg(offerTo(HIGH, LOW)), {
      type: 'answer-ready',
      peer: LOW,
      sid: SID,
      token: 'ANSWER',
    }).state;
    const dup = run(s, msg(offerTo(HIGH, LOW)));
    expect(published(dup.effects)).toEqual([answerTo(LOW, HIGH)]);
    expect(kinds(dup.effects)).not.toContain('accept-offer');
  });
  it('a duplicate offer while the answer is still being prepared does nothing', () => {
    const s = run(paired(), msg(offerTo(HIGH, LOW))).state;
    expect(run(s, msg(offerTo(HIGH, LOW))).effects).toEqual([]);
  });
  it('a NEW sid (the caller started over) replaces the session', () => {
    const s = run(paired(), msg(offerTo(HIGH, LOW)), {
      type: 'answer-ready',
      peer: LOW,
      sid: SID,
      token: 'ANSWER',
    }).state;
    const next = run(s, msg(offerTo(HIGH, LOW, 'deadbeef', 'OFFER2')));
    expect(next.effects).toEqual([
      { kind: 'dispose-session' },
      { kind: 'accept-offer', peer: LOW, sid: 'deadbeef', token: 'OFFER2' },
    ]);
    expect(next.state.answer).toBeNull();
  });
  it('an offer can arrive before the hello: it pairs us as the callee', () => {
    const { state, effects } = run(initialRoom(HIGH), msg(offerTo(HIGH, LOW)));
    expect(state).toMatchObject({ phase: 'paired', peer: LOW, role: 'callee', sid: SID });
    expect(effects).toContainEqual({ kind: 'clear-timer', name: 'hello' });
    expect(effects).toContainEqual({ kind: 'accept-offer', peer: LOW, sid: SID, token: 'OFFER' });
  });
  it('offers for someone else, from a stranger, or to a caller are ignored', () => {
    expect(run(paired(), msg(offerTo(THIRD, LOW))).effects).toEqual([]);
    expect(run(paired(), msg(offerTo(HIGH, THIRD))).effects).toEqual([]);
    const caller = run(initialRoom(LOW), msg(helloFrom(HIGH))).state;
    expect(run(caller, msg(offerTo(LOW, HIGH))).effects).toEqual([]);
  });
  it('answer-ready for a stale session is discarded', () => {
    const s = run(paired(), msg(offerTo(HIGH, LOW))).state;
    expect(
      run(s, { type: 'answer-ready', peer: LOW, sid: 'ffffffff', token: 'X' }).effects,
    ).toEqual([]);
    expect(run(s, { type: 'answer-ready', peer: THIRD, sid: SID, token: 'X' }).effects).toEqual([]);
  });
});

describe('a third person with the link', () => {
  it('is ignored, and we notify only once', () => {
    const paired = run(initialRoom(HIGH), msg(helloFrom(LOW))).state;
    const first = run(paired, msg(helloFrom(THIRD)));
    expect(first.effects).toEqual([{ kind: 'notify', what: 'third-party' }]);
    expect(first.state).toMatchObject({ peer: LOW, phase: 'paired' }); // the room stays locked to the first pair
    expect(run(first.state, msg(helloFrom(THIRD, 9))).effects).toEqual([]);
  });
});

describe('failure = automatic reconnect', () => {
  it('goes back to waiting, says hello again and accepts anyone (a refreshed peer has a NEW id)', () => {
    const connected = run(initialRoom(HIGH), msg(helloFrom(LOW)), msg(offerTo(HIGH, LOW)), {
      type: 'session-connected',
    }).state;
    const failed = run(connected, { type: 'session-failed', now: 50_000 });
    expect(failed.state).toMatchObject({
      phase: 'waiting',
      peer: null,
      role: null,
      sid: null,
      connected: false,
    });
    expect(failed.effects).toContainEqual({ kind: 'dispose-session' });
    expect(published(failed.effects)).toEqual([helloFrom(HIGH, 50_000)]);
    expect(failed.effects).toContainEqual({
      kind: 'set-timer',
      name: 'hello',
      ms: RELAY_HELLO_INTERVAL_MS,
    });
    // ...and the peer comes back with a different id:
    const NEW_ID = '3'.repeat(16);
    const again = run(failed.state, msg(helloFrom(NEW_ID), 51_000));
    expect(again.state).toMatchObject({ phase: 'paired', peer: NEW_ID });
  });
  it('the old pairing does not leak: stale answers from the previous peer are ignored', () => {
    const s = run(
      initialRoom(LOW),
      msg(helloFrom(HIGH)),
      { type: 'offer-ready', peer: HIGH, sid: SID, token: 'OFFER' },
      { type: 'session-failed', now: 1 },
    ).state;
    expect(run(s, msg(answerTo(LOW, HIGH))).effects).toEqual([]);
  });
  it('can re-pair with the SAME peer id (both sides failed at once)', () => {
    const s = run(initialRoom(LOW), msg(helloFrom(HIGH)), { type: 'session-failed', now: 1 }).state;
    expect(run(s, msg(helloFrom(HIGH), 2)).state).toMatchObject({
      phase: 'paired',
      peer: HIGH,
      role: 'caller',
    });
  });
  it('is ignored after leaving', () => {
    const left = run(initialRoom(LOW), { type: 'leave' }).state;
    expect(run(left, { type: 'session-failed', now: 1 }).effects).toEqual([]);
  });
});

describe('bye and leave', () => {
  it('a bye from the peer ends the pairing and tells the host', () => {
    const paired = run(initialRoom(HIGH), msg(helloFrom(LOW))).state;
    const { state, effects } = run(paired, msg({ v: 1, t: 'bye', from: LOW }));
    expect(state.phase).toBe('left');
    expect(effects).toEqual([
      { kind: 'clear-timer', name: 'resend' },
      { kind: 'dispose-session' },
      { kind: 'notify', what: 'peer-left' },
    ]);
  });
  it('a bye from a stranger, or while still unpaired, is ignored', () => {
    const paired = run(initialRoom(HIGH), msg(helloFrom(LOW))).state;
    expect(run(paired, msg({ v: 1, t: 'bye', from: THIRD })).effects).toEqual([]);
    expect(run(initialRoom(HIGH), msg({ v: 1, t: 'bye', from: LOW })).effects).toEqual([]);
  });
  it('leaving says bye, stops every timer and drops the session — and only once', () => {
    const { state, effects } = run(initialRoom(LOW), { type: 'join', now: 0 }, { type: 'leave' });
    expect(published(effects).at(-1)).toEqual({ v: 1, t: 'bye', from: LOW });
    expect(effects).toContainEqual({ kind: 'clear-timer', name: 'hello' });
    expect(effects).toContainEqual({ kind: 'clear-timer', name: 'resend' });
    expect(effects).toContainEqual({ kind: 'dispose-session' });
    expect(run(state, { type: 'leave' }).effects).toEqual([]);
  });
  it('nothing is processed after leaving', () => {
    const left = run(initialRoom(HIGH), { type: 'leave' }).state;
    for (const m of [helloFrom(LOW), offerTo(HIGH, LOW)])
      expect(run(left, msg(m)).effects).toEqual([]);
  });
  it('session-connected before pairing is a no-op', () => {
    expect(run(initialRoom(LOW), { type: 'session-connected' }).effects).toEqual([]);
  });
});
