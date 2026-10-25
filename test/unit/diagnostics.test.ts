import { describe, expect, it } from 'vitest';
import { diagnose, type DiagnosticsInput } from '../../src/core/rtc/diagnostics';

const base: DiagnosticsInput = {
  localCandidateTypes: ['host', 'srflx'],
  remoteCandidateTypes: ['host', 'srflx'],
  turnConfigured: false,
  online: true,
};

describe('diagnose', () => {
  const cases: [string, Partial<DiagnosticsInput>, string][] = [
    [
      'offline, nothing but host',
      { localCandidateTypes: ['host'], online: false },
      'offline-no-stun',
    ],
    ['online but STUN blocked', { localCandidateTypes: ['host'] }, 'stun-blocked'],
    ['peer has only host candidates', { remoteCandidateTypes: ['host'] }, 'peer-stun-blocked'],
    ['both srflx, no TURN', {}, 'strict-nat'],
    ['TURN configured but no relay candidate', { turnConfigured: true }, 'turn-failed'],
    [
      'TURN configured, relay gathered, still failed',
      { turnConfigured: true, localCandidateTypes: ['host', 'srflx', 'relay'] },
      'unknown',
    ],
    [
      'relay-only local with peer relay',
      { localCandidateTypes: ['relay'], remoteCandidateTypes: ['relay'], turnConfigured: true },
      'unknown',
    ],
    [
      'offline but already has relay',
      {
        localCandidateTypes: ['relay'],
        online: false,
        remoteCandidateTypes: ['relay'],
        turnConfigured: true,
      },
      'unknown',
    ],
  ];
  it.each(cases)('%s', (_n, over, key) => expect(diagnose({ ...base, ...over })).toBe(key));
});
