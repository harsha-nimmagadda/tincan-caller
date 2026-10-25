import { describe, expect, it } from 'vitest';
import { parseStats, qualityOf, type StatsReportLike } from '../../src/core/rtc/stats';

type Entry = Record<string, unknown>;
const report = (entries: Entry[]): StatsReportLike => {
  const m = new Map(entries.map((e) => [e['id'] as string, e]));
  return { get: (id) => m.get(id), values: () => m.values() };
};
const cand = (id: string, candidateType: string, address = '10.0.0.1'): Entry => ({
  id,
  type: 'local-candidate',
  candidateType,
  address,
});

/** Chrome/Safari shape: transport → selectedCandidatePairId; `kind` on rtp stats. */
function chrome(opts: {
  t: number;
  lost?: number;
  recv?: number;
  bytesIn?: number;
  bytesOut?: number;
  local?: string;
  remote?: string;
  rtt?: number;
}): StatsReportLike {
  return report([
    { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
    {
      id: 'P',
      type: 'candidate-pair',
      localCandidateId: 'L',
      remoteCandidateId: 'R',
      currentRoundTripTime: opts.rtt ?? 0.05,
    },
    cand('L', opts.local ?? 'host'),
    cand('R', opts.remote ?? 'host', '10.0.0.2'),
    {
      id: 'IV',
      type: 'inbound-rtp',
      kind: 'video',
      bytesReceived: (opts.bytesIn ?? 0) * 0.9,
      packetsLost: opts.lost ?? 0,
      packetsReceived: opts.recv ?? 0,
      frameWidth: 1280,
      frameHeight: 720,
      framesPerSecond: 30,
      codecId: 'C1',
    },
    {
      id: 'IA',
      type: 'inbound-rtp',
      kind: 'audio',
      bytesReceived: (opts.bytesIn ?? 0) * 0.1,
      packetsLost: 0,
      packetsReceived: 0,
    },
    { id: 'IR', type: 'inbound-rtp', kind: 'video', isRemote: true, bytesReceived: 999999 },
    { id: 'OV', type: 'outbound-rtp', kind: 'video', bytesSent: opts.bytesOut ?? 0 },
    { id: 'C1', type: 'codec', mimeType: 'video/VP8' },
  ]);
}

describe('parseStats', () => {
  it('first sample: no rates, but route/rtt/video/codec', () => {
    const { telemetry, snapshot } = parseStats(chrome({ t: 0 }), null, 0);
    expect(telemetry).toMatchObject({
      rttMs: 50,
      route: 'direct-lan',
      ipv6: false,
      kbpsIn: null,
      kbpsOut: null,
      lossPct: null,
      codec: 'video/VP8',
      video: { width: 1280, height: 720, fps: 30 },
    });
    expect(snapshot).toMatchObject({ t: 0, bytesIn: 0, bytesOut: 0 });
  });
  it('bitrates and loss come from deltas, not cumulative totals', () => {
    const first = parseStats(
      chrome({ t: 0, bytesIn: 1_000_000, bytesOut: 500_000, lost: 100, recv: 900 }),
      null,
      0,
    ).snapshot;
    const { telemetry } = parseStats(
      chrome({ t: 2000, bytesIn: 1_500_000, bytesOut: 700_000, lost: 105, recv: 995 }),
      first,
      2000,
    );
    expect(telemetry.kbpsIn).toBeCloseTo(2000); // 500 kB * 8 / 2 s
    expect(telemetry.kbpsOut).toBeCloseTo(800);
    expect(telemetry.lossPct).toBeCloseTo(5); // 5 lost of 100 in this window; cumulative would be ~10%
  });
  it('counter resets and zero intervals give null, no packets gives 0 loss', () => {
    const prev = parseStats(chrome({ t: 0, bytesIn: 5000, lost: 10, recv: 10 }), null, 0).snapshot;
    expect(parseStats(chrome({ t: 1, bytesIn: 100 }), prev, 1000).telemetry).toMatchObject({
      kbpsIn: null,
      lossPct: null,
    });
    expect(
      parseStats(chrome({ t: 1, bytesIn: 6000, lost: 10, recv: 10 }), prev, 0).telemetry.kbpsIn,
    ).toBeNull();
    expect(
      parseStats(chrome({ t: 1, bytesIn: 6000, lost: 10, recv: 10 }), prev, 1000).telemetry.lossPct,
    ).toBe(0);
  });
  it('route classification and ipv6', () => {
    expect(parseStats(chrome({ t: 0, local: 'relay' }), null, 0).telemetry.route).toBe('relay');
    expect(parseStats(chrome({ t: 0, remote: 'relay' }), null, 0).telemetry.route).toBe('relay');
    expect(parseStats(chrome({ t: 0, local: 'srflx' }), null, 0).telemetry.route).toBe(
      'direct-nat',
    );
    const v6 = report([
      { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
      { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      cand('L', 'host', '2001:db8::1'),
      cand('R', 'srflx'),
    ]);
    expect(parseStats(v6, null, 0).telemetry).toMatchObject({
      ipv6: true,
      route: 'direct-nat',
      rttMs: null,
    });
  });
  it('Firefox variant: no transport.selectedCandidatePairId, pair.selected, `ip` field, mediaType', () => {
    const ff = report([
      {
        id: 'P1',
        type: 'candidate-pair',
        state: 'failed',
        localCandidateId: 'X',
        remoteCandidateId: 'X',
      },
      {
        id: 'P2',
        type: 'candidate-pair',
        selected: true,
        localCandidateId: 'L',
        remoteCandidateId: 'R',
        currentRoundTripTime: 0.2,
      },
      { id: 'L', type: 'local-candidate', candidateType: 'srflx', ip: '1.2.3.4' },
      { id: 'R', type: 'remote-candidate', candidateType: 'host', ip: 'fe80::1' },
      { id: 'IA', type: 'inbound-rtp', mediaType: 'audio', bytesReceived: 100, codecId: 'CA' },
      { id: 'CA', type: 'codec', mimeType: 'audio/opus' },
    ]);
    const { telemetry } = parseStats(ff, null, 0);
    expect(telemetry).toMatchObject({
      route: 'direct-nat',
      ipv6: true,
      rttMs: 200,
      codec: 'audio/opus',
      video: null,
    });
  });
  it('falls back to a succeeded+nominated pair, and tolerates an empty report', () => {
    const r = report([
      {
        id: 'P',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'L',
        remoteCandidateId: 'R',
      },
      cand('L', 'host'),
      cand('R', 'host'),
    ]);
    expect(parseStats(r, null, 0).telemetry.route).toBe('direct-lan');
    expect(parseStats(report([]), null, 0).telemetry).toMatchObject({
      route: 'unknown',
      rttMs: null,
      quality: 'unknown',
      codec: null,
    });
  });
  it('ignores garbage entries and non-numeric fields', () => {
    const r: StatsReportLike = {
      get: () => null,
      values: () => [
        null,
        5,
        'x',
        { type: 'inbound-rtp', kind: 'video', bytesReceived: 'lots', frameWidth: NaN },
      ],
    };
    expect(() => parseStats(r, null, 0)).not.toThrow();
    expect(parseStats(r, null, 0).telemetry.video).toBeNull();
  });
});

describe('quality', () => {
  it('thresholds: rtt <150/<400, loss <2/<8; the worse wins', () => {
    expect(qualityOf(149, 1.9)).toBe('good');
    expect(qualityOf(150, 0)).toBe('fair');
    expect(qualityOf(399, 0)).toBe('fair');
    expect(qualityOf(400, 0)).toBe('poor');
    expect(qualityOf(10, 2)).toBe('fair');
    expect(qualityOf(10, 8)).toBe('poor');
    expect(qualityOf(200, 9)).toBe('poor');
  });
  it('uses what is known', () => {
    expect(qualityOf(null, null)).toBe('unknown');
    expect(qualityOf(500, null)).toBe('poor');
    expect(qualityOf(null, 0)).toBe('good');
  });
});
