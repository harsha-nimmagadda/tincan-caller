import type { DiagnosticKey } from './diagnostics';

export type FailReason =
  | 'connect-timeout'
  | 'ice-failed'
  | 'restart-timeout'
  | 'sas-commit-mismatch'
  | 'protocol-mismatch'
  | 'internal';

export type SessionState =
  | { status: 'idle' }
  | { status: 'gathering' }
  | { status: 'awaiting-answer'; offerToken: string; createdAt: number }
  | { status: 'awaiting-connection'; answerToken: string }
  | { status: 'connecting' }
  | { status: 'negotiating-media' }
  | { status: 'connected' }
  | { status: 'reconnecting' }
  | { status: 'ended'; reason: 'local-hangup' | 'remote-hangup' }
  | { status: 'failed'; reason: FailReason; diagnostics?: DiagnosticKey };

export interface MediaState {
  mic: boolean;
  cam: boolean;
}

/** Non-fatal hints for the UI. */
export type SessionWarning = 'invite-old' | 'waiting-for-caller';

export interface SessionEvents {
  state: SessionState;
  remoteStream: MediaStream;
  remoteMediaState: MediaState;
  sas: string;
  warning: SessionWarning;
}

export interface DebugInfo {
  status: SessionState['status'];
  connectionState: RTCPeerConnectionState | 'none';
  ctlState: RTCDataChannelState | 'none';
  activeTimers: number;
  activeListeners: number;
}
