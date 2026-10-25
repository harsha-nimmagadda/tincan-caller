import { GATHER_TIMEOUT_MS } from '../../config';
import type { Settings, TurnServer } from '../settings/settings';

export const GATHER_TIMEOUT_WITH_TURN_MS = 5000;

export function enabledTurn(s: Settings): TurnServer[] {
  return s.turn.filter((t) => t.enabled);
}

export function hasTurn(s: Settings): boolean {
  return enabledTurn(s).length > 0;
}

export function gatherTimeoutMs(s: Settings): number {
  return hasTurn(s) ? GATHER_TIMEOUT_WITH_TURN_MS : GATHER_TIMEOUT_MS;
}

/** RTCPeerConnection configuration (§6.2). `certificates` is omitted when generation failed. */
export function buildRtcConfiguration(
  s: Settings,
  certificates?: RTCCertificate[],
): RTCConfiguration {
  const iceServers: RTCIceServer[] = [];
  if (s.stun.length > 0) iceServers.push({ urls: s.stun });
  for (const t of enabledTurn(s)) {
    const server: RTCIceServer = { urls: t.urls };
    if (t.username) server.username = t.username;
    if (t.credential) server.credential = t.credential;
    iceServers.push(server);
  }
  const config: RTCConfiguration = {
    iceServers,
    iceTransportPolicy: s.forceRelay && hasTurn(s) ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
  if (certificates && certificates.length > 0) config.certificates = certificates;
  return config;
}
