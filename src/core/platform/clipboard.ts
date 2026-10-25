export type CopyResult = 'copied' | 'manual';

/**
 * Copy text. Falls back to a selected off-screen textarea + `execCommand('copy')`; if that fails
 * too, returns 'manual' and the UI shows its visible textarea with a "press Ctrl/Cmd+C" hint.
 */
export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    /* permission denied or insecure context: try the fallback */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok ? 'copied' : 'manual';
}

/** Only call from a user gesture (a "Paste" button). Returns null if unavailable or denied. */
export async function readText(): Promise<string | null> {
  try {
    return (await navigator.clipboard?.readText?.()) ?? null;
  } catch {
    return null;
  }
}
