import { describe, expect, it } from 'vitest';
import { DEFAULT_RELAYS, DEFAULT_STUN } from '../../src/config';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettings,
  saveSettings,
  SETTINGS_KEY,
  type StorageLike,
} from '../../src/core/settings/settings';

const memory = (init?: string): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>(init ? [[SETTINGS_KEY, init]] : []);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('settings', () => {
  it('defaults', () => {
    expect(DEFAULT_SETTINGS.stun).toEqual(DEFAULT_STUN);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({}).relays).toEqual(DEFAULT_RELAYS);
  });
  it('defaults are not shared mutable state', () => {
    parseSettings(null).stun.push('stun:evil');
    expect(DEFAULT_SETTINGS.stun).toEqual(DEFAULT_STUN);
  });
  it('accepts a valid object', () => {
    const s = {
      stun: ['stun:a.example:3478'],
      turn: [{ urls: 'turn:t.example:3478', username: 'u', credential: 'p', enabled: true }],
      forceRelay: true,
      relayEnabled: true,
      relays: ['wss://r.example'],
      quality: 'high',
      startMicOn: false,
      startCamOn: false,
      preferredDevices: { audioinput: 'abc' },
      showStats: true,
    };
    expect(parseSettings(s)).toEqual(s);
  });
  it('validates per field, falling back to defaults', () => {
    const s = parseSettings({
      stun: ['http://nope', 'stun:ok.example', 5],
      turn: [{ urls: 'stun:x' }, 'x', { urls: 'turns:t.example', enabled: 'yes', username: '' }],
      relays: ['ws://insecure', 'wss://ok.example'],
      quality: 'ultra',
      forceRelay: 'yes',
      startMicOn: 0,
      preferredDevices: { audioinput: 5, videoinput: 'cam1', other: 'x' },
      showStats: 'x',
    });
    expect(s.stun).toEqual(['stun:ok.example']);
    expect(s.turn).toEqual([{ urls: 'turns:t.example', enabled: true }]);
    expect(s.relays).toEqual(['wss://ok.example']);
    expect(
      parseSettings({
        relays: [
          'ws://localhost:7777',
          'ws://127.0.0.1',
          'ws://evil.example',
          'ws://localhost.evil.com',
        ],
      }).relays,
    ).toEqual(['ws://localhost:7777', 'ws://127.0.0.1']);
    expect(s.quality).toBe('auto');
    expect(s.forceRelay).toBe(false);
    expect(s.startMicOn).toBe(true);
    expect(s.preferredDevices).toEqual({ videoinput: 'cam1' });
    expect(s.showStats).toBe(false);
  });
  it('non-array lists fall back; list length is capped', () => {
    expect(parseSettings({ stun: 'x', turn: 'x' }).stun).toEqual(DEFAULT_STUN);
    expect(
      parseSettings({ stun: Array.from({ length: 20 }, (_, i) => `stun:h${i}`) }).stun,
    ).toHaveLength(8);
    expect(parseSettings({ stun: ['stun:' + 'x'.repeat(300)] }).stun).toEqual([]);
  });
  it('load/save roundtrip and resilience', () => {
    const st = memory();
    expect(saveSettings({ ...DEFAULT_SETTINGS, quality: 'high' }, st)).toBe(true);
    expect(loadSettings(st).quality).toBe('high');
    expect(loadSettings(memory('{broken'))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, throwing)).toBe(false);
    expect(saveSettings(DEFAULT_SETTINGS, null)).toBe(false);
  });
  it('default storage lookup does not throw when localStorage is absent', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });
});
