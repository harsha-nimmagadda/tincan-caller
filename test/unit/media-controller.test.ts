import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MediaAccessError,
  MediaController,
  type MediaDevicesLike,
  type MediaNotice,
  type VisibilityLike,
} from '../../src/core/media/media-controller';

class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  enabled = true;
  constructor(
    readonly kind: 'audio' | 'video',
    readonly id: string,
    private readonly settings: MediaTrackSettings,
    private readonly log: string[],
  ) {
    super();
  }
  stop() {
    if (this.readyState === 'live') this.log.push(`stop:${this.id}`);
    this.readyState = 'ended';
  }
  getSettings() {
    return this.settings;
  }
  /** What the OS does when a device is unplugged / capture is revoked. */
  endByOs() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

type Ideal = { exact?: string; ideal?: string };
const pick = (v: unknown): { exact?: string; ideal?: string } =>
  v && typeof v === 'object' ? (v as Ideal) : {};

function setup(opts: { mobile?: boolean; portrait?: boolean; cams?: string[] } = {}) {
  const log: string[] = [];
  const tracks: FakeTrack[] = [];
  let cams = opts.cams ?? ['cam-front', 'cam-back'];
  const failures: ((c: MediaStreamConstraints) => Error | null)[] = [];
  const devListeners = new Set<() => void>();
  const visListeners = new Set<() => void>();
  const vis: VisibilityLike & { visibilityState: string } = {
    visibilityState: 'visible',
    addEventListener: (_t, f) => void visListeners.add(f),
    removeEventListener: (_t, f) => void visListeners.delete(f),
  };

  const mediaDevices: MediaDevicesLike = {
    async getUserMedia(c) {
      log.push(`gum:${c.audio ? 'A' : ''}${c.video ? 'V' : ''}`);
      for (const f of failures) {
        const err = f(c);
        if (err) throw err;
      }
      const out: FakeTrack[] = [];
      if (c.audio) {
        const id = pick((c.audio as MediaTrackConstraints).deviceId).exact ?? 'mic-default';
        out.push(new FakeTrack('audio', id, { deviceId: id }, log));
      }
      if (c.video) {
        const vc = c.video === true ? {} : c.video;
        const wantId = pick(vc.deviceId).exact;
        const wantFacing = pick(vc.facingMode);
        const id =
          wantId ??
          ((wantFacing.exact ?? wantFacing.ideal) === 'environment' ? 'cam-back' : 'cam-front');
        if (!cams.includes(id)) throw new DOMException('gone', 'OverconstrainedError');
        out.push(
          new FakeTrack(
            'video',
            id,
            { deviceId: id, facingMode: id === 'cam-back' ? 'environment' : 'user' },
            log,
          ),
        );
        log.push(`  video-constraints:${JSON.stringify(vc)}`);
      }
      tracks.push(...out);
      return {
        getAudioTracks: () => out.filter((t) => t.kind === 'audio'),
        getVideoTracks: () => out.filter((t) => t.kind === 'video'),
      } as unknown as MediaStream;
    },
    async enumerateDevices() {
      return [
        { kind: 'audioinput', deviceId: 'mic-default', label: 'Mic' },
        ...cams.map((id) => ({ kind: 'videoinput', deviceId: id, label: id })),
        { kind: 'audiooutput', deviceId: 'spk', label: 'Spk' },
      ];
    },
    addEventListener: (_t, f) => void devListeners.add(f),
    removeEventListener: (_t, f) => void devListeners.delete(f),
  };
  const c = new MediaController({
    mediaDevices,
    visibility: vis,
    isMobile: () => opts.mobile ?? false,
    isPortrait: () => opts.portrait ?? false,
  });
  const notices: MediaNotice[] = [];
  c.events.on('notice', (n) => notices.push(n));
  return {
    c,
    log,
    tracks,
    notices,
    failures,
    vis,
    devListeners,
    visListeners,
    setCams: (v: string[]) => void (cams = v),
    deviceChange: async () => {
      devListeners.forEach((f) => f());
      await c.setMicEnabled(c.snapshot.micOn); // no-op that lets the queue drain below
      await new Promise((r) => setTimeout(r, 0));
    },
    becomeVisible: async () => {
      visListeners.forEach((f) => f());
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const dom = (name: string) => new DOMException(name, name);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('MediaController.start', () => {
  it('asks for mic + camera in ONE getUserMedia call with the preset constraints', async () => {
    const { c, log } = setup();
    await c.start({ video: true, quality: 'auto' });
    expect(log.filter((l) => l.startsWith('gum'))).toEqual(['gum:AV']);
    expect(log.find((l) => l.includes('video-constraints'))).toContain('"width":{"ideal":1280}');
    expect(c.snapshot).toMatchObject({ micOn: true, camOn: true, facing: 'user', canFlip: true });
  });
  it('uses portrait constraints when the phone is upright', async () => {
    const { c, log } = setup({ portrait: true });
    await c.start({ video: true, quality: 'data-saver' });
    expect(log.find((l) => l.includes('video-constraints'))).toContain(
      '"width":{"ideal":360},"height":{"ideal":640}',
    );
  });
  it('audio-only start requests no video', async () => {
    const { c, log } = setup();
    const snap = await c.start({ video: false });
    expect(log).toEqual(['gum:A']);
    expect(snap).toMatchObject({ camOn: false, micOn: true });
  });
  it('unsatisfiable constraints → retries relaxed (video: true)', async () => {
    const { c, failures, log } = setup();
    failures.push((x) =>
      x.video && typeof x.video === 'object' ? dom('OverconstrainedError') : null,
    );
    expect((await c.start({ video: true })).camOn).toBe(true);
    expect(log.filter((l) => l.startsWith('gum'))).toEqual(['gum:AV', 'gum:AV']);
  });
  it('no usable camera → continues audio-only with a notice', async () => {
    const { c, failures, notices } = setup();
    failures.push((x) => (x.video ? dom('NotFoundError') : null));
    const snap = await c.start({ video: true });
    expect(snap).toMatchObject({ camOn: false, micOn: true });
    expect(notices).toEqual(['camera-unavailable']);
  });
  it('camera held by another app → audio-only with a specific notice', async () => {
    const { c, failures, notices } = setup();
    failures.push((x) => (x.video ? dom('NotReadableError') : null));
    expect((await c.start({ video: true })).camOn).toBe(false);
    expect(notices).toEqual(['camera-in-use']);
  });
  it('permission denied is fatal and not retried', async () => {
    const { c, failures, log } = setup();
    failures.push(() => dom('NotAllowedError'));
    await expect(c.start({ video: true })).rejects.toMatchObject({ kind: 'permission-denied' });
    expect(log.filter((l) => l.startsWith('gum'))).toHaveLength(1);
  });
  it('no microphone at all is fatal', async () => {
    const { c, failures } = setup();
    failures.push(() => dom('NotFoundError'));
    await expect(c.start({ video: false })).rejects.toBeInstanceOf(MediaAccessError);
    await expect(c.start({ video: false })).rejects.toMatchObject({ kind: 'no-device' });
  });
  it('a stale preferred device id falls back to the default instead of failing', async () => {
    const { c, setCams } = setup();
    setCams(['cam-front']);
    const snap = await c.start({ video: true, deviceIds: { videoinput: 'cam-back' } });
    expect(snap.camOn).toBe(true);
    expect(snap.video?.getSettings().deviceId).toBe('cam-front');
  });
});

describe('mic and camera switches', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(async () => {
    t = setup();
    await t.c.start({ video: true });
  });

  it('mute only flips track.enabled; the track stays live', () => {
    t.c.setMicEnabled(false);
    expect(t.c.snapshot.micOn).toBe(false);
    expect(t.c.snapshot.audio?.readyState).toBe('live');
    t.c.setMicEnabled(true);
    expect(t.c.snapshot.micOn).toBe(true);
  });
  it('mute persists across a mic re-acquire', async () => {
    t.c.setMicEnabled(false);
    await t.c.setDevice('audioinput', 'mic-default');
    expect(t.c.snapshot.audio?.enabled).toBe(false);
  });
  it('cam off STOPS the video track (camera light off); cam on acquires a new one', async () => {
    const old = t.c.snapshot.video as unknown as FakeTrack;
    expect(await t.c.setCamEnabled(false)).toBe(false);
    expect(old.readyState).toBe('ended');
    expect(t.c.snapshot.video).toBeNull();
    t.log.length = 0;
    expect(await t.c.setCamEnabled(true)).toBe(true);
    expect(t.log.filter((l) => l.startsWith('gum'))).toEqual(['gum:V']);
    expect(t.c.snapshot.camOn).toBe(true);
  });
  it('cam on failing leaves the camera off and says why', async () => {
    await t.c.setCamEnabled(false);
    t.failures.push(() => dom('NotReadableError'));
    expect(await t.c.setCamEnabled(true)).toBe(false);
    expect(t.notices).toContain('camera-in-use');
  });
});

describe('flipCamera', () => {
  it('phone: stops the old camera BEFORE opening the new one, using exact facing', async () => {
    const t = setup({ mobile: true });
    await t.c.start({ video: true });
    t.log.length = 0;
    expect(await t.c.flipCamera()).toBe(true);
    const order = t.log.filter((l) => l.startsWith('stop:cam') || l.startsWith('gum'));
    expect(order).toEqual(['stop:cam-front', 'gum:V']);
    expect(t.log.find((l) => l.includes('video-constraints'))).toContain(
      '"facingMode":{"exact":"environment"}',
    );
    expect(t.c.snapshot.facing).toBe('environment');
    expect(t.c.snapshot.mirror).toBe(false);
  });
  it('phone: falls back to ideal facing when exact is rejected', async () => {
    const t = setup({ mobile: true });
    await t.c.start({ video: true });
    t.failures.push((x) =>
      x.video && JSON.stringify(x.video).includes('"exact":"environment"')
        ? dom('OverconstrainedError')
        : null,
    );
    expect(await t.c.flipCamera()).toBe(true);
    expect(t.c.snapshot.facing).toBe('environment');
  });
  it('phone: if the other camera cannot open, the original camera is restored', async () => {
    const t = setup({ mobile: true });
    await t.c.start({ video: true });
    t.failures.push((x) =>
      x.video && JSON.stringify(x.video).includes('environment') ? dom('NotReadableError') : null,
    );
    expect(await t.c.flipCamera()).toBe(true);
    expect(t.notices).toContain('flip-failed');
    expect(t.c.snapshot).toMatchObject({ camOn: true, facing: 'user' });
  });
  it('phone: a remembered deviceId does not block flipping', async () => {
    const t = setup({ mobile: true });
    await t.c.start({ video: true, deviceIds: { videoinput: 'cam-front' } });
    await t.c.flipCamera();
    expect(t.c.snapshot.facing).toBe('environment');
  });
  it('desktop: cycles to the next camera by deviceId', async () => {
    const t = setup({ mobile: false, cams: ['c1', 'c2'] });
    await t.c.start({ video: true, deviceIds: { videoinput: 'c1' } });
    await t.c.flipCamera();
    expect(t.c.snapshot.video?.getSettings().deviceId).toBe('c2');
    await t.c.flipCamera();
    expect(t.c.snapshot.video?.getSettings().deviceId).toBe('c1');
  });
  it('is unavailable with a single camera or with the camera off', async () => {
    const one = setup({ cams: ['cam-front'] });
    await one.c.start({ video: true });
    expect(one.c.snapshot.canFlip).toBe(false);
    expect(await one.c.flipCamera()).toBe(false);
    const off = setup();
    await off.c.start({ video: false });
    expect(await off.c.flipCamera()).toBe(false);
  });
});

describe('setDevice ordering', () => {
  it('desktop: opens the new device first, then stops the old (no gap)', async () => {
    const t = setup({ mobile: false });
    await t.c.start({ video: true });
    t.log.length = 0;
    await t.c.setDevice('videoinput', 'cam-back');
    expect(t.log.filter((l) => l.startsWith('stop:cam') || l.startsWith('gum'))).toEqual([
      'gum:V',
      'stop:cam-front',
    ]);
    expect(t.c.snapshot.video?.getSettings().deviceId).toBe('cam-back');
  });
  it('mobile: stops the old device first, then opens the new one', async () => {
    const t = setup({ mobile: true });
    await t.c.start({ video: true });
    t.log.length = 0;
    await t.c.setDevice('videoinput', 'cam-back');
    expect(t.log.filter((l) => l.startsWith('stop:cam') || l.startsWith('gum'))).toEqual([
      'stop:cam-front',
      'gum:V',
    ]);
  });
  it('mobile: a failed switch brings the previous device back', async () => {
    const t = setup({ mobile: true });
    await t.c.start({ video: true, deviceIds: { videoinput: 'cam-front' } });
    t.failures.push((x) =>
      x.video && JSON.stringify(x.video).includes('cam-back') ? dom('NotReadableError') : null,
    );
    await t.c.setDevice('videoinput', 'cam-back');
    expect(t.notices).toContain('device-switch-failed');
    expect(t.c.snapshot.video?.getSettings().deviceId).toBe('cam-front');
  });
  it('desktop: a failed switch keeps the old device running', async () => {
    const t = setup();
    await t.c.start({ video: true });
    const old = t.c.snapshot.video;
    t.failures.push((x) => (x.video ? dom('NotReadableError') : null));
    await t.c.setDevice('videoinput', 'cam-back');
    expect(t.c.snapshot.video).toBe(old);
    expect(old?.readyState).toBe('live');
    expect(t.notices).toContain('device-switch-failed');
  });
  it('microphone switch re-acquires audio only', async () => {
    const t = setup();
    await t.c.start({ video: true });
    t.log.length = 0;
    await t.c.setDevice('audioinput', 'mic-2');
    expect(t.log.filter((l) => l.startsWith('gum'))).toEqual(['gum:A']);
    expect(t.c.snapshot.audio?.getSettings().deviceId).toBe('mic-2');
  });
  it('speaker choice is remembered but needs no capture', async () => {
    const t = setup();
    await t.c.start({ video: true });
    t.log.length = 0;
    await t.c.setDevice('audiooutput', 'spk');
    expect(t.log).toEqual([]);
    expect(t.c.preferredDevices.audiooutput).toBe('spk');
  });
  it('choosing a camera while the camera is off just remembers it', async () => {
    const t = setup();
    await t.c.start({ video: false });
    t.log.length = 0;
    await t.c.setDevice('videoinput', 'cam-back');
    expect(t.log).toEqual([]);
    await t.c.setCamEnabled(true);
    expect(t.c.snapshot.video?.getSettings().deviceId).toBe('cam-back');
  });
  it('operations are serialised: a flip and a device switch never interleave', async () => {
    const t = setup({ mobile: true });
    await t.c.start({ video: true });
    t.log.length = 0;
    await Promise.all([t.c.flipCamera(), t.c.setDevice('videoinput', 'cam-front')]);
    const order = t.log.filter((l) => l.startsWith('stop:cam') || l.startsWith('gum'));
    expect(order).toEqual(['stop:cam-front', 'gum:V', 'stop:cam-back', 'gum:V']);
  });
});

describe('device changes and lost tracks', () => {
  it('the active camera vanishing falls back to the default camera', async () => {
    const t = setup();
    await t.c.start({ video: true, deviceIds: { videoinput: 'cam-back' } });
    t.setCams(['cam-front']);
    await t.deviceChange();
    expect(t.c.snapshot.video?.getSettings().deviceId).toBe('cam-front');
    expect(t.notices).toContain('device-fallback');
    expect(t.c.snapshot.canFlip).toBe(false);
  });
  it('an unrelated device change does not touch the running tracks', async () => {
    const t = setup();
    await t.c.start({ video: true });
    const before = t.c.snapshot.video;
    t.log.length = 0;
    await t.deviceChange();
    expect(t.c.snapshot.video).toBe(before);
    expect(t.log.filter((l) => l.startsWith('gum'))).toEqual([]);
  });
  it('a track ended by the OS is re-acquired', async () => {
    const t = setup();
    await t.c.start({ video: true });
    (t.c.snapshot.video as unknown as FakeTrack).endByOs();
    await flush();
    await flush();
    expect(t.c.snapshot.video?.readyState).toBe('live');
    expect(t.c.snapshot.camOn).toBe(true);
  });
  it('re-acquire failure → notice; coming back to the page retries', async () => {
    const t = setup();
    await t.c.start({ video: true });
    t.failures.push((x) => (x.video ? dom('NotReadableError') : null));
    (t.c.snapshot.video as unknown as FakeTrack).endByOs();
    await flush();
    await flush();
    expect(t.notices).toContain('camera-lost');
    expect(t.c.snapshot.camOn).toBe(false);
    t.failures.length = 0;
    await t.becomeVisible();
    expect(t.c.snapshot.camOn).toBe(true);
  });
  it('iOS background kill: ended tracks are re-acquired on visibilitychange → visible', async () => {
    const t = setup();
    await t.c.start({ video: true });
    (t.c.snapshot.audio as unknown as FakeTrack).readyState = 'ended';
    (t.c.snapshot.video as unknown as FakeTrack).readyState = 'ended';
    await t.becomeVisible();
    expect(t.c.snapshot.audio?.readyState).toBe('live');
    expect(t.c.snapshot.video?.readyState).toBe('live');
  });
  it('a hidden page does not re-acquire', async () => {
    const t = setup();
    await t.c.start({ video: true });
    (t.c.snapshot.video as unknown as FakeTrack).readyState = 'ended';
    t.vis.visibilityState = 'hidden';
    t.log.length = 0;
    await t.becomeVisible();
    expect(t.log).toEqual([]);
  });
  it('does not resurrect a camera the user turned off', async () => {
    const t = setup();
    await t.c.start({ video: true });
    await t.c.setCamEnabled(false);
    t.log.length = 0;
    await t.becomeVisible();
    expect(t.log).toEqual([]);
    expect(t.c.snapshot.camOn).toBe(false);
  });
});

describe('stop() and snapshot details', () => {
  it('stop releases every track and every listener, and is idempotent', async () => {
    const t = setup();
    await t.c.start({ video: true });
    const [a, v] = [t.c.snapshot.audio, t.c.snapshot.video];
    expect(t.devListeners.size + t.visListeners.size).toBe(2);
    t.c.stop();
    t.c.stop();
    expect(a?.readyState).toBe('ended');
    expect(v?.readyState).toBe('ended');
    expect(t.devListeners.size + t.visListeners.size).toBe(0);
    expect(t.c.snapshot).toMatchObject({ camOn: false, micOn: false });
  });
  it('late OS events after stop() are ignored', async () => {
    const t = setup();
    await t.c.start({ video: true });
    const v = t.c.snapshot.video as unknown as FakeTrack;
    t.c.stop();
    t.log.length = 0;
    v.endByOs();
    await flush();
    expect(t.log.filter((l) => l.startsWith('gum'))).toEqual([]);
  });
  it('mirror: front camera yes; unknown facing → yes on desktop, no on a phone', async () => {
    const d = setup();
    await d.c.start({ video: true });
    expect(d.c.snapshot.mirror).toBe(true);
    const unknown = vi
      .spyOn(d.c.snapshot.video as unknown as FakeTrack, 'getSettings')
      .mockReturnValue({});
    expect(d.c.snapshot).toMatchObject({ facing: 'unknown', mirror: true });
    unknown.mockRestore();
    const m = setup({ mobile: true });
    await m.c.start({ video: true });
    vi.spyOn(m.c.snapshot.video as unknown as FakeTrack, 'getSettings').mockReturnValue({});
    expect(m.c.snapshot).toMatchObject({ facing: 'unknown', mirror: false });
  });
  it('emits localMedia on every change', async () => {
    const t = setup();
    const seen: boolean[] = [];
    t.c.events.on('localMedia', (m) => seen.push(m.camOn));
    await t.c.start({ video: true });
    await t.c.setCamEnabled(false);
    expect(seen.at(0)).toBe(true);
    expect(seen.at(-1)).toBe(false);
  });
});
