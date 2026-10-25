import type { IceDescription, SetupRole } from '../token/types';
import { selectCandidates, parseCandidateLine } from './candidates';
import { SdpParseError, UnsupportedFingerprintError } from './errors';

interface Sections {
  session: string[];
  media: string[];
}

function splitSections(sdp: string): Sections {
  const session: string[] = [];
  const media: string[] = [];
  let target: string[] | null = session;
  let found = false;
  for (const line of sdp.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('m=')) {
      if (!found && line.startsWith('m=application')) {
        found = true;
        target = media;
      } else {
        target = null;
      }
      continue;
    }
    target?.push(line);
  }
  if (!found) throw new SdpParseError('no m=application section');
  return { session, media };
}

/** Value of `a=<name>:<value>` — media section first, then session level. */
function attr(s: Sections, name: string): string | undefined {
  const prefix = `a=${name}:`;
  for (const list of [s.media, s.session]) {
    const hit = list.find((l) => l.startsWith(prefix));
    if (hit) return hit.slice(prefix.length).trim();
  }
  return undefined;
}

function parseFingerprint(s: Sections): Uint8Array {
  const prefix = 'a=fingerprint:';
  const lines = [...s.media, ...s.session].filter((l) => l.startsWith(prefix));
  for (const l of lines) {
    const [algo, hex] = l.slice(prefix.length).trim().split(/\s+/);
    if (algo?.toLowerCase() !== 'sha-256' || !hex) continue;
    const parts = hex.split(':');
    if (parts.length !== 32 || !parts.every((p) => /^[0-9a-f]{2}$/i.test(p))) {
      throw new SdpParseError('malformed fingerprint');
    }
    return Uint8Array.from(parts, (p) => parseInt(p, 16));
  }
  throw new UnsupportedFingerprintError('no sha-256 DTLS fingerprint');
}

function parseOrigin(s: Sections): { sessId: string; sessVersion: number } {
  const o = s.session.find((l) => l.startsWith('o='));
  const parts = o?.slice(2).split(/\s+/);
  const sessId = parts?.[1];
  const version = parts?.[2];
  if (!sessId || !/^\d{1,20}$/.test(sessId) || !version || !/^\d{1,10}$/.test(version)) {
    throw new SdpParseError('malformed o= line');
  }
  return { sessId, sessVersion: Number(version) };
}

/** Pulls the bootstrap-relevant facts out of `pc.localDescription.sdp` (§6.4). */
export function extractIceDescription(sdp: string): IceDescription {
  const s = splitSections(sdp);
  const ufrag = attr(s, 'ice-ufrag');
  const pwd = attr(s, 'ice-pwd');
  const setup = attr(s, 'setup');
  if (!ufrag || !pwd) throw new SdpParseError('missing ICE credentials');
  if (setup !== 'actpass' && setup !== 'active' && setup !== 'passive') {
    throw new SdpParseError('missing or unsupported a=setup');
  }
  const candidates = s.media
    .filter((l) => l.startsWith('a=candidate:'))
    .map(parseCandidateLine)
    .filter((c) => c !== null);
  return {
    setup: setup as SetupRole,
    mid: attr(s, 'mid') ?? '0',
    ufrag,
    pwd,
    ...parseOrigin(s),
    fingerprint: parseFingerprint(s),
    candidates: selectCandidates(candidates),
  };
}
