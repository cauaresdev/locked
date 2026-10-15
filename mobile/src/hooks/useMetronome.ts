import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Tempo } from '../api/types';
import { buildTimeline, cues, stateAt, totalMs, type CadenceState } from '../engine/tempo';
import { useCues } from './useCues';

const LEAD_IN_MS = 3000;

/**
 * Tactical cadence metronome. Cues are scheduled against a fixed start time
 * (each timeout re-aims at its absolute target), so late frames never
 * accumulate into drift across a 36 s set.
 */
export function useMetronome(tempo: Tempo | null, reps: number, pattern: string) {
  const play = useCues();
  const timeline = useMemo(() => (tempo ? buildTimeline(tempo, reps, pattern) : []), [tempo, reps, pattern]);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const stop = useCallback(() => {
    clear();
    setStartAt(null);
  }, [clear]);

  const start = useCallback(() => {
    clear();
    const t0 = Date.now() + LEAD_IN_MS;
    setStartAt(t0);
    // 3-2-1 lead-in ticks, then the cadence itself.
    const schedule = [
      { atMs: -3000, kind: 'tick' as const },
      { atMs: -2000, kind: 'tick' as const },
      { atMs: -1000, kind: 'tick' as const },
      ...cues(timeline),
    ];
    for (const cue of schedule) {
      timers.current.push(setTimeout(() => play(cue.kind), Math.max(0, t0 + cue.atMs - Date.now())));
    }
    timers.current.push(setTimeout(() => setStartAt(null), LEAD_IN_MS + totalMs(timeline) + 50));
  }, [clear, play, timeline]);

  useEffect(() => {
    if (startAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(id);
  }, [startAt]);

  useEffect(() => clear, [clear]);

  const elapsed = startAt === null ? 0 : now - startAt;
  const state: CadenceState & { leadIn: number } = {
    ...stateAt(timeline, Math.max(0, elapsed)),
    leadIn: elapsed < 0 ? Math.ceil(-elapsed / 1000) : 0,
  };

  return {
    running: startAt !== null,
    state,
    totalSeconds: totalMs(timeline) / 1000,
    start,
    stop,
  };
}
