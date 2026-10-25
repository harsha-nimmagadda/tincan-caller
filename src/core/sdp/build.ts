import type { CandidateType, IceDescription } from '../token/types';

const TYPE_PREF: Record<CandidateType, number> = { host: 126, prflx: 110, srflx: 100, relay: 0 };

/** Multiplication, not shifts: `126 << 24` overflows int32 (Rules §8). */
export function candidatePriority(type: CandidateType, index: number): number {
  return TYPE_PREF[type] * 16777216 + (65535 - index) * 256 + 255;
}

function fingerprintText(fp: Uint8Array): string {
  return Array.from(fp, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/** Synthetic remote SDP for the data-channel bootstrap (§6.5, NORMATIVE). */
export function buildRemoteSdp(d: IceDescription): string {
  const lines = [
    'v=0',
    `o=- ${d.sessId} ${d.sessVersion} IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${d.mid}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${d.ufrag}`,
    `a=ice-pwd:${d.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fingerprintText(d.fingerprint)}`,
    `a=setup:${d.setup}`,
    `a=mid:${d.mid}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];
  d.candidates.forEach((c, i) => {
    const related = c.type === 'host' ? '' : ' raddr 0.0.0.0 rport 0';
    lines.push(
      `a=candidate:${i + 1} 1 udp ${candidatePriority(c.type, i)} ${c.address} ${c.port} typ ${c.type}${related}`,
    );
  });
  lines.push('a=end-of-candidates');
  return lines.join('\r\n') + '\r\n';
}
