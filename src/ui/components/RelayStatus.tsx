import type { RelayPhase } from '../../core/signaling/relay/relay-controller';
import { t, type MessageKey } from '../../i18n';
import { useStore } from '../../state/store';
import { ErrorPanel } from './ErrorPanel';

const PHASE: Record<RelayPhase, MessageKey> = {
  connecting: 'relay.phaseConnecting',
  waiting: 'relay.phaseWaiting',
  'peer-found': 'relay.phasePeer',
  connected: 'relay.phaseConnected',
  left: 'relay.phaseLeft',
};

/** Live status lines for relay mode: relays connected n/N → waiting → peer found → connecting. */
export function RelayStatus() {
  const relay = useStore((s) => s.relay);
  const switchToManual = useStore((s) => s.switchToManual);
  const goHome = useStore((s) => s.goHome);
  if (!relay) return null;
  const { status } = relay;

  return (
    <div className="space-y-3" data-testid="relay-status" data-phase={status.phase}>
      <ul className="muted space-y-1" aria-label={t('relay.statusAria')}>
        <li data-testid="relay-relays">
          {t('relay.relays', { connected: status.relaysConnected, total: status.relaysTotal })}
        </li>
        <li className="flex items-center gap-2" data-testid="relay-phase">
          {status.phase !== 'connected' && !status.unreachable ? (
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"
            />
          ) : null}
          {t(PHASE[status.phase])}
        </li>
      </ul>
      {status.unreachable ? (
        <div data-testid="relay-unreachable">
          <ErrorPanel message={{ key: 'relay.unreachable' }}>
            {relay.creator ? (
              <button
                type="button"
                className="btn"
                data-testid="relay-switch-manual"
                onClick={() => void switchToManual()}
              >
                {t('relay.switchManual')}
              </button>
            ) : (
              <button type="button" className="btn" data-testid="relay-cancel" onClick={goHome}>
                {t('common.home')}
              </button>
            )}
          </ErrorPanel>
        </div>
      ) : null}
    </div>
  );
}
