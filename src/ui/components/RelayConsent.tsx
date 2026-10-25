import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { Dialog } from './Dialog';

/**
 * Relays are third-party servers. Before using them (when not switched on in Settings) say plainly
 * what they can and cannot see. The answer is never stored: it covers this call only.
 */
export function RelayConsent() {
  const allow = useStore((s) => s.allowRelay);
  const deny = useStore((s) => s.denyRelay);
  return (
    <Dialog title={t('consent.title')} onClose={deny} testId="relay-consent">
      <div className="space-y-3 text-sm">
        <div>
          <h3 className="font-semibold">{t('consent.seesTitle')}</h3>
          <ul className="muted list-disc pl-5">
            <li>{t('consent.sees1')}</li>
            <li>{t('consent.sees2')}</li>
            <li>{t('consent.sees3')}</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">{t('consent.hiddenTitle')}</h3>
          <ul className="muted list-disc pl-5">
            <li>{t('consent.hidden1')}</li>
            <li>{t('consent.hidden2')}</li>
            <li>{t('consent.hidden3')}</li>
          </ul>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn flex-1"
          data-testid="relay-consent-cancel"
          data-autofocus
          onClick={deny}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary flex-1"
          data-testid="relay-consent-allow"
          onClick={allow}
        >
          {t('consent.allow')}
        </button>
      </div>
    </Dialog>
  );
}
