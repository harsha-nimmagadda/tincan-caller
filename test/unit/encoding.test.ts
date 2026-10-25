import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from '../../src/core/encoding/base64url';
import { crc32 } from '../../src/core/encoding/crc32';
import {
  bytesEqual,
  concatBytes,
  toHex,
  u32be,
  utf8,
  fromUtf8,
  randomBytes,
  sha256,
} from '../../src/core/encoding/bytes';
import {
  bytesToMdns,
  classifyAddress,
  formatIPv4,
  formatIPv6,
  mdnsToBytes,
  parseIPv4,
  parseIPv6,
} from '../../src/core/encoding/address';

describe('base64url', () => {
  it('matches RFC 4648 vectors (unpadded)', () => {
    const v: [string, string][] = [
      ['', ''],
      ['f', 'Zg'],
      ['fo', 'Zm8'],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg'],
      ['fooba', 'Zm9vYmE'],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [plain, enc] of v) {
      expect(encodeBase64Url(utf8(plain))).toBe(enc);
      expect(fromUtf8(decodeBase64Url(enc) ?? new Uint8Array())).toBe(plain);
    }
  });
  it('uses the url-safe alphabet', () => {
    expect(encodeBase64Url(Uint8Array.of(0xfb, 0xff, 0xfe))).toBe('-__-');
  });
  it('round-trips random bytes of every small length', () => {
    for (let n = 0; n < 40; n++) {
      const b = randomBytes(n);
      expect(bytesEqual(decodeBase64Url(encodeBase64Url(b)) ?? new Uint8Array(1), b)).toBe(true);
    }
  });
  it('rejects bad characters, impossible lengths and non-canonical bits', () => {
    expect(decodeBase64Url('ab+d')).toBeNull();
    expect(decodeBase64Url('ab=')).toBeNull();
    expect(decodeBase64Url('A')).toBeNull();
    expect(decodeBase64Url('Zh')).toBeNull(); // trailing bits not zero
  });
});

describe('crc32', () => {
  it('standard check value', () => expect(crc32(utf8('123456789'))).toBe(0xcbf43926));
  it('empty input', () => expect(crc32(new Uint8Array())).toBe(0));
});

describe('bytes', () => {
  it('helpers', async () => {
    expect(toHex(Uint8Array.of(0, 255, 16))).toBe('00ff10');
    expect(u32be(Uint8Array.of(0xff, 0xff, 0xff, 0xff))).toBe(0xffffffff);
    expect(concatBytes(Uint8Array.of(1), Uint8Array.of(2, 3))).toEqual(Uint8Array.of(1, 2, 3));
    expect(bytesEqual(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(toHex(await sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('addresses', () => {
  it('ipv4', () => {
    expect(formatIPv4(parseIPv4('192.168.1.20') ?? new Uint8Array())).toBe('192.168.1.20');
    for (const bad of ['1.2.3', '256.1.1.1', '01.2.3.4', 'a.b.c.d', '1.2.3.4.5'])
      expect(parseIPv4(bad)).toBeNull();
  });
  it('ipv6 parse + RFC 5952 format', () => {
    const cases: [string, string][] = [
      ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
      ['::1', '::1'],
      ['::', '::'],
      ['fe80::1:0:0:2', 'fe80::1:0:0:2'],
      ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'], // single zero group is not compressed
      ['2001:DB8::ff00:42:8329', '2001:db8::ff00:42:8329'],
      ['::ffff:192.168.0.1', '::ffff:c0a8:1'],
    ];
    for (const [input, out] of cases)
      expect(formatIPv6(parseIPv6(input) ?? new Uint8Array(16))).toBe(out);
    for (const bad of [
      '1::2::3',
      'fe80::1%eth0',
      '12345::1',
      '1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7:8:9',
      'g::1',
      '192.168.0.1',
      '::1.2.3',
      '1:2:3:4:5:6:7::8',
    ]) {
      expect(parseIPv6(bad)).toBeNull();
    }
  });
  it('mdns', () => {
    const host = '2dcfdaed-d6b5-4c98-8d5c-80d597e2a4be.local';
    const b = mdnsToBytes(host.toUpperCase());
    expect(b?.length).toBe(16);
    expect(bytesToMdns(b ?? new Uint8Array(16))).toBe(host);
    expect(mdnsToBytes('example.local')).toBeNull();
  });
  it('classify', () => {
    expect(classifyAddress('10.0.0.1')).toBe('ipv4');
    expect(classifyAddress('::1')).toBe('ipv6');
    expect(classifyAddress('2dcfdaed-d6b5-4c98-8d5c-80d597e2a4be.local')).toBe('mdns');
    expect(classifyAddress('example.com')).toBeNull();
  });
});
