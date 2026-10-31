import type { Implement } from '../api/types';

// % of 1RM for 1..12 reps taken to failure: the same RPE chart the server uses (strength.py).
const CHART = [1.0, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68];
const MIN_RPE = 6;

export function pctOf1rm(reps: number, rpe: number): number {
  const eff = reps + (10 - rpe);
  if (eff <= 1) return 1;
  if (eff <= CHART.length) {
    const lo = Math.floor(eff);
    const hi = Math.min(lo + 1, CHART.length);
    return CHART[lo - 1] + (CHART[hi - 1] - CHART[lo - 1]) * (eff - lo);
  }
  const n = CHART.length;
  return (CHART[n - 1] * (1 + n / 30)) / (1 + eff / 30);
}

/** Estimated 1RM of one set, or null when the set can't say (no load, no reps, effort too vague). */
export function setE1rm(load: number | null, reps: number | null, rpe: number | null): number | null {
  if (load == null || load <= 0 || reps == null || reps <= 0 || rpe == null || rpe < MIN_RPE) return null;
  return Math.round((load / pctOf1rm(reps, rpe)) * 10) / 10;
}

/** A set is a record when its estimate beats the best so far by more than rounding noise. */
export function isRecord(e1rm: number | null, best: number | null): boolean {
  return e1rm != null && best != null && e1rm > best + 0.5;
}

const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
// Plate-loaded implements; the barbell's own 20 kg is part of the load, the machines' sleds are not.
const BAR_KG: Partial<Record<Implement, number>> = { barbell: 20, smith: 0, leg_press: 0, hack_squat: 0 };

export function loadsPlates(implement: Implement): boolean {
  return implement in BAR_KG;
}

/** Plates for one side, heaviest first; null when the load can't be split (below the bar). */
export function platesPerSide(totalKg: number, implement: Implement): { plates: number[]; leftover: number } | null {
  const bar = BAR_KG[implement];
  if (bar == null || totalKg < bar) return null;
  let side = Math.round(((totalKg - bar) / 2) * 100) / 100;
  const plates: number[] = [];
  for (const p of PLATES) {
    while (side >= p - 1e-9) {
      plates.push(p);
      side = Math.round((side - p) * 100) / 100;
    }
  }
  return { plates, leftover: side };
}

export interface LoggedSet {
  exercise: string;
  reps: number | null;
  load_kg: number | null;
  rpe: number | null;
  record: boolean;
}

export function sessionSummary(sets: LoggedSet[]): { sets: number; volumeKg: number; records: string[] } {
  const volumeKg = sets.reduce((v, s) => v + (s.load_kg ?? 0) * (s.reps ?? 0), 0);
  const records = [...new Set(sets.filter((s) => s.record).map((s) => s.exercise))];
  return { sets: sets.length, volumeKg: Math.round(volumeKg), records };
}
