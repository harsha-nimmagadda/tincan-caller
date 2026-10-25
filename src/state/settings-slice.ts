import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from '../core/settings/settings';
import type { SettingsSlice, StoreGet, StoreSet } from './types';

export function createSettingsSlice(set: StoreSet, get: StoreGet): SettingsSlice {
  const persist = (settings: Settings) => {
    set({ settings });
    if (!saveSettings(settings)) get().toast('toast.settingsNotSaved');
  };
  return {
    settings: loadSettings(),
    updateSettings: (patch) => persist({ ...get().settings, ...patch }),
    resetSettings: () => persist(structuredClone(DEFAULT_SETTINGS)),
  };
}
