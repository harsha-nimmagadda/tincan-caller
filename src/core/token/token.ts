import {
  bytesToMdns,
  formatIPv4,
  formatIPv6,
  mdnsToBytes,
  parseIPv4,
  parseIPv6,
} from '../encoding/address';
import { decodeBase64Url, encodeBase64Url } from '../encoding/base64url';
import { concatBytes, u32be } from '../encoding/bytes';
import { crc32 } from '../encoding/crc32';
import { MAX_CANDIDATES } from '../../config';
import { TokenCorruptError, TokenFormatError, TokenKindError, TokenVersionError } from './errors';
import type { CandidateType, SetupRole, Token, TokenCandidate, TokenKind } from './types';

export const TOKEN_VERSION = 1;
export const MAX_TOKEN_BYTES = 512;

const SETUPS: SetupRole[] = ['actpass', 'active', 'passive'];
const TYPES: CandidateType[] = ['host', 'srflx', 'relay', 'prflx'];
const FAMILIES: TokenCandidate['family'][] = ['ipv4', 'ipv6', 'mdns'];

// ---------- writer / reader ----------

class Writer {
  private parts: Uint8Array[] = [];
  u8(n: number) {
    this.parts.push(Uint8Array.of(n));
  }
  u16(n: number) {
    this.parts.push(Uint8Array.of(n >> 8, n & 0xff));
  }
  u32(n: number) {
    this.parts.push(Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff));
  }
  raw(b: Uint8Array) {
    this.parts.push(b);
  }
  ascii(s: string, min: number, max: number, what: string, re: RegExp) {
    if (s.length < min || s.length > max || !re.test(s)) {
      throw new TokenFormatError(`invalid ${what}`);
    }
    this.u8(s.length);
    this.raw(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  }
  bytes(): Uint8Array {
    return concatBytes(...this.parts);
  }
}

class Reader {
  pos = 0;
  constructor(
    private readonly b: Uint8Array,
    private readonly end: number,
  ) {}
  take(n: number): Uint8Array {
    if (this.pos + n > this.end) throw new TokenCorruptError('token is truncated');
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u8(): number {
    return this.take(1)[0] ?? 0;
  }
  u16(): number {
    const t = this.take(2);
    return ((t[0] ?? 0) << 8) | (t[1] ?? 0);
  }
  u32(): number {
    return u32be(this.take(4));
  }
  ascii(min: number, max: number, what: string, re: RegExp): string {
    const len = this.u8();
    if (len < min || len > max) throw new TokenFormatError(`invalid ${what} length`);
    const s = String.fromCharCode(...this.take(len));
    if (!re.test(s)) throw new TokenFormatError(`invalid ${what}`);
    return s;
  }
  get done(): boolean {
    return this.pos === this.end;
  }
}

const ICE_CHARS = /^[\x21-\x7e]+$/;
const DIGITS = /^[0-9]+$/;

// ---------- encode ----------

function encodeCandidate(w: Writer, c: TokenCandidate) {
  const type = TYPES.indexOf(c.type);
  const family = FAMILIES.indexOf(c.family);
  if (type < 0 || family < 0) throw new TokenFormatError('invalid candidate type/family');
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) {
    throw new TokenFormatError('invalid candidate port');
  }
  const addr =
    c.family === 'ipv4'
      ? parseIPv4(c.address)
      : c.family === 'ipv6'
        ? parseIPv6(c.address)
        : mdnsToBytes(c.address);
  if (!addr) throw new TokenFormatError('invalid candidate address');
  w.u8(type | (family << 2));
  w.raw(addr);
  w.u16(c.port);
}

export function encodeToken(t: Token): string {
  const w = new Writer();
  const isAnswer = t.kind === 'answer';
  const setup = SETUPS.indexOf(t.setup);
  if (setup < 0) throw new TokenFormatError('invalid setup');
  if (t.fingerprint.length !== 32) throw new TokenFormatError('fingerprint must be 32 bytes');
  if (t.candidates.length > MAX_CANDIDATES) throw new TokenFormatError('too many candidates');
  if (isAnswer && (t.commit?.length !== 16 || t.offerRef?.length !== 4)) {
    throw new TokenFormatError('answer needs a 16-byte commit and a 4-byte offerRef');
  }
  if (!isAnswer && (t.commit || t.offerRef)) {
    throw new TokenFormatError('offer must not carry commit/offerRef');
  }
  if (!Number.isInteger(t.sessVersion) || t.sessVersion < 0 || t.sessVersion > 0xffffffff) {
    throw new TokenFormatError('invalid sess-version');
  }
  const hasMid = t.mid !== '0';

  w.u8((TOKEN_VERSION << 4) | (isAnswer ? 1 : 0));
  w.u8(setup | (hasMid ? 4 : 0) | (isAnswer ? 8 | 16 : 0));
  w.ascii(t.ufrag, 4, 64, 'ice-ufrag', ICE_CHARS);
  w.ascii(t.pwd, 22, 128, 'ice-pwd', ICE_CHARS);
  w.ascii(t.sessId, 1, 20, 'sess-id', DIGITS);
  w.u32(t.sessVersion);
  w.raw(t.fingerprint);
  if (hasMid) w.ascii(t.mid, 1, 16, 'mid', ICE_CHARS);
  if (isAnswer && t.commit && t.offerRef) {
    w.raw(t.commit);
    w.raw(t.offerRef);
  }
  w.u8(t.candidates.length);
  for (const c of t.candidates) encodeCandidate(w, c);

  const body = w.bytes();
  const crc = new Writer();
  crc.u32(crc32(body));
  const all = concatBytes(body, crc.bytes());
  if (all.length > MAX_TOKEN_BYTES) throw new TokenFormatError('token too large');
  return encodeBase64Url(all);
}

