import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRemoteSdp, candidatePriority } from '../../src/core/sdp/build';
import { parseCandidateLine, selectCandidates } from '../../src/core/sdp/candidates';
import { SdpParseError, UnsupportedFingerprintError } from '../../src/core/sdp/errors';
import { extractIceDescription } from '../../src/core/sdp/extract';
import { decodeToken, encodeToken } from '../../src/core/token/token';
import type { TokenCandidate } from '../../src/core/token/types';
import { offer } from './helpers';

const dir = new URL('../fixtures/sdp/', import.meta.url);
const fixture = (n: string) => readFileSync(new URL(n, dir), 'utf8');
const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');

describe('extract: real chromium offer', () => {
  const x = extractIceDescription(fixture('chromium-offer.sdp'));
  it('exact values', () => {
    expect(x.setup).toBe('actpass');
    expect(x.mid).toBe('0');
    expect(x.ufrag).toHaveLength(4);
    expect(x.pwd).toHaveLength(24);
    expect(x.sessVersion).toBe(2);
    expect(hex(x.fingerprint)).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(x.candidates.length).toBeGreaterThan(0);
    expect(x.candidates.every((c) => c.type === 'host' && c.family === 'mdns')).toBe(true);
  });
  it('matches the raw lines in the file', () => {
    const sdp = fixture('chromium-offer.sdp');
    expect(sdp).toContain(`a=ice-ufrag:${x.ufrag}`);
    expect(sdp).toContain(`a=ice-pwd:${x.pwd}`);
    expect(sdp).toContain(`a=fingerprint:sha-256 ${hex(x.fingerprint)}`);
    expect(sdp).toContain(`o=- ${x.sessId} ${x.sessVersion} IN`);
  });
});

describe('extract: real firefox offer (session-level fingerprint, tcp candidates, uppercase UDP)', () => {
  const x = extractIceDescription(fixture('firefox-offer.sdp'));
  it('exact values', () => {
    expect(fixture('firefox-offer.sdp')).toMatch(/^a=fingerprint/m);
    expect(x.setup).toBe('actpass');
    expect(x.ufrag).toHaveLength(8);
    expect(x.pwd).toHaveLength(32);
    expect(x.sessVersion).toBe(0);
    expect(x.candidates.length).toBeGreaterThan(0);
    expect(x.candidates.length).toBeLessThanOrEqual(2); // tcp lines dropped
  });
});

describe.each(readdirSync(dir).filter((f) => f.endsWith('.sdp')))(
  'fixture round trip: %s',
  (file) => {
    const x = extractIceDescription(fixture(file));
    it('extract → encode → decode → build keeps key attributes', () => {
      const kind = file.includes('answer') ? 'answer' : 'offer';
      const tok = {
        ...x,
        kind,
        ...(kind === 'answer' ? { commit: new Uint8Array(16), offerRef: new Uint8Array(4) } : {}),
      } as const;
      const back = decodeToken(encodeToken(tok));
      expect(back).toEqual(tok);
      const sdp = buildRemoteSdp(back);
      expect(sdp).toContain(`a=ice-ufrag:${x.ufrag}\r\n`);
      expect(sdp).toContain(`a=ice-pwd:${x.pwd}\r\n`);
      expect(sdp).toContain(`a=fingerprint:sha-256 ${hex(x.fingerprint)}\r\n`);
      expect(sdp).toContain(`a=setup:${x.setup}\r\n`);
    });
    it('extract(build(x)) deep-equals x', () => {
      expect(extractIceDescription(buildRemoteSdp(x))).toEqual(x);
    });
  },
);

describe('answers', () => {
  it('chromium and firefox answers to a chromium offer are setup:active', () => {
    for (const f of ['chromium-answer.sdp', 'firefox-answer.sdp']) {
      expect(extractIceDescription(fixture(f)).setup).toBe('active');
    }
  });
});

describe('build', () => {
  it('exact output (NORMATIVE template)', () => {
    const sdp = buildRemoteSdp({ ...offer, mid: '0', candidates: offer.candidates.slice(0, 3) });
    const fpText = hex(offer.fingerprint);
    expect(sdp).toBe(
      [
        'v=0',
        'o=- 154376669258529379 2 IN IP4 127.0.0.1',
        's=-',
        't=0 0',
        'a=group:BUNDLE 0',
        'a=msid-semantic: WMS',
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
        'c=IN IP4 0.0.0.0',
        'a=ice-ufrag:PQpP',
        'a=ice-pwd:VUUi0OhmwFt352QKFBnHdBgf',
        'a=ice-options:trickle',
        `a=fingerprint:sha-256 ${fpText}`,
        'a=setup:actpass',
        'a=mid:0',
        'a=sctp-port:5000',
        'a=max-message-size:262144',
        'a=candidate:1 1 udp 2130706431 192.168.1.20 50000 typ host',
        'a=candidate:2 1 udp 2130706175 2dcfdaed-d6b5-4c98-8d5c-80d597e2a4be.local 39058 typ host',
        'a=candidate:3 1 udp 1694498303 203.0.113.9 61000 typ srflx raddr 0.0.0.0 rport 0',
        'a=end-of-candidates',
        '',
      ].join('\r\n'),
    );
  });
  it('priority math does not overflow int32', () => {
    expect(candidatePriority('host', 0)).toBe(2130706431);
    expect(candidatePriority('host', 0)).toBeGreaterThan(2 ** 31 - 1 - 17_000_000);
    expect(candidatePriority('relay', 0)).toBe(65535 * 256 + 255);
    expect(candidatePriority('prflx', 1)).toBe(110 * 16777216 + 65534 * 256 + 255);
    expect(candidatePriority('srflx', 2)).toBe(100 * 16777216 + 65533 * 256 + 255);
  });
});

