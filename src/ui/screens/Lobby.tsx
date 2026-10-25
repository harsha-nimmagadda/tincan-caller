import { QUALITY_PROFILES } from '../../core/media/constraints';
import type { QualityPreset } from '../../core/settings/settings';
import { t, type MessageKey } from '../../i18n';
import { useStore } from '../../state/store';
import { DevicePicker } from '../components/DevicePicker';
import { BackIcon, MicIcon, MicOffIcon, UserIcon } from '../components/Icons';
import { PermissionHelp } from '../components/PermissionHelp';
import { VideoTile } from '../components/VideoTile';
import { useMicLevel } from '../hooks/useMicLevel';

const QUALITY_LABEL: Record<QualityPreset, MessageKey> = {
  auto: 'quality.auto',
  'data-saver': 'quality.dataSaver',
  high: 'quality.high',
};

export function Lobby() {
  const role = useStore((s) => s.role);
  const local = useStore((s) => s.local);
  const ready = useStore((s) => s.mediaReady);
  const mediaError = useStore((s) => s.mediaError);
  const startMedia = useStore((s) => s.startMedia);
  const setMic = useStore((s) => s.setMic);
  const setCam = useStore((s) => s.setCam);
  const goHome = useStore((s) => s.goHome);
  const proceed = useStore((s) => s.continueFromLobby);
  const quality = useStore((s) => s.settings.quality);
  const update = useStore((s) => s.updateSettings);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setLobbyMode);
  const hasLink = useStore((s) => s.pendingRelaySecret !== null);
  const level = useMicLevel(local.stream, local.micOn);

  return (
    <main className="page">
      <header className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={t('common.back')}
          title={t('common.back')}
          data-testid="lobby-back"
          onClick={goHome}
        >
          <BackIcon />
        </button>
        <h1 className="text-xl font-semibold">
          {t(role === 'callee' ? 'lobby.titleJoin' : 'lobby.titleStart')}
        </h1>
      </header>

      {mediaError ? (
        <PermissionHelp kind={mediaError} onRetry={() => void startMedia()} />
      ) : (
        <>
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
            {local.camOn ? (
              <VideoTile
                stream={local.stream}
                muted
                mirror={local.mirror}
                label={t('lobby.preview')}
                testId="lobby-preview"
                className="h-full w-full"
              />
            ) : (
              <div
                className="flex h-full flex-col items-center justify-center gap-2 text-slate-300"
                data-testid="lobby-no-camera"
              >
                <UserIcon className="h-16 w-16" />
                <span>{ready ? t('lobby.cameraOff') : t('lobby.starting')}</span>
              </div>
            )}
          </div>

          <div className="card space-y-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn"
                data-testid="lobby-mic"
                aria-pressed={!local.micOn}
                aria-label={t(local.micOn ? 'call.muteMic' : 'call.unmuteMic')}
                onClick={() => setMic(!local.micOn)}
              >
                {local.micOn ? <MicIcon /> : <MicOffIcon />}
              </button>
              <div
                role="meter"
                aria-label={t('lobby.micLevel')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(level * 100)}
                className="h-3 flex-1 overflow-hidden rounded-full bg-slate-700"
              >
                <div
                  className="h-full bg-emerald-400 transition-[width] duration-75"
                  style={{ width: `${Math.round(level * 100)}%` }}
                />
              </div>
            </div>

            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span>{t('lobby.audioOnly')}</span>
              <input
                type="checkbox"
                role="switch"
                data-testid="audio-only-switch"
                className="switch"
                checked={!local.camOn}
                disabled={!ready}
                onChange={(e) => void setCam(!e.target.checked)}
              />
            </label>

            <DevicePicker />

            {role === 'caller' ? (
              <fieldset className="space-y-2" data-testid="mode-selector">
                <legend className="mb-1 text-sm text-slate-300">{t('lobby.mode')}</legend>
                {(['manual', 'relay'] as const).map((m) => (
                  <label
                    key={m}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-slate-700 p-3"
                  >
                    <input
                      type="radio"
                      name="mode"
                      className="mt-1 h-5 w-5 accent-sky-500"
                      data-testid={`mode-${m}`}
                      checked={mode === m}
                      onChange={() => setMode(m)}
                    />
                    <span>
                      <span className="block">
                        {t(m === 'manual' ? 'lobby.modeManual' : 'lobby.modeRelay')}
                      </span>
                      <span className="muted block">
                        {t(m === 'manual' ? 'lobby.modeManualHint' : 'lobby.modeRelayHint')}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : mode === 'relay' && hasLink ? (
              <p className="muted" data-testid="mode-relay-link">
                {t('lobby.joiningRelay')}
              </p>
            ) : null}

            <label className="block text-sm">
              <span className="mb-1 block text-slate-300">{t('lobby.quality')}</span>
              <select
                className="field"
                data-testid="sel-quality"
                value={quality}
                onChange={(e) => update({ quality: e.target.value as QualityPreset })}
              >
                {(Object.keys(QUALITY_PROFILES) as QualityPreset[]).map((q) => (
                  <option key={q} value={q}>
                    {t(QUALITY_LABEL[q])}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            className="btn btn-primary w-full !py-4 text-lg"
            data-testid="lobby-continue"
            disabled={!ready}
            onClick={() => void proceed()}
          >
            {t('common.continue')}
          </button>
        </>
      )}
    </main>
  );
}
