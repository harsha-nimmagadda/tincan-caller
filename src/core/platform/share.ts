import { copyText, type CopyResult } from './clipboard';

export interface ShareData {
  title: string;
  text: string;
  url: string;
}
export type ShareResult = 'shared' | 'cancelled' | CopyResult;

/** Native share sheet where available (phones), otherwise copy the URL. */
export async function shareLink(data: ShareData): Promise<ShareResult> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      /* share failed for another reason: fall through to copy */
    }
  }
  return copyText(data.url);
}
