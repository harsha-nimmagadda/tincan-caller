import { MAX_CTL_MESSAGE_BYTES } from '../../config';

/** Structural copy of RTCIceCandidateInit so this module stays DOM-free. */
export interface IceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type Ctl =
  | { t: 'hello'; proto: number; app: string }
  | { t: 'sdp'; type: 'offer' | 'answer'; sdp: string }
  | { t: 'ice'; c: IceCandidateInit | null }
  | { t: 'sas1'; n: string }
  | { t: 'sas2'; n: string }
  | { t: 'media'; mic: boolean; cam: boolean }
  | { t: 'bye' };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const optStr = (v: unknown) => v === undefined || v === null || typeof v === 'string';

function parseIce(c: unknown): IceCandidateInit | null | undefined {
  if (c === null) return null;
  if (!isRec(c)) return undefined;
  const idx = c['sdpMLineIndex'];
  if (
    !(c['candidate'] === undefined || typeof c['candidate'] === 'string') ||
    !optStr(c['sdpMid']) ||
    !optStr(c['usernameFragment']) ||
    !(idx === undefined || idx === null || (typeof idx === 'number' && Number.isInteger(idx)))
  ) {
    return undefined;
  }
  return c as IceCandidateInit;
}

/** Validates one decoded JSON value. Unknown `t` and invalid shapes → null (dropped). */
export function guardCtl(v: unknown): Ctl | null {
  if (!isRec(v)) return null;
  switch (v['t']) {
    case 'hello':
      return Number.isInteger(v['proto']) && typeof v['app'] === 'string' && v['app'].length <= 64
        ? { t: 'hello', proto: v['proto'] as number, app: v['app'] }
        : null;
    case 'sdp':
      return (v['type'] === 'offer' || v['type'] === 'answer') && typeof v['sdp'] === 'string'
        ? { t: 'sdp', type: v['type'], sdp: v['sdp'] }
        : null;
    case 'ice': {
      const c = parseIce(v['c']);
      return c === undefined ? null : { t: 'ice', c };
    }
    case 'sas1':
    case 'sas2':
      return typeof v['n'] === 'string' && v['n'].length <= 64 ? { t: v['t'], n: v['n'] } : null;
    case 'media':
      return typeof v['mic'] === 'boolean' && typeof v['cam'] === 'boolean'
        ? { t: 'media', mic: v['mic'], cam: v['cam'] }
        : null;
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

/** Parses a raw data-channel payload; oversize, non-string, bad JSON → null. */
export function parseCtl(raw: unknown): Ctl | null {
  if (typeof raw !== 'string' || raw.length > MAX_CTL_MESSAGE_BYTES) return null;
  if (new TextEncoder().encode(raw).length > MAX_CTL_MESSAGE_BYTES) return null;
  try {
    return guardCtl(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function encodeCtl(msg: Ctl): string {
  const text = JSON.stringify(msg);
  if (new TextEncoder().encode(text).length > MAX_CTL_MESSAGE_BYTES) {
    throw new RangeError('control message too large');
  }
  return text;
}
