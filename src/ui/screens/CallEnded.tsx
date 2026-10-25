import { SOURCE_URL } from '../../config';
import type { DiagnosticKey } from '../../core/rtc/diagnostics';
import { t, type MessageKey } from '../../i18n';
import { useStore } from '../../state/store';
import type { EndInfo } from '../../state/types';
import { formatDuration } from '../format';

const ENDED: Record<Extract<EndInfo, { kind: 'ended' }>['reason'], MessageKey> = {
  'local-hangup': 'ended.local',
  'remote-hangup': 'ended.remote',
  'codes-mismatch': 'ended.codesMismatch',
};
const FAILED: Record<Extract<EndInfo, { kind: 'failed' }>['reason'], MessageKey> = {
  'connect-timeout': 'failed.connectTimeout',
  'ice-failed': 'failed.iceFailed',
  'restart-timeout': 'failed.restartTimeout',
  'sas-commit-mismatch': 'failed.sasMismatch',
  'protocol-mismatch': 'failed.protocol',
  internal: 'failed.internal',
};
const DIAG: Record<DiagnosticKey, MessageKey> = {
  'offline-no-stun': 'diag.offline',
  'stun-blocked': 'diag.stunBlocked',
  'peer-stun-blocked': 'diag.peerStunBlocked',
  'strict-nat': 'diag.strictNat',
  'turn-failed': 'diag.turnFailed',
  unknown: 'diag.unknown',
};

export function CallEnded() {
  const info = useStore((s) => s.endInfo);
  const startCall = useStore((s) => s.startCall);
  const goHome = useStore((s) => s.goHome);
  const go = useStore((s) => s.go);
  if (!info) return null;

  const failed = info.kind === 'failed';
  const reasonKey = info.kind === 'ended' ? ENDED[info.reason] : FAILED[info.reason];
  const needsTurn =
    info.kind === 'failed' &&
    (info.diagnostics === 'strict-nat' || info.diagnostics === 'turn-failed');

  return (
    <main className="page justify-center">
      <h1
        className="text-2xl font-semibold"
        data-testid="ended-reason"
        data-reason={info.reason}
        data-kind={info.kind}
      >
        {t(reasonKey)}
      </h1>
      {info.durationMs > 0 ? (
        <p className="muted">
          {t('ended.duration', { duration: formatDuration(info.durationMs) })}
        </p>
      ) : null}

      {info.kind === 'failed' && info.diagnostics ? (
        <div
          role="alert"
          data-testid="diagnostics"
          data-diagnostic={info.diagnostics}
          className="rounded-xl border border-red-500/60 bg-red-950/60 p-3"
        >
          <p>{t(DIAG[info.diagnostics])}</p>
          {needsTurn ? (
            <a
              className="mt-2 inline-block underline"
              href={`${SOURCE_URL}/blob/main/docs/turn.md`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('ended.turnDocs')}
            </a>
          ) : null}
        </div>
      ) : null}

      {info.kind === 'ended' && info.reason === 'codes-mismatch' ? (
        <p role="alert" className="rounded-xl border border-red-500/60 bg-red-950/60 p-3">
          {t('ended.codesMismatchBody')}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="new-call"
          onClick={startCall}
        >
          {t(failed ? 'ended.newInvite' : 'ended.newCall')}
        </button>
        {failed ? (
          <button
            type="button"
            className="btn"
            data-testid="open-settings"
            onClick={() => go('settings')}
          >
            {t('ended.settings')}
          </button>
        ) : null}
        <button type="button" className="btn" data-testid="go-home" onClick={goHome}>
          {t('common.home')}
        </button>
      </div>
    </main>
  );
}
