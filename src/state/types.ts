import type { DiagnosticKey } from '../core/rtc/diagnostics';
import type { Facing } from '../core/media/constraints';
import type { DeviceKind, DeviceLists } from '../core/media/devices';
import type { AccessErrorKind, MediaNotice } from '../core/media/media-controller';
import type { FailReason, MediaState, SessionState } from '../core/rtc/session-types';
import type { Telemetry } from '../core/rtc/stats';
import type { Settings } from '../core/settings/settings';
import type { RelayStatus } from '../core/signaling/relay/relay-controller';
import type { MessageKey } from '../i18n';

export type Screen =
  'home' | 'lobby' | 'create' | 'join' | 'in-call' | 'ended' | 'settings' | 'about' | 'bridge';
export type Role = 'caller' | 'callee';
export type Mode = 'manual' | 'relay';

export interface RelayView {
  status: RelayStatus;
  /** The shareable `#r=` link. */
  link: string;
  /** The person who made the link (sees "Share this link"). */
  creator: boolean;
}

export interface ToastItem {
  id: number;
  key: MessageKey;
  params?: Record<string, string | number>;
}

export interface Message {
  key: MessageKey;
  params?: Record<string, string | number>;
}

export type EndInfo =
  | {
      kind: 'ended';
      reason: 'local-hangup' | 'remote-hangup' | 'codes-mismatch';
      durationMs: number;
    }
  | { kind: 'failed'; reason: FailReason; diagnostics?: DiagnosticKey; durationMs: number };

export interface LocalView {
  micOn: boolean;
  camOn: boolean;
  facing: Facing | 'unknown';
  mirror: boolean;
  canFlip: boolean;
  /** What the preview/PiP tile plays. Never null-checked by components for tracks. */
  stream: MediaStream | null;
}

export interface Code {
  token: string;
  link: string;
}

export interface UiSlice {
  screen: Screen;
  toasts: ToastItem[];
  confirm: 'end-call' | null;
  hudOpen: boolean;
  moreOpen: boolean;
  safetyOpen: boolean;
  go(screen: Screen): void;
  toast(key: MessageKey, params?: ToastItem['params']): void;
  dismissToast(id: number): void;
  askConfirm(kind: 'end-call' | null): void;
  setHud(open: boolean): void;
  setMore(open: boolean): void;
  setSafety(open: boolean): void;
  copy(text: string): Promise<void>;
  share(link: string): Promise<void>;
}

export interface SettingsSlice {
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  resetSettings(): void;
}

export interface MediaSlice {
  local: LocalView;
  devices: DeviceLists;
  preferredDevices: Partial<Record<DeviceKind, string>>;
  mediaError: AccessErrorKind | null;
  mediaReady: boolean;
  startMedia(): Promise<void>;
  stopMedia(): void;
  setMic(on: boolean): void;
  setCam(on: boolean): Promise<void>;
  flipCamera(): Promise<void>;
  setDevice(kind: DeviceKind, deviceId: string): Promise<void>;
  /** Scanning on phones needs the camera to itself; returns what to pass to `endScan`. */
  beginScan(): Promise<boolean>;
  endScan(resumeCam: boolean): Promise<void>;
}

export interface CallSlice {
  role: Role | null;
  pendingOffer: string | null;
  joinError: Message | null;
  session: SessionState;
  invite: Code | null;
  inviteCreatedAt: number | null;
  inviteOld: boolean;
  reply: Code | null;
  waitingHint: boolean;
  replyError: Message | null;
  callError: Message | null;
  sas: string | null;
  sasVerified: boolean;
  remoteStream: MediaStream | null;
  remoteMedia: MediaState;
  telemetry: Telemetry | null;
  callStartedAt: number | null;
  endInfo: EndInfo | null;
  bridge: { token: string; status: 'checking' | 'done' | 'manual' } | null;
  autoplayBlocked: boolean;

  startCall(): void;
  /** Validates pasted/scanned/linked invite text; on success moves to the lobby as callee. */
  submitJoinCode(input: string): boolean;
  clearJoinError(): void;
  continueFromLobby(): Promise<void>;
  newInvite(): Promise<void>;
  submitReply(input: string): Promise<void>;
  clearReplyError(): void;
  hangup(): void;
  confirmCodes(match: boolean): void;
  setAutoplayBlocked(blocked: boolean): void;
  goHome(): void;
  openBridge(token: string): Promise<void>;
}

export interface RelaySlice {
  /** The signaling mode chosen in the lobby / by the link. */
  mode: Mode;
  relay: RelayView | null;
  /** A relay call lost its connection and is looking for the peer again. */
  relayWaiting: boolean;
  /** Asking permission to use relays (never stored silently): from the lobby or from a `#r=` link. */
  relayConsent: 'lobby' | 'link' | null;
  /** The call ended because the peer hung up, and the room could be re-entered. */
  relayCanRejoin: boolean;
  pendingRelaySecret: Uint8Array | null;

  setLobbyMode(mode: Mode): void;
  allowRelay(): void;
  denyRelay(): void;
  openRelayLink(value: string): void;
  startRelayRoom(): Promise<void>;
  resumeRelay(): Promise<void>;
  switchToManual(): Promise<void>;
  rejoinRelay(): void;
}

export type AppState = UiSlice & SettingsSlice & MediaSlice & CallSlice & RelaySlice;
export type StoreSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
export type StoreGet = () => AppState;

export type NoticeToastKey = Record<MediaNotice, MessageKey>;
