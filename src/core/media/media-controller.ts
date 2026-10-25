import type { QualityPreset } from '../settings/settings';
import { isMobileDevice, isPortrait } from '../platform/orientation';
import { Emitter } from '../util/emitter';
import { audioConstraints, videoConstraints, type Facing } from './constraints';
import { EMPTY_DEVICES, parseDevices, type DeviceKind, type DeviceLists } from './devices';

export interface MediaDevicesLike {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<readonly { kind: string; deviceId: string; label: string }[]>;
  addEventListener(type: 'devicechange', fn: () => void): void;
  removeEventListener(type: 'devicechange', fn: () => void): void;
}

export interface VisibilityLike {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export interface MediaEnv {
  mediaDevices: MediaDevicesLike;
  visibility: VisibilityLike | null;
  isMobile: () => boolean;
  isPortrait: () => boolean;
}

function defaultEnv(): MediaEnv {
  return {
    mediaDevices: navigator.mediaDevices,
    visibility: typeof document === 'undefined' ? null : document,
    isMobile: isMobileDevice,
    isPortrait,
  };
}

export type AccessErrorKind = 'permission-denied' | 'device-in-use' | 'no-device' | 'unknown';

/** Fatal: we could not get even a microphone. */
export class MediaAccessError extends Error {
  override name = 'MediaAccessError';
  constructor(
    readonly kind: AccessErrorKind,
    options?: { cause?: unknown },
  ) {
    super(kind, options);
  }
}

/** Non-fatal hints for toasts. */
export type MediaNotice =
  | 'camera-unavailable' // no usable camera: continuing audio-only
  | 'camera-in-use' // another app holds the camera: continuing audio-only
  | 'camera-lost' // the camera stopped (unplugged / OS revoked) and could not be re-acquired
  | 'mic-lost'
  | 'flip-failed'
  | 'device-switch-failed'
  | 'device-fallback'; // the selected device vanished; switched to the default

export interface LocalMedia {
  audio: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
  micOn: boolean;
  camOn: boolean;
  facing: Facing | 'unknown';
  /** Mirror the local preview (front camera, or unknown on desktop). */
  mirror: boolean;
  canFlip: boolean;
}

export interface MediaEvents {
  localMedia: LocalMedia;
  devices: DeviceLists;
  notice: MediaNotice;
}

export interface StartOptions {
  video: boolean;
  quality?: QualityPreset;
  deviceIds?: Partial<Record<DeviceKind, string>>;
}

const errName = (e: unknown) => (e instanceof Error || e instanceof DOMException ? e.name : '');
const isNoDevice = (e: unknown) =>
  ['NotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(errName(e));

function toAccessError(e: unknown): MediaAccessError {
  const n = errName(e);
  if (n === 'NotAllowedError' || n === 'SecurityError')
    return new MediaAccessError('permission-denied', { cause: e });
  if (n === 'NotReadableError' || n === 'AbortError')
    return new MediaAccessError('device-in-use', { cause: e });
  if (isNoDevice(e)) return new MediaAccessError('no-device', { cause: e });
  return new MediaAccessError('unknown', { cause: e });
}

/**
 * Owns the local camera and microphone tracks. The call session only borrows them via
 * `replaceTrack`; releasing the camera (cam off) really stops the track so the light goes off.
 */
export class MediaController {
  readonly events = new Emitter<MediaEvents>();
  private readonly env: MediaEnv;
  private audio: MediaStreamTrack | null = null;
  private video: MediaStreamTrack | null = null;
  private micOn = true;
  private wantCam = false;
  private quality: QualityPreset = 'auto';
  private facing: Facing = 'user';
  private preferred: Partial<Record<DeviceKind, string>> = {};
  private devices: DeviceLists = EMPTY_DEVICES;
  private disposers: (() => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private micLost = false;

  constructor(env: Partial<MediaEnv> = {}) {
    this.env = { ...defaultEnv(), ...env };
  }

  // ---------- public API ----------

  get snapshot(): LocalMedia {
    const settings = this.video?.getSettings();
    const facing =
      settings?.facingMode === 'user' || settings?.facingMode === 'environment'
        ? settings.facingMode
        : 'unknown';
    return {
      audio: this.audio,
      video: this.video,
      micOn: this.audio !== null && this.micOn,
      camOn: this.video !== null,
      facing,
      mirror: facing === 'user' || (facing === 'unknown' && !this.env.isMobile()),
      canFlip: this.devices.videoinput.length >= 2,
    };
  }

  get deviceLists(): DeviceLists {
    return this.devices;
  }

  get preferredDevices(): Partial<Record<DeviceKind, string>> {
    return { ...this.preferred };
  }

  /** Asks for the microphone (and camera). Throws `MediaAccessError` only if no microphone. */
  start(opts: StartOptions): Promise<LocalMedia> {
    return this.run(async () => {
      this.quality = opts.quality ?? 'auto';
      this.preferred = { ...opts.deviceIds };
      this.wantCam = opts.video;
      this.stopped = false;
      const { audio, video } = await this.acquireInitial(opts.video);
      this.audio = this.adopt('audio', audio);
      this.video = video ? this.adopt('video', video) : null;
      this.wantCam = this.video !== null;
      this.listen();
      await this.refreshDevices();
      this.emitChange();
      return this.snapshot;
    });
  }

  /** Mute/unmute: only flips `track.enabled` (the mic light stays on; no renegotiation). */
  setMicEnabled(on: boolean): void {
    this.micOn = on;
    if (this.audio) this.audio.enabled = on;
    this.emitChange();
  }

  /** Off stops the camera track for real; on acquires a fresh one. Returns whether it is now on. */
  setCamEnabled(on: boolean): Promise<boolean> {
    return this.run(async () => {
      this.wantCam = on;
      if (!on) {
        this.dropVideo();
        this.emitChange();
        return false;
      }
      if (this.video) return true;
      try {
        this.video = this.adopt(
          'video',
          await this.getVideo({ deviceId: this.preferred.videoinput }),
        );
      } catch (e) {
        this.wantCam = false;
        this.events.emit(
          'notice',
          errName(e) === 'NotReadableError' ? 'camera-in-use' : 'camera-unavailable',
        );
      }
      this.emitChange();
      return this.video !== null;
    });
  }

  /** Front/back on phones; next camera on desktops. The old track is stopped *first*. */
  flipCamera(): Promise<boolean> {
    return this.run(async () => {
      if (!this.video || !this.snapshot.canFlip) return false;
      const mobile = this.env.isMobile();
      const currentId = this.video.getSettings().deviceId;
      const previous = this.preferred.videoinput;
      const cams = this.devices.videoinput;
      const nextFacing: Facing = this.facing === 'user' ? 'environment' : 'user';
      const nextCam = cams[(cams.findIndex((c) => c.deviceId === currentId) + 1) % cams.length];

      this.dropVideo(); // many Androids cannot open a second camera while the first is open
      if (mobile) delete this.preferred.videoinput; // an explicit deviceId would override facingMode
      try {
        this.video = this.adopt(
          'video',
          mobile
            ? await this.getVideoWithFallback(nextFacing)
            : await this.getVideo({ deviceId: nextCam?.deviceId }),
        );
        this.facing = mobile ? nextFacing : this.facing;
        if (!mobile && nextCam) this.preferred.videoinput = nextCam.deviceId;
      } catch {
        this.events.emit('notice', 'flip-failed');
        await this.restoreVideo(previous);
      }
      this.emitChange();
      return this.video !== null;
    });
  }

  /**
   * Switch microphone/camera (re-acquire with `deviceId: exact`). Desktop opens the new device
   * before closing the old one (no gap); mobile closes first (one camera at a time).
   * Speaker choice is only stored here; apply it with `applySink`.
   */
  setDevice(kind: DeviceKind, deviceId: string): Promise<boolean> {
    return this.run(async () => {
      if (kind === 'audiooutput') {
        this.preferred.audiooutput = deviceId;
        return true;
      }
      const previous = this.preferred[kind];
      const old = kind === 'audioinput' ? this.audio : this.video;
      if (kind === 'videoinput' && !this.video) {
        this.preferred.videoinput = deviceId; // camera is off: remember for next time
        return true;
      }
      const mobile = this.env.isMobile();
      if (mobile) this.release(kind);
      try {
        const fresh =
          kind === 'audioinput' ? await this.getAudio(deviceId) : await this.getVideo({ deviceId });
        if (!mobile) old?.stop();
        this.preferred[kind] = deviceId;
        this.setTrack(kind, fresh);
      } catch {
        this.events.emit('notice', 'device-switch-failed');
        if (mobile) await this.reacquire(kind, previous);
      }
      this.emitChange();
      return true;
    });
  }

  /** Stops every track and removes all listeners. Safe to call repeatedly. */
  stop(): void {
    this.stopped = true;
    for (const d of this.disposers) d();
    this.disposers = [];
    this.audio?.stop();
    this.video?.stop();
    this.audio = this.video = null;
    this.wantCam = false;
    this.emitChange();
  }

  // ---------- acquisition ----------

  private audioReq(deviceId: string | undefined): MediaStreamConstraints['audio'] {
    return audioConstraints(deviceId);
  }

  private videoReq(o: {
    deviceId?: string | undefined;
    facing?: Facing;
    exact?: boolean;
  }): MediaTrackConstraints {
    // `deviceId: undefined` really means "the default camera" — callers pass the preference.
    return videoConstraints(this.quality, {
      portrait: this.env.isPortrait(),
      ...(o.deviceId ? { deviceId: o.deviceId } : { facingMode: o.facing ?? this.facing }),
      ...(o.exact ? { exactFacing: true } : {}),
    });
  }

  private async gum(c: MediaStreamConstraints): Promise<MediaStream> {
    return this.env.mediaDevices.getUserMedia(c);
  }

  private async getAudio(deviceId: string | undefined): Promise<MediaStreamTrack> {
    const track = (await this.gum({ audio: this.audioReq(deviceId) })).getAudioTracks()[0];
    if (!track) throw new DOMException('no audio track', 'NotFoundError');
    return track;
  }

  private async getVideo(o: {
    deviceId?: string | undefined;
    facing?: Facing;
    exact?: boolean;
  }): Promise<MediaStreamTrack> {
    const track = (await this.gum({ video: this.videoReq(o) })).getVideoTracks()[0];
    if (!track) throw new DOMException('no video track', 'NotFoundError');
    return track;
  }

  /** `exact` facing first; many browsers reject it, so retry with `ideal`. */
  private async getVideoWithFallback(facing: Facing): Promise<MediaStreamTrack> {
    try {
      return await this.getVideo({ facing, exact: true, deviceId: undefined });
    } catch (e) {
      if (!isNoDevice(e)) throw e;
      return this.getVideo({ facing, deviceId: undefined });
    }
  }

  private async acquireInitial(wantVideo: boolean) {
    const split = (s: MediaStream) => ({
      audio: s.getAudioTracks()[0] ?? null,
      video: s.getVideoTracks()[0] ?? null,
    });
    const pick = (s: ReturnType<typeof split>) => {
      if (!s.audio) throw new MediaAccessError('no-device');
      return s as { audio: MediaStreamTrack; video: MediaStreamTrack | null };
    };
    let error: unknown;
    try {
      return pick(
        split(
          await this.gum({
            audio: this.audioReq(this.preferred.audioinput),
            video: wantVideo ? this.videoReq({ deviceId: this.preferred.videoinput }) : false,
          }),
        ),
      );
    } catch (e) {
      error = e;
    }
    if (error instanceof MediaAccessError) throw error;
    if (errName(error) === 'NotAllowedError') throw toAccessError(error);
    // Stale device ids or an unsatisfiable resolution: retry with relaxed constraints.
    if (isNoDevice(error)) {
      try {
        return pick(split(await this.gum({ audio: audioConstraints(), video: wantVideo })));
      } catch (e) {
        error = e;
      }
    }
    if (errName(error) === 'NotAllowedError') throw toAccessError(error);
    if (wantVideo) {
      // Camera problems must not block a call: continue with the microphone only.
      try {
        const audio = pick(split(await this.gum({ audio: audioConstraints() })));
        this.events.emit(
          'notice',
          errName(error) === 'NotReadableError' ? 'camera-in-use' : 'camera-unavailable',
        );
        return audio;
      } catch (e) {
        throw toAccessError(e);
      }
    }
    throw toAccessError(error);
  }

  // ---------- track bookkeeping ----------

  /** Wires `ended` handling (device unplugged / OS revoked) and applies the mute state. */
  private adopt(kind: 'audio' | 'video', track: MediaStreamTrack): MediaStreamTrack {
    if (kind === 'audio') track.enabled = this.micOn;
    track.addEventListener('ended', () => {
      // Tracks we stop ourselves never fire `ended`; this is the OS/device ending it.
      const current = kind === 'audio' ? this.audio : this.video;
      if (current === track && !this.stopped) void this.run(() => this.onTrackEnded(kind));
    });
    return track;
  }

  private setTrack(kind: 'audioinput' | 'videoinput', track: MediaStreamTrack): void {
    if (kind === 'audioinput') this.audio = this.adopt('audio', track);
    else this.video = this.adopt('video', track);
  }

  private release(kind: 'audioinput' | 'videoinput'): void {
    if (kind === 'audioinput') {
      this.audio?.stop();
      this.audio = null;
    } else this.dropVideo();
  }

  private dropVideo(): void {
    this.video?.stop();
    this.video = null;
  }

  private async onTrackEnded(kind: 'audio' | 'video'): Promise<void> {
    if (this.stopped) return;
    if (kind === 'audio') this.audio = null;
    else this.video = null;
    const k = kind === 'audio' ? 'audioinput' : 'videoinput';
    await this.reacquire(k, this.preferred[k]);
    this.emitChange();
  }

  /** Re-open a lost device, preferring `deviceId`, then the default. Emits a notice on failure. */
  private async reacquire(
    kind: 'audioinput' | 'videoinput',
    deviceId: string | undefined,
  ): Promise<void> {
    if (this.stopped) return;
    if (kind === 'videoinput' && !this.wantCam) return;
    const attempt = async (id: string | undefined) =>
      kind === 'audioinput' ? this.getAudio(id) : this.getVideo({ deviceId: id });
    try {
      let track: MediaStreamTrack;
      try {
        track = await attempt(deviceId);
      } catch (e) {
        if (!deviceId) throw e;
        delete this.preferred[kind]; // the preferred device is gone: use the default
        track = await attempt(undefined);
      }
      this.setTrack(kind, track);
      if (kind === 'audioinput') this.micLost = false;
    } catch {
      if (kind === 'audioinput') this.micLost = true;
      this.events.emit('notice', kind === 'audioinput' ? 'mic-lost' : 'camera-lost');
    }
  }

  private async restoreVideo(deviceId: string | undefined): Promise<void> {
    if (this.wantCam) await this.reacquire('videoinput', deviceId);
  }

  // ---------- listeners ----------

  private listen(): void {
    if (this.disposers.length > 0) return;
    const onDeviceChange = () => void this.run(() => this.onDeviceChange());
    this.env.mediaDevices.addEventListener('devicechange', onDeviceChange);
    this.disposers.push(() =>
      this.env.mediaDevices.removeEventListener('devicechange', onDeviceChange),
    );

    const vis = this.env.visibility;
    if (vis) {
      // iOS kills capture in the background; recover when the page is visible again.
      const onVisible = () => {
        if (vis.visibilityState === 'visible') void this.run(() => this.recover());
      };
      vis.addEventListener('visibilitychange', onVisible);
      this.disposers.push(() => vis.removeEventListener('visibilitychange', onVisible));
    }
  }

  private async recover(): Promise<void> {
    if (this.stopped) return;
    if (this.audio?.readyState === 'ended' || this.micLost) {
      this.audio = null;
      await this.reacquire('audioinput', this.preferred.audioinput);
    }
    if (this.wantCam && (this.video === null || this.video.readyState === 'ended')) {
      this.video = null;
      await this.reacquire('videoinput', this.preferred.videoinput);
    }
    this.emitChange();
  }

  private async onDeviceChange(): Promise<void> {
    await this.refreshDevices();
    for (const kind of ['audioinput', 'videoinput'] as const) {
      const track = kind === 'audioinput' ? this.audio : this.video;
      const id = track?.getSettings().deviceId;
      const known = this.devices[kind];
      // Active device vanished → fall back to the default one.
      if (track && id && known.length > 0 && !known.some((d) => d.deviceId === id)) {
        this.release(kind);
        delete this.preferred[kind];
        this.events.emit('notice', 'device-fallback');
        await this.reacquire(kind, undefined);
      }
    }
    this.emitChange();
  }

  private async refreshDevices(): Promise<void> {
    try {
      this.devices = parseDevices(await this.env.mediaDevices.enumerateDevices());
    } catch {
      this.devices = EMPTY_DEVICES;
    }
    this.events.emit('devices', this.devices);
  }

  // ---------- plumbing ----------

  /** Serialise operations so a flip cannot interleave with a device switch. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private emitChange(): void {
    this.events.emit('localMedia', this.snapshot);
  }
}
