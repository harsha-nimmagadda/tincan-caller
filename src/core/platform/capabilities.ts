import { supportsSinkId } from '../media/devices';

export interface Capabilities {
  wakeLock: boolean;
  pip: boolean;
  sinkId: boolean;
  share: boolean;
  clipboardRead: boolean;
  barcodeDetector: boolean;
  getUserMedia: boolean;
}

/** Everything the UI feature-detects, in one place. */
export function detectCapabilities(): Capabilities {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    wakeLock: !!nav && 'wakeLock' in nav,
    pip: typeof document !== 'undefined' && !!document.pictureInPictureEnabled,
    sinkId: supportsSinkId(),
    share: typeof nav?.share === 'function',
    clipboardRead: typeof nav?.clipboard?.readText === 'function',
    barcodeDetector: typeof globalThis !== 'undefined' && 'BarcodeDetector' in globalThis,
    getUserMedia: typeof nav?.mediaDevices?.getUserMedia === 'function',
  };
}
