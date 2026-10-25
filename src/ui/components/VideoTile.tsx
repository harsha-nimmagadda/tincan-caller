import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  mirror?: boolean;
  fit?: 'contain' | 'cover';
  label: string;
  testId?: string;
  className?: string;
  /** Called when the browser's autoplay policy refuses to start playback. */
  onPlayBlocked?: () => void;
}

export function VideoTile({
  stream,
  muted,
  mirror,
  fit = 'cover',
  label,
  testId,
  className,
  onPlayBlocked,
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  // Keep the latest callback without making it an effect dependency: re-running the effect on every
  // render would re-assign srcObject, which restarts playback in WebKit.
  const blocked = useRef(onPlayBlocked);
  useEffect(() => {
    blocked.current = onPlayBlocked;
  });

  useEffect(() => {
    const v = ref.current;
    if (!v || v.srcObject === stream) return;
    v.srcObject = stream;
    if (stream) {
      v.play().catch(() => blocked.current?.()); // Rule 7: never leave a rejected play() unhandled
    }
  }, [stream]);

  return (
    <video
      ref={ref}
      data-testid={testId}
      aria-label={label}
      autoPlay
      playsInline
      muted={muted}
      className={className}
      style={{ objectFit: fit, transform: mirror ? 'scaleX(-1)' : undefined }}
    />
  );
}
