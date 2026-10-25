export type Route = 'direct-lan' | 'direct-nat' | 'relay' | 'unknown';
export type Quality = 'good' | 'fair' | 'poor' | 'unknown';

export interface Telemetry {
  rttMs: number | null;
  route: Route;
  ipv6: boolean;
  kbpsIn: number | null;
  kbpsOut: number | null;
  video: { width: number; height: number; fps: number | null } | null;
  lossPct: number | null;
  codec: string | null;
  quality: Quality;
}

/** Cumulative counters from the previous poll; deltas against these give rates. */
export interface StatsSnapshot {
  t: number;
  bytesIn: number;
  bytesOut: number;
  packetsLost: number;
  packetsReceived: number;
}

/** What `RTCStatsReport` offers; a plain `Map` of fixture JSON satisfies it too. */
export interface StatsReportLike {
  get(id: string): unknown;
  values(): Iterable<unknown>;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (typeof v === 'object' && v !== null ? (v as Rec) : null);
const num = (r: Rec | null, k: string): number | null => {
  const v = r?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const str = (r: Rec | null, k: string): string | null => {
  const v = r?.[k];
  return typeof v === 'string' ? v : null;
};

function findSelectedPair(report: StatsReportLike): Rec | null {
  const all = Array.from(report.values(), rec).filter((r): r is Rec => r !== null);
  const transport = all.find(
    (r) => r['type'] === 'transport' && typeof r['selectedCandidatePairId'] === 'string',
  );
  const viaTransport = rec(report.get(str(transport ?? null, 'selectedCandidatePairId') ?? ''));
  if (viaTransport) return viaTransport;
  const pairs = all.filter((r) => r['type'] === 'candidate-pair');
  return (
    pairs.find((p) => p['selected'] === true) ??
    pairs.find((p) => p['state'] === 'succeeded' && p['nominated'] === true) ??
    null
  );
}

function candidateInfo(report: StatsReportLike, id: string | null) {
  const c = rec(report.get(id ?? ''));
  return { type: str(c, 'candidateType'), address: str(c, 'address') ?? str(c, 'ip') ?? '' };
}

function routeOf(local: string | null, remote: string | null): Route {
  if (!local || !remote) return 'unknown';
  if (local === 'relay' || remote === 'relay') return 'relay';
  if (local === 'host' && remote === 'host') return 'direct-lan';
  return 'direct-nat';
}

const RANK: Quality[] = ['good', 'fair', 'poor'];
function grade(value: number | null, fairAt: number, poorAt: number): Quality {
  if (value === null) return 'unknown';
  return value >= poorAt ? 'poor' : value >= fairAt ? 'fair' : 'good';
}
export function qualityOf(rttMs: number | null, lossPct: number | null): Quality {
  const parts = [grade(rttMs, 150, 400), grade(lossPct, 2, 8)].filter((q) => q !== 'unknown');
  if (parts.length === 0) return 'unknown';
  return RANK[Math.max(...parts.map((q) => RANK.indexOf(q)))] ?? 'unknown';
}

const kbps = (now: number, before: number, dtSec: number): number | null => {
  const d = now - before;
  return d < 0 || dtSec <= 0 ? null : (d * 8) / 1000 / dtSec;
};

export function parseStats(
  report: StatsReportLike,
  prev: StatsSnapshot | null,
  nowMs: number,
): { telemetry: Telemetry; snapshot: StatsSnapshot } {
  const all = Array.from(report.values(), rec).filter((r): r is Rec => r !== null);
  const kindOf = (r: Rec) => str(r, 'kind') ?? str(r, 'mediaType');

  const pair = findSelectedPair(report);
  const local = candidateInfo(report, str(pair, 'localCandidateId'));
  const remote = candidateInfo(report, str(pair, 'remoteCandidateId'));
  const rtt = num(pair, 'currentRoundTripTime');

  const inbound = all.filter((r) => r['type'] === 'inbound-rtp' && r['isRemote'] !== true);
  const outbound = all.filter((r) => r['type'] === 'outbound-rtp' && r['isRemote'] !== true);
  const sum = (rs: Rec[], k: string) => rs.reduce((n, r) => n + (num(r, k) ?? 0), 0);

  const snapshot: StatsSnapshot = {
    t: nowMs,
    bytesIn: sum(inbound, 'bytesReceived'),
    bytesOut: sum(outbound, 'bytesSent'),
    packetsLost: Math.max(0, sum(inbound, 'packetsLost')),
    packetsReceived: sum(inbound, 'packetsReceived'),
  };

  let kbpsIn: number | null = null;
  let kbpsOut: number | null = null;
  let lossPct: number | null = null;
  if (prev) {
    const dt = (nowMs - prev.t) / 1000;
    kbpsIn = kbps(snapshot.bytesIn, prev.bytesIn, dt);
    kbpsOut = kbps(snapshot.bytesOut, prev.bytesOut, dt);
    const lost = snapshot.packetsLost - prev.packetsLost;
    const got = snapshot.packetsReceived - prev.packetsReceived;
    if (lost >= 0 && got >= 0) lossPct = lost + got > 0 ? (lost / (lost + got)) * 100 : 0;
  }

  const videoIn = inbound.find((r) => kindOf(r) === 'video') ?? null;
  const width = num(videoIn, 'frameWidth');
  const height = num(videoIn, 'frameHeight');
  const codecId =
    str(videoIn, 'codecId') ?? str(inbound.find((r) => kindOf(r) === 'audio') ?? null, 'codecId');
  const rttMs = rtt === null ? null : rtt * 1000;

  return {
    snapshot,
    telemetry: {
      rttMs,
      route: routeOf(local.type, remote.type),
      ipv6: local.address.includes(':') || remote.address.includes(':'),
      kbpsIn,
      kbpsOut,
      video:
        width !== null && height !== null
          ? { width, height, fps: num(videoIn, 'framesPerSecond') }
          : null,
      lossPct,
      codec: str(rec(report.get(codecId ?? '')), 'mimeType'),
      quality: qualityOf(rttMs, lossPct),
    },
  };
}