describe('extract errors', () => {
  const base = fixture('chromium-offer.sdp');
  it('no application section', () => {
    expect(() => extractIceDescription('v=0\r\nm=audio 9 RTP/AVP 0\r\n')).toThrow(SdpParseError);
  });
  it('ignores other media sections', () => {
    const withAudioFirst = base.replace(
      'm=application',
      'm=audio 9 RTP/AVP 0\r\na=ice-ufrag:ZZZZ\r\nm=application',
    );
    expect(extractIceDescription(withAudioFirst).ufrag).not.toBe('ZZZZ');
  });
  it('missing credentials / setup / o= / fingerprint', () => {
    expect(() => extractIceDescription(base.replace(/a=ice-ufrag.*\r?\n/, ''))).toThrow(
      SdpParseError,
    );
    expect(() => extractIceDescription(base.replace(/a=setup.*\r?\n/, ''))).toThrow(SdpParseError);
    expect(() => extractIceDescription(base.replace(/^o=.*\r?\n/m, ''))).toThrow(SdpParseError);
    expect(() =>
      extractIceDescription(base.replace(/^o=.*$/m, 'o=- abc 2 IN IP4 1.1.1.1')),
    ).toThrow(SdpParseError);
    expect(() => extractIceDescription(base.replace('sha-256', 'sha-1'))).toThrow(
      UnsupportedFingerprintError,
    );
    expect(() =>
      extractIceDescription(base.replace(/(a=fingerprint:sha-256 )(\w\w:)/, '$1ZZ:')),
    ).toThrow(SdpParseError);
    expect(() => extractIceDescription(base.replace(/a=fingerprint.*\r?\n/, ''))).toThrow(
      UnsupportedFingerprintError,
    );
  });
  it('mid defaults to "0"', () => {
    expect(extractIceDescription(base.replace(/a=mid:0\r?\n/, '')).mid).toBe('0');
  });
});

describe('parseCandidateLine', () => {
  it('parses types and normalizes', () => {
    expect(parseCandidateLine('a=candidate:1 1 UDP 2122252543 10.0.0.2 5000 typ host')).toEqual({
      type: 'host',
      family: 'ipv4',
      address: '10.0.0.2',
      port: 5000,
    });
    expect(
      parseCandidateLine(
        'candidate:1 1 udp 1 2001:DB8:0:0:0:0:0:1 5000 typ srflx raddr :: rport 0',
      ),
    ).toEqual({ type: 'srflx', family: 'ipv6', address: '2001:db8::1', port: 5000 });
    expect(
      parseCandidateLine(
        'a=candidate:1 1 udp 1 2DCFDAED-D6B5-4C98-8D5C-80D597E2A4BE.local 5 typ host',
      )?.address,
    ).toBe('2dcfdaed-d6b5-4c98-8d5c-80d597e2a4be.local');
  });
  it('drops tcp, component 2, unknown types, bad addresses, bad ports, junk', () => {
    for (const l of [
      'a=candidate:1 1 tcp 1 10.0.0.2 9 typ host',
      'a=candidate:1 2 udp 1 10.0.0.2 5000 typ host',
      'a=candidate:1 1 udp 1 10.0.0.2 5000 typ weird',
      'a=candidate:1 1 udp 1 example.com 5000 typ host',
      'a=candidate:1 1 udp 1 10.0.0.2 0 typ host',
      'a=candidate:1 1 udp 1 10.0.0.2 70000 typ host',
      'garbage',
      'a=candidate:1 1 udp 1 fe80::1%eth0 5000 typ host',
    ])
      expect(parseCandidateLine(l)).toBeNull();
  });
});

describe('selectCandidates', () => {
  const mk = (
    type: TokenCandidate['type'],
    family: TokenCandidate['family'],
    i: number,
  ): TokenCandidate => ({
    type,
    family,
    port: 1000 + i,
    address:
      family === 'ipv4'
        ? `10.0.0.${i}`
        : family === 'ipv6'
          ? `2001:db8::${i.toString(16)}`
          : `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}.local`,
  });
  const lots = [
    ...Array.from({ length: 5 }, (_, i) => mk('relay', 'ipv4', i)),
    ...Array.from({ length: 5 }, (_, i) => mk('host', 'ipv6', 10 + i)),
    ...Array.from({ length: 5 }, (_, i) => mk('srflx', 'ipv4', 20 + i)),
    ...Array.from({ length: 5 }, (_, i) => mk('host', 'mdns', 30 + i)),
    ...Array.from({ length: 5 }, (_, i) => mk('host', 'ipv4', 40 + i)),
  ];
  it('orders by bucket and caps each bucket', () => {
    const out = selectCandidates(lots);
    expect(out.map((c) => `${c.type}/${c.family}`)).toEqual([
      'host/ipv4',
      'host/ipv4',
      'host/ipv4',
      'host/mdns',
      'host/mdns',
      'srflx/ipv4',
      'srflx/ipv4',
      'host/ipv6',
      'host/ipv6',
      'relay/ipv4',
      'relay/ipv4',
      'relay/ipv4',
    ]);
    expect(out).toHaveLength(12);
  });
  it('global cap and dedupe', () => {
    expect(selectCandidates(lots, 4)).toHaveLength(4);
    const dup = mk('host', 'ipv4', 1);
    expect(selectCandidates([dup, { ...dup }, dup])).toHaveLength(1);
  });
  it('drops prflx', () => {
    expect(selectCandidates([mk('prflx', 'ipv4', 1)])).toEqual([]);
  });
});
