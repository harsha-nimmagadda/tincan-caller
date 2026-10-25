import { MediaController, type MediaDevicesLike } from '../core/media/media-controller';
import { ScreenWakeLock } from '../core/platform/wake-lock';
import type { CallSession } from '../core/rtc/call-session';
import type { SessionState } from '../core/rtc/session-types';

/** Process-wide singletons. They are not React state: the store holds snapshots of them. */
let mediaDevicesOverride: MediaDevicesLike | null = null;
let mobileOverride: boolean | null = null;
let media: MediaController | null = null;

/** Test builds only (see src/testing/install-fakes.ts): swap in fake cameras/microphones. */
export function installMediaOverride(devices: MediaDevicesLike, mobile: boolean | null): void {
  mediaDevicesOverride = devices;
  mobileOverride = mobile;
  media = null;
}

export function getMedia(): MediaController {
  media ??= new MediaController({
    ...(mediaDevicesOverride ? { mediaDevices: mediaDevicesOverride } : {}),
    ...(mobileOverride !== null ? { isMobile: () => mobileOverride === true } : {}),
  });
  return media;
}

export const wakeLock = new ScreenWakeLock();

/** The one live call, if any. */
/** Call internals the relay slice drives (set by the call slice; avoids an import cycle). */
export interface CallInternals {
  newSession(relay: boolean): CallSession;
  attachLocal(s: CallSession): Promise<void>;
  disposeSession(): void;
  enterCall(): void;
  /** Back in the call after a reconnect: restart stats, reset per-connection state. */
  resumeCall(): void;
  finishCall(st: Extract<SessionState, { status: 'ended' | 'failed' }>): void;
  createInvite(): Promise<void>;
}

/** What the call slice asks of the relay slice. */
export interface RelayHooks {
  /** Relay-mode reaction to a session state; true = handled (skip the default). */
  handleState(st: SessionState): boolean;
  /** The call ended: leave the room. Returns whether "wait for them to rejoin" makes sense. */
  onCallFinished(st: Extract<SessionState, { status: 'ended' | 'failed' }>): boolean;
  /** Back to Home: leave the room and forget it. */
  reset(): void;
}

export const hooks: { internals: CallInternals | null; relay: RelayHooks | null } = {
  internals: null,
  relay: null,
};

/** `last` outlives the call so tests can assert that its resources were released. */
export const call: { session: CallSession | null; last: CallSession | null } = {
  session: null,
  last: null,
};
