import { useState } from 'react';
import {
  dismissIosHint,
  iosHintDismissed,
  readInstallEnv,
  shouldShowIosInstallHint,
} from '../../core/platform/install';
import { t } from '../../i18n';

/** iOS cannot prompt to install: explain Share → Add to Home Screen, once. */
export function IosInstallHint() {
  const [hidden, setHidden] = useState(
    () => !shouldShowIosInstallHint(readInstallEnv(), iosHintDismissed()),
  );
  if (hidden) return null;
  return (
    <aside
      className="card space-y-2"
      data-testid="ios-install-hint"
      aria-label={t('install.title')}
    >
      <h2 className="font-semibold">{t('install.title')}</h2>
      <p className="muted">{t('install.body')}</p>
      <button
        type="button"
        className="btn"
        data-testid="ios-install-dismiss"
        onClick={() => {
          dismissIosHint();
          setHidden(true);
        }}
      >
        {t('install.dismiss')}
      </button>
    </aside>
  );
}
