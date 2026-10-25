// Loaded ONLY through dynamic import() when relay mode is used, so nostr-tools stays out of the
// initial bundle. Everything on the wire is AES-GCM encrypted by relay-crypto first (§7).
import { RELAY_KIND, RELAY_MAX_EVENT_AGE_S } from '../../../config';
import type { RelayMsg } from './messages';
import { decryptMsg, deriveRoom, encryptMsg } from './relay-crypto';
import type { RelayTransport } from './relay-controller';

const STATUS_POLL_MS = 1000;
const PUBLISH_WAIT_MS = 5000;
const SEEN_LIMIT = 500;
const SINCE_SLACK_S = 10;

const normalize = (url: string) => new URL(url).href;

/** Joins the room for `secret` on every relay, with a throwaway Nostr identity. */
export async function openNostrTransport(opts: {
  secret: Uint8Array;
  relays: string[];
}): Promise<RelayTransport> {
  const [{ SimplePool }, { finalizeEvent, generateSecretKey, getPublicKey }] = await Promise.all([
    import('nostr-tools/pool'),
    import('nostr-tools/pure'),
  ]);
  const { roomTag, key } = await deriveRoom(opts.secret);
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const pool = new SimplePool({ enableReconnect: true });
  const messageListeners = new Set<(m: RelayMsg) => void>();
  const statusListeners = new Set<() => void>();
  const seen = new Set<string>();
  let closed = false;

  const handle = async (event: {
    id: string;
    pubkey: string;
    created_at: number;
    content: string;
  }) => {
    if (event.pubkey === pubkey) return; // our own echo
    if (Math.floor(Date.now() / 1000) - event.created_at > RELAY_MAX_EVENT_AGE_S) return; // stale
    if (seen.has(event.id)) return; // the same event from another relay
    seen.add(event.id);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
    const msg = await decryptMsg(key, event.content); // wrong room key / junk → null
    if (msg && !closed) for (const cb of messageListeners) cb(msg);
  };

  const sub = pool.subscribeMany(
    opts.relays,
    { kinds: [RELAY_KIND], '#x': [roomTag], since: Math.floor(Date.now() / 1000) - SINCE_SLACK_S },
    { onevent: (e) => void handle(e) },
  );

  const status = () => {
    const live = pool.listConnectionStatus();
    return {
      connected: opts.relays.filter((r) => live.get(normalize(r)) === true).length,
      total: opts.relays.length,
    };
  };
  let last = '';
  const poll = setInterval(() => {
    const key = JSON.stringify(status());
    if (key === last) return;
    last = key;
    for (const cb of statusListeners) cb();
  }, STATUS_POLL_MS);

  return {
    async publish(msg) {
      if (closed) return;
      const content = await encryptMsg(key, msg);
      const event = finalizeEvent(
        {
          kind: RELAY_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['x', roomTag]],
          content,
        },
        sk,
      );
      await Promise.allSettled(pool.publish(opts.relays, event, { maxWait: PUBLISH_WAIT_MS }));
    },
    onMessage(cb) {
      messageListeners.add(cb);
      return () => void messageListeners.delete(cb);
    },
    status,
    onStatus(cb) {
      statusListeners.add(cb);
      return () => void statusListeners.delete(cb);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      sub.close();
      pool.close(opts.relays);
      messageListeners.clear();
      statusListeners.clear();
    },
  };
}

/** Settings → Test: the socket connects, and the relay answers our REQ with EOSE, within `timeoutMs`. */
export async function testRelay(url: string, timeoutMs = 5000): Promise<boolean> {
  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool({ enableReconnect: false });
  try {
    // Connect first: the pool also reports "EOSE" for a relay it could not reach.
    await pool.ensureRelay(url, { connectionTimeout: timeoutMs });
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      pool.subscribeMany(
        [url],
        { kinds: [RELAY_KIND], '#x': ['0'.repeat(32)], limit: 1 },
        {
          onevent: () => undefined,
          oneose: () => {
            clearTimeout(timer);
            resolve(true);
          },
          maxWait: timeoutMs,
        },
      );
    });
  } catch {
    return false;
  } finally {
    pool.close([url]);
  }
}
