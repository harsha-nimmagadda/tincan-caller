import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import type { Screen } from '../../state/types';

/** Screens where a reload would lose work or end a call. */
const BUSY: Screen[] = ['in-call', 'create', 'join'];

/**
 * A new version waits in the background (`registerType: 'prompt'`); it is offered only when no call
 * or handshake is in progress, and only applied when the person taps Reload.
 */
export function UpdatePrompt() {
  const screen = useStore((s) => s.screen);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh || BUSY.includes(screen)) return null;
  return (
    <div
      role="status"
      data-testid="update-prompt"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-sky-800 px-4 py-2 text-sm text-white"
      style={{ paddingTop: 'calc(0.5rem + var(--safe-top))' }}
    >
      <span>{t('update.available')}</span>
      <button
        type="button"
        className="btn !min-h-9 !py-1"
        data-testid="update-reload"
        onClick={() => void updateServiceWorker(true)}
      >
        {t('update.reload')}
      </button>
      <button
        type="button"
        className="btn btn-ghost !min-h-9 !py-1"
        data-testid="update-later"
        onClick={() => setNeedRefresh(false)}
      >
        {t('update.later')}
      </button>
    </div>
  );
}
