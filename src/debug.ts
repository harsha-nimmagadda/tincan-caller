// PLAN-NOTE: the plan names this file debug.tsx; it needs no JSX, so it is plain debug.ts.
// Dev/test-only harness (excluded from production builds, see vite.config.ts) that drives
// CallSession + MediaController by hand. Query params:
//   fake=1     fake mediaDevices (2 cameras, mic, 2 speakers) instead of the real ones
//   stun=1     default STUN servers (otherwise none: LAN-only, deterministic for CI)
//   audio=1    start with the camera off (audio-only mode)
//   quality=   auto | data-saver | high
//   mobile=1   behave like a touch device (flip by facingMode; close-then-open device switching)
import { createFakeMediaDevices } from './debug-fake-media';
import { CallSession } from './core/rtc/call-session';
import type { SessionState } from './core/rtc/session-types';
import { maxBitrate } from './core/media/constraints';
import { applySink, type DeviceKind } from './core/media/devices';
import { MediaAccessError, MediaController, type LocalMedia } from './core/media/media-controller';
import { DEFAULT_SETTINGS, type QualityPreset } from './core/settings/settings';
import { buildLink } from './core/signaling/link';

const params = new URLSearchParams(location.search);
const fake = params.get('fake') === '1';
const quality =
  (['auto', 'data-saver', 'high'] as const).find((q) => q === params.get('quality')) ?? 'auto';
const el = <T extends HTMLElement>(id: string) => {
  const node = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!node) throw new Error(`missing #${id}`);
  return node;
};
const show = (id: string, text: string) => void (el(id).textContent = text);
const message = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

const fakeMedia = fake ? createFakeMediaDevices() : null;
const media = new MediaController({
  ...(fakeMedia ? { mediaDevices: fakeMedia.devices } : {}),
  ...(params.get('mobile') === '1' ? { isMobile: () => true } : {}),
});
let session: CallSession | null = null;
let local: LocalMedia = media.snapshot;
const logLines: string[] = [];

// ---------- local media → UI + session ----------
function fillSelect(
  kind: DeviceKind,
  entries: { deviceId: string; label: string }[],
  selected: string | undefined,
) {
  const sel = el<HTMLSelectElement>(`sel-${kind}`);
  sel.replaceChildren(
    ...entries.map((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `${kind} ${i + 1}`;
      return o;
    }),
  );
  if (selected) sel.value = selected;
}

media.events.on('localMedia', (m) => {
  local = m;
  el<HTMLVideoElement>('local-video').srcObject = new MediaStream(
    [m.audio, m.video].filter((t): t is MediaStreamTrack => t !== null),
  );
  el<HTMLVideoElement>('local-video').style.transform = m.mirror ? 'scaleX(-1)' : '';
  show('local-facing', m.facing);
  show('local-mirror', String(m.mirror));
  el('btn-flip').hidden = !m.canFlip || !m.camOn;
  void session?.attachLocalTracks(m.audio, m.video);
  session?.sendMediaState({ mic: m.micOn, cam: m.camOn });
});
media.events.on('devices', (d) => {
  const active = (t: MediaStreamTrack | null) => t?.getSettings().deviceId;
  fillSelect('audioinput', d.audioinput, active(local.audio));
  fillSelect('videoinput', d.videoinput, active(local.video));
  fillSelect('audiooutput', d.audiooutput, media.preferredDevices.audiooutput);
});
media.events.on('notice', (n) => show('notice', n));

