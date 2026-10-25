import { APP_VERSION } from '../config';
import { maxBitrate } from '../core/media/constraints';
import { bindCallActions } from '../core/platform/media-session';
import { CallSession } from '../core/rtc/call-session';
import type { SessionState } from '../core/rtc/session-types';
import { STATS_INTERVAL_MS } from '../config';
import { buildLink, extractToken, parseTokenInput } from '../core/signaling/link';
import { listenForAnswers, sendAnswer } from '../core/signaling/tab-bridge';
import { tokenErrorMessage } from './errors';
import { call, getMedia, hooks, wakeLock } from './services';
import type { CallSlice, EndInfo, StoreGet, StoreSet } from './types';

const baseUrl = () => `${location.origin}${location.pathname}`;
const TELEMETRY_IDLE_MS = 3000;

// Module-level handles for things that are not React state.
let stopBridge: (() => void) | null = null;
let unbindMediaSession: (() => void) | null = null;
let telemetryTimer: ReturnType<typeof setTimeout> | null = null;
let pendingEnd: 'codes-mismatch' | null = null;

const FRESH = {
  pendingOffer: null,
  joinError: null,
  session: { status: 'idle' } as SessionState,
  invite: null,
  inviteCreatedAt: null,
  inviteOld: false,
  reply: null,
  waitingHint: false,
  replyError: null,
  callError: null,
  sas: null,
  sasVerified: false,
  remoteStream: null,
  remoteMedia: { mic: true, cam: true },
  telemetry: null,
  callStartedAt: null,
  autoplayBlocked: false,
  relay: null,
  relayWaiting: false,
  relayConsent: null,
} as const;

