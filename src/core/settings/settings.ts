import { DEFAULT_RELAYS, DEFAULT_STUN } from '../../config';

export const SETTINGS_KEY = 'tincan.settings.v1';

export interface TurnServer {
  urls: string;
  username?: string;
  credential?: string;
  enabled: boolean;
}
export type QualityPreset = 'auto' | 'data-saver' | 'high';

export interface Settings {
  stun: string[];
  turn: TurnServer[];
  forceRelay: boolean;
  relayEnabled: boolean;
  relays: string[];
  quality: QualityPreset;
  startMicOn: boolean;
  startCamOn: boolean;
  preferredDevices: { audioinput?: string; videoinput?: string; audiooutput?: string };
  showStats: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  stun: DEFAULT_STUN,
  turn: [],
  forceRelay: false,
  relayEnabled: false,
  relays: DEFAULT_RELAYS,
  quality: 'auto',
  startMicOn: true,
  startCamOn: true,
  preferredDevices: {},
  showStats: false,
};

/** Minimal Storage so this module needs no DOM types at runtime. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const MAX_LIST = 8;
const MAX_URL = 256;

function urlList(v: unknown, re: RegExp, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  return v
    .filter((x): x is string => typeof x === 'string' && x.length <= MAX_URL && re.test(x))
    .slice(0, MAX_LIST);
}
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const optStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= 512 ? v : undefined;

function parseTurn(v: unknown): TurnServer[] {
  if (!Array.isArray(v)) return [];
  const out: TurnServer[] = [];
  for (const item of v.slice(0, MAX_LIST)) {
    if (!isRec(item) || typeof item['urls'] !== 'string') continue;
    const urls = item['urls'];
    if (urls.length > MAX_URL || !/^turns?:\S+$/.test(urls)) continue;
    const s: TurnServer = { urls, enabled: bool(item['enabled'], true) };
    const username = optStr(item['username']);
    const credential = optStr(item['credential']);
    if (username) s.username = username;
    if (credential) s.credential = credential;
    out.push(s);
  }
  return out;
}

function parseDevices(v: unknown): Settings['preferredDevices'] {
  const out: Settings['preferredDevices'] = {};
  if (!isRec(v)) return out;
  for (const k of ['audioinput', 'videoinput', 'audiooutput'] as const) {
    const id = optStr(v[k]);
    if (id) out[k] = id;
  }
  return out;
}

/** Validates untrusted JSON field by field; anything invalid falls back to its default. */
export function parseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isRec(raw)) return structuredClone(d);
  const q = raw['quality'];
  return {
    stun: urlList(raw['stun'], /^stuns?:\S+$/, [...d.stun]),
    turn: parseTurn(raw['turn']),
    forceRelay: bool(raw['forceRelay'], d.forceRelay),
    relayEnabled: bool(raw['relayEnabled'], d.relayEnabled),
    relays: urlList(raw['relays'], /^wss:\/\/\S+$/, [...d.relays]),
    quality: q === 'auto' || q === 'data-saver' || q === 'high' ? q : d.quality,
    startMicOn: bool(raw['startMicOn'], d.startMicOn),
    startCamOn: bool(raw['startCamOn'], d.startCamOn),
    preferredDevices: parseDevices(raw['preferredDevices']),
    showStats: bool(raw['showStats'], d.showStats),
  };
}

function defaultStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null; // access can throw in sandboxed/private contexts
  }
}

export function loadSettings(storage: StorageLike | null = defaultStorage()): Settings {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return parseSettings(text ? (JSON.parse(text) as unknown) : null);
  } catch {
    return parseSettings(null);
  }
}

export function saveSettings(
  settings: Settings,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
