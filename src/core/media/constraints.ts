import type { QualityPreset } from '../settings/settings';

interface Size {
  width: number;
  height: number;
  aspectRatio: number;
}

export interface QualityProfile {
  landscape: Size;
  portrait: Size;
  frameRate: number;
  /** Sender cap in bits per second (applied by the call session). */
  maxBitrate: number;
}

/** auto = 720p30, data-saver = 360p15, high = 1080p30 (§6.11). */
export const QUALITY_PROFILES: Record<QualityPreset, QualityProfile> = {
  auto: {
    landscape: { width: 1280, height: 720, aspectRatio: 16 / 9 },
    portrait: { width: 720, height: 1280, aspectRatio: 9 / 16 },
    frameRate: 30,
    maxBitrate: 1_500_000,
  },
  'data-saver': {
    landscape: { width: 640, height: 360, aspectRatio: 16 / 9 },
    portrait: { width: 360, height: 640, aspectRatio: 9 / 16 },
    frameRate: 15,
    maxBitrate: 300_000,
  },
  high: {
    landscape: { width: 1920, height: 1080, aspectRatio: 16 / 9 },
    portrait: { width: 1080, height: 1920, aspectRatio: 9 / 16 },
    frameRate: 30,
    maxBitrate: 2_500_000,
  },
};

export type Facing = 'user' | 'environment';

export interface VideoRequest {
  /** Capture in portrait (phone held upright) rather than landscape. */
  portrait: boolean;
  deviceId?: string;
  facingMode?: Facing;
  /** `exact` facing (used when flipping) instead of `ideal`. */
  exactFacing?: boolean;
}

/** Orientation-aware camera constraints (ported from the POC, "auto" aspect only). */
export function videoConstraints(quality: QualityPreset, req: VideoRequest): MediaTrackConstraints {
  const profile = QUALITY_PROFILES[quality];
  const target = req.portrait ? profile.portrait : profile.landscape;
  const c: MediaTrackConstraints = {
    width: { ideal: target.width },
    height: { ideal: target.height },
    aspectRatio: { ideal: target.aspectRatio },
    frameRate: { ideal: profile.frameRate },
  };
  // deviceId and facingMode conflict: an explicit device always wins.
  if (req.deviceId) c.deviceId = { exact: req.deviceId };
  else if (req.facingMode) {
    c.facingMode = req.exactFacing ? { exact: req.facingMode } : { ideal: req.facingMode };
  }
  return c;
}

/** Echo cancellation, noise suppression and AGC on. */
export function audioConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

export function maxBitrate(quality: QualityPreset): number {
  return QUALITY_PROFILES[quality].maxBitrate;
}
