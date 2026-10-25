// A tiny in-memory Nostr relay for e2e tests: EVENT / REQ / EOSE / CLOSE with `kinds`, `#x` and
// `since` filtering. Ephemeral like the real thing: nothing is stored or replayed.
// Standalone: `node scripts/mock-nostr-relay.ts` (PORT env, default 7777).
import { pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

interface Filter {
  kinds?: number[];
  since?: number;
  [tag: `#${string}`]: string[] | undefined;
}
interface NostrEvent {
  id: string;
  kind: number;
  created_at: number;
  tags: string[][];
  [k: string]: unknown;
}

function matches(f: Filter, e: NostrEvent): boolean {
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.since !== undefined && e.created_at < f.since) return false;
  for (const [key, wanted] of Object.entries(f)) {
    if (!key.startsWith('#') || !Array.isArray(wanted)) continue;
    const name = key.slice(1);
    if (!e.tags.some((t) => t[0] === name && wanted.includes(t[1] ?? ''))) return false;
  }
  return true;
}

export interface MockRelay {
  url: string;
  port: number;
  /** Events accepted so far (to assert what the relay could see). */
  events: NostrEvent[];
  clients(): number;
  close(): Promise<void>;
}

export async function startMockRelay(port = 0): Promise<MockRelay> {
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const subs = new Map<WebSocket, Map<string, Filter[]>>();
  const events: NostrEvent[] = [];

  wss.on('connection', (ws) => {
    subs.set(ws, new Map());
    ws.on('close', () => subs.delete(ws));
    ws.on('message', (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!Array.isArray(msg)) return;
      const [type, a, ...rest] = msg as [string, unknown, ...unknown[]];
      if (type === 'EVENT') {
        const event = a as NostrEvent;
        events.push(event);
        ws.send(JSON.stringify(['OK', event.id, true, '']));
        for (const [client, byId] of subs) {
          for (const [subId, filters] of byId) {
            if (filters.some((f) => matches(f, event)))
              client.send(JSON.stringify(['EVENT', subId, event]));
          }
        }
      } else if (type === 'REQ') {
        subs.get(ws)?.set(String(a), rest as Filter[]);
        ws.send(JSON.stringify(['EOSE', String(a)]));
      } else if (type === 'CLOSE') {
        subs.get(ws)?.delete(String(a));
      }
    });
  });

  const actual = (wss.address() as { port: number }).port;
  return {
    url: `ws://localhost:${actual}`,
    port: actual,
    events,
    clients: () => subs.size,
    close: () =>
      new Promise((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = await startMockRelay(Number(process.env['PORT'] ?? 7777));
  console.log(`mock relay on ${relay.url}`);
}
