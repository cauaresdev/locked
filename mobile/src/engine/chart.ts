// Pure chart math (scales, ticks, hit-testing), kept out of the SVG components so it can be tested.

export interface Domain {
  min: number;
  max: number;
}

/** Y domain covering every value and reference line, padded so marks never touch the edges. */
export function yDomain(values: number[], refs: number[] = [], opts: { zero?: boolean; pad?: number } = {}): Domain {
  const all = [...values, ...refs].filter((v) => Number.isFinite(v));
  if (all.length === 0) return { min: 0, max: 1 };
  let min = opts.zero ? Math.min(0, ...all) : Math.min(...all);
  let max = Math.max(...all);
  if (max === min) {
    const bump = Math.abs(max) * 0.05 || 1;
    min -= bump;
    max += bump;
  }
  const pad = (max - min) * (opts.pad ?? 0.08);
  return { min: opts.zero && min >= 0 ? 0 : min - pad, max: max + pad };
}

/** Maps a value in `d` to a pixel between `top` (max) and `bottom` (min). */
export function scaleY(v: number, d: Domain, top: number, bottom: number): number {
  return bottom - ((v - d.min) / (d.max - d.min)) * (bottom - top);
}

/** X pixel of point `i` of `n`, spread across [left, right]; a lone point sits in the middle. */
export function scaleX(i: number, n: number, left: number, right: number): number {
  if (n <= 1) return (left + right) / 2;
  return left + (i / (n - 1)) * (right - left);
}

/** About `count` round tick values inside the domain (1, 2, 2.5 or 5 × a power of ten). */
export function ticks(d: Domain, count = 3): number[] {
  const span = d.max - d.min;
  if (!(span > 0)) return [d.min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(d.min / step) * step; v <= d.max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** Index of the point closest to pixel `x` (the crosshair snaps to it). */
export function nearestIndex(x: number, n: number, left: number, right: number): number {
  if (n <= 1) return 0;
  const i = Math.round(((x - left) / (right - left)) * (n - 1));
  return Math.max(0, Math.min(n - 1, i));
}

/** The selected index if it is still inside the data, else null (data shrank under a held crosshair). */
export function clampIndex(sel: number | null, n: number): number | null {
  return sel != null && sel >= 0 && sel < n ? sel : null;
}

/** Last, lowest and highest value of a series (gaps skipped), for a chart's spoken summary. */
export function seriesStats(values: (number | null)[]): { last: number; min: number; max: number } | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  return { last: v[v.length - 1], min: Math.min(...v), max: Math.max(...v) };
}

/** Short day label (dd/mm) from an ISO date. */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
