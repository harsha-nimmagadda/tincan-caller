/**
 * Hands a reply (`#a=` link) from a freshly opened tab to the caller's tab (§8.3).
 * Same-browser only: iOS home-screen apps and Safari do not share a BroadcastChannel,
 * which is why the opened tab falls back to showing the code for pasting.
 */
const CHANNEL = 'tincan-bridge';
export const BRIDGE_ACK_TIMEOUT_MS = 700;

type Msg = { t: 'answer'; token: string } | { t: 'accepted' };

function open(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
}

function parse(data: unknown): Msg | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as { t?: unknown; token?: unknown };
  if (m.t === 'accepted') return { t: 'accepted' };
  if (m.t === 'answer' && typeof m.token === 'string' && m.token.length <= 1024) {
    return { t: 'answer', token: m.token };
  }
  return null;
}

/**
 * Caller tab: listen for replies. `accept` returns true only if the reply belongs to our pending
 * invite; only then is `accepted` sent back. Returns a stop function.
 */
export function listenForAnswers(accept: (token: string) => Promise<boolean>): () => void {
  const ch = open();
  if (!ch) return () => undefined;
  let pending = 0;
  let stopped = false;
  const closeIfDone = () => {
    if (stopped && pending === 0) ch.close();
  };
  ch.onmessage = (e: MessageEvent) => {
    const m = parse(e.data);
    if (m?.t !== 'answer') return;
    pending++;
    void accept(m.token)
      .then((ok) => {
        if (ok) ch.postMessage({ t: 'accepted' } satisfies Msg);
      })
      .finally(() => {
        pending--;
        closeIfDone();
      });
  };
  // Accepting a reply moves the call on, which stops this listener *before* the acknowledgement is
  // sent; so closing waits for any answer still being processed.
  return () => {
    stopped = true;
    ch.onmessage = null;
    closeIfDone();
  };
}

/** Opened tab: offer the reply to a caller tab; resolves true if one accepted it in time. */
export function sendAnswer(token: string, timeoutMs = BRIDGE_ACK_TIMEOUT_MS): Promise<boolean> {
  const ch = open();
  if (!ch) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      ch.onmessage = null;
      ch.close();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    ch.onmessage = (e: MessageEvent) => {
      if (parse(e.data)?.t === 'accepted') done(true);
    };
    ch.postMessage({ t: 'answer', token } satisfies Msg);
  });
}