// ---------- decode ----------

function decodeCandidate(r: Reader): TokenCandidate {
  const head = r.u8();
  if (head >> 4 !== 0) throw new TokenFormatError('reserved candidate bits set');
  const type = TYPES[head & 3];
  const family = FAMILIES[(head >> 2) & 3];
  if (!type || !family) throw new TokenFormatError('invalid candidate family');
  let address: string;
  if (family === 'ipv4') address = formatIPv4(r.take(4));
  else if (family === 'ipv6') address = formatIPv6(r.take(16));
  else address = bytesToMdns(r.take(16));
  const port = r.u16();
  if (port < 1) throw new TokenFormatError('invalid candidate port');
  return { type, family, address, port };
}

export function decodeToken(text: string, expected?: TokenKind): Token {
  const bytes = decodeBase64Url(text);
  if (!bytes) throw new TokenCorruptError('the code looks cut off or mistyped');
  if (bytes.length > MAX_TOKEN_BYTES) throw new TokenFormatError('token too large');
  if (bytes.length < 8) throw new TokenCorruptError('the code looks cut off or mistyped');
  if ((bytes[0] ?? 0) >> 4 !== TOKEN_VERSION) {
    throw new TokenVersionError('this code was made by a different version of the app');
  }
  const body = bytes.subarray(0, bytes.length - 4);
  if (crc32(body) !== u32be(bytes, bytes.length - 4)) {
    throw new TokenCorruptError('the code looks cut off or mistyped');
  }

  const kind: TokenKind = ((bytes[0] ?? 0) & 15) === 0 ? 'offer' : 'answer';
  if (((bytes[0] ?? 0) & 15) > 1) throw new TokenFormatError('unknown token kind');
  if (expected && kind !== expected) {
    throw new TokenKindError(
      expected === 'offer'
        ? 'this is a reply code, but an invite was expected'
        : 'this is an invite, but a reply code was expected',
    );
  }

  const r = new Reader(bytes, body.length);
  r.u8(); // header
  const flags = r.u8();
  if (flags >> 5 !== 0) throw new TokenFormatError('reserved flag bits set');
  const setup = SETUPS[flags & 3];
  if (!setup) throw new TokenFormatError('invalid setup');
  const hasMid = (flags & 4) !== 0;
  const hasCommit = (flags & 8) !== 0;
  const hasOfferRef = (flags & 16) !== 0;
  if (kind === 'answer' && !(hasCommit && hasOfferRef)) {
    throw new TokenFormatError('answer must carry commit and offerRef');
  }
  if (kind === 'offer' && (hasCommit || hasOfferRef)) {
    throw new TokenFormatError('offer must not carry commit/offerRef');
  }

  const ufrag = r.ascii(4, 64, 'ice-ufrag', ICE_CHARS);
  const pwd = r.ascii(22, 128, 'ice-pwd', ICE_CHARS);
  const sessId = r.ascii(1, 20, 'sess-id', DIGITS);
  const sessVersion = r.u32();
  const fingerprint = Uint8Array.from(r.take(32));
  const mid = hasMid ? r.ascii(1, 16, 'mid', ICE_CHARS) : '0';
  const token: Token = {
    kind,
    setup,
    mid,
    ufrag,
    pwd,
    sessId,
    sessVersion,
    fingerprint,
    candidates: [],
  };
  if (hasCommit) token.commit = Uint8Array.from(r.take(16));
  if (hasOfferRef) token.offerRef = Uint8Array.from(r.take(4));

  const count = r.u8();
  if (count > MAX_CANDIDATES) throw new TokenFormatError('too many candidates');
  for (let i = 0; i < count; i++) token.candidates.push(decodeCandidate(r));
  if (!r.done) throw new TokenFormatError('unexpected trailing bytes');
  return token;
}
