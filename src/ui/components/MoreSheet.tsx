import { pipSupported, enterPip } from '../../core/platform/pip';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { DevicePicker } from './DevicePicker';
import { Dialog } from './Dialog';
import { ChartIcon, PipIcon, ShieldIcon } from './Icons';

/** The "more" panel: devices, picture-in-picture, stats overlay, safety code. */
export function MoreSheet({ remoteVideo }: { remoteVideo: () => HTMLVideoElement | null }) {
  const setMore = useStore((s) => s.setMore);
  const setHud = useStore((s) => s.setHud);
  const hudOpen = useStore((s) => s.hudOpen);
  const setSafety = useStore((s) => s.setSafety);
  const toast = useStore((s) => s.toast);
  const video = remoteVideo();
  const pip = video ? pipSupported(video) : false;

  const startPip = async () => {
    setMore(false);
    if (video && !(await enterPip(video))) toast('toast.pipFailed');
  };

  return (
    <Dialog title={t('call.more')} onClose={() => setMore(false)} testId="more-sheet">
      <DevicePicker />
      <div className="grid gap-2">
        {pip ? (
          <button
            type="button"
            className="btn justify-start"
            data-testid="btn-pip"
            onClick={() => void startPip()}
          >
            <PipIcon /> {t('call.pip')}
          </button>
        ) : null}
        <button
          type="button"
          className="btn justify-start"
          data-testid="btn-hud"
          aria-pressed={hudOpen}
          onClick={() => {
            setHud(!hudOpen);
            setMore(false);
          }}
        >
          <ChartIcon /> {t(hudOpen ? 'call.hideStats' : 'call.showStats')}
        </button>
        <button
          type="button"
          className="btn justify-start"
          data-testid="btn-safety"
          onClick={() => setSafety(true)}
        >
          <ShieldIcon /> {t('call.safetyCode')}
        </button>
      </div>
      <button
        type="button"
        className="btn btn-ghost w-full"
        data-autofocus
        onClick={() => setMore(false)}
      >
        {t('common.close')}
      </button>
    </Dialog>
  );
}
