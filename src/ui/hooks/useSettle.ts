import { useCallback, useEffect, useRef } from 'react';

/** Runs `fn` once input has been quiet for `delayMs`; any pending run is cancelled on unmount. */
export function useSettle(delayMs: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const schedule = useCallback(
    (fn: () => void) => {
      cancel();
      timer.current = setTimeout(fn, delayMs);
    },
    [cancel, delayMs],
  );
  useEffect(() => cancel, [cancel]);
  return { schedule, cancel };
}
