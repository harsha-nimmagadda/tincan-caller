// PLAN-NOTE: the plan names this file debug.tsx; it needs no JSX, so it is plain debug.ts.
// Dev/test-only harness (excluded from production builds, see vite.config.ts) that drives
// CallSession by hand. Query params: fake=1 (canvas+oscillator tracks), stun=1 (default STUN),
// audio=1 (start with the camera off).
import { CallSession } from './core/rtc/call-session';
import type { SessionState } from './core/rtc/session-types';
import { DEFAULT_SETTINGS } from './core/settings/settings';
import { buildLink } from './core/signaling/link';

const params = new URLSearchParams(location.search);
const fake = params.get('fake') === '1';
const el = <T extends HTMLElement>(id: string) => {
  const node = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!node) throw new Error(`missing #${id}`);
  return node;
};
const show = (id: string, text: string) => void (el(id).textContent = text);

// ---------- fake media ----------
function fakeVideo(): MediaStreamTrack {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  let n = 0;
  const draw = () => {
    if (!ctx) return;
    ctx.fillStyle = `hsl(${(n * 7) % 360} 70% 45%)`;
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = '#fff';
    ctx.font = '40px monospace';
    ctx.fillText(String(n++), 20, 130);
  };
  draw();
  const timer = setInterval(draw, 33);
  const track = canvas.captureStream(30).getVideoTracks()[0];
  if (!track) throw new Error('canvas.captureStream gave no track');
  const stop = track.stop.bind(track);
  track.stop = () => {
    clearInterval(timer);
    stop();
  };
  return track;
}

function fakeAudio(): MediaStreamTrack {
  const ctx = new AudioContext();
  void ctx.resume();
  const osc = ctx.createOscillator();
  const dest = ctx.createMediaStreamDestination();
  osc.connect(dest);
  osc.start();
  const track = dest.stream.getAudioTracks()[0];
  if (!track) throw new Error('no audio track');
  const stop = track.stop.bind(track);
  track.stop = () => {
    void ctx.close();
    stop();
  };
  return track;
}

let audio: MediaStreamTrack | null = null;
let video: MediaStreamTrack | null = null;

async function acquire(wantVideo: boolean): Promise<void> {
  if (fake) {
    audio = fakeAudio();
    video = wantVideo ? fakeVideo() : null;
  } else {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantVideo });
    audio = s.getAudioTracks()[0] ?? null;
    video = s.getVideoTracks()[0] ?? null;
  }
  showLocal();
}

function showLocal() {
  const tracks = [audio, video].filter((t): t is MediaStreamTrack => t !== null);
  el<HTMLVideoElement>('local-video').srcObject = new MediaStream(tracks);
}

const liveLocalTracks = () => [audio, video].filter((t) => t?.readyState === 'live').length;

function stopLocal() {
  audio?.stop();
  video?.stop();
}

// ---------- session ----------
let session: CallSession | null = null;
const logLines: string[] = [];

function newSession(): CallSession {
  const settings = {
    ...DEFAULT_SETTINGS,
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
    if (st.status === 'connected')
      s.sendMediaState({ mic: audio?.enabled ?? false, cam: video !== null });
    if (st.status === 'ended' || st.status === 'failed') stopLocal();
  });
  s.on('remoteStream', (stream) => {
    const v = el<HTMLVideoElement>('remote-video');
    v.srcObject = stream;
    v.play().catch(() => (el('tap-to-play').hidden = false));
  });
  s.on('remoteMediaState', (m) => {
    el('remote-mic-off').hidden = m.mic;
    el('remote-cam-off').hidden = m.cam;
  });
  s.on('sas', (code) => show('sas-code', code));
  session = s;
  return s;
}

async function start(fn: (s: CallSession) => Promise<void>): Promise<void> {
  try {
    await acquire(params.get('audio') !== '1');
    const s = newSession();
    await s.attachLocalTracks(audio, video);
    await fn(s);
  } catch (e) {
    show('error-panel', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
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
      const reply = await s.acceptOffer((el('offer-input') as HTMLTextAreaElement).value);
      (el('reply-code') as HTMLTextAreaElement).value = reply;
    }),
);

el('reply-submit').addEventListener('click', () => {
  show('error-panel', '');
  session?.acceptAnswer((el('reply-input') as HTMLTextAreaElement).value).catch((e: unknown) => {
    show('error-panel', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  });
});

el('btn-hangup').addEventListener('click', () => session?.hangup());
el('tap-to-play').addEventListener('click', () => {
  void el<HTMLVideoElement>('remote-video').play();
  el('tap-to-play').hidden = true;
});

el('btn-mic').addEventListener('click', () => {
  if (!audio) return;
  audio.enabled = !audio.enabled;
  session?.sendMediaState({ mic: audio.enabled, cam: video !== null });
});

el('btn-cam').addEventListener('click', () => {
  void (async () => {
    if (video) {
      video.stop();
      video = null;
    } else {
      video = fake
        ? fakeVideo()
        : ((await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0] ??
          null);
    }
    showLocal();
    await session?.attachLocalTracks(audio, video);
    session?.sendMediaState({ mic: audio?.enabled ?? false, cam: video !== null });
  })();
});

// ---------- hooks for e2e ----------
Object.assign(window, {
  __tincan: {
    log: () => logLines,
    debug: () => ({ ...session?.debugInfo, liveLocalTracks: liveLocalTracks() }),
    stats: async () => {
      const pc = (session as unknown as { pc?: RTCPeerConnection } | null)?.pc;
      const report = await pc?.getStats();
      return report ? Array.from(report.values()) : [];
    },
    telemetry: () => session?.getTelemetry(),
  },
});
