import { afterEach, describe, expect, it, vi } from 'vitest';
import { candidateType, testTurnServer } from '../../src/core/rtc/ice-test';

type Listener = (e: { candidate: { candidate: string } | null }) => void;

class FakePc {
  static last: FakePc | null = null;
  static script: (string | null)[] = [];
  closed = false;
  config: RTCConfiguration;
  private listener: Listener | null = null;
  constructor(config: RTCConfiguration) {
    this.config = config;
    FakePc.last = this;
  }
  addEventListener(_t: string, l: Listener) {
    this.listener = l;
  }
  createDataChannel() {}
  createOffer() {
    return Promise.resolve({ type: 'offer' as const, sdp: '' });
  }
  setLocalDescription() {
    for (const c of FakePc.script)
      queueMicrotask(() => this.listener?.({ candidate: c === null ? null : { candidate: c } }));
    return Promise.resolve();
  }
  close() {
    this.closed = true;
  }
}

const cand = (type: string) => `candidate:1 1 udp 1 1.2.3.4 5000 typ ${type} raddr 0.0.0.0 rport 0`;

describe('candidateType', () => {
  it.each([
    [cand('relay'), 'relay'],
    [cand('srflx'), 'srflx'],
    ['candidate:1 1 udp 1 abc.local 5000 typ host', 'host'],
    ['garbage', null],
  ])('%s', (line, type) => expect(candidateType(line)).toBe(type));
});

describe('testTurnServer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const run = (script: (string | null)[], timeout?: number) => {
    FakePc.script = script;
    vi.stubGlobal('RTCPeerConnection', FakePc);
    return testTurnServer({ urls: 'turn:x:3478', username: 'u', credential: 'p' }, timeout);
  };

  it('passes when a relay candidate appears, using only that server and relay policy', async () => {
    expect(await run([cand('host'), cand('relay')])).toBe(true);
    expect(FakePc.last?.config.iceTransportPolicy).toBe('relay');
    expect(FakePc.last?.config.iceServers).toEqual([
      { urls: 'turn:x:3478', username: 'u', credential: 'p' },
    ]);
    expect(FakePc.last?.closed).toBe(true);
  });

  it('fails when gathering ends without a relay candidate', async () => {
    expect(await run([cand('host'), null])).toBe(false);
    expect(FakePc.last?.closed).toBe(true);
  });

  it('fails on timeout when nothing happens', async () => {
    vi.useFakeTimers();
    const p = run([], 5000);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await p).toBe(false);
  });
});
