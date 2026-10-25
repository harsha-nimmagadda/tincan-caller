import { useState } from 'react';
import { parseSettings, type QualityPreset, type TurnServer } from '../../core/settings/settings';
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
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  id: string;
  disabled?: boolean;
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
        disabled={disabled}
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
  const [relayText, setRelayText] = useState(settings.relays.join('\n'));
  const [turnTests, setTurnTests] = useState<Record<number, 'testing' | 'ok' | 'fail'>>({});
  const [tests, setTests] = useState<Record<string, 'testing' | 'ok' | 'fail'>>({});
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

  const relayLines = relayText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const relayInvalid = relayLines.length - parseSettings({ relays: relayLines }).relays.length;

  const saveRelays = (text: string) => {
    setRelayText(text);
    const entries = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    update({ relays: parseSettings({ relays: entries }).relays });
  };

  /** Connect to each relay and wait for it to answer a subscription (EOSE) within 5 s. */
  const testRelays = async () => {
    const urls = parseSettings({ relays: relayLines }).relays;
    setTests(Object.fromEntries(urls.map((u) => [u, 'testing' as const])));
    const { testRelay } = await import('../../core/signaling/relay/nostr-transport');
    await Promise.all(
      urls.map(async (u) => {
        const ok = await testRelay(u, 5000);
        setTests((prev) => ({ ...prev, [u]: ok ? 'ok' : 'fail' }));
      }),
    );
  };

  const setTurn = (turn: TurnServer[]) => {
    setTurnTests({});
    // Force relay only means something while a TURN server is enabled.
    update({ turn, ...(turn.some((x) => x.enabled) ? {} : { forceRelay: false }) });
  };
  const patchTurn = (i: number, patch: Partial<TurnServer>) =>
    setTurn(settings.turn.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const hasTurn = settings.turn.some((x) => x.enabled);

  const testTurn = async (i: number) => {
    const server = settings.turn[i];
    if (!server) return;
    setTurnTests((p) => ({ ...p, [i]: 'testing' }));
    const { testTurnServer } = await import('../../core/rtc/ice-test');
    const ok = await testTurnServer(server);
    setTurnTests((p) => ({ ...p, [i]: ok ? 'ok' : 'fail' }));
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

      <section className="card space-y-3" aria-labelledby="turn-h">
        <h2 id="turn-h" className="font-semibold">
          {t('settings.turn')}
        </h2>
        <p className="muted">{t('settings.turnHelp')}</p>
        <p className="text-amber-300" data-testid="turn-warning">
          {t('settings.turnWarning')}
        </p>
        <ul className="space-y-3">
          {settings.turn.map((server, i) => (
            <li
              key={i}
              className="space-y-2 rounded-xl border border-slate-700 p-3"
              data-testid="turn-row"
            >
              <input
                className="field font-mono text-sm"
                data-testid="turn-urls"
                aria-label={t('settings.turnUrls')}
                placeholder="turn:example.com:3478"
                value={server.urls}
                onChange={(e) => patchTurn(i, { urls: e.target.value.trim() })}
              />
              <input
                className="field text-sm"
                data-testid="turn-username"
                aria-label={t('settings.turnUsername')}
                placeholder={t('settings.turnUsername')}
                autoComplete="off"
                value={server.username ?? ''}
                onChange={(e) => patchTurn(i, { username: e.target.value })}
              />
              <input
                className="field text-sm"
                data-testid="turn-credential"
                type="password"
                aria-label={t('settings.turnCredential')}
                placeholder={t('settings.turnCredential')}
                autoComplete="off"
                value={server.credential ?? ''}
                onChange={(e) => patchTurn(i, { credential: e.target.value })}
              />
              <Toggle
                id="turn-enabled"
                label={t('settings.turnEnabled')}
                checked={server.enabled}
                onChange={(v) => patchTurn(i, { enabled: v })}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn"
                  data-testid="turn-test"
                  disabled={!/^turns?:\S+$/.test(server.urls) || turnTests[i] === 'testing'}
                  onClick={() => void testTurn(i)}
                >
                  {t('settings.turnTest')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid="turn-remove"
                  onClick={() => setTurn(settings.turn.filter((_, j) => j !== i))}
                >
                  {t('settings.turnRemove')}
                </button>
                <span
                  data-testid="turn-result"
                  data-state={turnTests[i] ?? 'idle'}
                  aria-live="polite"
                >
                  {turnTests[i] === 'testing'
                    ? t('settings.turnTesting')
                    : turnTests[i] === 'ok'
                      ? t('settings.turnOk')
                      : turnTests[i] === 'fail'
                        ? t('settings.turnFail')
                        : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn"
          data-testid="turn-add"
          disabled={settings.turn.length >= 8}
          onClick={() => setTurn([...settings.turn, { urls: '', enabled: true }])}
        >
          {t('settings.turnAdd')}
        </button>
        <Toggle
          id="force-relay"
          disabled={!hasTurn}
          label={t('settings.forceRelay')}
          checked={settings.forceRelay && hasTurn}
          onChange={(v) => update({ forceRelay: v })}
        />
        {!hasTurn ? <p className="muted">{t('settings.forceRelayNeedsTurn')}</p> : null}
        <p className="muted">{t('settings.forceRelayHelp')}</p>
      </section>

      <section className="card space-y-3" aria-labelledby="relay-h">
        <h2 id="relay-h" className="font-semibold">
          {t('settings.relays')}
        </h2>
        <p className="muted">{t('settings.relaysHelp')}</p>
        <Toggle
          id="relay-enabled"
          label={t('settings.relayEnabled')}
          checked={settings.relayEnabled}
          onChange={(v) => update({ relayEnabled: v })}
        />
        <textarea
          data-testid="relay-list"
          aria-label={t('settings.relayList')}
          className="field h-24 font-mono text-sm"
          value={relayText}
          onChange={(e) => saveRelays(e.target.value)}
        />
        {relayInvalid > 0 ? (
          <p role="alert" className="text-amber-300">
            {t('settings.relayInvalid', { count: relayInvalid })}
          </p>
        ) : null}
        <button
          type="button"
          className="btn"
          data-testid="relay-test"
          disabled={relayLines.length === 0}
          onClick={() => void testRelays()}
        >
          {t('settings.relayTest')}
        </button>
        <ul className="space-y-1" data-testid="relay-test-results" aria-live="polite">
          {Object.entries(tests).map(([url, state]) => (
            <li key={url} data-state={state} data-url={url} className="font-mono text-sm">
              {t(
                state === 'ok'
                  ? 'settings.relayOk'
                  : state === 'fail'
                    ? 'settings.relayFail'
                    : 'settings.relayTesting',
                { url },
              )}
            </li>
          ))}
        </ul>
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
          setRelayText(useStore.getState().settings.relays.join('\n'));
          setTests({});
          setTurnTests({});
        }}
      >
        {t('settings.reset')}
      </button>
    </main>
  );
}
