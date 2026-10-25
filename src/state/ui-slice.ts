import { copyText } from '../core/platform/clipboard';
import { shareLink } from '../core/platform/share';
import { APP_NAME } from '../config';
import { t } from '../i18n';
import type { StoreGet, StoreSet, UiSlice } from './types';

let nextToast = 1;

export function createUiSlice(set: StoreSet, get: StoreGet): UiSlice {
  return {
    screen: 'home',
    toasts: [],
    confirm: null,
    hudOpen: false,
    moreOpen: false,
    safetyOpen: false,
    go: (screen) => set({ screen, moreOpen: false, safetyOpen: false }),
    toast: (key, params) => {
      const id = nextToast++;
      set((s) => ({ toasts: [...s.toasts.slice(-2), { id, key, ...(params ? { params } : {}) }] }));
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
    askConfirm: (confirm) => set({ confirm }),
    setHud: (hudOpen) => set({ hudOpen }),
    setMore: (moreOpen) => set({ moreOpen }),
    setSafety: (safetyOpen) => set({ safetyOpen, moreOpen: false }),
    copy: async (text) => {
      get().toast((await copyText(text)) === 'copied' ? 'toast.copied' : 'toast.copyManual');
    },
    share: async (link) => {
      const r = await shareLink({ title: APP_NAME, text: t('share.text'), url: link });
      if (r === 'copied') get().toast('toast.copied');
      else if (r === 'manual') get().toast('toast.copyManual');
    },
  };
}
