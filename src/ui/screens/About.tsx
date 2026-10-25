import { APP_NAME, APP_VERSION, LICENSE_NAME, PROTOCOL_VERSION, SOURCE_URL } from '../../config';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { BackIcon } from '../components/Icons';

export function About() {
  const go = useStore((s) => s.go);
  return (
    <main className="page">
      <header className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={t('common.back')}
          title={t('common.back')}
          data-testid="about-back"
          onClick={() => go('home')}
        >
          <BackIcon />
        </button>
        <h1 className="text-xl font-semibold">{t('about.title', { name: APP_NAME })}</h1>
      </header>
      <section className="card space-y-3">
        <p>{t('about.summary')}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-slate-300">{t('about.version')}</dt>
          <dd data-testid="app-version">{APP_VERSION}</dd>
          <dt className="text-slate-300">{t('about.protocol')}</dt>
          <dd>{PROTOCOL_VERSION}</dd>
          <dt className="text-slate-300">{t('about.license')}</dt>
          <dd>{LICENSE_NAME}</dd>
        </dl>
        <p>
          <a
            className="underline"
            data-testid="source-link"
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('about.source')}
          </a>
        </p>
      </section>
      <section className="card space-y-2">
        <h2 className="font-semibold">{t('about.privacyTitle')}</h2>
        <ul className="muted list-disc space-y-1 pl-5">
          <li>{t('about.privacy1')}</li>
          <li>{t('about.privacy2')}</li>
          <li>{t('about.privacy3')}</li>
          <li>{t('about.privacy4')}</li>
        </ul>
      </section>
    </main>
  );
}
