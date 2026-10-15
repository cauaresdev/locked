import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Wall-clock countdown. Remaining time is derived from Date.now(), not from
 * counting intervals, so it does not drift when JS frames are delayed.
 */
export function useCountdown(totalSeconds: number, onDone?: () => void) {
  const [remainingMs, setRemainingMs] = useState(totalSeconds * 1000);
  const [running, setRunning] = useState(false);
  const endAt = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = Math.max(0, (endAt.current ?? 0) - Date.now());
      setRemainingMs(left);
      if (left === 0) {
        setRunning(false);
        endAt.current = null;
        onDoneRef.current?.();
      }
    }, 100);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback(
    (seconds?: number) => {
      const ms = (seconds ?? totalSeconds) * 1000;
      endAt.current = Date.now() + ms;
      setRemainingMs(ms);
      setRunning(true);
    },
    [totalSeconds],
  );

  const stop = useCallback(() => {
    endAt.current = null;
    setRunning(false);
  }, []);

  // Idle, the countdown shows the full duration (and follows changes to it).
  const shown = running ? remainingMs : totalSeconds * 1000;
  return { remainingMs: shown, remainingSeconds: shown / 1000, running, start, stop };
}
