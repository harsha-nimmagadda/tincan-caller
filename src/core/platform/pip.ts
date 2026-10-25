type PipVideo = HTMLVideoElement & {
  webkitSetPresentationMode?(mode: 'picture-in-picture' | 'inline'): void;
  webkitSupportsPresentationMode?(mode: string): boolean;
  autoPictureInPicture?: boolean;
};

export function pipSupported(video?: HTMLVideoElement): boolean {
  if (typeof document !== 'undefined' && document.pictureInPictureEnabled) return true;
  const v = video as PipVideo | undefined;
  return v?.webkitSupportsPresentationMode?.('picture-in-picture') === true;
}

export async function enterPip(video: HTMLVideoElement): Promise<boolean> {
  const v = video as PipVideo;
  try {
    if (typeof document !== 'undefined' && document.pictureInPictureEnabled) {
      await video.requestPictureInPicture();
      return true;
    }
    if (v.webkitSetPresentationMode) {
      v.webkitSetPresentationMode('picture-in-picture');
      return true;
    }
  } catch {
    /* needs a user gesture, or the video has no metadata yet */
  }
  return false;
}

export async function exitPip(video?: HTMLVideoElement): Promise<void> {
  try {
    if (typeof document !== 'undefined' && document.pictureInPictureElement)
      await document.exitPictureInPicture();
    else (video as PipVideo | undefined)?.webkitSetPresentationMode?.('inline');
  } catch {
    /* nothing to exit */
  }
}

type SessionWithPip = { setActionHandler(a: string, h: (() => void) | null): void };

/**
 * Enter PiP automatically when the tab is hidden: Chrome through the Media Session
 * `enterpictureinpicture` action, Safari through `autopictureinpicture`. Returns a cleanup.
 */
export function enableAutoPip(video: HTMLVideoElement): () => void {
  const v = video as PipVideo;
  v.autoPictureInPicture = true;
  video.setAttribute('autopictureinpicture', '');
  const ms =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator.mediaSession as unknown as SessionWithPip | undefined);
  let registered = false;
  try {
    ms?.setActionHandler('enterpictureinpicture', () => void enterPip(video));
    registered = ms !== undefined;
  } catch {
    /* action not supported by this browser */
  }
  return () => {
    video.removeAttribute('autopictureinpicture');
    v.autoPictureInPicture = false;
    if (registered) {
      try {
        ms?.setActionHandler('enterpictureinpicture', null);
      } catch {
        /* ignore */
      }
    }
  };
}
