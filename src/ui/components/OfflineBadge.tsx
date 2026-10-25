import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { useOnline } from '../hooks/useOnline';

/** Reminder that, with no network, calls only work between devices on the same local network. */
export function OfflineBadge() {
  const online = useOnline();
  const screen = useStore((s) => s.screen);
  if (online || screen === 'in-call') return null;
  return (
    <div
      role="status"
      data-testid="offline-badge"
      className="fixed inset-x-0 bottom-0 z-40 bg-amber-300 px-4 py-2 text-center text-sm font-medium text-black"
      style={{ paddingBottom: 'calc(0.5rem + var(--safe-bottom))' }}
    >
      {t('offline.banner')}
    </div>
  );
}
