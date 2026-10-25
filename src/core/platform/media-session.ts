export interface CallActions {
  toggleMic(): void;
  toggleCam(): void;
  hangup(): void;
}

interface CallMediaSession {
  setActionHandler(action: string, handler: (() => void) | null): void;
  setMicrophoneActive?(active: boolean): void;
  setCameraActive?(active: boolean): void;
}

const session = (): CallMediaSession | null =>
  typeof navigator === 'undefined'
    ? null
    : ((navigator.mediaSession as unknown as CallMediaSession | undefined) ?? null);

const ACTIONS: [string, keyof CallActions][] = [
  ['togglemicrophone', 'toggleMic'],
  ['togglecamera', 'toggleCam'],
  ['hangup', 'hangup'],
];

/** Hooks the OS call controls (lock screen, PiP window). Each action is try/catch'd: support varies. */
export function bindCallActions(actions: CallActions): () => void {
  const ms = session();
  const bound: string[] = [];
  for (const [name, key] of ACTIONS) {
    try {
      ms?.setActionHandler(name, () => actions[key]());
      bound.push(name);
    } catch {
      /* unsupported action */
    }
  }
  return () => {
    for (const name of bound) {
      try {
        ms?.setActionHandler(name, null);
      } catch {
        /* ignore */
      }
    }
  };
}

export function setMediaSessionState(state: { mic: boolean; cam: boolean }): void {
  const ms = session();
  try {
    ms?.setMicrophoneActive?.(state.mic);
    ms?.setCameraActive?.(state.cam);
  } catch {
    /* ignore */
  }
}
