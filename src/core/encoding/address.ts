export type AddressFamily = 'ipv4' | 'ipv6' | 'mdns';

const MDNS_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.local$/i;

export function parseIPv4(s: string): Uint8Array | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const p = parts[i] ?? '';
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

export function parseIPv6(s: string): Uint8Array | null {
  if (s.includes('%') || !s.includes(':')) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    const items = part.split(':');
    for (let i = 0; i < items.length; i++) {
      const item = items[i] ?? '';
      if (i === items.length - 1 && item.includes('.')) {
        const v4 = parseIPv4(item);
        if (!v4) return null;
        groups.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
      } else if (/^[0-9a-f]{1,4}$/i.test(item)) {
        groups.push(parseInt(item, 16));
      } else return null;
    }
    return groups;
  };
  const head = toGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? toGroups(halves[1] ?? '') : [];
  if (!head || !tail) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  groups.forEach((g, i) => {
    out[i * 2] = g >> 8;
    out[i * 2 + 1] = g & 0xff;
  });
  return out;
}

export function formatIPv4(b: Uint8Array): string {
  return Array.from(b.subarray(0, 4)).join('.');
}

/** RFC 5952 compressed lowercase text form. */
export function formatIPv6(b: Uint8Array): string {
  const g: number[] = [];
  for (let i = 0; i < 8; i++) g.push(((b[i * 2] ?? 0) << 8) | (b[i * 2 + 1] ?? 0));
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = (xs: number[]) => xs.map((x) => x.toString(16)).join(':');
  if (bestLen < 2) return hex(g);
  return `${hex(g.slice(0, bestStart))}::${hex(g.slice(bestStart + bestLen))}`;
}

export function isMdnsHost(s: string): boolean {
  return MDNS_RE.test(s);
}

export function mdnsToBytes(s: string): Uint8Array | null {
  const m = MDNS_RE.exec(s);
  const uuid = m?.[1];
  if (!uuid) return null;
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToMdns(b: Uint8Array): string {
  const h = Array.from(b.subarray(0, 16), (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
}

export function classifyAddress(s: string): AddressFamily | null {
  if (isMdnsHost(s)) return 'mdns';
  if (parseIPv4(s)) return 'ipv4';
  if (parseIPv6(s)) return 'ipv6';
  return null;
}
