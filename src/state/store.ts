import { create } from 'zustand';
import { createCallSlice } from './call-slice';
import { createMediaSlice } from './media-slice';
import { createSettingsSlice } from './settings-slice';
import type { AppState } from './types';
import { createUiSlice } from './ui-slice';

export const useStore = create<AppState>()((set, get) => ({
  ...createUiSlice(set, get),
  ...createSettingsSlice(set, get),
  ...createMediaSlice(set, get),
  ...createCallSlice(set, get),
}));
