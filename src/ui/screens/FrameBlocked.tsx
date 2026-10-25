import { t } from '../../i18n';

/**
 * GitHub Pages cannot send `frame-ancestors`, so if the app finds itself inside someone else's page
 * (clickjacking) it renders nothing but a link to open it directly. No camera, no calls.
 */
export function FrameBlocked() {
  return (
    <main className="page justify-center text-center" data-testid="frame-blocked">
      <h1 className="text-xl font-semibold">{t('frame.title')}</h1>
      <a
        className="btn btn-primary"
        data-testid="frame-open"
        href={location.href}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t('frame.open')}
      </a>
    </main>
  );
}
