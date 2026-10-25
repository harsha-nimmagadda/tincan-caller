import type { TimerBag } from './timers';

/** The slice of RTCPeerConnection gathering needs, so tests can use a fake. */
export interface GatherTarget {
  readonly iceGatheringState: RTCIceGatheringState;
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
}

export interface GatherHandle {
  /** Resolves when gathering completes or the timeout hits, whichever is first. */
  done: Promise<void>;
  /** Candidate types seen so far, e.g. ['host', 'srflx'] (for diagnostics). */
  localTypes(): string[];
  stop(): void;
}

/** Start *before* `setLocalDescription()` so no candidate event is missed. */
export function trackGathering(
  pc: GatherTarget,
  timeoutMs: number,
  timers: TimerBag,
): GatherHandle {
  const types = new Set<string>();
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const onCandidate = (e: Event) => {
    const text = (e as RTCPeerConnectionIceEvent).candidate?.candidate ?? '';
    const type = /\btyp (\w+)/.exec(text)?.[1];
    if (type) types.add(type);
  };
  const onState = () => {
    if (pc.iceGatheringState === 'complete') stop();
  };
  const timeout = timers.set(() => stop(), timeoutMs);

  function stop() {
    pc.removeEventListener('icecandidate', onCandidate);
    pc.removeEventListener('icegatheringstatechange', onState);
    timers.clear(timeout);
    finish();
  }

  pc.addEventListener('icecandidate', onCandidate);
  pc.addEventListener('icegatheringstatechange', onState);
  onState();
  return { done, localTypes: () => [...types], stop };
}
