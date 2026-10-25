import { INVITE_AGE_SHOWN_MS } from '../../config';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { CodeBox } from '../components/CodeBox';
import { CopyIcon, ShareIcon } from '../components/Icons';
import { QrCode } from '../components/QrCode';
import { ReplyBox } from '../components/ReplyBox';
import { useNow } from '../hooks/useNow';

export function CreateCall() {
  const invite = useStore((s) => s.invite);
  const createdAt = useStore((s) => s.inviteCreatedAt);
  const old = useStore((s) => s.inviteOld);
  const status = useStore((s) => s.session.status);
  const goHome = useStore((s) => s.goHome);
  const newInvite = useStore((s) => s.newInvite);
  const copy = useStore((s) => s.copy);
  const share = useStore((s) => s.share);
  const now = useNow(30_000);

  const connecting = status === 'connecting' || status === 'negotiating-media';
  const ageMs = createdAt ? now - createdAt : 0;

  return (
    <main className="page">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('create.title')}</h1>
        <button type="button" className="btn btn-ghost" data-testid="cancel-call" onClick={goHome}>
          {t('common.cancel')}
        </button>
      </header>

      {!invite ? (
        <p className="muted flex items-center gap-2" role="status" data-testid="gathering">
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"
          />
          {t('create.finding')}
        </p>
      ) : (
        <>
          <section className="card space-y-3" aria-labelledby="step1">
            <h2 id="step1" className="font-semibold">
              {t('create.step1')}
            </h2>
            <p className="muted">{t('create.step1Body')}</p>
            <QrCode value={invite.link} testId="invite-qr" />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                data-testid="invite-share"
                onClick={() => void share(invite.link)}
              >
                <ShareIcon /> {t('common.share')}
              </button>
              <button
                type="button"
                className="btn"
                data-testid="invite-copy"
                onClick={() => void copy(invite.link)}
              >
                <CopyIcon /> {t('create.copyLink')}
              </button>
            </div>
            <CodeBox token={invite.token} testId="invite-code" summaryKey="create.showCode" />
            {ageMs >= INVITE_AGE_SHOWN_MS ? (
              <p className="muted" data-testid="invite-age">
                {t('create.age', { minutes: Math.floor(ageMs / 60_000) })}
              </p>
            ) : null}
            {old ? (
              <div
                role="alert"
                className="rounded-xl border border-amber-500/60 bg-amber-950/50 p-3"
                data-testid="invite-old"
              >
                <p>{t('create.old')}</p>
                <button
                  type="button"
                  className="btn mt-2"
                  data-testid="new-invite"
                  onClick={() => void newInvite()}
                >
                  {t('create.newInvite')}
                </button>
              </div>
            ) : null}
          </section>

          <section className="card space-y-3" aria-labelledby="step2">
            <h2 id="step2" className="font-semibold">
              {t('create.step2')}
            </h2>
            <p className="muted">{t('create.step2Body')}</p>
            <ReplyBox />
            {connecting ? (
              <p className="muted flex items-center gap-2" role="status" data-testid="connecting">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"
                />
                {t('call.connecting')}
              </p>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
