import { useEffect, useRef, useState } from 'react';
import { enableAutoPip } from '../../core/platform/pip';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { ControlBar } from '../components/ControlBar';
import { MicOffIcon, UserIcon } from '../components/Icons';
import { MoreSheet } from '../components/MoreSheet';
import { SafetyBadge, SafetyDialog } from '../components/SafetyCode';
import { QualityDot, StatsHud } from '../components/StatsHud';
import { VideoTile } from '../components/VideoTile';
import { useCornerDrag, type Corner } from '../hooks/useCornerDrag';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useNow } from '../hooks/useNow';
import { formatDuration } from '../format';

const CORNER: Record<Corner, string> = {
  tl: 'left-3 top-16',
  tr: 'right-3 top-16',
  bl: 'bottom-28 left-3',
  br: 'bottom-28 right-3',
};

export function InCall() {
  const stage = useRef<HTMLDivElement>(null);
  const remote = useStore((s) => s.remoteStream);
  const remoteMedia = useStore((s) => s.remoteMedia);
  const local = useStore((s) => s.local);
  const status = useStore((s) => s.session.status);
  const started = useStore((s) => s.callStartedAt);
  const hudOpen = useStore((s) => s.hudOpen);
  const moreOpen = useStore((s) => s.moreOpen);
  const safetyOpen = useStore((s) => s.safetyOpen);
  const blocked = useStore((s) => s.autoplayBlocked);
  const setBlocked = useStore((s) => s.setAutoplayBlocked);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const now = useNow(1000);
  const drag = useCornerDrag(stage);

  useKeyboardShortcuts(true);

  const remoteVideo = () =>
    stage.current?.querySelector<HTMLVideoElement>('video[data-testid="remote-video"]') ?? null;

  useEffect(() => {
    const v = remoteVideo();
    return v ? enableAutoPip(v) : undefined;
  }, [remote]);

  const startAudio = () => {
    setBlocked(false);
    remoteVideo()
      ?.play()
      .catch(() => setBlocked(true));
  };

  return (
    <main
      ref={stage}
      className="fixed inset-0 overflow-hidden bg-black"
      style={{ height: '100dvh' }}
      onDoubleClick={() => setFit(fit === 'contain' ? 'cover' : 'contain')}
    >
      <VideoTile
        stream={remote}
        fit={fit}
        label={t('call.remoteVideo')}
        testId="remote-video"
        className="h-full w-full"
        onPlayBlocked={() => setBlocked(true)}
      />

      {!remoteMedia.cam ? (
        <div
          data-testid="remote-cam-off"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900 text-slate-300"
        >
          <UserIcon className="h-24 w-24" />
          <span>{t('call.remoteCamOff')}</span>
        </div>
      ) : null}

      {!remoteMedia.mic ? (
        <div
          data-testid="remote-mic-off"
          role="img"
          aria-label={t('call.remoteMicOff')}
          className="absolute left-3 top-28 z-10 flex items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-sm"
        >
          <MicOffIcon className="h-4 w-4" /> {t('call.remoteMicOff')}
        </div>
      ) : null}

      <div
        className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-6"
        style={{ paddingTop: 'calc(0.75rem + var(--safe-top))' }}
      >
        <QualityDot />
        <span
          data-testid="call-timer"
          className="font-mono text-sm"
          aria-label={t('call.timerAria')}
        >
          {formatDuration(started ? now - started : 0)}
        </span>
        <SafetyBadge />
      </div>

      {status === 'reconnecting' ? (
        <div
          role="status"
          data-testid="reconnecting"
          className="absolute inset-x-0 top-14 z-20 mx-auto w-fit rounded-full bg-amber-500 px-4 py-1 text-sm font-medium text-black"
        >
          {t('call.reconnecting')}
        </div>
      ) : null}

      {hudOpen ? <StatsHud /> : null}

      <div
        {...drag.handlers}
        data-testid="local-tile"
        data-corner={drag.corner}
        className={`absolute z-10 h-40 w-28 touch-none overflow-hidden rounded-xl border border-slate-500 bg-slate-900 shadow-lg motion-safe:transition-all ${CORNER[drag.corner]}`}
        style={
          drag.offset
            ? { transform: `translate(${drag.offset.x}px, ${drag.offset.y}px)`, transition: 'none' }
            : undefined
        }
      >
        {local.camOn ? (
          <VideoTile
            stream={local.stream}
            muted
            mirror={local.mirror}
            label={t('call.localVideo')}
            testId="local-video"
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-400">
            <UserIcon className="h-10 w-10" />
          </div>
        )}
      </div>

      {blocked ? (
        <button
          type="button"
          data-testid="tap-to-play"
          className="btn btn-primary absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 !px-6 !py-4 text-lg"
          onClick={startAudio}
        >
          {t('call.tapToPlay')}
        </button>
      ) : null}

      <ControlBar />
      {moreOpen ? <MoreSheet remoteVideo={remoteVideo} /> : null}
      {safetyOpen ? <SafetyDialog /> : null}
    </main>
  );
}
