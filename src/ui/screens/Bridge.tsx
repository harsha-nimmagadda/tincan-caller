import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { CopyIcon } from '../components/Icons';

/** Shown in a tab opened from a reply (`#a=`) link (§8.3). */
export function Bridge() {
  const bridge = useStore((s) => s.bridge);
  const copy = useStore((s) => s.copy);
  const goHome = useStore((s) => s.goHome);
  if (!bridge) return null;
  return (
    <main className="page justify-center" data-testid="bridge" data-status={bridge.status}>
      {bridge.status === 'checking' ? (
        <p role="status" className="muted">
          {t('bridge.checking')}
        </p>
      ) : bridge.status === 'done' ? (
        <p role="status" className="text-xl">
          {t('bridge.done')}
        </p>
      ) : (
        <>
          <p>{t('bridge.manual')}</p>
          <textarea
            readOnly
            data-testid="bridge-code"
            aria-label={t('bridge.manual')}
            className="field h-28 font-mono text-xs"
            value={bridge.token}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="btn btn-primary"
            data-testid="bridge-copy"
            onClick={() => void copy(bridge.token)}
          >
            <CopyIcon /> {t('common.copyCode')}
          </button>
        </>
      )}
      <button type="button" className="btn" onClick={goHome}>
        {t('common.home')}
      </button>
    </main>
  );
}