export function createCallSlice(set: StoreSet, get: StoreGet): CallSlice {
  // ---------- side effects tied to the call ----------

  const startTelemetry = () => {
    const tick = () => {
      const s = call.session;
      if (!s) return;
      s.getTelemetry()
        .then((telemetry) => set({ telemetry }))
        .catch(() => undefined)
        .finally(() => {
          if (call.session === s) {
            telemetryTimer = setTimeout(
              tick,
              get().hudOpen ? STATS_INTERVAL_MS : TELEMETRY_IDLE_MS,
            );
          }
        });
    };
    tick();
  };

  const teardownEffects = () => {
    if (telemetryTimer) clearTimeout(telemetryTimer);
    telemetryTimer = null;
    stopBridge?.();
    stopBridge = null;
    unbindMediaSession?.();
    unbindMediaSession = null;
    void wakeLock.release();
  };

  const disposeSession = () => {
    const s = call.session;
    call.session = null; // handlers ignore events from a session that is no longer current
    s?.hangup();
  };

  const enterCall = () => {
    set({
      screen: 'in-call',
      callStartedAt: Date.now(),
      moreOpen: false,
      hudOpen: get().settings.showStats,
      autoplayBlocked: false,
    });
    history.pushState({ tincan: 'call' }, ''); // so Android Back asks instead of leaving
    void wakeLock.acquire();
    unbindMediaSession = bindCallActions({
      toggleMic: () => get().setMic(!get().local.micOn),
      toggleCam: () => void get().setCam(!get().local.camOn),
      hangup: () => get().hangup(),
    });
    startTelemetry();
  };

  const finishCall = (st: Extract<SessionState, { status: 'ended' | 'failed' }>) => {
    const started = get().callStartedAt;
    const durationMs = started ? Date.now() - started : 0;
    const reason = pendingEnd;
    pendingEnd = null;
    const endInfo: EndInfo =
      st.status === 'ended'
        ? { kind: 'ended', reason: reason ?? st.reason, durationMs }
        : {
            kind: 'failed',
            reason: st.reason,
            ...(st.diagnostics ? { diagnostics: st.diagnostics } : {}),
            durationMs,
          };
    teardownEffects();
    call.session = null;
    get().stopMedia();
    const relayCanRejoin = hooks.relay?.onCallFinished(st) ?? false;
    set({
      ...FRESH,
      relayCanRejoin,
      session: st,
      endInfo,
      screen: 'ended',
      moreOpen: false,
      safetyOpen: false,
      confirm: null,
      hudOpen: false,
    });
  };

  const onState = (st: SessionState) => {
    set({ session: st });
    if (hooks.relay?.handleState(st)) return;
    if (st.status === 'awaiting-answer') {
      // Same-browser reply links hand their code to this tab (§8.3).
      stopBridge ??= listenForAnswers(async (token) => {
        const s = call.session;
        if (s?.state.status !== 'awaiting-answer') return false;
        try {
          await s.acceptAnswer(token);
          return true;
        } catch {
          return false;
        }
      });
    } else {
      stopBridge?.();
      stopBridge = null;
    }
    if (st.status === 'connected' && get().screen !== 'in-call') enterCall();
    if (st.status === 'ended' || st.status === 'failed') finishCall(st);
  };

  const newSession = (relayMode = false): CallSession => {
    const { settings } = get();
    const s = new CallSession({
      settings,
      appVersion: APP_VERSION,
      // A reload in relay mode is a dropout to reconnect from, not a hangup.
      byeOnPageHide: !relayMode,
    });
    call.session = s;
    call.last = s;
    const current =
      <T>(fn: (v: T) => void) =>
      (v: T) => {
        if (call.session === s) fn(v);
      };
    s.on('state', current(onState));
    s.on(
      'remoteStream',
      current((remoteStream) => set({ remoteStream })),
    );
    s.on(
      'remoteMediaState',
      current((remoteMedia) => set({ remoteMedia })),
    );
    s.on(
      'sas',
      current((sas) => set({ sas })),
    );
    s.on(
      'warning',
      current((w) => set(w === 'invite-old' ? { inviteOld: true } : { waitingHint: true })),
    );
    void s.setMaxVideoBitrate(maxBitrate(settings.quality));
    return s;
  };

  const attachLocal = async (s: CallSession) => {
    const m = getMedia().snapshot;
    await s.attachLocalTracks(m.audio, m.video);
    s.sendMediaState({ mic: m.micOn, cam: m.camOn });
  };

  const createInvite = async () => {
    const s = newSession();
    set({ ...FRESH, role: 'caller', screen: 'create', session: s.state });
    await attachLocal(s);
    try {
      const token = await s.createOffer();
      if (call.session !== s) return;
      set({
        invite: { token, link: buildLink(baseUrl(), 'offer', token) },
        inviteCreatedAt: Date.now(),
      });
    } catch {
      /* the session reported `failed`; the ended screen explains it */
    }
  };

  /** After a relay reconnect: the call screen stays; stats and per-connection state start over. */
  const resumeCall = () => {
    if (telemetryTimer) clearTimeout(telemetryTimer);
    set({
      relayWaiting: false,
      remoteMedia: { mic: true, cam: true },
      sas: null,
      sasVerified: false,
      telemetry: null,
    });
    startTelemetry();
  };

  const acceptInvite = async () => {
    const offer = get().pendingOffer;
    if (!offer) return;
    const s = newSession();
    set({ ...FRESH, role: 'callee', pendingOffer: offer, screen: 'join', session: s.state });
    await attachLocal(s);
    try {
      const token = await s.acceptOffer(offer);
      if (call.session !== s) return;
      set({ reply: { token, link: buildLink(baseUrl(), 'answer', token) } });
    } catch (e) {
      if (call.session === s && s.state.status === 'idle') {
        set({ callError: tokenErrorMessage(e, 'invite') });
      }
    }
  };

  hooks.internals = {
    newSession,
    attachLocal,
    disposeSession,
    enterCall,
    resumeCall,
    finishCall,
    createInvite,
  };

  return {
    role: null,
    ...FRESH,
    endInfo: null,
    bridge: null,

    startCall: () => {
      get().goHome();
      set({
        role: 'caller',
        screen: 'lobby',
        mode: get().settings.relayEnabled ? 'relay' : 'manual',
      });
      void get().startMedia();
    },

    submitJoinCode: (input) => {
      try {
        parseTokenInput(input, 'offer');
      } catch (e) {
        set({ joinError: tokenErrorMessage(e, 'invite') });
        return false;
      }
      get().goHome();
      set({ role: 'callee', pendingOffer: extractToken(input), screen: 'lobby' });
      void get().startMedia();
      return true;
    },
    clearJoinError: () => set({ joinError: null }),

    continueFromLobby: async () => {
      if (get().mode === 'relay') await get().startRelayRoom();
      else if (get().role === 'caller') await createInvite();
      else await acceptInvite();
    },

    newInvite: async () => {
      disposeSession();
      teardownEffects();
      await createInvite();
    },

    submitReply: async (input) => {
      const s = call.session;
      if (s?.state.status !== 'awaiting-answer') return;
      set({ replyError: null });
      try {
        await s.acceptAnswer(input);
      } catch (e) {
        if (call.session === s && s.state.status === 'awaiting-answer') {
          set({ replyError: tokenErrorMessage(e, 'reply') });
        }
      }
    },
    clearReplyError: () => set({ replyError: null }),

    hangup: () => {
      if (call.session) call.session.hangup();
      else get().goHome();
    },

    confirmCodes: (match) => {
      if (match) return set({ sasVerified: true, safetyOpen: false });
      pendingEnd = 'codes-mismatch';
      get().hangup();
    },

    setAutoplayBlocked: (autoplayBlocked) => set({ autoplayBlocked }),

    goHome: () => {
      hooks.relay?.reset();
      disposeSession();
      teardownEffects();
      get().stopMedia();
      pendingEnd = null;
      set({
        ...FRESH,
        role: null,
        mode: 'manual',
        pendingRelaySecret: null,
        relayCanRejoin: false,
        endInfo: null,
        bridge: null,
        screen: 'home',
        confirm: null,
        hudOpen: false,
      });
    },

    openBridge: async (token) => {
      set({ screen: 'bridge', bridge: { token, status: 'checking' } });
      const accepted = await sendAnswer(token);
      set({ bridge: { token, status: accepted ? 'done' : 'manual' } });
    },
  };
}
