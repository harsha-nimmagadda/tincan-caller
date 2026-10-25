import { buildLink } from '../core/signaling/link';
import {
  decodeRoomSecret,
  encodeRoomSecret,
  newInstanceId,
  newRoomSecret,
} from '../core/signaling/relay/messages';
import {
  RelayController,
  type RelayHost,
  type RelayStatus,
} from '../core/signaling/relay/relay-controller';
import { clearResume, loadResume, saveResume } from '../core/signaling/relay/resume';
import { call, hooks } from './services';
import type { RelaySlice, StoreGet, StoreSet } from './types';

const baseUrl = () => `${location.origin}${location.pathname}`;
const CONNECTING: RelayStatus = {
  phase: 'connecting',
  relaysConnected: 0,
  relaysTotal: 0,
  unreachable: false,
};

// Not React state: the live room, and what is needed to re-enter it.
let controller: RelayController | null = null;
let room: { secret: Uint8Array; creator: boolean } | null = null;
let allowedThisCall = false;

export function createRelaySlice(set: StoreSet, get: StoreGet): RelaySlice {
  const internals = () => {
    if (!hooks.internals) throw new Error('call slice not ready');
    return hooks.internals;
  };

  const leaveRoom = () => {
    controller?.leave();
    controller = null;
    clearResume();
  };

  /** What the room protocol needs from the call: sessions to start, answer and drop. */
  const host: RelayHost = {
    createOffer: async () => {
      const s = internals().newSession(true);
      await internals().attachLocal(s);
      return s.createOffer();
    },
    acceptOffer: async (token) => {
      const s = internals().newSession(true);
      await internals().attachLocal(s);
      return s.acceptOffer(token);
    },
    applyAnswer: async (token) => {
      const s = call.session;
      if (!s) throw new Error('no session');
      await s.acceptAnswer(token);
    },
    disposeSession: () => internals().disposeSession(),
    notice: (what) => {
      if (what === 'third-party') return get().toast('toast.relayThirdParty');
      // The peer left the room: that is a hangup. Dispose first so the ended state is ours.
      internals().disposeSession();
      internals().finishCall({ status: 'ended', reason: 'remote-hangup' });
    },
  };

  const openRoom = async (secret: Uint8Array, creator: boolean) => {
    leaveRoom();
    room = { secret, creator };
    saveResume({ secret: encodeRoomSecret(secret), creator });
    const link = buildLink(baseUrl(), 'relay', encodeRoomSecret(secret));
    set({
      role: creator ? 'caller' : 'callee',
      mode: 'relay',
      screen: creator ? 'create' : 'join',
      pendingRelaySecret: secret,
      relay: { status: CONNECTING, link, creator },
      relayWaiting: false,
      relayCanRejoin: false,
      endInfo: null,
    });
    const showStatus = (status: RelayStatus) =>
      set((s) => (s.relay ? { relay: { ...s.relay, status } } : {}));
    try {
      // Lazy: nostr-tools and the crypto only load when relay mode is actually used.
      const { openNostrTransport } = await import('../core/signaling/relay/nostr-transport');
      const transport = await openNostrTransport({ secret, relays: get().settings.relays });
      if (room?.secret !== secret || get().relay === null) return void transport.close(); // cancelled while loading
      controller = new RelayController({
        myId: newInstanceId(),
        transport,
        host,
        onStatus: showStatus,
      });
      controller.start();
    } catch {
      showStatus({
        phase: 'connecting',
        relaysConnected: 0,
        relaysTotal: get().settings.relays.length,
        unreachable: true,
      });
    }
  };

  const enterLobby = () => {
    set({ screen: 'lobby' });
    void get().startMedia();
  };

  hooks.relay = {
    handleState: (st) => {
      if (!controller) return false;
      if (st.status === 'connected') {
        controller.sessionConnected();
        if (get().screen === 'in-call') internals().resumeCall();
        else internals().enterCall();
        return true;
      }
      if (st.status === 'failed') {
        // Not the end of the call: look for the peer again (the room is still open).
        controller.sessionFailed();
        set({ relayWaiting: get().screen === 'in-call', remoteStream: null });
        return true;
      }
      return false;
    },
    onCallFinished: (st) => {
      const rejoin = st.status === 'ended' && st.reason === 'remote-hangup' && room !== null;
      leaveRoom();
      return rejoin;
    },
    reset: () => {
      leaveRoom();
      room = null;
      allowedThisCall = false;
    },
  };

  return {
    mode: 'manual',
    relay: null,
    relayWaiting: false,
    relayConsent: null,
    relayCanRejoin: false,
    pendingRelaySecret: null,

    setLobbyMode: (mode) => {
      if (mode === 'relay' && !get().settings.relayEnabled && !allowedThisCall)
        set({ relayConsent: 'lobby' });
      else set({ mode });
    },

    allowRelay: () => {
      allowedThisCall = true;
      const from = get().relayConsent;
      set({ relayConsent: null });
      if (from === 'lobby') set({ mode: 'relay' });
      else if (from === 'link') enterLobby();
    },

    denyRelay: () => {
      const from = get().relayConsent;
      set({ relayConsent: null });
      if (from === 'link') get().goHome();
    },

    openRelayLink: (value) => {
      const secret = decodeRoomSecret(value);
      if (!secret) return get().toast('toast.relayBadLink');
      get().goHome();
      set({ role: 'callee', mode: 'relay', pendingRelaySecret: secret });
      // Consent is never stored silently: ask unless relays are switched on in Settings.
      if (get().settings.relayEnabled) enterLobby();
      else set({ relayConsent: 'link' });
    },

    startRelayRoom: async () => {
      const { role, pendingRelaySecret } = get();
      const creator = role === 'caller';
      const secret = pendingRelaySecret ?? (creator ? newRoomSecret() : null);
      if (secret) await openRoom(secret, creator);
    },

    /** After a reload: rejoin the room this tab was in, with no extra taps. */
    resumeRelay: async () => {
      const record = loadResume();
      const secret = record ? decodeRoomSecret(record.secret) : null;
      if (!record || !secret) return;
      allowedThisCall = true; // this tab already said yes
      set({
        role: record.creator ? 'caller' : 'callee',
        mode: 'relay',
        pendingRelaySecret: secret,
        screen: 'lobby',
      });
      await get().startMedia();
      if (get().mediaReady) await get().continueFromLobby(); // otherwise the lobby explains what is missing
    },

    switchToManual: async () => {
      const creator = get().relay?.creator === true;
      leaveRoom();
      room = null;
      if (!creator) return get().goHome();
      set({ mode: 'manual', relay: null, pendingRelaySecret: null });
      await internals().createInvite();
    },

    rejoinRelay: () => {
      const previous = room;
      get().goHome();
      if (!previous) return;
      room = previous;
      set({
        role: previous.creator ? 'caller' : 'callee',
        mode: 'relay',
        pendingRelaySecret: previous.secret,
      });
      enterLobby();
    },
  };
}
