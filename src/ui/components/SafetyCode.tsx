import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { Dialog } from './Dialog';
import { ShieldCheckIcon, ShieldIcon } from './Icons';

/** Top-bar shield: grey "unverified" until the two people compare codes. Never blocks the call. */
export function SafetyBadge() {
  const verified = useStore((s) => s.sasVerified);
  const setSafety = useStore((s) => s.setSafety);
  return (
    <button
      type="button"
      data-testid="sas-badge"
      data-verified={verified}
      aria-label={t(verified ? 'safety.verifiedAria' : 'safety.unverifiedAria')}
      className={`btn btn-ghost !px-2 ${verified ? 'text-emerald-400' : 'text-slate-300'}`}
      onClick={() => setSafety(true)}
    >
      {verified ? <ShieldCheckIcon /> : <ShieldIcon />}
      <span className="text-sm">{t(verified ? 'safety.verified' : 'safety.unverified')}</span>
    </button>
  );
}

export function SafetyDialog() {
  const code = useStore((s) => s.sas);
  const verified = useStore((s) => s.sasVerified);
  const setSafety = useStore((s) => s.setSafety);
  const confirmCodes = useStore((s) => s.confirmCodes);
  return (
    <Dialog
      title={t('safety.title')}
      body={t('safety.body')}
      onClose={() => setSafety(false)}
      testId="safety-dialog"
    >
      <p
        data-testid="sas-code"
        aria-label={code ? t('safety.codeAria', { code }) : t('safety.pending')}
        className="rounded-xl bg-slate-950 py-4 text-center font-mono text-4xl tracking-widest"
      >
        {code ?? t('safety.pending')}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="btn btn-primary flex-1"
          data-testid="sas-match"
          disabled={!code || verified}
          onClick={() => confirmCodes(true)}
        >
          {t('safety.match')}
        </button>
        <button
          type="button"
          className="btn btn-danger flex-1"
          data-testid="sas-mismatch"
          disabled={!code}
          onClick={() => confirmCodes(false)}
        >
          {t('safety.mismatch')}
        </button>
      </div>
      <button
        type="button"
        className="btn btn-ghost w-full"
        data-autofocus
        onClick={() => setSafety(false)}
      >
        {t('common.close')}
      </button>
    </Dialog>
  );
}
