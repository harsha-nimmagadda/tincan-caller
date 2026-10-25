import { describe, expect, it, vi } from 'vitest';
import { GATHER_TIMEOUT_MS } from '../../src/config';
import { Emitter } from '../../src/core/rtc/emitter';
import { trackGathering, type GatherTarget } from '../../src/core/rtc/gather';
import {
  buildRtcConfiguration,
  enabledTurn,
  gatherTimeoutMs,
  GATHER_TIMEOUT_WITH_TURN_MS,
  hasTurn,
} from '../../src/core/rtc/ice-config';
import { Negotiation } from '../../src/core/rtc/negotiation';
import { TimerBag } from '../../src/core/rtc/timers';
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/settings/settings';
import { candidateAttribute } from '../../src/core/sdp/build';

const settings = (over: Partial<Settings>): Settings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  ...over,
});
const turn = { urls: 'turn:t.example:3478', username: 'u', credential: 'p', enabled: true };

describe('ice-config', () => {
  it('defaults: STUN only, policy all, bundle max-bundle', () => {
    const c = buildRtcConfiguration(DEFAULT_SETTINGS);
    expect(c.iceServers).toEqual([{ urls: DEFAULT_SETTINGS.stun }]);
    expect(c).toMatchObject({
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    expect(c.certificates).toBeUndefined();
    expect(gatherTimeoutMs(DEFAULT_SETTINGS)).toBe(GATHER_TIMEOUT_MS);
  });
  it('empty STUN list gives no iceServers entry (LAN only)', () => {
    expect(buildRtcConfiguration(settings({ stun: [] })).iceServers).toEqual([]);
  });
  it('TURN: only enabled servers, credentials passed, longer gather timeout', () => {
    const s = settings({ turn: [turn, { ...turn, urls: 'turn:off.example', enabled: false }] });
    expect(enabledTurn(s)).toHaveLength(1);
    expect(hasTurn(s)).toBe(true);
    expect(buildRtcConfiguration(s).iceServers).toContainEqual({
      urls: turn.urls,
      username: 'u',
      credential: 'p',
    });
    expect(gatherTimeoutMs(s)).toBe(GATHER_TIMEOUT_WITH_TURN_MS);
  });
  it('forceRelay only takes effect when a TURN server is enabled', () => {
    expect(buildRtcConfiguration(settings({ forceRelay: true })).iceTransportPolicy).toBe('all');
    expect(
      buildRtcConfiguration(settings({ forceRelay: true, turn: [turn] })).iceTransportPolicy,
    ).toBe('relay');
  });
  it('certificates are included when provided', () => {
    const cert = {} as RTCCertificate;
    expect(buildRtcConfiguration(DEFAULT_SETTINGS, [cert]).certificates).toEqual([cert]);
    expect(buildRtcConfiguration(DEFAULT_SETTINGS, []).certificates).toBeUndefined();
  });
});

describe('Emitter', () => {
  it('delivers, unsubscribes, and isolates throwing listeners', () => {
    const e = new Emitter<{ n: number }>();
    const got: number[] = [];
    const off = e.on('n', (v) => got.push(v));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    e.on('n', () => {
      throw new Error('boom');
    });
    e.on('n', (v) => got.push(v * 10));
    e.emit('n', 1);
    off();
    e.emit('n', 2);
    expect(got).toEqual([1, 10, 20]);
  });
});

describe('TimerBag', () => {
  it('counts, fires once, clears individually and all', () => {
    vi.useFakeTimers();
    const t = new TimerBag();
    const fn = vi.fn();
    const a = t.set(fn, 100);
    t.set(fn, 200);
    expect(t.size).toBe(2);
    t.clear(a);
    t.clear(null);
    expect(t.size).toBe(1);
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(t.size).toBe(0);
    t.set(fn, 50);
    t.clearAll();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

class FakePc extends EventTarget implements GatherTarget {
  iceGatheringState: RTCIceGatheringState = 'new';
  complete() {
    this.iceGatheringState = 'complete';
    this.dispatchEvent(new Event('icegatheringstatechange'));
  }
  candidate(text: string) {
    const e = new Event('icecandidate');
    Object.assign(e, { candidate: { candidate: text } });
    this.dispatchEvent(e);
  }
}

describe('trackGathering', () => {
  it('resolves on complete, records candidate types, cleans up', async () => {
    const pc = new FakePc();
    const timers = new TimerBag();
    const g = trackGathering(pc, 3000, timers);
    pc.candidate('candidate:1 1 udp 1 10.0.0.1 5000 typ host');
    pc.candidate('candidate:2 1 udp 1 1.2.3.4 5000 typ srflx raddr 0.0.0.0 rport 0');
    pc.candidate('garbage');
    pc.complete();
    await g.done;
    expect(g.localTypes().sort()).toEqual(['host', 'srflx']);
    expect(timers.size).toBe(0);
  });
  it('resolves immediately if already complete', async () => {
    const pc = new FakePc();
    pc.iceGatheringState = 'complete';
    await trackGathering(pc, 3000, new TimerBag()).done;
  });
  it('resolves on timeout', async () => {
    vi.useFakeTimers();
    const timers = new TimerBag();
    const g = trackGathering(new FakePc(), 3000, timers);
    vi.advanceTimersByTime(3001);
    await g.done;
    expect(timers.size).toBe(0);
    vi.useRealTimers();
  });
});

describe('candidateAttribute', () => {
  it('matches the SDP candidate line format', () => {
    expect(
      candidateAttribute({ type: 'host', family: 'ipv4', address: '10.0.0.1', port: 5 }, 0),
    ).toBe('candidate:1 1 udp 2130706431 10.0.0.1 5 typ host');
    expect(
      candidateAttribute({ type: 'relay', family: 'ipv4', address: '1.1.1.1', port: 9 }, 2),
    ).toContain('typ relay raddr 0.0.0.0 rport 0');
  });
});

// A scripted RTCPeerConnection stand-in: enough to exercise the perfect-negotiation rules.
function fakePc(signalingState: RTCSignalingState = 'stable') {
  const calls: string[] = [];
  const pc = {
    signalingState,
    localDescription: null as { type: string; sdp: string } | null,
    async setLocalDescription() {
      pc.localDescription = {
        type: pc.signalingState === 'have-remote-offer' ? 'answer' : 'offer',
        sdp: 'local-sdp',
      };
      calls.push(`setLocal:${pc.localDescription.type}`);
      pc.signalingState = pc.localDescription.type === 'answer' ? 'stable' : 'have-local-offer';
    },
    async setRemoteDescription(d: { type: string }) {
      calls.push(`setRemote:${d.type}`);
      pc.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
    },
    async addIceCandidate() {
      calls.push('addIce');
    },
  };
  return { pc: pc as unknown as RTCPeerConnection & typeof pc, calls };
}

describe('Negotiation (perfect negotiation)', () => {
  const mk = (polite: boolean, state: RTCSignalingState = 'stable') => {
    const { pc, calls } = fakePc(state);
    const sent: unknown[] = [];
    const settled = vi.fn();
    const before = vi.fn(async () => {
      calls.push('beforeAnswer');
    });
    const n = new Negotiation({
      pc,
      polite,
      send: (m) => sent.push(m),
      beforeAnswer: before,
      onSettled: settled,
    });
    return { n, pc, calls, sent, settled, before };
  };

  it('negotiationneeded sends an offer', async () => {
    const { n, sent } = mk(false);
    await n.onNegotiationNeeded();
    expect(sent).toEqual([{ t: 'sdp', type: 'offer', sdp: 'local-sdp' }]);
  });
  it('remote offer: applies, runs beforeAnswer BEFORE answering, replies, settles', async () => {
    const { n, calls, sent, settled } = mk(true);
    await n.handle({ t: 'sdp', type: 'offer', sdp: 'x' });
    expect(calls).toEqual(['setRemote:offer', 'beforeAnswer', 'setLocal:answer']);
    expect(sent).toEqual([{ t: 'sdp', type: 'answer', sdp: 'local-sdp' }]);
    expect(settled).toHaveBeenCalledOnce();
  });
  it('remote answer is applied and settles', async () => {
    const { n, calls, settled } = mk(false, 'have-local-offer');
    await n.handle({ t: 'sdp', type: 'answer', sdp: 'x' });
    expect(calls).toEqual(['setRemote:answer']);
    expect(settled).toHaveBeenCalledOnce();
  });
  it('glare: the impolite side ignores a colliding offer', async () => {
    const { n, calls, sent } = mk(false, 'have-local-offer');
    await n.handle({ t: 'sdp', type: 'offer', sdp: 'x' });
    expect(calls).toEqual([]);
    expect(sent).toEqual([]);
  });
  it('glare: the polite side accepts a colliding offer', async () => {
    const { n, calls } = mk(true, 'have-local-offer');
    await n.handle({ t: 'sdp', type: 'offer', sdp: 'x' });
    expect(calls).toContain('setRemote:offer');
  });
  it('ice: null is ignored, candidates are added', async () => {
    const { n, calls } = mk(false);
    await n.handle({ t: 'ice', c: null });
    await n.handle({ t: 'ice', c: { candidate: 'c' } });
    expect(calls).toEqual(['addIce']);
  });
  it('ice errors propagate unless we are ignoring the peer offer', async () => {
    const a = mk(false);
    a.pc.addIceCandidate = async () => {
      throw new Error('bad');
    };
    await expect(a.n.handle({ t: 'ice', c: { candidate: 'c' } })).rejects.toThrow('bad');
    const b = mk(false, 'have-local-offer');
    b.pc.addIceCandidate = async () => {
      throw new Error('bad');
    };
    await b.n.handle({ t: 'sdp', type: 'offer', sdp: 'x' }); // collision → ignoreOffer
    await expect(b.n.handle({ t: 'ice', c: { candidate: 'c' } })).resolves.toBeUndefined();
  });
});
