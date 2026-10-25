import { MAX_CANDIDATES } from '../../config';
import { classifyAddress, formatIPv6, parseIPv6 } from '../encoding/address';
import type { TokenCandidate } from '../token/types';

/** A candidate line parsed from SDP: `candidate:<f> <comp> <transport> <prio> <addr> <port> typ <type> ...` */
export function parseCandidateLine(line: string): TokenCandidate | null {
  const m = /^(?:a=)?candidate:(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/i.exec(
    line.trim(),
  );
  if (!m) return null;
  const [, , component, transport, , address, portText, typ] = m;
  if (component !== '1' || transport?.toLowerCase() !== 'udp') return null;
  const type = typ?.toLowerCase();
  if (type !== 'host' && type !== 'srflx' && type !== 'relay' && type !== 'prflx') return null;
  if (!address || !portText) return null;
  const family = classifyAddress(address);
  if (!family) return null;
  const port = Number(portText);
  if (port < 1 || port > 65535) return null;
  const normalized =
    family === 'mdns'
      ? address.toLowerCase()
      : family === 'ipv6'
        ? normalizeIPv6(address)
        : address;
  return { type, family, address: normalized, port };
}

function normalizeIPv6(addr: string): string {
  // Re-format through bytes so the text form is always compressed lowercase.
  const bytes = parseIPv6(addr);
  return bytes ? formatIPv6(bytes) : addr;
}

const BUCKETS: { cap: number; match: (c: TokenCandidate) => boolean }[] = [
  { cap: 3, match: (c) => c.type === 'host' && c.family === 'ipv4' },
  { cap: 2, match: (c) => c.type === 'host' && c.family === 'mdns' },
  { cap: 2, match: (c) => c.type === 'srflx' && c.family === 'ipv4' },
  { cap: 2, match: (c) => (c.type === 'host' || c.type === 'srflx') && c.family === 'ipv6' },
  { cap: 3, match: (c) => c.type === 'relay' },
];

/** Dedupe, then pick by the §6.4 order: host v4 (3), host mDNS (2), srflx v4 (2), v6 (2), relay (3). */
export function selectCandidates(all: TokenCandidate[], max = MAX_CANDIDATES): TokenCandidate[] {
  const seen = new Set<string>();
  const unique = all.filter((c) => {
    const key = `${c.type}|${c.address}|${c.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const out: TokenCandidate[] = [];
  for (const { cap, match } of BUCKETS) {
    for (const c of unique.filter(match).slice(0, cap)) {
      if (out.length < max) out.push(c);
    }
  }
  return out;
}