// ---------- session ----------
function newSession(): CallSession {
  const settings = {
    ...DEFAULT_SETTINGS,
    quality: quality as QualityPreset,
    stun: params.get('stun') === '1' ? DEFAULT_SETTINGS.stun : [],
  };
  const s = new CallSession({
    settings,
    appVersion: 'debug',
    log: (line) => {
      logLines.push(`${Math.round(performance.now())} ${line}`);
      console.log(line);
    },
  });
  s.on('state', (st: SessionState) => {
    show('call-state', st.status);
    if (st.status === 'ended') show('ended-reason', st.reason);
    if (st.status === 'failed') {
      show('ended-reason', st.reason);
      show('error-panel', `${st.reason}${st.diagnostics ? ` (${st.diagnostics})` : ''}`);
    }
    if (st.status === 'connected') s.sendMediaState({ mic: local.micOn, cam: local.camOn });
    if (st.status === 'ended' || st.status === 'failed') media.stop();
  });
  s.on('remoteStream', (stream) => {
    const v = el<HTMLVideoElement>('remote-video');
    v.srcObject = stream;
    v.play().catch(() => (el('tap-to-play').hidden = false));
    void applySink(v, media.preferredDevices.audiooutput);
  });
  s.on('remoteMediaState', (m) => {
    el('remote-mic-off').hidden = m.mic;
    el('remote-cam-off').hidden = m.cam;
  });
  s.on('sas', (code) => show('sas-code', code));
  void s.setMaxVideoBitrate(maxBitrate(quality));
  session = s;
  return s;
}

async function start(fn: (s: CallSession) => Promise<void>): Promise<void> {
  try {
    await media.start({ video: params.get('audio') !== '1', quality });
    const s = newSession();
    await s.attachLocalTracks(local.audio, local.video);
    await fn(s);
  } catch (e) {
    show('error-panel', e instanceof MediaAccessError ? `media:${e.kind}` : message(e));
  }
}

el('start-call').addEventListener(
  'click',
  () =>
    void start(async (s) => {
      const token = await s.createOffer();
      (el('invite-code') as HTMLTextAreaElement).value = token;
      (el('invite-link') as HTMLTextAreaElement).value = buildLink(
        location.href.split('?')[0] ?? '',
        'offer',
        token,
      );
    }),
);
el('join-submit').addEventListener(
  'click',
  () =>
    void start(async (s) => {
      (el('reply-code') as HTMLTextAreaElement).value = await s.acceptOffer(
        (el('offer-input') as HTMLTextAreaElement).value,
      );
    }),
);
el('reply-submit').addEventListener('click', () => {
  show('error-panel', '');
  session
    ?.acceptAnswer((el('reply-input') as HTMLTextAreaElement).value)
    .catch((e: unknown) => show('error-panel', message(e)));
});

el('btn-hangup').addEventListener('click', () => session?.hangup());
el('tap-to-play').addEventListener('click', () => {
  void el<HTMLVideoElement>('remote-video').play();
  el('tap-to-play').hidden = true;
});
el('btn-mic').addEventListener('click', () => media.setMicEnabled(!local.micOn));
el('btn-cam').addEventListener('click', () => void media.setCamEnabled(!local.camOn));
el('btn-flip').addEventListener('click', () => void media.flipCamera());
for (const kind of ['audioinput', 'videoinput', 'audiooutput'] as const) {
  el<HTMLSelectElement>(`sel-${kind}`).addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    void media.setDevice(kind, id).then(() => {
      if (kind === 'audiooutput') void applySink(el<HTMLVideoElement>('remote-video'), id);
    });
  });
}

// ---------- hooks for e2e ----------
const liveTracks = () => [local.audio, local.video].filter((t) => t?.readyState === 'live').length;
Object.assign(window, {
  __tincan: {
    log: () => logLines,
    debug: () => ({
      ...session?.debugInfo,
      liveLocalTracks: liveTracks(),
      videoLive: local.video?.readyState === 'live',
      videoMaxBitrate: session?.videoMaxBitrate ?? null,
    }),
    stats: async () => {
      const pc = (session as unknown as { pc?: RTCPeerConnection } | null)?.pc;
      const report = await pc?.getStats();
      return report ? Array.from(report.values()) : [];
    },
    telemetry: () => session?.getTelemetry(),
    unplug: (id: string) => fakeMedia?.unplug(id),
    simulateBackgroundKill: () => {
      // iOS ends capture tracks in the background; mimic it: stop + 'ended' + visibility event.
      for (const t of [local.audio, local.video]) {
        if (t?.readyState === 'live') {
          t.stop();
          Object.defineProperty(t, 'readyState', { value: 'ended' });
        }
      }
      document.dispatchEvent(new Event('visibilitychange'));
    },
  },
});
