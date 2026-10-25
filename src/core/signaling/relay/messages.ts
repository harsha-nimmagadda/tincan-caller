import { decodeBase64Url, encodeBase64Url } from '../../encoding/base64url';
import { randomBytes, toHex } from '../../encoding/bytes';

/** What two peers say to each other through the relays (always AES-GCM encrypted first). §7.3 */
export type RelayMsg =
  | { v: 1; t: 'hello'; from: string; ts: number }
  | { v: 1; t: 'offer'; from: string; to: string; sid: string; token: string }
  | { v: 1; t: 'answer'; from: string; to: string; sid: string; token: string }
  | { v: 1; t: 'bye'; from: string };

export const ROOM_SECRET_BYTES = 16;
const MAX_TOKEN_CHARS = 1024;
const ID = /^[0-9a-f]{16}$/;
const SID = /^[0-9a-f]{8}$/;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isToken = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_TOKEN_CHARS;

/** Validates one decrypted payload. Anything unexpected → null (dropped). */
export function guardRelayMsg(v: unknown): RelayMsg | null {
  if (!isRec(v) || v['v'] !== 1 || typeof v['from'] !== 'string' || !ID.test(v['from']))
    return null;
  const from = v['from'];
  switch (v['t']) {
    case 'hello':
      return typeof v['ts'] === 'number' && Number.isFinite(v['ts'])
        ? { v: 1, t: 'hello', from, ts: v['ts'] }
        : null;
    case 'bye':
      return { v: 1, t: 'bye', from };
    case 'offer':
    case 'answer': {
      const to = v['to'];
      const sid = v['sid'];
      const token = v['token'];
      if (
        typeof to !== 'string' ||
        !ID.test(to) ||
        typeof sid !== 'string' ||
        !SID.test(sid) ||
        !isToken(token)
      )
        return null;
      return { v: 1, t: v['t'], from, to, sid, token };
    }
    default:
      return null;
  }
}

/** Random per-page-load instance id (16 hex). Roles are decided by comparing two of these. */
export const newInstanceId = (): string => toHex(randomBytes(8));
/** Random per-negotiation session id (8 hex). */
export const newSessionId = (): string => toHex(randomBytes(4));

export const newRoomSecret = (): Uint8Array => randomBytes(ROOM_SECRET_BYTES);
export const encodeRoomSecret = (secret: Uint8Array): string => encodeBase64Url(secret);

/** The `#r=` value: exactly 16 bytes (22 base64url chars), else null. */
export function decodeRoomSecret(text: string): Uint8Array | null {
  const bytes = decodeBase64Url(text);
  return bytes && bytes.length === ROOM_SECRET_BYTES ? bytes : null;
}
