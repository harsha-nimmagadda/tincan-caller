import { describe, expect, it } from 'vitest';
import { MAX_CTL_MESSAGE_BYTES } from '../../src/config';
import { encodeCtl, guardCtl, parseCtl } from '../../src/core/rtc/control';

const roundtrip = (v: unknown) => parseCtl(JSON.stringify(v));

describe('ctl guards', () => {
  it('accepts every valid message', () => {
    const valid = [
      { t: 'hello', proto: 1, app: '0.1.0' },
      { t: 'sdp', type: 'offer', sdp: 'v=0' },
      { t: 'sdp', type: 'answer', sdp: 'v=0' },
      { t: 'ice', c: null },
      {
        t: 'ice',
        c: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      },
      { t: 'ice', c: {} },
      { t: 'sas1', n: 'abc' },
      { t: 'sas2', n: 'abc' },
      { t: 'media', mic: true, cam: false },
      { t: 'bye' },
    ];
    for (const m of valid) expect(roundtrip(m)).toEqual(m);
  });
  it('rejects malformed fields', () => {
    const bad = [
      { t: 'hello', proto: '1', app: 'x' },
      { t: 'hello', proto: 1.5, app: 'x' },
      { t: 'hello', proto: 1, app: 'x'.repeat(65) },
      { t: 'sdp', type: 'rollback', sdp: '' },
      { t: 'sdp', type: 'offer' },
      { t: 'ice' },
      { t: 'ice', c: 'x' },
      { t: 'ice', c: { candidate: 5 } },
      { t: 'ice', c: { sdpMid: 5 } },
      { t: 'ice', c: { sdpMLineIndex: 'a' } },
      { t: 'ice', c: { usernameFragment: 3 } },
      { t: 'sas1', n: 5 },
      { t: 'sas2', n: 'x'.repeat(65) },
      { t: 'media', mic: 1, cam: true },
      { t: 'media', mic: true },
    ];
    for (const m of bad) expect(roundtrip(m)).toBeNull();
  });
  it('ignores unknown types and non-objects (forward compatibility)', () => {
    expect(roundtrip({ t: 'chat', text: 'hi' })).toBeNull();
    for (const v of [null, 5, 'x', [], [{ t: 'bye' }], {}]) expect(guardCtl(v)).toBeNull();
  });
  it('drops oversize, non-string and unparseable payloads', () => {
    expect(parseCtl('{nope')).toBeNull();
    expect(parseCtl(new ArrayBuffer(4))).toBeNull();
    expect(parseCtl(undefined)).toBeNull();
    const big = JSON.stringify({ t: 'sdp', type: 'offer', sdp: 'x'.repeat(MAX_CTL_MESSAGE_BYTES) });
    expect(parseCtl(big)).toBeNull();
    // multi-byte chars: fewer UTF-16 units than bytes
    const multi = JSON.stringify({
      t: 'sdp',
      type: 'offer',
      sdp: '€'.repeat(MAX_CTL_MESSAGE_BYTES / 3 + 10),
    });
    expect(multi.length).toBeLessThan(MAX_CTL_MESSAGE_BYTES);
    expect(parseCtl(multi)).toBeNull();
  });
  it('encodeCtl round-trips and refuses oversize', () => {
    expect(parseCtl(encodeCtl({ t: 'bye' }))).toEqual({ t: 'bye' });
    expect(() =>
      encodeCtl({ t: 'sdp', type: 'offer', sdp: 'x'.repeat(MAX_CTL_MESSAGE_BYTES) }),
    ).toThrow(RangeError);
  });
});
