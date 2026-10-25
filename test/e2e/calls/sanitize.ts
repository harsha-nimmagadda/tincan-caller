const V4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const V6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi;
const KEEP = new Set(['0.0.0.0', '::']);

/**
 * Replaces every IP address in a captured stats dump with a documentation address
 * (192.0.2.x / 2001:db8::x), consistently, so fixtures never leak the machine's real network.
 */
export function sanitizeAddresses<T>(value: T): T {
  const map = new Map<string, string>();
  const fake = (real: string, v6: boolean) => {
    if (KEEP.has(real)) return real;
    let out = map.get(real);
    if (!out) {
      const n = map.size + 1;
      out = v6 ? `2001:db8::${n.toString(16)}` : `192.0.2.${n}`;
      map.set(real, out);
    }
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string')
      return v.replace(V6, (m) => fake(m, true)).replace(V4, (m) => fake(m, false));
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
