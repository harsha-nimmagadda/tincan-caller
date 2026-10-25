import { describe, expect, it } from 'vitest';
import { decodeBase64Url } from '../../src/core/encoding/base64url';
import { decryptMsg, deriveRoom, encryptMsg } from '../../src/core/signaling/relay/relay-crypto';
import {
  decodeRoomSecret,
  encodeRoomSecret,
  guardRelayMsg,
  newInstanceId,
  newRoomSecret,
  newSessionId,
  type RelayMsg,
} from '../../src/core/signaling/relay/messages';

const ID_A = 'a'.repeat(16);
const ID_B = 'b'.repeat(16);
const secret = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const offer: RelayMsg = {
  v: 1,
  t: 'offer',
  from: ID_A,
  to: ID_B,
  sid: '0123abcd',
  token: 'x'.repeat(150),
};

describe('room derivation', () => {
  it('is deterministic: same secret → same public room tag (32 hex)', async () => {
    const a = await deriveRoom(secret);
    const b = await deriveRoom(secret);
    expect(a.roomTag).toMatch(/^[0-9a-f]{32}$/);
    expect(a.roomTag).toBe(b.roomTag);
  });
  it('different secrets → different rooms', async () => {
    const other = Uint8Array.from(secret, (b) => b ^ 1);
    expect((await deriveRoom(other)).roomTag).not.toBe((await deriveRoom(secret)).roomTag);
  });
  it('the key is non-extractable, and the tag does not reveal the secret', async () => {
    const room = await deriveRoom(secret);
    expect(room.key.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('raw', room.key)).rejects.toThrow();
    expect(room.roomTag).not.toContain(
      Array.from(secret, (b) => b.toString(16).padStart(2, '0')).join(''),
    );
  });
});

describe('encrypt / decrypt', () => {
  it('round-trips every message type', async () => {
    const { key } = await deriveRoom(secret);
    const msgs: RelayMsg[] = [
      { v: 1, t: 'hello', from: ID_A, ts: 1700000000000 },
      offer,
      { v: 1, t: 'answer', from: ID_B, to: ID_A, sid: '0123abcd', token: 'y'.repeat(190) },
      { v: 1, t: 'bye', from: ID_A },
    ];
    for (const m of msgs) expect(await decryptMsg(key, await encryptMsg(key, m))).toEqual(m);
  });
  it('uses a fresh IV each time (same message → different ciphertext)', async () => {
    const { key } = await deriveRoom(secret);
    expect(await encryptMsg(key, offer)).not.toBe(await encryptMsg(key, offer));
  });
  it('content is iv(12) ‖ ciphertext, and does not contain the plaintext', async () => {
    const { key } = await deriveRoom(secret);
    const content = await encryptMsg(key, offer);
    const bytes = decodeBase64Url(content) ?? new Uint8Array();
    expect(bytes.length).toBeGreaterThan(12 + JSON.stringify(offer).length);
    expect(content).not.toContain(offer.token.slice(0, 20));
  });
  it('a wrong key fails (returns null, never throws)', async () => {
    const { key } = await deriveRoom(secret);
    const wrong = (await deriveRoom(Uint8Array.from(secret, (b) => b ^ 0xff))).key;
    expect(await decryptMsg(wrong, await encryptMsg(key, offer))).toBeNull();
  });
  it('tampering, truncation and junk are rejected', async () => {
    const { key } = await deriveRoom(secret);
    const content = await encryptMsg(key, offer);
    const flipped = content.slice(0, 30) + (content[30] === 'A' ? 'B' : 'A') + content.slice(31);
    expect(await decryptMsg(key, flipped)).toBeNull();
    expect(await decryptMsg(key, content.slice(0, 20))).toBeNull();
    for (const junk of ['', 'not base64!', 'AAAA', '🙂'])
      expect(await decryptMsg(key, junk)).toBeNull();
  });
  it('valid ciphertext of an invalid message is dropped', async () => {
    const { key } = await deriveRoom(secret);
    const bad = { v: 1, t: 'offer', from: 'nope' } as unknown as RelayMsg;
    expect(await decryptMsg(key, await encryptMsg(key, bad))).toBeNull();
  });
});

describe('message guard and secrets', () => {
  it('accepts valid and rejects malformed messages', () => {
    expect(guardRelayMsg(offer)).toEqual(offer);
    for (const bad of [
      null,
      5,
      [],
      {},
      { ...offer, v: 2 },
      { ...offer, from: 'short' },
      { ...offer, to: 'ZZ' + 'a'.repeat(14) },
      { ...offer, sid: '123' },
      { ...offer, token: '' },
      { ...offer, token: 'x'.repeat(2000) },
      { ...offer, t: 'rollback' },
      { v: 1, t: 'hello', from: ID_A, ts: 'now' },
      { v: 1, t: 'hello', from: ID_A, ts: Infinity },
    ])
      expect(guardRelayMsg(bad)).toBeNull();
    expect(guardRelayMsg({ v: 1, t: 'bye', from: ID_A, extra: 1 })).toEqual({
      v: 1,
      t: 'bye',
      from: ID_A,
    });
  });
  it('ids and secrets have the right shape and are random', () => {
    expect(newInstanceId()).toMatch(/^[0-9a-f]{16}$/);
    expect(newSessionId()).toMatch(/^[0-9a-f]{8}$/);
    expect(newInstanceId()).not.toBe(newInstanceId());
    const s = newRoomSecret();
    expect(s).toHaveLength(16);
    expect(encodeRoomSecret(s)).toHaveLength(22);
  });
  it('decodeRoomSecret accepts exactly 22 chars / 16 bytes', () => {
    const s = newRoomSecret();
    expect(decodeRoomSecret(encodeRoomSecret(s))).toEqual(s);
    for (const bad of ['', 'abc', 'x'.repeat(21), 'x'.repeat(23), '!'.repeat(22)])
      expect(decodeRoomSecret(bad)).toBeNull();
  });
});
