import type { TurnServer } from '../settings/settings';

export const TURN_TEST_TIMEOUT_MS = 5000;

/** Pulls the candidate type out of an SDP candidate line (`... typ relay ...`). */
export function candidateType(candidate: string): string | null {
  return /\styp\s(host|srflx|prflx|relay)\b/.exec(candidate)?.[1] ?? null;
}

/**
 * Settings → Test for a TURN server: gather with only that server, forcing relay candidates, and
 * pass when a `relay` candidate appears within `timeoutMs`. Nothing leaves the browser except the
 * allocation request to the server being tested.
 */
export async function testTurnServer(
  server: Pick<TurnServer, 'urls' | 'username' | 'credential'>,
  timeoutMs = TURN_TEST_TIMEOUT_MS,
): Promise<boolean> {
  const ice: RTCIceServer = { urls: server.urls };
  if (server.username) ice.username = server.username;
  if (server.credential) ice.credential = server.credential;
  const pc = new RTCPeerConnection({ iceServers: [ice], iceTransportPolicy: 'relay' });
  try {
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate && candidateType(e.candidate.candidate) === 'relay') finish(true);
        else if (!e.candidate) finish(false); // gathering ended with no relay candidate
      });
      pc.createDataChannel('turn-test');
      pc.createOffer().then(
        (offer) => pc.setLocalDescription(offer).catch(() => finish(false)),
        () => finish(false),
      );
    });
  } finally {
    pc.close();
  }
}
