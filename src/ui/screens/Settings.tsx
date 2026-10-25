import { useState } from 'react';
import { parseSettings, type QualityPreset } from '../../core/settings/settings';
import { t, type MessageKey } from '../../i18n';
import { useStore } from '../../state/store';
import { BackIcon } from '../components/Icons';

const QUALITIES: [QualityPreset, MessageKey][] = [
  ['auto', 'quality.auto'],
  ['data-saver', 'quality.dataSaver'],
  ['high', 'quality.high'],
];

function Toggle({
  label,
  checked,
  onChange,
  id,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  id: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        data-testid={id}
        className="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function Settings() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const reset = useStore((s) => s.resetSettings);
  const go = useStore((s) => s.go);
  const [stunText, setStunText] = useState(settings.stun.join('\n'));
  const lines = stunText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const valid = parseSettings({ stun: lines }).stun;
  const invalid = lines.length - valid.length;

  const saveStun = (text: string) => {
    setStunText(text);
    const entries = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // An emptied list is allowed on purpose: LAN-only calls.
    update({ stun: entries.length === 0 ? [] : parseSettings({ stun: entries }).stun });
  };

  return (
    <main className="page">
      <header className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={t('common.back')}
          title={t('common.back')}
          data-testid="settings-back"
          onClick={() => go('home')}
        >
          <BackIcon />
        </button>
        <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
      </header>

      <section className="card space-y-2" aria-labelledby="stun-h">
        <h2 id="stun-h" className="font-semibold">
          {t('settings.stun')}
        </h2>
        <p className="muted">{t('settings.stunHelp')}</p>
        <textarea
          data-testid="stun-input"
          aria-label={t('settings.stun')}
          className="field h-24 font-mono text-sm"
          value={stunText}
          onChange={(e) => saveStun(e.target.value)}
        />
        {invalid > 0 ? (
          <p role="alert" className="text-amber-300">
            {t('settings.stunInvalid', { count: invalid })}
          </p>
        ) : null}
        {lines.length === 0 ? <p className="muted">{t('settings.stunEmpty')}</p> : null}
      </section>

      <section className="card space-y-3" aria-labelledby="call-h">
        <h2 id="call-h" className="font-semibold">
          {t('settings.call')}
        </h2>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-300">{t('lobby.quality')}</span>
          <select
            className="field"
            data-testid="settings-quality"
            value={settings.quality}
            onChange={(e) => update({ quality: e.target.value as QualityPreset })}
          >
            {QUALITIES.map(([q, key]) => (
              <option key={q} value={q}>
                {t(key)}
              </option>
            ))}
          </select>
        </label>
        <Toggle
          id="start-mic"
          label={t('settings.startMic')}
          checked={settings.startMicOn}
          onChange={(v) => update({ startMicOn: v })}
        />
        <Toggle
          id="start-cam"
          label={t('settings.startCam')}
          checked={settings.startCamOn}
          onChange={(v) => update({ startCamOn: v })}
        />
        <Toggle
          id="show-stats"
          label={t('settings.showStats')}
          checked={settings.showStats}
          onChange={(v) => update({ showStats: v })}
        />
      </section>

      <button
        type="button"
        className="btn btn-danger"
        data-testid="reset-settings"
        onClick={() => {
          reset();
          setStunText(useStore.getState().settings.stun.join('\n'));
        }}
      >
        {t('settings.reset')}
      </button>
    </main>
  );
}
