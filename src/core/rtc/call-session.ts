import {
  CONNECT_TIMEOUT_MS,
  DISCONNECT_GRACE_MS,
  OFFER_SOFT_EXPIRY_MS,
  PROTOCOL_VERSION,
  RESTART_TIMEOUT_MS,
} from '../../config';
import { bytesEqual, randomBytes } from '../encoding/bytes';
import { buildRemoteSdp, candidateAttribute } from '../sdp/build';
import { extractIceDescription } from '../sdp/extract';
import type { Settings } from '../settings/settings';
import { parseTokenInput } from '../signaling/link';
import { TokenMismatchError } from '../token/errors';
import { computeOfferRef } from '../token/offer-ref';
import { encodeToken } from '../token/token';
import type { IceDescription, Token } from '../token/types';
import { encodeCtl, parseCtl, type Ctl } from './control';
import { diagnose } from './diagnostics';
import { Emitter } from './emitter';
import { trackGathering, type GatherHandle } from './gather';
import { buildRtcConfiguration, gatherTimeoutMs, hasTurn } from './ice-config';
import { MediaBridge } from './media-bridge';
import { Negotiation } from './negotiation';
import { computeCommit, SasExchange } from './sas';
import type {
  DebugInfo,
  FailReason,
  MediaState,
  SessionEvents,
  SessionState,
} from './session-types';
import { parseStats, type StatsSnapshot, type Telemetry } from './stats';
import { TimerBag } from './timers';

export interface SessionOptions {
  settings: Settings;
  appVersion?: string;
  isOnline?: () => boolean;
  /** Debug-only trace sink; never receives tokens or SDP. */
  log?: (line: string) => void;
}

const WAITING_HINT_MS = 2 * 60_000;
const BYE_FLUSH_MS = 100;
const KEEP_WARM_MS = 8000;

function connState(pc: RTCPeerConnection): RTCPeerConnectionState {
  if (pc.connectionState) return pc.connectionState;
  // Fallback for engines without connectionState.
  const ice = pc.iceConnectionState;
  if (ice === 'checking') return 'connecting';
  if (ice === 'completed') return 'connected';
  return ice as RTCPeerConnectionState;
}

/** One 1:1 call: bootstrap over tokens, then everything else over the `ctl` data channel. */
export class CallSession {
  private readonly emitter = new Emitter<SessionEvents>();
  private readonly timers = new TimerBag();
  private disposers: (() => void)[] = [];
  private st: SessionState = { status: 'idle' };
  private role: 'caller' | 'callee' | null = null;
  private pc: RTCPeerConnection | null = null;
  private ctl: RTCDataChannel | null = null;
  private bridge: MediaBridge | null = null;
  private gather: GatherHandle | null = null;
  private sas: SasExchange | null = null;
  private queue: Promise<void> = Promise.resolve();

  private finished = false;
  private ctlOpen = false;
  private ctlEverOpen = false;
  private mediaNegotiated = false;
  private remoteStreamEmitted = false;

