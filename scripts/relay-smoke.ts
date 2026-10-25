// Manual check (needs network): does each public relay accept and forward our ephemeral event kind?
// Run: pnpm relay-smoke [wss://relay1 wss://relay2 ...]   (defaults to DEFAULT_RELAYS)
// For every relay: connect, subscribe with an `x`-tag filter, publish a kind-25050 event from a
// second connection and check the first one receives it. The event carries no secrets: a random
// room tag and the text "smoke". Exit code 1 if fewer than 3 relays pass.
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { DEFAULT_RELAYS, RELAY_KIND } from '../src/config.ts';

useWebSocketImplementation(WebSocket);

const TIMEOUT_MS = 8000;
const relays = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_RELAYS;

async function check(url: string): Promise<{ url: string; ok: boolean; detail: string }> {
  const tag = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const listener = new SimplePool({ enableReconnect: false });
  const sender = new SimplePool({ enableReconnect: false });
  const t0 = Date.now();
  try {
    let eoseAt = 0;
    const received = new Promise<number>((resolve) => {
      listener.subscribeMany(
        [url],
        { kinds: [RELAY_KIND], '#x': [tag] },
        {
          onevent: () => resolve(Date.now() - t0),
          oneose: () => (eoseAt = Date.now() - t0),
          maxWait: TIMEOUT_MS,
        },
      );
    });
    const deadline = Date.now() + TIMEOUT_MS;
    while (!eoseAt && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    if (!eoseAt)
      return {
        url,
        ok: false,
        detail: `no EOSE within ${TIMEOUT_MS} ms (unreachable or REQ ignored)`,
      };

    const event = finalizeEvent(
      {
        kind: RELAY_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['x', tag]],
        content: 'smoke',
      },
      generateSecretKey(),
    );
    const acks = await Promise.allSettled(sender.publish([url], event, { maxWait: TIMEOUT_MS }));
    const rejected = acks.find((a) => a.status === 'rejected') as PromiseRejectedResult | undefined;
    if (rejected) return { url, ok: false, detail: `publish rejected: ${String(rejected.reason)}` };

    const got = await Promise.race([
      received,
      new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS)),
    ]);
    return got === null
      ? { url, ok: false, detail: 'accepted the event but never forwarded it to the subscriber' }
      : { url, ok: true, detail: `EOSE ${eoseAt} ms, delivered ${got} ms` };
  } catch (e) {
    return { url, ok: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    listener.close([url]);
    sender.close([url]);
  }
}

const results = await Promise.all(relays.map(check));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.url}  ${r.detail}`);
const passing = results.filter((r) => r.ok).map((r) => r.url);
console.log(
  `\n${passing.length}/${results.length} relays pass. Keep in DEFAULT_RELAYS: ${JSON.stringify(passing)}`,
);
process.exitCode = passing.length >= 3 ? 0 : 1;
process.exit();
