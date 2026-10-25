const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

/** base64url without padding (RFC 4648 §5). */
export function encodeBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(n >> 18) & 63] ?? '';
    out += ALPHABET[(n >> 12) & 63] ?? '';
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63] ?? '';
    if (i + 2 < bytes.length) out += ALPHABET[n & 63] ?? '';
  }
  return out;
}

/** Strict decoder: returns null on bad characters, impossible length or non-canonical trailing bits. */
export function decodeBase64Url(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const ch of text) {
    const v = LOOKUP.get(ch);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  if (acc !== 0) return null; // leftover bits must be zero
  return out;
}