  private offerCreds: { ufrag: string; pwd: string } | null = null;
  private localFingerprint: Uint8Array | null = null;
  private remoteTypes: string[] = [];
  private localAudio: MediaStreamTrack | null = null;
  private localVideo: MediaStreamTrack | null = null;
  private localMedia: MediaState | null = null;
  private prevStats: StatsSnapshot | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: SessionOptions) {}

  // ---------- public API ----------

  get state(): SessionState {
    return this.st;
  }

  on<K extends keyof SessionEvents>(event: K, fn: (value: SessionEvents[K]) => void): () => void {
    return this.emitter.on(event, fn);
  }

  /** Caller: idle → gathering → awaiting-answer. Returns the invite token. */
  async createOffer(): Promise<string> {
    this.requireStatus('idle');
    this.role = 'caller';
    this.setState({ status: 'gathering' });
    try {
      const pc = await this.setupPeer();
      const gather = this.startGather(pc);
      await pc.setLocalDescription();
      await gather.done;
      const desc = extractIceDescription(pc.localDescription?.sdp ?? '');
      this.localFingerprint = desc.fingerprint;
      this.offerCreds = { ufrag: desc.ufrag, pwd: desc.pwd };
      const offerToken = encodeToken({ kind: 'offer', ...desc });
      this.timers.set(() => this.emitter.emit('warning', 'invite-old'), OFFER_SOFT_EXPIRY_MS);
      this.setState({ status: 'awaiting-answer', offerToken, createdAt: Date.now() });
      return offerToken;
    } catch (e) {
      this.fail('internal');
      throw e;
    }
  }

  /** Caller: validates the reply (kind, offerRef) and applies it. Bad input throws and can be retried. */
  async acceptAnswer(input: string): Promise<void> {
    this.requireStatus('awaiting-answer');
    const token = parseTokenInput(input, 'answer');
    const creds = this.offerCreds;
    if (!creds || !this.pc || !this.localFingerprint) throw new Error('session not ready');
    const expected = await computeOfferRef(creds.ufrag, creds.pwd);
    if (!token.offerRef || !bytesEqual(token.offerRef, expected)) {
      throw new TokenMismatchError('This reply code belongs to a different invite');
    }
    this.requireStatus('awaiting-answer'); // a concurrent submit may have won
    this.setState({ status: 'connecting' });
    this.remoteTypes = token.candidates.map((c) => c.type);
    this.sas = new SasExchange({
      role: 'caller',
      localFingerprint: this.localFingerprint,
      remoteFingerprint: token.fingerprint,
      ...(token.commit ? { commit: token.commit } : {}),
    });
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: buildRemoteSdp(token) });
      this.connectTimer = this.timers.set(() => this.fail('connect-timeout'), CONNECT_TIMEOUT_MS);
    } catch (e) {
      this.fail('internal');
      throw e;
    }
  }

  /** Callee: idle → gathering → awaiting-connection. Returns the reply token. */
  async acceptOffer(input: string): Promise<string> {
    this.requireStatus('idle');
    const offer = parseTokenInput(input, 'offer');
    this.role = 'callee';
    this.remoteTypes = offer.candidates.map((c) => c.type);
    this.setState({ status: 'gathering' });
    try {
      const pc = await this.setupPeer();
      await pc.setRemoteDescription({
        type: 'offer',
        sdp: buildRemoteSdp(offer),
      });
      const gather = this.startGather(pc);
      await pc.setLocalDescription();
      await gather.done;
      const desc: IceDescription = extractIceDescription(pc.localDescription?.sdp ?? '');
      const nonce = randomBytes(16);
      this.sas = new SasExchange({
        role: 'callee',
        localFingerprint: desc.fingerprint,
        remoteFingerprint: offer.fingerprint,
        nonce,
      });
      const answerToken = encodeToken({
        kind: 'answer',
        ...desc,
        commit: await computeCommit(nonce),
        offerRef: await computeOfferRef(offer.ufrag, offer.pwd),
      });
      this.timers.set(() => this.emitter.emit('warning', 'waiting-for-caller'), WAITING_HINT_MS);
      this.keepWarm(pc, offer);
      this.setState({ status: 'awaiting-connection', answerToken });
      return answerToken;
    } catch (e) {
      this.fail('internal');
      throw e;
    }
  }

  hangup(): void {
    if (this.finished) return;
    const wasOpen = this.ctlOpen;
    if (wasOpen) this.send({ t: 'bye' });
    this.finish({ status: 'ended', reason: 'local-hangup' }, wasOpen);
  }

  /** Local tracks stay owned by the caller (MediaController); the session only swaps them in. */
  async attachLocalTracks(
    audio: MediaStreamTrack | null,
    video: MediaStreamTrack | null,
  ): Promise<void> {
    this.localAudio = audio;
    this.localVideo = video;
    await this.bridge?.attachLocal(audio, video);
  }

  sendMediaState(s: MediaState): void {
    this.localMedia = s;
    this.send({ t: 'media', mic: s.mic, cam: s.cam });
  }

  async getTelemetry(): Promise<Telemetry> {
    if (!this.pc) throw new Error('no peer connection');
    const { telemetry, snapshot } = parseStats(
      await this.pc.getStats(),
      this.prevStats,
      Date.now(),
    );
    this.prevStats = snapshot;
    return telemetry;
  }

  /** Leak counters for tests and the debug harness. */
  get debugInfo(): DebugInfo {
    return {
      status: this.st.status,
      connectionState: this.pc?.connectionState ?? 'none',
      ctlState: this.ctl?.readyState ?? 'none',
      activeTimers: this.timers.size,
      activeListeners: this.disposers.length,
    };
  }

  // ---------- setup ----------

  private requireStatus(status: SessionState['status']): void {
    if (this.st.status !== status)
      throw new Error(`session is ${this.st.status}, expected ${status}`);
  }

  private async setupPeer(): Promise<RTCPeerConnection> {
    let certificates: RTCCertificate[] | undefined;
    try {
      certificates = [
        await RTCPeerConnection.generateCertificate({
          name: 'ECDSA',
          namedCurve: 'P-256',
        } as EcKeyGenParams),
      ];
    } catch {
      certificates = undefined;
    }
    const pc = new RTCPeerConnection(buildRtcConfiguration(this.opts.settings, certificates));
    this.pc = pc;
    const bridge = new MediaBridge(pc);
    this.bridge = bridge;
    await bridge.attachLocal(this.localAudio, this.localVideo);

    const negotiation = new Negotiation({
      pc,
      polite: this.role === 'callee',
      send: (m) => this.send(m),
      beforeAnswer: () => bridge.prepareForAnswer(),
      onSettled: () => {
        this.mediaNegotiated = true;
        this.maybeConnected();
      },
    });
    this.negotiation = negotiation;

    this.listen(pc, 'negotiationneeded', () => {
      if (!this.ctlOpen) return;
      negotiation.onNegotiationNeeded().catch(() => this.fail('internal'));
    });
    this.listen(pc, 'icecandidate', (e) => {
      const c = (e as RTCPeerConnectionIceEvent).candidate;
      if (c && this.ctlOpen) this.send({ t: 'ice', c: c.toJSON() });
    });
    this.listen(pc, 'track', (e) => {
      const first = bridge.handleTrack((e as RTCTrackEvent).track);
      if (first && !this.remoteStreamEmitted) {
        this.remoteStreamEmitted = true;
        this.emitter.emit('remoteStream', bridge.remoteStream);
      }
    });
    this.listen(pc, 'connectionstatechange', () => this.onConnectionState());
    if (pc.connectionState === undefined) {
      this.listen(pc, 'iceconnectionstatechange', () => this.onConnectionState());
    }
    this.listen(globalThis, 'pagehide', () => this.hangup());

    const ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0, ordered: true });
    this.ctl = ctl;
    this.listen(ctl, 'open', () => this.onCtlOpen());
    this.listen(ctl, 'message', (e) => {
      const data = (e as MessageEvent).data as unknown;
      this.enqueue(() => this.onCtlMessage(data));
    });
    this.listen(ctl, 'close', () => {
      this.log('ctl close');
      this.enqueue(async () => {
        if (!this.finished) this.fail('ice-failed');
      });
    });
    return pc;
  }

  private negotiation: Negotiation | null = null;

  /**
   * PLAN-NOTE (not in the plan): in manual mode the callee's ICE checks start long before the caller
   * has entered the reply, and the caller answers them without knowing us yet. If the callee then
   * goes quiet, that half-open state goes stale and the call dies the moment the reply is applied
   * (measured: a Firefox callee failed whenever the reply took more than ~30 s). Re-adding the
   * invite's candidates makes the callee's ICE agent re-ping the caller, which keeps it alive.
   */
  private keepWarm(pc: RTCPeerConnection, offer: Token): void {
    const tick = () => {
      if (this.finished || this.ctlEverOpen) return;
      offer.candidates.forEach((c, i) => {
        pc.addIceCandidate({
          candidate: candidateAttribute(c, i),
          sdpMid: offer.mid,
          sdpMLineIndex: 0,
        }).catch(
          () => undefined, // duplicates are rejected by some engines; that is fine
        );
      });
      this.timers.set(tick, KEEP_WARM_MS);
    };
    this.timers.set(tick, KEEP_WARM_MS);
  }

  private startGather(pc: RTCPeerConnection): GatherHandle {
    this.gather = trackGathering(pc, gatherTimeoutMs(this.opts.settings), this.timers);
    return this.gather;
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.disposers.push(() => target.removeEventListener(type, fn));
  }

  // ---------- control channel ----------

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch(() => this.fail('internal'));
  }

  private send(msg: Ctl): void {
    const ctl = this.ctl;
    if (!ctl || ctl.readyState !== 'open') return;
    try {
      ctl.send(encodeCtl(msg));
    } catch {
      /* best effort: a dead channel is handled by connection monitoring */
    }
  }

  private onCtlOpen(): void {
    if (this.finished) return;
    this.ctlOpen = true;
    this.ctlEverOpen = true;
    this.log('ctl open');
    if (this.st.status === 'connecting' || this.st.status === 'awaiting-connection') {
      this.setState({ status: 'negotiating-media' });
    }
    this.send({ t: 'hello', proto: PROTOCOL_VERSION, app: this.opts.appVersion ?? '0.0.0' });
    if (this.localMedia) this.sendMediaState(this.localMedia);
    if (this.role === 'caller') {
      const sas1 = this.sas?.begin();
      if (sas1) this.send(sas1);
      this.bridge?.addCallerTransceivers();
    } else if (!this.connectTimer) {
      this.connectTimer = this.timers.set(() => this.fail('connect-timeout'), CONNECT_TIMEOUT_MS);
    }
  }

  private async onCtlMessage(data: unknown): Promise<void> {
    if (this.finished) return;
    const msg = parseCtl(data);
    if (!msg) return;
    switch (msg.t) {
      case 'hello':
        if (msg.proto !== PROTOCOL_VERSION) this.fail('protocol-mismatch');
        return;
      case 'sdp':
      case 'ice':
        await this.negotiation?.handle(msg);
        return;
      case 'sas1':
      case 'sas2': {
        const out = await this.sas?.handle(msg);
        if (!out) return;
        if (out.error) return void this.fail(out.error);
        if (out.send) this.send(out.send);
        if (out.code) this.emitter.emit('sas', out.code);
        return;
      }
      case 'media':
        this.emitter.emit('remoteMediaState', { mic: msg.mic, cam: msg.cam });
        return;
      case 'bye':
        this.finish({ status: 'ended', reason: 'remote-hangup' }, false);
        return;
    }
  }

  // ---------- connection monitoring ----------

  private onConnectionState(): void {
    const pc = this.pc;
    if (this.finished || !pc) return;
    const cs = connState(pc);
    this.log(`pc connection=${cs} ice=${pc.iceConnectionState}`);
    if (cs !== 'disconnected') {
      this.timers.clear(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (cs === 'connected') {
      this.maybeConnected();
    } else if (cs === 'disconnected') {
      if (this.ctlEverOpen && !this.disconnectTimer) {
        this.disconnectTimer = this.timers.set(() => this.startReconnect(), DISCONNECT_GRACE_MS);
      }
    } else if (cs === 'failed') {
      // PLAN-NOTE: before `ctl` has ever opened, the callee cannot know whether the caller has
      // applied the reply yet (manual mode can take minutes), so ICE failure there is not final.
      if (this.st.status === 'reconnecting') return;
      if (!this.ctlEverOpen && this.role === 'callee') return;
      this.fail('ice-failed');
    }
  }

  private startReconnect(): void {
    this.disconnectTimer = null;
    if (this.finished || !this.pc) return;
    this.setState({ status: 'reconnecting' });
    this.restartTimer = this.timers.set(() => this.fail('restart-timeout'), RESTART_TIMEOUT_MS);
    if (this.role === 'caller') this.pc.restartIce?.();
  }

  private maybeConnected(): void {
    const pc = this.pc;
    if (this.finished || !pc || !this.ctlOpen || !this.mediaNegotiated) return;
    if (connState(pc) !== 'connected') return;
    const s = this.st.status;
    if (s !== 'negotiating-media' && s !== 'reconnecting') return;
    this.timers.clear(this.connectTimer);
    this.timers.clear(this.restartTimer);
    this.connectTimer = this.restartTimer = null;
    this.setState({ status: 'connected' });
  }

  private log(line: string): void {
    this.opts.log?.(line);
  }

  // ---------- state & teardown ----------

  private setState(state: SessionState): void {
    this.log(`state ${state.status}`);
    this.st = state;
    this.emitter.emit('state', state);
  }

  private fail(reason: FailReason): void {
    if (this.finished) return;
    this.log(`fail ${reason}`);
    const withDiagnostics =
      reason === 'connect-timeout' || reason === 'ice-failed' || reason === 'restart-timeout';
    const state: SessionState = { status: 'failed', reason };
    if (withDiagnostics) {
      state.diagnostics = diagnose({
        localCandidateTypes: this.gather?.localTypes() ?? [],
        remoteCandidateTypes: this.remoteTypes,
        turnConfigured: hasTurn(this.opts.settings),
        online: this.opts.isOnline?.() ?? globalThis.navigator?.onLine ?? true,
      });
    }
    this.finish(state, false);
  }

  private finish(state: SessionState, flushBye: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.setState(state);
    if (flushBye) {
      // Give the `bye` a moment to leave before the transport is torn down.
      this.timers.set(() => this.teardown(), BYE_FLUSH_MS);
    } else {
      this.teardown();
    }
  }

  private teardown(): void {
    this.timers.clearAll();
    this.gather?.stop();
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    try {
      this.ctl?.close();
    } catch {
      /* already closed */
    }
    try {
      this.pc?.close();
    } catch {
      /* already closed */
    }
    this.ctlOpen = false;
  }
}
