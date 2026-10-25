import { EMPTY_DEVICES } from '../core/media/devices';
import {
  MediaAccessError,
  type LocalMedia,
  type MediaNotice,
} from '../core/media/media-controller';
import { setMediaSessionState } from '../core/platform/media-session';
import { isMobileDevice } from '../core/platform/orientation';
import type { MessageKey } from '../i18n';
import { call, getMedia } from './services';
import type { LocalView, MediaSlice, StoreGet, StoreSet } from './types';

const NOTICE_TOAST: Record<MediaNotice, MessageKey> = {
  'camera-unavailable': 'toast.cameraUnavailable',
  'camera-in-use': 'toast.cameraInUse',
  'camera-lost': 'toast.cameraLost',
  'mic-lost': 'toast.micLost',
  'flip-failed': 'toast.flipFailed',
  'device-switch-failed': 'toast.deviceSwitchFailed',
  'device-fallback': 'toast.deviceFallback',
};

const EMPTY_LOCAL: LocalView = {
  micOn: true,
  camOn: false,
  facing: 'unknown',
  mirror: false,
  canFlip: false,
  stream: null,
};

function view(m: LocalMedia): LocalView {
  const tracks = [m.audio, m.video].filter((x): x is MediaStreamTrack => x !== null);
  return {
    micOn: m.micOn,
    camOn: m.camOn,
    facing: m.facing,
    mirror: m.mirror,
    canFlip: m.canFlip,
    stream: tracks.length > 0 ? new MediaStream(tracks) : null,
  };
}

let subscribed = false;

export function createMediaSlice(set: StoreSet, get: StoreGet): MediaSlice {
  const media = () => {
    const m = getMedia();
    if (!subscribed) {
      subscribed = true;
      m.events.on('localMedia', (snapshot) => {
        set({ local: view(snapshot), preferredDevices: m.preferredDevices });
        // The call (if any) borrows the tracks and tells the peer what is on.
        void call.session?.attachLocalTracks(snapshot.audio, snapshot.video);
        call.session?.sendMediaState({ mic: snapshot.micOn, cam: snapshot.camOn });
        if (get().screen === 'in-call')
          setMediaSessionState({ mic: snapshot.micOn, cam: snapshot.camOn });
      });
      m.events.on('devices', (devices) => set({ devices, preferredDevices: m.preferredDevices }));
      m.events.on('notice', (n) => get().toast(NOTICE_TOAST[n]));
    }
    return m;
  };

  return {
    local: EMPTY_LOCAL,
    devices: EMPTY_DEVICES,
    preferredDevices: {},
    mediaError: null,
    mediaReady: false,

    startMedia: async () => {
      const { settings } = get();
      set({ mediaError: null, mediaReady: false });
      try {
        await media().start({
          video: settings.startCamOn,
          quality: settings.quality,
          deviceIds: settings.preferredDevices,
        });
        media().setMicEnabled(settings.startMicOn);
        set({ mediaReady: true });
      } catch (e) {
        set({ mediaError: e instanceof MediaAccessError ? e.kind : 'unknown' });
      }
    },
    stopMedia: () => {
      getMedia().stop();
      set({ local: EMPTY_LOCAL, mediaReady: false });
    },
    setMic: (on) => media().setMicEnabled(on),
    setCam: async (on) => void (await media().setCamEnabled(on)),
    flipCamera: async () => void (await media().flipCamera()),
    setDevice: async (kind, deviceId) => {
      await media().setDevice(kind, deviceId);
      // Remember the choice for next time (speakers included).
      get().updateSettings({
        preferredDevices: { ...get().settings.preferredDevices, [kind]: deviceId },
      });
    },

    beginScan: async () => {
      // Phones usually cannot open a second camera while one is running.
      const resume = isMobileDevice() && get().local.camOn;
      if (resume) await media().setCamEnabled(false);
      return resume;
    },
    endScan: async (resume) => {
      if (resume && get().screen !== 'ended') await media().setCamEnabled(true);
    },
  };
}
