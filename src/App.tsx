import { useEffect } from 'react';
import { APP_NAME } from './config';
import { t, type MessageKey } from './i18n';
import { useStore } from './state/store';
import type { SessionState } from './core/rtc/session-types';
import { Dialog } from './ui/components/Dialog';
import { OfflineBadge } from './ui/components/OfflineBadge';
import { RelayConsent } from './ui/components/RelayConsent';
import { ToastHost } from './ui/components/ToastHost';
import { UpdatePrompt } from './ui/components/UpdatePrompt';
import { About } from './ui/screens/About';
import { Bridge } from './ui/screens/Bridge';
import { CallEnded } from './ui/screens/CallEnded';
import { CreateCall } from './ui/screens/CreateCall';
import { Home } from './ui/screens/Home';
import { InCall } from './ui/screens/InCall';
import { JoinCall } from './ui/screens/JoinCall';
import { Lobby } from './ui/screens/Lobby';
import { Settings } from './ui/screens/Settings';

const STATE_TEXT: Record<SessionState['status'], MessageKey> = {
  idle: 'state.idle',
  gathering: 'state.gathering',
  'awaiting-answer': 'state.awaitingAnswer',
  'awaiting-connection': 'state.awaitingConnection',
  connecting: 'state.connecting',
  'negotiating-media': 'state.connecting',
  connected: 'state.connected',
  reconnecting: 'state.reconnecting',
  ended: 'state.ended',
  failed: 'state.failed',
};

/** Screen-reader announcements of connection state changes (and a stable hook for tests). */
function StateAnnouncer() {
  const status = useStore((s) => s.session.status);
  return (
    <div
      role="status"
      aria-live="polite"
      className="sr-only"
      data-testid="call-state"
      data-state={status}
    >
      {t(STATE_TEXT[status])}
    </div>
  );
}

/** Back button during a call asks first; closing the tab asks via the browser's own dialog. */
function useCallGuards(inCall: boolean) {
  useEffect(() => {
    if (!inCall) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onPopState = () => {
      history.pushState({ tincan: 'call' }, '');
      useStore.getState().askConfirm('end-call');
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
    };
  }, [inCall]);
}

export function App() {
  const screen = useStore((s) => s.screen);
  const confirm = useStore((s) => s.confirm);
  const consent = useStore((s) => s.relayConsent);
  const askConfirm = useStore((s) => s.askConfirm);
  const hangup = useStore((s) => s.hangup);
  useCallGuards(screen === 'in-call');

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  return (
    <>
      {screen === 'home' && <Home />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'create' && <CreateCall />}
      {screen === 'join' && <JoinCall />}
      {screen === 'in-call' && <InCall />}
      {screen === 'ended' && <CallEnded />}
      {screen === 'settings' && <Settings />}
      {screen === 'about' && <About />}
      {screen === 'bridge' && <Bridge />}
      <StateAnnouncer />
      {consent ? <RelayConsent /> : null}
      <UpdatePrompt />
      <OfflineBadge />
      <ToastHost />
      {confirm === 'end-call' ? (
        <Dialog
          title={t('confirm.endTitle')}
          body={t('confirm.endBody')}
          onClose={() => askConfirm(null)}
          testId="confirm-end"
        >
          <div className="flex gap-2">
            <button
              type="button"
              className="btn flex-1"
              data-autofocus
              onClick={() => askConfirm(null)}
            >
              {t('confirm.keep')}
            </button>
            <button
              type="button"
              className="btn btn-danger flex-1"
              data-testid="confirm-end-yes"
              onClick={() => {
                askConfirm(null);
                hangup();
              }}
            >
              {t('confirm.end')}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
