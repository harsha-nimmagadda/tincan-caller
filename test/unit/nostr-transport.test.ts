import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startMockRelay, type MockRelay } from '../../scripts/mock-nostr-relay';
import { newRoomSecret, type RelayMsg } from '../../src/core/signaling/relay/messages';
import { openNostrTransport, testRelay } from '../../src/core/signaling/relay/nostr-transport';
import type { RelayTransport } from '../../src/core/signaling/relay/relay-controller';

const A = 'a'.repeat(16);
const B = 'b'.repeat(16);
const TOKEN = 'SECRET-TOKEN-' + 'x'.repeat(120);

let relay: MockRelay;
const open: RelayTransport[] = [];
beforeAll(async () => void (relay = await startMockRelay()));
afterEach(() => open.splice(0).forEach((t) => t.close()));
afterAll(async () => relay.close());

async function join(secret: Uint8Array, relays = [relay.url]) {
  const t = await openNostrTransport({ secret, relays });
  open.push(t);
  const got: RelayMsg[] = [];
  t.onMessage((m) => got.push(m));
  return { t, got };
}
const until = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
};
const msg = (over: Partial<RelayMsg> = {}) =>
  ({ v: 1, t: 'offer', from: A, to: B, sid: '0123abcd', token: TOKEN, ...over }) as RelayMsg;

describe('NostrTransport against a mock relay (real nostr-tools, real encryption)', () => {
  it('two peers with the same secret hear each other; the message arrives decrypted and intact', async () => {
    const secret = newRoomSecret();
    const a = await join(secret);
    const b = await join(secret);
    await until(() => a.t.status().connected === 1 && b.t.status().connected === 1);
    await new Promise((r) => setTimeout(r, 200)); // let both subscriptions register
    await a.t.publish(msg());
    await until(() => b.got.length > 0);
    expect(b.got).toEqual([msg()]);
  });

  it('does not echo your own messages back to you', async () => {
    const secret = newRoomSecret();
    const a = await join(secret);
    await until(() => a.t.status().connected === 1);
    await new Promise((r) => setTimeout(r, 200));
    await a.t.publish(msg());
    await new Promise((r) => setTimeout(r, 400));
    expect(a.got).toEqual([]);
  });

  it('a different secret is a different room: nothing is heard', async () => {
    const a = await join(newRoomSecret());
    const stranger = await join(newRoomSecret());
    await until(() => a.t.status().connected === 1 && stranger.t.status().connected === 1);
    await new Promise((r) => setTimeout(r, 200));
    await a.t.publish(msg());
    await new Promise((r) => setTimeout(r, 500));
    expect(stranger.got).toEqual([]);
  });

  it('the relay only ever sees ciphertext: no token, no SDP, no peer id', async () => {
    const secret = newRoomSecret();
    const a = await join(secret);
    await until(() => a.t.status().connected === 1);
    const before = relay.events.length;
    await a.t.publish(msg());
    const seen = relay.events.slice(before);
    expect(seen.length).toBe(1);
    const wire = JSON.stringify(seen);
    for (const secretBit of [TOKEN.slice(0, 20), A, B, '0123abcd', 'offer'])
      expect(wire).not.toContain(secretBit);
    expect(seen[0]?.kind).toBe(25050);
    expect(seen[0]?.tags).toEqual([['x', expect.stringMatching(/^[0-9a-f]{32}$/)]]);
  });

  it('duplicates are delivered once, even if two relays carry the same event', async () => {
    const second = await startMockRelay();
    try {
      const secret = newRoomSecret();
      const both = [relay.url, second.url];
      const a = await join(secret, both);
      const b = await join(secret, both);
      await until(() => a.t.status().connected === 2 && b.t.status().connected === 2);
      await new Promise((r) => setTimeout(r, 300));
      await a.t.publish(msg());
      await until(() => b.got.length > 0);
      await new Promise((r) => setTimeout(r, 400));
      expect(b.got).toHaveLength(1);
    } finally {
      await second.close();
    }
  });

  it('works with one dead relay among the live ones', async () => {
    const secret = newRoomSecret();
    const dead = 'ws://localhost:9'; // nothing listens there
    const a = await join(secret, [dead, relay.url]);
    const b = await join(secret, [dead, relay.url]);
    await until(() => a.t.status().connected === 1 && b.t.status().connected === 1);
    expect(a.t.status()).toEqual({ connected: 1, total: 2 });
    await new Promise((r) => setTimeout(r, 300));
    await a.t.publish(msg());
    await until(() => b.got.length > 0);
    expect(b.got).toHaveLength(1);
  });

  it('reports status changes and stops cleanly on close (no more messages, no throws)', async () => {
    const secret = newRoomSecret();
    const a = await join(secret);
    let notified = 0;
    a.t.onStatus(() => notified++);
    await until(() => notified > 0);
    expect(a.t.status().connected).toBe(1);
    a.t.close();
    a.t.close();
    await expect(a.t.publish(msg())).resolves.toBeUndefined();
  });

  it('Settings → Test: true for a live relay, false for a dead one', async () => {
    expect(await testRelay(relay.url, 3000)).toBe(true);
    expect(await testRelay('ws://localhost:9', 1500)).toBe(false);
  });
});
