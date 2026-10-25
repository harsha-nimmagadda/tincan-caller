import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { CodeBox } from '../components/CodeBox';
import { ErrorPanel } from '../components/ErrorPanel';
import { CopyIcon, ShareIcon } from '../components/Icons';
import { QrCode } from '../components/QrCode';

export function JoinCall() {
  const reply = useStore((s) => s.reply);
  const error = useStore((s) => s.callError);
  const hint = useStore((s) => s.waitingHint);
  const status = useStore((s) => s.session.status);
  const goHome = useStore((s) => s.goHome);
  const copy = useStore((s) => s.copy);
  const share = useStore((s) => s.share);

  return (
    <main className="page">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('join.title')}</h1>
        <button type="button" className="btn btn-ghost" data-testid="cancel-call" onClick={goHome}>
          {t('common.cancel')}
        </button>
      </header>

      {error ? (
        <ErrorPanel message={error}>
          <button type="button" className="btn" onClick={goHome}>
            {t('common.home')}
          </button>
        </ErrorPanel>
      ) : !reply ? (
        <p className="muted flex items-center gap-2" role="status" data-testid="gathering">
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"
          />
          {t('create.finding')}
        </p>
      ) : (
        <section className="card space-y-3" aria-labelledby="reply-h">
          <h2 id="reply-h" className="font-semibold">
            {t('join.sendBack')}
          </h2>
          <p className="muted">{t('join.sendBackBody')}</p>
          <QrCode value={reply.link} testId="reply-qr" />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              data-testid="reply-share"
              onClick={() => void share(reply.link)}
            >
              <ShareIcon /> {t('common.share')}
            </button>
            <button
              type="button"
              className="btn"
              data-testid="reply-copy"
              onClick={() => void copy(reply.link)}
            >
              <CopyIcon /> {t('join.copyLink')}
            </button>
          </div>
          <CodeBox token={reply.token} testId="reply-code" summaryKey="join.showCode" />
          <p className="muted flex items-center gap-2" role="status" data-testid="join-waiting">
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"
            />
            {status === 'negotiating-media' || status === 'connecting'
              ? t('call.connecting')
              : t('join.waiting')}
          </p>
          {hint ? (
            <p className="text-amber-300" data-testid="waiting-hint">
              {t('join.hint')}
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}
