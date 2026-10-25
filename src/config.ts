export const APP_NAME = 'Tincan';
export const PROTOCOL_VERSION = 1; // wire protocol, independent of app semver
export const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
];
// ↑ Verified with `pnpm relay-smoke` (all four passed; damus failed once, transiently). Re-run before releases.
export const GATHER_TIMEOUT_MS = 3000; // 5000 when any TURN server configured
export const CONNECT_TIMEOUT_MS = 20000; // after both descriptions applied
export const DISCONNECT_GRACE_MS = 3000; // 'disconnected' this long → restartIce
export const RESTART_TIMEOUT_MS = 15000; // restart not recovered → failed
export const OFFER_SOFT_EXPIRY_MS = 10 * 60_000; // warn "invite is old, create a new one"
export const STATS_INTERVAL_MS = 1000; // HUD visible; 3000 otherwise (quality dot)
export const MAX_CTL_MESSAGE_BYTES = 65536;
export const MAX_CANDIDATES = 12;
export const RELAY_KIND = 25050;
export const RELAY_HELLO_INTERVAL_MS = 3000;
export const RELAY_RESEND_MS = 4000;
export const RELAY_MAX_EVENT_AGE_S = 60;

/** AGPL §13: users of a network service must be offered the source. Set VITE_SOURCE_URL in forks. */
export const SOURCE_URL: string =
  // `import.meta.env` is absent outside Vite (plain Node scripts, Playwright specs importing core code).
  (import.meta as { env?: ImportMetaEnv }).env?.VITE_SOURCE_URL ??
  'https://github.com/harsha-nimmagadda/tincan-caller';
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const INVITE_AGE_SHOWN_MS = 5 * 60_000;
export const LICENSE_NAME = 'AGPL-3.0';
