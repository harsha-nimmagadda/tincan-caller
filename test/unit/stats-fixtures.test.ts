import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStats, type StatsReportLike } from '../../src/core/rtc/stats';

interface Fixture {
  engine: string;
  samples: { t: number; entries: { id: string }[] }[];
}
const load = (engine: string): Fixture =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/stats/${engine}.json`, import.meta.url), 'utf8'),
  ) as Fixture;
const asReport = (entries: { id: string }[]): StatsReportLike => {
  const m = new Map(entries.map((e) => [e.id, e]));
  return { get: (id) => m.get(id), values: () => m.values() };
};

// Real getStats() dumps from a live call (caller side, other party is Chromium on the same host).
describe.each(['chromium', 'firefox', 'webkit'])('real %s stats', (engine) => {
  const fx = load(engine);
  const [s0, s1] = fx.samples;
  if (!s0 || !s1) throw new Error('fixture needs two samples');

  it('first sample has route, rtt-or-null and no rates', () => {
    const { telemetry } = parseStats(asReport(s0.entries), null, s0.t);
    expect(telemetry.route).not.toBe('unknown');
    expect(telemetry.kbpsIn).toBeNull();
    expect(telemetry.lossPct).toBeNull();
  });

  it('second sample yields positive bitrates from deltas and sane video info', () => {
    const first = parseStats(asReport(s0.entries), null, s0.t);
    const { telemetry } = parseStats(asReport(s1.entries), first.snapshot, s1.t);
    expect(telemetry.kbpsIn).toBeGreaterThan(0);
    expect(telemetry.kbpsOut).toBeGreaterThan(0);
    expect(telemetry.video?.width).toBeGreaterThan(0);
    expect(telemetry.video?.height).toBeGreaterThan(0);
    expect(telemetry.lossPct).toBeGreaterThanOrEqual(0);
    expect(telemetry.codec).toMatch(/^(video|audio)\//);
    expect(['good', 'fair', 'poor', 'unknown']).toContain(telemetry.quality);
  });

  it('both parties are on the same host, so the route is a direct one', () => {
    const { telemetry } = parseStats(asReport(s1.entries), null, s1.t);
    expect(['direct-lan', 'direct-nat']).toContain(telemetry.route);
  });
});

describe('fixtures are anonymised', () => {
  it.each(['chromium', 'firefox', 'webkit'])('%s has no private LAN addresses', (engine) => {
    const text = readFileSync(new URL(`../fixtures/stats/${engine}.json`, import.meta.url), 'utf8');
    expect(text).not.toMatch(/\b(192\.168|10\.\d+|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+/);
  });
});
