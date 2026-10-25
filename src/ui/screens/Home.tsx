import { useState } from 'react';
import { APP_NAME } from '../../config';
import { extractToken } from '../../core/signaling/link';
import { readText } from '../../core/platform/clipboard';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { ErrorPanel } from '../components/ErrorPanel';
import { GearIcon, InfoIcon, ScanIcon } from '../components/Icons';
import { QrScannerDialog } from '../components/QrScannerDialog';
import { useSettle } from '../hooks/useSettle';

export function Home() {
  const startCall = useStore((s) => s.startCall);
  const submit = useStore((s) => s.submitJoinCode);
  const joinError = useStore((s) => s.joinError);
  const clearError = useStore((s) => s.clearJoinError);
  const go = useStore((s) => s.go);
  const [joining, setJoining] = useState(false);
  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  const { schedule, cancel } = useSettle(400);

  const change = (value: string) => {
    setText(value);
    clearError();
    cancel();
    if (value.trim()) schedule(() => void submit(value));
  };

  return (
    <div className="page">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{APP_NAME}</h1>
        <nav className="flex gap-1" aria-label={t('home.navAria')}>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={t('home.settings')}
            title={t('home.settings')}
            data-testid="open-settings"
            onClick={() => go('settings')}
          >
            <GearIcon />
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={t('home.about')}
            title={t('home.about')}
            data-testid="open-about"
            onClick={() => go('about')}
          >
            <InfoIcon />
          </button>
        </nav>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-6">
        <div className="space-y-2 text-center">
          <h2 className="text-3xl font-semibold">{t('home.headline')}</h2>
          <p className="muted">{t('home.sub')}</p>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            className="btn btn-primary w-full !py-4 text-lg"
            data-testid="start-call"
            onClick={startCall}
          >
            {t('home.start')}
          </button>
          <button
            type="button"
            className="btn w-full"
            data-testid="join-toggle"
            aria-expanded={joining}
            onClick={() => setJoining(!joining)}
          >
            {t('home.join')}
          </button>
        </div>

        {joining ? (
          <section className="card space-y-3" aria-label={t('home.join')}>
            <textarea
              data-testid="join-input"
              aria-label={t('home.joinLabel')}
              placeholder={t('home.joinPlaceholder')}
              className="field h-24 font-mono text-xs"
              value={text}
              onChange={(e) => change(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                data-testid="join-scan"
                onClick={() => setScanning(true)}
              >
                <ScanIcon /> {t('home.scan')}
              </button>
              <button
                type="button"
                className="btn"
                data-testid="join-paste"
                onClick={() => void readText().then((v) => v && change(v))}
              >
                {t('common.paste')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="join-submit"
                disabled={!extractToken(text)}
                onClick={() => void submit(text)}
              >
                {t('home.joinGo')}
              </button>
            </div>
          </section>
        ) : null}

        {joinError ? <ErrorPanel message={joinError} /> : null}
        {scanning ? (
          <QrScannerDialog
            onClose={() => setScanning(false)}
            onResult={(value) => {
              setScanning(false);
              setJoining(true);
              change(value);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
