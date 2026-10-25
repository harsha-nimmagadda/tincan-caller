import { useEffect, useState } from 'react';

/** 0..1 loudness of a stream's audio, for the lobby meter. Releases the AudioContext on cleanup. */
export function useMicLevel(stream: MediaStream | null, enabled: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (
      !stream ||
      !enabled ||
      stream.getAudioTracks().length === 0 ||
      typeof AudioContext === 'undefined'
    ) {
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 64));
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
      setLevel(0);
    };
  }, [stream, enabled]);
  return enabled ? level : 0;
}
