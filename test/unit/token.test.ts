import { describe, expect, it } from 'vitest';
import { encodeBase64Url } from '../../src/core/encoding/base64url';
import { concatBytes } from '../../src/core/encoding/bytes';
import { crc32 } from '../../src/core/encoding/crc32';
import { decodeBase64Url } from '../../src/core/encoding/base64url';
import { decodeToken, encodeToken, MAX_TOKEN_BYTES } from '../../src/core/token/token';
import { computeOfferRef } from '../../src/core/token/offer-ref';
import {
  TokenCorruptError,
  TokenFormatError,
  TokenKindError,
  TokenVersionError,
} from '../../src/core/token/errors';
import { answer, offer } from './helpers';

/** Re-seal a mutated body with a valid CRC so we test the field check, not the CRC check. */
function reseal(mutate: (b: Uint8Array) => Uint8Array): string {
  const bytes = decodeBase64Url(encodeToken(offer)) ?? new Uint8Array();
  const body = mutate(bytes.slice(0, bytes.length - 4));
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(body));
  return encodeBase64Url(concatBytes(body, crc));
}

describe('token roundtrip', () => {
  it('offer', () => expect(decodeToken(encodeToken(offer), 'offer')).toEqual(offer));
  it('answer (with mid, commit, offerRef)', () =>
    expect(decodeToken(encodeToken(answer), 'answer')).toEqual(answer));
  it('is compact: a typical offer is well under 512 bytes and a QR-friendly size', () => {
    expect(encodeToken(offer).length).toBeLessThan(220);
  });
  it('supports zero candidates and 12 candidates', () => {
    expect(decodeToken(encodeToken({ ...offer, candidates: [] })).candidates).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => ({
      type: 'srflx' as const,
      family: 'ipv4' as const,
      address: `203.0.113.${i}`,
      port: 1000 + i,
    }));
    expect(decodeToken(encodeToken({ ...offer, candidates: many })).candidates).toHaveLength(12);
  });
  it('offerRef is 4 bytes of SHA-256(ufrag:pwd) and stable', async () => {
    const a = await computeOfferRef('PQpP', 'secret-secret-secret-1234');
    expect(a).toHaveLength(4);
    expect(await computeOfferRef('PQpP', 'secret-secret-secret-1234')).toEqual(a);
    expect(await computeOfferRef('PQpQ', 'secret-secret-secret-1234')).not.toEqual(a);
  });
});

