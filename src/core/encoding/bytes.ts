const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8 = (s: string): Uint8Array => encoder.encode(s);
export const fromUtf8 = (b: Uint8Array): string => decoder.decode(b);

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function u32be(b: Uint8Array, offset = 0): number {
  return (
    (((b[offset] ?? 0) << 24) |
      ((b[offset + 1] ?? 0) << 16) |
      ((b[offset + 2] ?? 0) << 8) |
      (b[offset + 3] ?? 0)) >>>
    0
  );
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource));
}

export function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
