import { TimerBag } from '../../rtc/timers';
import { newSessionId, type RelayMsg } from './messages';
import {
  initialRoom,
  roomReduce,
  type RoomEffect,
  type RoomEvent,
  type RoomState,
  type TimerName,
} from './relay-room';

/** Connection to the relays. Messages arrive already decrypted, validated and de-duplicated. */
export interface RelayTransport {
  publish(msg: RelayMsg): Promise<void>;
  onMessage(cb: (msg: RelayMsg) => void): () => void;
  status(): { connected: number; total: number };
  onStatus(cb: () => void): () => void;
  close(): void;
}

/** What the controller needs from the call: sessions it can start, answer and drop. */
export interface RelayHost {
  /** Start a fresh caller session; resolves to its offer token. */
  createOffer(): Promise<string>;
  /** Start a fresh callee session from the peer's offer; resolves to the answer token. */
  acceptOffer(token: string): Promise<string>;
  applyAnswer(token: string): Promise<void>;
  disposeSession(): void;
  notice(what: 'third-party' | 'peer-left'): void;
}

export type RelayPhase = 'connecting' | 'waiting' | 'peer-found' | 'connected' | 'left';

export interface RelayStatus {
  phase: RelayPhase;
  relaysConnected: number;
  relaysTotal: number;
  /** No relay answered in time: show "Couldn't reach the relays". */
  unreachable: boolean;
}

export interface ControllerOptions {
  myId: string;
  transport: RelayTransport;
  host: RelayHost;
  onStatus(status: RelayStatus): void;
  now?: () => number;
  /** §7.4: no relay reachable within 8 s. */
  unreachableAfterMs?: number;
}

export const UNREACHABLE_AFTER_MS = 8000;

/** Runs the pure room protocol (`roomReduce`) against real relays and a real call session. */
export class RelayController {
  private state: RoomState;
  private readonly timers = new TimerBag();
  private readonly offs: (() => void)[] = [];
  private readonly timerHandles = new Map<TimerName, ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private sessionUp = false;
  private unreachable = false;
  private lastStatusKey = '';

  constructor(private readonly o: ControllerOptions) {
    this.state = initialRoom(o.myId);
    this.now = o.now ?? Date.now;
  }

  start(): void {
    this.offs.push(
      this.o.transport.onMessage((msg) => this.dispatch({ type: 'message', msg, now: this.now() })),
    );
    this.offs.push(this.o.transport.onStatus(() => this.emitStatus()));
    this.timers.set(() => {
      if (this.o.transport.status().connected === 0) this.unreachable = true;
      this.emitStatus();
    }, this.o.unreachableAfterMs ?? UNREACHABLE_AFTER_MS);
    this.dispatch({ type: 'join', now: this.now() });
    this.emitStatus();
  }

  /** The call session reached `connected`. */
  sessionConnected(): void {
    this.sessionUp = true;
    this.dispatch({ type: 'session-connected' });
  }

  /** The call session failed (or the peer vanished): look for the peer again. */
  sessionFailed(): void {
    this.sessionUp = false;
    this.dispatch({ type: 'session-failed', now: this.now() });
  }

  /** Say goodbye to the room and release everything. Safe to call twice. */
  leave(): void {
    this.dispatch({ type: 'leave' });
    for (const off of this.offs.splice(0)) off();
    this.timers.clearAll();
    this.timerHandles.clear();
    this.o.transport.close();
    this.emitStatus();
  }

  get phase(): RoomState['phase'] {
    return this.state.phase;
  }

  /** Leak counter for tests. */
  get activeTimers(): number {
    return this.timers.size;
  }

  // ---------- internals ----------

  private dispatch(event: RoomEvent): void {
    const step = roomReduce(this.state, event);
    this.state = step.state;
    for (const effect of step.effects) this.run(effect);
    this.emitStatus();
  }

  private run(effect: RoomEffect): void {
    switch (effect.kind) {
      case 'publish':
        void this.o.transport.publish(effect.msg).catch(() => undefined); // a dead relay must not stop the others
        return;
      case 'set-timer': {
        this.timers.clear(this.timerHandles.get(effect.name));
        this.timerHandles.set(
          effect.name,
          this.timers.set(
            () => this.dispatch({ type: 'timer', name: effect.name, now: this.now() }),
            effect.ms,
          ),
        );
        return;
      }
      case 'clear-timer':
        this.timers.clear(this.timerHandles.get(effect.name));
        this.timerHandles.delete(effect.name);
        return;
      case 'create-offer': {
        const sid = newSessionId();
        this.o.host.createOffer().then(
          (token) => this.dispatch({ type: 'offer-ready', peer: effect.peer, sid, token }),
          () => undefined, // the session reports its own failure
        );
        return;
      }
      case 'accept-offer':
        this.o.host.acceptOffer(effect.token).then(
          (token) =>
            this.dispatch({ type: 'answer-ready', peer: effect.peer, sid: effect.sid, token }),
          () => undefined, // a bad offer is dropped; the caller will send another
        );
        return;
      case 'apply-answer':
        this.o.host.applyAnswer(effect.token).catch(() => this.sessionFailed());
        return;
      case 'dispose-session':
        this.o.host.disposeSession();
        return;
      case 'notify':
        if (effect.what !== 'peer-found') this.o.host.notice(effect.what);
        return;
    }
  }

  private phaseForUi(): RelayPhase {
    const { phase, peer } = this.state;
    if (phase === 'left') return 'left';
    if (this.sessionUp) return 'connected';
    if (peer) return 'peer-found';
    return this.o.transport.status().connected > 0 ? 'waiting' : 'connecting';
  }

  private emitStatus(): void {
    const { connected, total } = this.o.transport.status();
    if (connected > 0) this.unreachable = false;
    const status: RelayStatus = {
      phase: this.phaseForUi(),
      relaysConnected: connected,
      relaysTotal: total,
      unreachable: this.unreachable,
    };
    const key = JSON.stringify(status);
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    this.o.onStatus(status);
  }
}
