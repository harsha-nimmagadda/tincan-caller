export type DiagnosticKey =
  | 'offline-no-stun'
  | 'stun-blocked'
  | 'peer-stun-blocked'
  | 'strict-nat'
  | 'turn-failed'
  | 'unknown';

export interface DiagnosticsInput {
  /** Candidate types gathered locally, e.g. ['host', 'srflx']. */
  localCandidateTypes: readonly string[];
  /** Candidate types found in the peer's token. */
  remoteCandidateTypes: readonly string[];
  turnConfigured: boolean;
  online: boolean;
}

/** Explains a failed connection in one key (§6.10). Order matters: most specific first. */
export function diagnose(i: DiagnosticsInput): DiagnosticKey {
  const localSrflx = i.localCandidateTypes.includes('srflx');
  const localRelay = i.localCandidateTypes.includes('relay');
  const remoteReachable =
    i.remoteCandidateTypes.includes('srflx') || i.remoteCandidateTypes.includes('relay');

  if (!i.online && !localSrflx && !localRelay) return 'offline-no-stun';
  if (i.turnConfigured && !localRelay) return 'turn-failed';
  if (!localSrflx && !localRelay) return 'stun-blocked';
  if (!remoteReachable) return 'peer-stun-blocked';
  if (!i.turnConfigured && localSrflx) return 'strict-nat';
  return 'unknown';
}
