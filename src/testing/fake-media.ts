// Dev/test-only: a fake `navigator.mediaDevices` with two cameras (front/back), a microphone and
// two speakers, backed by canvas + oscillator tracks. It lets e2e drive the real MediaController
// (flip, device switching, unplug) in every engine, without relying on browser fake-device flags.
import type { MediaDevicesLike } from '../core/media/media-controller';

interface FakeCam {
  deviceId: string;
  label: string;
  facing: 'user' | 'environment';
  hue: number;
}

const FRONT: FakeCam = {
  deviceId: 'cam-front',
  label: 'Fake front camera',
  facing: 'user',
  hue: 210,
};
const BACK: FakeCam = {
  deviceId: 'cam-back',
  label: 'Fake back camera',
  facing: 'environment',
  hue: 20,
};

function overconstrained(): DOMException {
  return new DOMException('no matching device', 'OverconstrainedError');
}

function ideal(v: unknown): unknown {
  return v && typeof v === 'object'
    ? ((v as { exact?: unknown; ideal?: unknown }).exact ?? (v as { ideal?: unknown }).ideal)
    : v;
}

export function createFakeMediaDevices(opts: { deny?: boolean } = {}) {
  const events = new EventTarget();
  let cams: FakeCam[] = [FRONT, BACK];
  const live = new Map<string, Set<MediaStreamTrack>>();

  function track(
    deviceId: string,
    t: MediaStreamTrack,
    settings: MediaTrackSettings,
    onStop: () => void,
  ) {
    const stop = t.stop.bind(t);
    t.stop = () => {
      onStop();
      stop();
    };
    const getSettings = t.getSettings.bind(t);
    t.getSettings = () => ({ ...getSettings(), ...settings, deviceId });
    const set = live.get(deviceId) ?? new Set();
    set.add(t);
    live.set(deviceId, set);
    return t;
  }

  function videoTrack(cam: FakeCam): MediaStreamTrack {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    let n = 0;
    const draw = () => {
      if (!ctx) return;
      ctx.fillStyle = `hsl(${(cam.hue + n * 5) % 360} 70% 45%)`;
      ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = '#fff';
      ctx.font = '36px monospace';
      ctx.fillText(`${cam.facing} ${n++}`, 10, 130);
    };
    draw();
    const timer = setInterval(draw, 33);
    const t = canvas.captureStream(30).getVideoTracks()[0];
    if (!t) throw new Error('canvas.captureStream gave no track');
    return track(cam.deviceId, t, { facingMode: cam.facing, width: 320, height: 240 }, () =>
      clearInterval(timer),
    );
  }

  function audioTrack(): MediaStreamTrack {
    const ctx = new AudioContext();
    void ctx.resume();
    const osc = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const t = dest.stream.getAudioTracks()[0];
    if (!t) throw new Error('no audio track');
    return track('mic-1', t, {}, () => void ctx.close());
  }

  function pickCam(c: MediaTrackConstraints | true): FakeCam {
    if (c === true)
      return (
        cams[0] ??
        (() => {
          throw overconstrained();
        })()
      );
    const wantId = ideal(c.deviceId);
    if (typeof wantId === 'string') {
      const hit = cams.find((x) => x.deviceId === wantId);
      if (!hit) throw overconstrained();
      return hit;
    }
    const wantFacing = ideal(c.facingMode);
    const exact = !!c.facingMode && typeof c.facingMode === 'object' && 'exact' in c.facingMode;
    const hit = cams.find((x) => x.facing === wantFacing);
    if (hit) return hit;
    if (exact) throw overconstrained();
    const first = cams[0];
    if (!first) throw new DOMException('no camera', 'NotFoundError');
    return first;
  }

  const devices: MediaDevicesLike = {
    async getUserMedia(c) {
      if (opts.deny) throw new DOMException('permission denied', 'NotAllowedError');
      const tracks: MediaStreamTrack[] = [];
      if (c.audio) tracks.push(audioTrack());
      if (c.video) tracks.push(videoTrack(pickCam(c.video)));
      return new MediaStream(tracks);
    },
    async enumerateDevices() {
      return [
        { kind: 'audioinput', deviceId: 'mic-1', label: 'Fake microphone' },
        ...cams.map((x) => ({ kind: 'videoinput', deviceId: x.deviceId, label: x.label })),
        { kind: 'audiooutput', deviceId: 'spk-1', label: 'Fake speaker 1' },
        { kind: 'audiooutput', deviceId: 'spk-2', label: 'Fake speaker 2' },
      ];
    },
    addEventListener: (type, fn) => events.addEventListener(type, fn),
    removeEventListener: (type, fn) => events.removeEventListener(type, fn),
  };

  return {
    devices,
    /** Pulls a camera: its live tracks end (like a real unplug) and `devicechange` fires. */
    unplug(deviceId: string) {
      cams = cams.filter((x) => x.deviceId !== deviceId);
      for (const t of live.get(deviceId) ?? []) {
        if (t.readyState === 'live') {
          t.stop();
          t.dispatchEvent(new Event('ended'));
        }
      }
      events.dispatchEvent(new Event('devicechange'));
    },
    /** Hides the second camera so a "single camera" device can be simulated. */
    removeBackCamera() {
      cams = cams.filter((x) => x.deviceId !== BACK.deviceId);
    },
  };
}
