import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import {
  FlipIcon,
  HangupIcon,
  MicIcon,
  MicOffIcon,
  MoreIcon,
  VideoIcon,
  VideoOffIcon,
} from './Icons';

interface RoundProps {
  label: string;
  testId: string;
  onClick(): void;
  children: ReactNode;
  pressed?: boolean;
  danger?: boolean;
  off?: boolean;
}

function Round({ label, testId, onClick, children, pressed, danger, off }: RoundProps) {
  const tone = danger ? 'btn-danger' : off ? 'bg-slate-100 text-slate-900 hover:bg-white' : '';
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      className={`btn !h-14 !w-14 !rounded-full !p-0 ${tone}`}
    >
      {children}
    </button>
  );
}

export function ControlBar() {
  const local = useStore((s) => s.local);
  const setMic = useStore((s) => s.setMic);
  const setCam = useStore((s) => s.setCam);
  const flip = useStore((s) => s.flipCamera);
  const hangup = useStore((s) => s.hangup);
  const setMore = useStore((s) => s.setMore);
  const moreOpen = useStore((s) => s.moreOpen);

  return (
    <div
      role="toolbar"
      aria-label={t('call.controls')}
      className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pt-10"
      style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
    >
      <Round
        label={t(local.micOn ? 'call.muteMic' : 'call.unmuteMic')}
        testId="btn-mic"
        pressed={!local.micOn}
        off={!local.micOn}
        onClick={() => setMic(!local.micOn)}
      >
        {local.micOn ? <MicIcon /> : <MicOffIcon />}
      </Round>
      <Round
        label={t(local.camOn ? 'call.camOff' : 'call.camOn')}
        testId="btn-cam"
        pressed={!local.camOn}
        off={!local.camOn}
        onClick={() => void setCam(!local.camOn)}
      >
        {local.camOn ? <VideoIcon /> : <VideoOffIcon />}
      </Round>
      {local.canFlip && local.camOn ? (
        <Round label={t('call.flip')} testId="btn-flip" onClick={() => void flip()}>
          <FlipIcon />
        </Round>
      ) : null}
      <Round label={t('call.end')} testId="btn-hangup" danger onClick={hangup}>
        <HangupIcon />
      </Round>
      <Round
        label={t('call.more')}
        testId="btn-more"
        pressed={moreOpen}
        onClick={() => setMore(!moreOpen)}
      >
        <MoreIcon />
      </Round>
    </div>
  );
}
