import { MediaController, type MediaDevicesLike } from '../core/media/media-controller';
import { ScreenWakeLock } from '../core/platform/wake-lock';
import type { CallSession } from '../core/rtc/call-session';

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
/** `last` outlives the call so tests can assert that its resources were released. */
export const call: { session: CallSession | null; last: CallSession | null } = {
  session: null,
  last: null,
};
