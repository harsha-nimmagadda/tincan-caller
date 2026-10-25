import { APP_NAME } from './config';
import { t } from './i18n';

export function App() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-4">
      <h1 className="text-3xl font-semibold" data-testid="app-name">
        {APP_NAME}
      </h1>
      <p className="text-slate-400">{t('app.tagline')}</p>
    </main>
  );
}
