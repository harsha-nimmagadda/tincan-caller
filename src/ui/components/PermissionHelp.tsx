import type { AccessErrorKind } from '../../core/media/media-controller';
import { t, type MessageKey } from '../../i18n';
import { ErrorPanel } from './ErrorPanel';

const TITLE: Record<AccessErrorKind, MessageKey> = {
  'permission-denied': 'perm.denied',
  'device-in-use': 'perm.inUse',
  'no-device': 'perm.noDevice',
  unknown: 'perm.unknown',
};

/** What to do when the browser would not give us the camera/microphone. */
export function PermissionHelp({ kind, onRetry }: { kind: AccessErrorKind; onRetry(): void }) {
  return (
    <div data-testid="permission-help" className="space-y-3">
      <ErrorPanel message={{ key: TITLE[kind] }}>
        <button type="button" className="btn" onClick={onRetry}>
          {t('common.tryAgain')}
        </button>
      </ErrorPanel>
      {kind === 'permission-denied' ? (
        <ul className="muted list-disc space-y-1 pl-5">
          <li>{t('perm.stepChrome')}</li>
          <li>{t('perm.stepSafari')}</li>
          <li>{t('perm.stepFirefox')}</li>
        </ul>
      ) : null}
    </div>
  );
}
