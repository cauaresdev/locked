import type { Tempo } from '../api/types';

export type PhaseName = 'eccentric' | 'bottom_pause' | 'concentric' | 'top_pause';

export const PHASE_LABEL: Record<PhaseName, string> = {
  eccentric: 'EXCÊNTRICA',
  bottom_pause: 'PAUSA',
  concentric: 'CONCÊNTRICA',
  top_pause: 'PAUSA',
};

export interface Segment {
  rep: number; // 1-based
  phase: PhaseName;
  startMs: number;
  durationMs: number;
}

export interface CadenceState {
  done: boolean;
  rep: number;
  phase: PhaseName | null;
  secondInPhase: number; // 1-based count shown to the athlete
  phaseSeconds: number;
}

// Pulls and hinges start from the stretched position, so the first movement
// is the concentric even though tempo notation is written eccentric-first.
const CONCENTRIC_FIRST = new Set(['pull_vertical', 'pull_horizontal', 'hinge']);

export function phaseOrder(pattern: string): PhaseName[] {
  return CONCENTRIC_FIRST.has(pattern)
    ? ['concentric', 'top_pause', 'eccentric', 'bottom_pause']
    : ['eccentric', 'bottom_pause', 'concentric', 'top_pause'];
}

export function buildTimeline(tempo: Tempo, reps: number, pattern: string): Segment[] {
  const order = phaseOrder(pattern);
  const segments: Segment[] = [];
  let t = 0;
  for (let rep = 1; rep <= reps; rep++) {
    for (const phase of order) {
      const seconds = tempo[phase];
      if (seconds <= 0) continue;
      segments.push({ rep, phase, startMs: t, durationMs: seconds * 1000 });
      t += seconds * 1000;
    }
  }
  return segments;
}

export function totalMs(timeline: Segment[]): number {
  const last = timeline[timeline.length - 1];
  return last ? last.startMs + last.durationMs : 0;
}

export function stateAt(timeline: Segment[], elapsedMs: number): CadenceState {
  const seg = timeline.find((s) => elapsedMs >= s.startMs && elapsedMs < s.startMs + s.durationMs);
  if (!seg) {
    const last = timeline[timeline.length - 1];
    return { done: true, rep: last?.rep ?? 0, phase: null, secondInPhase: 0, phaseSeconds: 0 };
  }
  return {
    done: false,
    rep: seg.rep,
    phase: seg.phase,
    secondInPhase: Math.floor((elapsedMs - seg.startMs) / 1000) + 1,
    phaseSeconds: seg.durationMs / 1000,
  };
}

export type MetronomeView = CadenceState & { leadIn: number };

/** What the metronome shows `elapsedMs` after the first rep starts (negative: the 3-2-1 lead-in). */
export function metronomeView(timeline: Segment[], elapsedMs: number): MetronomeView {
  return {
    ...stateAt(timeline, Math.max(0, elapsedMs)),
    leadIn: elapsedMs < 0 ? Math.ceil(-elapsedMs / 1000) : 0,
  };
}

/** Same display: the metronome re-renders only when what it shows changes, not on every poll. */
export function sameView(a: MetronomeView, b: MetronomeView): boolean {
  return (
    a.done === b.done &&
    a.rep === b.rep &&
    a.phase === b.phase &&
    a.secondInPhase === b.secondInPhase &&
    a.phaseSeconds === b.phaseSeconds &&
    a.leadIn === b.leadIn
  );
}

export type Cue = { atMs: number; kind: 'phase' | 'tick' | 'done' };

// Audio/haptic cues: a strong cue at each phase change, a dry tick on every
// other second boundary, and a final cue when the set ends.
export function cues(timeline: Segment[]): Cue[] {
  const out: Cue[] = [];
  for (const s of timeline) {
    out.push({ atMs: s.startMs, kind: 'phase' });
    for (let ms = s.startMs + 1000; ms < s.startMs + s.durationMs; ms += 1000) {
      out.push({ atMs: ms, kind: 'tick' });
    }
  }
  out.push({ atMs: totalMs(timeline), kind: 'done' });
  return out;
}

export function tempoNotation(t: Tempo): string {
  return `${t.eccentric}-${t.bottom_pause}-${t.concentric}-${t.top_pause}`;
}
