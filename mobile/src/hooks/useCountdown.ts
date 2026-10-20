import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Wall-clock countdown. Remaining time is derived from Date.now(), not from
 * counting intervals, so it does not drift when JS frames are delayed.
 * onDone gets how late the end was noticed: well past zero means JS was suspended
 * (screen locked, app in the background) and the moment has already gone.
 */
export function useCountdown(totalSeconds: number, onDone?: (lateMs: number) => void) {
  // Whole seconds, as displayed: the 100 ms poll keeps the countdown on time, and React skips
  // the nine polls a second that leave the number unchanged.
  const [remaining, setRemaining] = useState(Math.ceil(totalSeconds));
  const [running, setRunning] = useState(false);
  const endAt = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const now = Date.now();
      const end = endAt.current ?? 0;
      const left = Math.max(0, end - now);
      setRemaining(Math.ceil(left / 1000));
      if (left === 0) {
        setRunning(false);
        endAt.current = null;
        onDoneRef.current?.(now - end);
      }
    }, 100);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback(
    (seconds?: number) => {
      const ms = (seconds ?? totalSeconds) * 1000;
      endAt.current = Date.now() + ms;
      setRemaining(Math.ceil(ms / 1000));
      setRunning(true);
    },
    [totalSeconds],
  );

  /** Moves the end by deltaSeconds (negative shortens; never before now). Returns the seconds left. */
  const extend = useCallback((deltaSeconds: number) => {
    if (endAt.current == null) return 0;
    endAt.current = Math.max(Date.now(), endAt.current + deltaSeconds * 1000);
    const left = Math.ceil((endAt.current - Date.now()) / 1000);
    setRemaining(left);
    return left;
  }, []);

  const stop = useCallback(() => {
    endAt.current = null;
    setRunning(false);
  }, []);

  // Idle, the countdown shows the full duration (and follows changes to it).
  const shown = running ? remaining : totalSeconds;
  return { remainingMs: shown * 1000, remainingSeconds: shown, running, start, stop, extend };
}