describe('token rejection', () => {
  it('encoder: >12 candidates, bad fingerprint, answer without commit, offer with commit', () => {
    const c = offer.candidates[0]!;
    expect(() => encodeToken({ ...offer, candidates: Array(13).fill(c) })).toThrow(
      TokenFormatError,
    );
    expect(() => encodeToken({ ...offer, fingerprint: new Uint8Array(31) })).toThrow(
      TokenFormatError,
    );
    expect(() => encodeToken({ ...answer, commit: undefined })).toThrow(TokenFormatError);
    expect(() => encodeToken({ ...offer, commit: answer.commit })).toThrow(TokenFormatError);
  });
  it('encoder: field range checks', () => {
    for (const bad of [
      { ufrag: 'abc' },
      { pwd: 'short' },
      { sessId: '12a' },
      { sessId: '' },
      { mid: 'x'.repeat(17) },
      { sessVersion: -1 },
      { sessVersion: 2 ** 32 },
      { ufrag: 'a b c d' },
      { setup: 'bogus' as never },
    ]) {
      expect(() =>
        encodeToken({ ...offer, ...bad, mid: (bad as { mid?: string }).mid ?? '0' }),
      ).toThrow(TokenFormatError);
    }
    const c = offer.candidates[0]!;
    expect(() => encodeToken({ ...offer, candidates: [{ ...c, port: 0 }] })).toThrow(
      TokenFormatError,
    );
    expect(() => encodeToken({ ...offer, candidates: [{ ...c, address: 'nope' }] })).toThrow(
      TokenFormatError,
    );
    expect(() => encodeToken({ ...offer, candidates: [{ ...c, type: 'weird' as never }] })).toThrow(
      TokenFormatError,
    );
  });
  it('too long', () => {
    expect(() => decodeToken('A'.repeat(MAX_TOKEN_BYTES * 2))).toThrow(TokenFormatError);
  });
  it('not base64url / too short / truncated → corrupt', () => {
    const t = encodeToken(offer);
    expect(() => decodeToken('!!!!')).toThrow(TokenCorruptError);
    expect(() => decodeToken('AAA')).toThrow(TokenCorruptError);
    expect(() => decodeToken(t.slice(0, t.length - 10))).toThrow(TokenCorruptError);
    const flipped = t.slice(0, 40) + (t[40] === 'A' ? 'B' : 'A') + t.slice(41);
    expect(() => decodeToken(flipped)).toThrow(TokenCorruptError);
  });
  it('bad version', () => {
    const bytes = decodeBase64Url(encodeToken(offer)) ?? new Uint8Array();
    bytes[0] = 0x20;
    expect(() => decodeToken(encodeBase64Url(bytes))).toThrow(TokenVersionError);
  });
  it('kind mismatch has specific messages', () => {
    expect(() => decodeToken(encodeToken(answer), 'offer')).toThrow(TokenKindError);
    expect(() => decodeToken(encodeToken(offer), 'answer')).toThrow(/invite/);
    expect(() => decodeToken(encodeToken(answer), 'offer')).toThrow(/reply/);
  });
  it('unknown kind nibble, reserved flags, bad setup', () => {
    expect(() => decodeToken(reseal((b) => (b.set([0x12], 0), b)))).toThrow(TokenFormatError);
    expect(() => decodeToken(reseal((b) => (b.set([(b[1] ?? 0) | 0x20], 1), b)))).toThrow(
      TokenFormatError,
    );
    expect(() => decodeToken(reseal((b) => (b.set([3], 1), b)))).toThrow(TokenFormatError);
  });
  it('offer claiming commit flag / answer without it', () => {
    expect(() => decodeToken(reseal((b) => (b.set([(b[1] ?? 0) | 8], 1), b)))).toThrow(
      TokenFormatError,
    );
    const a = decodeBase64Url(encodeToken(answer)) ?? new Uint8Array();
    const body = a.slice(0, a.length - 4);
    body.set([(body[1] ?? 0) & ~8], 1);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, crc32(body));
    expect(() => decodeToken(encodeBase64Url(concatBytes(body, crc)))).toThrow(TokenFormatError);
  });
  it('bad field lengths and trailing bytes', () => {
    expect(() => decodeToken(reseal((b) => (b.set([2], 2), b)))).toThrow(TokenFormatError); // ufrag len 2
    expect(() => decodeToken(reseal((b) => concatBytes(b, Uint8Array.of(0))))).toThrow(
      TokenFormatError,
    );
    expect(() => decodeToken(reseal((b) => b.slice(0, 30)))).toThrow(TokenCorruptError);
  });
  it('>12 candidates in count byte; candidate reserved bits; bad family; port 0', () => {
    const count = 87; // header 2 + ufrag 5 + pwd 25 + sess-id 19 + version 4 + fingerprint 32
    expect(() => decodeToken(reseal((b) => (b.set([13], count), b)))).toThrow(TokenFormatError);
    expect(() => decodeToken(reseal((b) => (b.set([0x10], count + 1), b)))).toThrow(
      TokenFormatError,
    );
    expect(() => decodeToken(reseal((b) => (b.set([0x0c], count + 1), b)))).toThrow(
      TokenFormatError,
    );
    expect(() => decodeToken(reseal((b) => (b.set([0, 0], count + 1 + 1 + 4), b)))).toThrow(
      TokenFormatError,
    );
  });
  it('non-ascii / digits fields', () => {
    expect(() => decodeToken(reseal((b) => (b.set([0x20], 3), b)))).toThrow(TokenFormatError); // space in ufrag
    const sess = 2 + 1 + 4 + 1 + 24 + 1;
    expect(() => decodeToken(reseal((b) => (b.set([0x41], sess), b)))).toThrow(TokenFormatError); // 'A' in sess-id
  });
});
