import type { Prescription } from '../api/types';
import { tempoNotation } from './tempo';

export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function isoDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return isoDay(new Date(y, m - 1, d + n));
}

function volume(rx: Prescription): string {
  if (rx.reps_sequence) return rx.reps_sequence.join('-');
  if (rx.reps_per_side) return `${rx.reps_per_side}/lado`;
  if (rx.reps) return String(rx.reps);
  return '';
}

function seconds(n: number): string {
  return n >= 120 && n % 60 === 0 ? `${n / 60} min` : `${n} s`;
}

/** Compact prescription line, e.g. "6 × 4 @ 4-0-4-1 · RPE 8". */
export function rxSummary(rx: Prescription): string {
  const sets = rx.sets > 1 ? `${rx.sets} × ` : '';
  let main: string;
  switch (rx.mode) {
    case 'timed':
      main = `${sets}${seconds(rx.duration_seconds ?? 0)}${rx.unilateral ? '/lado' : ''}`;
      break;
    case 'hold': {
      const reps = rx.reps_per_side && rx.reps_per_side > 1 ? `${rx.reps_per_side}/lado × ` : '';
      const side = rx.unilateral && !reps ? '/lado' : '';
      main = `${sets}${reps}${seconds(rx.hold_seconds ?? 0)}${side} isometria`;
      break;
    }
    default:
      main = `${sets}${volume(rx)}`;
  }
  const parts = [main];
  if (rx.tempo) parts[0] += ` · cadência ${tempoNotation(rx.tempo)} s`;
  if (rx.intensity) parts.push(rx.intensity);
  if (rx.target_rpe) parts.push(`esforço ${String(rx.target_rpe).replace('.', ',')}/10 (RPE)`);
  if (rx.suggested_load_kg != null) parts.push(`${String(rx.suggested_load_kg).replace('.', ',')} kg`);
  return parts.join(' · ');
}

/**
 * Reps to log for one set, in the same unit the prescription targets (per side
 * for unilateral work, the largest chunk of a sequence), so e1RM math lines up.
 */
export function repsToLog(rx: Prescription): number | null {
  if (rx.reps_per_side) return rx.reps_per_side;
  if (rx.reps_sequence) return Math.max(...rx.reps_sequence);
  return rx.reps;
}

/** Work seconds of one set for timed/hold modes. */
export function workSeconds(rx: Prescription): number {
  if (rx.mode === 'timed') return (rx.duration_seconds ?? 0) * (rx.unilateral ? 2 : 1);
  if (rx.mode === 'hold') {
    const holds = rx.reps_per_side ? rx.reps_per_side * 2 : 1;
    return (rx.hold_seconds ?? 0) * holds;
  }
  return 0;
}

export function formatKgM(v: number): string {
  if (v >= 1_000_000) return `${decimal(v / 1_000_000, 2)} M`;
  if (v >= 10_000) return `${decimal(v / 1000)} k`;
  return Math.round(v).toLocaleString('pt-BR');
}

const CYCLE_STRUCTURE: Record<string, string> = {
  '6_on_2_off': '6 dias de treino + 2 de folga',
  '5_of_7': '5 treinos em 7 dias',
  '4_of_7': '4 treinos em 7 dias',
};

export function cycleStructureLabel(structure: string): string {
  return CYCLE_STRUCTURE[structure] ?? structure.replaceAll('_', ' ');
}

export function decimal(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',');
}

/**
 * A number typed the Brazilian way: "82,5" and "82.5" are both 82.5, "1.500" is 1500.
 * With a comma, dots are thousands separators. Returns null for empty or invalid input.
 */
export function parseDecimal(s: string): number | null {
  let t = s.trim().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
