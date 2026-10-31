import { useMemo, useState, type ReactNode } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { clampIndex, nearestIndex, scaleX, scaleY, seriesStats, ticks, yDomain, type Domain } from '../engine/chart';
import { colors, space } from '../theme';
import { Panel, Row, T, TextLink } from './ui';

// Chart chrome follows the app palette: the main series in the accent, references and
// secondary series in muted text, grid in the border tone. Status colors only where they mean status,
// always alongside a written level. Identity never relies on color alone: series differ
// by mark (line vs. dot) and carry a legend; every chart also has a table view.

const PAD = { left: 40, right: 10, top: 10, bottom: 20 };
const TICK_FONT = { fontSize: 10 } as const;

export interface RefLine {
  y: number;
  label: string;
}

const NO_REFS: RefLine[] = []; // a stable default, so memoized chart math is not recomputed every render

export interface LegendItem {
  label: string;
  kind: 'line' | 'dot' | 'bar';
  color: string;
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

/** Card with title, optional legend, and a chart / table toggle. */
export function ChartCard({
  title,
  note,
  legend,
  table,
  children,
}: {
  title: string;
  note?: string;
  legend?: LegendItem[];
  table: TableData;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Panel style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <T variant="title" style={{ flex: 1, fontSize: 16 }}>{title}</T>
        <TextLink label={asTable ? 'Ver gráfico' : 'Ver tabela'} onPress={() => setAsTable(!asTable)}
          accessibilityLabel={`${asTable ? 'Ver gráfico' : 'Ver tabela'}: ${title}`} />
      </Row>
      {note && <T variant="hint">{note}</T>}
      {legend && legend.length > 1 && !asTable && (
        <Row style={{ gap: space.lg, flexWrap: 'wrap' }}>
          {legend.map((l) => (
            <Row key={l.label} style={{ gap: space.xs }}>
              <LegendKey item={l} />
              <T variant="hint">{l.label}</T>
            </Row>
          ))}
        </Row>
      )}
      {asTable ? <DataTable table={table} /> : children}
    </Panel>
  );
}

function LegendKey({ item }: { item: LegendItem }) {
  return (
    <Svg width={16} height={10}>
      {item.kind === 'line' && <Line x1={0} y1={5} x2={16} y2={5} stroke={item.color} strokeWidth={2} />}
      {item.kind === 'dot' && <Circle cx={8} cy={5} r={4} fill={item.color} />}
      {item.kind === 'bar' && <Rect x={3} y={0} width={10} height={10} rx={2} fill={item.color} />}
    </Svg>
  );
}

function DataTable({ table }: { table: TableData }) {
  return (
    <View accessibilityRole="list" style={{ gap: 2 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        {table.headers.map((h) => (
          <T key={h} variant="label" style={{ flex: 1 }}>{h}</T>
        ))}
      </Row>
      {table.rows.length === 0 && <T variant="hint">Sem dados no período.</T>}
      {table.rows.map((r, i) => (
        <Row key={i} style={{ justifyContent: 'space-between' }}>
          {r.map((c, j) => (
            <T key={j} style={{ flex: 1, fontSize: 13 }}>{c}</T>
          ))}
        </Row>
      ))}
    </View>
  );
}

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  return [w, (e) => setW(e.nativeEvent.layout.width)];
}

/** Finger position -> selected index; the crosshair follows a drag. */
function useScrub(n: number, width: number) {
  const [sel, setSel] = useState<number | null>(null);
  const pick = (e: GestureResponderEvent) => setSel(nearestIndex(e.nativeEvent.locationX, n, PAD.left, width - PAD.right));
  return {
    sel: clampIndex(sel, n), // new, shorter data (another range) falls back to the latest point
    handlers: {
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      onResponderGrant: pick,
      onResponderMove: pick,
    },
  };
}

function Grid({ d, width, height, format, refs }: { d: Domain; width: number; height: number;
  format: (v: number) => string; refs: RefLine[] }) {
  const bottom = height - PAD.bottom;
  return (
    <>
      {ticks(d).map((t) => {
        const y = scaleY(t, d, PAD.top, bottom);
        return (
          <G key={`t${t}`}>
            <Line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke={colors.border} strokeWidth={1} />
            <SvgText x={PAD.left - 6} y={y + 3} fill={colors.textMuted} textAnchor="end" {...TICK_FONT}>{format(t)}</SvgText>
          </G>
        );
      })}
      {refs.map((r) => {
        const y = scaleY(r.y, d, PAD.top, bottom);
        return (
          <G key={`r${r.label}`}>
            <Line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke={colors.textMuted} strokeWidth={1}
              strokeDasharray="4 4" />
            <SvgText x={width - PAD.right} y={y - 4} fill={colors.textMuted} textAnchor="end" {...TICK_FONT}>{r.label}</SvgText>
          </G>
        );
      })}
    </>
  );
}

function XLabels({ labels, width, height, n }: { labels: string[]; width: number; height: number; n: number }) {
  if (labels.length === 0) return null;
  const y = height - 4;
  return (
    <>
      <SvgText x={scaleX(0, n, PAD.left, width - PAD.right)} y={y} fill={colors.textMuted}
        textAnchor={n > 1 ? 'start' : 'middle'} {...TICK_FONT}>{labels[0]}</SvgText>
      {n > 1 && (
        <SvgText x={width - PAD.right} y={y} fill={colors.textMuted} textAnchor="end" {...TICK_FONT}>
          {labels[labels.length - 1]}
        </SvgText>
      )}
    </>
  );
}

/** Value first, then the series name, keyed with a short stroke of its mark. */
function Readout({ title, items }: { title: string; items: { label: string; value: string; key: LegendItem }[] }) {
  return (
    <Row style={{ gap: space.md, flexWrap: 'wrap', minHeight: 22 }}>
      <T variant="label">{title}</T>
      {items.map((it) => (
        <Row key={it.label} style={{ gap: space.xs }}>
          <LegendKey item={it.key} />
          <T style={{ fontSize: 14 }}>{it.value}</T>
          <T variant="hint">{it.label}</T>
        </Row>
      ))}
    </Row>
  );
}

export interface Series {
  label: string;
  color: string;
  kind: 'line' | 'dot';
  values: (number | null)[];
}

/** Line / dot chart over a shared x axis (one entry per day or point). */
export function LineChart({
  series,
  xLabels,
  refs = NO_REFS,
  format,
  height = 160,
}: {
  series: Series[];
  xLabels: string[];
  refs?: RefLine[];
  format: (v: number) => string;
  height?: number;
}) {
  const [width, onLayout] = useWidth();
  const n = xLabels.length;
  const { sel, handlers } = useScrub(n, width);
  const at = sel ?? n - 1; // the latest point is labelled until the reader picks another
  const bottom = height - PAD.bottom;
  // Scrubbing re-renders at touch rate: the domain and line paths only change with the data or the width.
  const d = useMemo(
    () => yDomain(series.flatMap((s) => s.values.filter((v): v is number => v != null)), refs.map((r) => r.y)),
    [series, refs],
  );
  const x = (i: number) => scaleX(i, n, PAD.left, width - PAD.right);
  const y = (v: number) => scaleY(v, d, PAD.top, bottom);
  const paths = useMemo(
    () =>
      series.map((s) => {
        let out = '';
        let pen = false;
        s.values.forEach((v, i) => {
          if (v == null) {
            pen = false;
            return;
          }
          const px = scaleX(i, n, PAD.left, width - PAD.right);
          const py = scaleY(v, d, PAD.top, bottom);
          out += `${pen ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
          pen = true;
        });
        return out;
      }),
    [series, n, width, d, bottom],
  );
  const summary = series
    .map((s) => {
      const st = seriesStats(s.values);
      return st
        ? `${s.label}: último ${format(st.last)}, mínimo ${format(st.min)}, máximo ${format(st.max)}`
        : `${s.label}: sem dados`;
    })
    .join('; ');

  return (
    <View style={{ gap: space.xs }}>
      {n > 0 && (
        <Readout
          title={xLabels[at]}
          items={series
            .filter((s) => s.values[at] != null)
            .map((s) => ({ label: s.label, value: format(s.values[at] as number), key: { label: s.label, kind: s.kind, color: s.color } }))}
        />
      )}
      <View onLayout={onLayout} {...handlers} accessible accessibilityLabel={`Gráfico de ${n} pontos. ${summary}`}>
        {width > 0 && n > 0 && (
          <Svg width={width} height={height}>
            <Grid d={d} width={width} height={height} format={format} refs={refs} />
            {series.map((s, si) =>
              s.kind === 'line' ? (
                <Path key={s.label} d={paths[si]} stroke={s.color} strokeWidth={2} fill="none"
                  strokeLinejoin="round" strokeLinecap="round" />
              ) : (
                s.values.map((v, i) =>
                  v == null ? null : (
                    <Circle key={`${s.label}${i}`} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke={colors.surface}
                      strokeWidth={2} />
                  ),
                )
              ),
            )}
            <Line x1={x(at)} x2={x(at)} y1={PAD.top} y2={bottom} stroke={colors.text} strokeWidth={1} opacity={0.5} />
            {series.map((s) =>
              s.values[at] != null ? (
                <Circle key={`sel${s.label}`} cx={x(at)} cy={y(s.values[at] as number)} r={5} fill={s.color}
                  stroke={colors.surface} strokeWidth={2} />
              ) : null,
            )}
            <XLabels labels={xLabels} width={width} height={height} n={n} />
          </Svg>
        )}
      </View>
    </View>
  );
}

export interface Bar {
  label: string; // x label (e.g. day)
  value: number;
  color?: string;
  note?: string; // shown in the readout (e.g. the written status level)
}

/** Vertical bars from a zero baseline, rounded data-ends, 2px gaps. */
export function BarChart({
  bars,
  refs = NO_REFS,
  format,
  height = 150,
  seriesLabel,
}: {
  bars: Bar[];
  refs?: RefLine[];
  format: (v: number) => string;
  height?: number;
  seriesLabel: string;
}) {
  const [width, onLayout] = useWidth();
  const n = bars.length;
  const { sel, handlers } = useScrub(n, width);
  const at = sel ?? n - 1;
  const d = yDomain(bars.map((b) => b.value), refs.map((r) => r.y), { zero: true });
  const bottom = height - PAD.bottom;
  const slot = n > 0 ? (width - PAD.left - PAD.right) / n : 0;
  const barW = Math.max(2, slot - 2);
  const baseY = scaleY(Math.max(0, d.min), d, PAD.top, bottom);

  const barPath = (i: number, v: number) => {
    const x0 = PAD.left + i * slot + (slot - barW) / 2;
    const top = scaleY(v, d, PAD.top, bottom);
    const h = Math.max(0, baseY - top);
    const r = Math.min(4, barW / 2, h);
    // Rounded at the data end only; square on the baseline.
    return `M${x0},${baseY} L${x0},${top + r} Q${x0},${top} ${x0 + r},${top} L${x0 + barW - r},${top} ` +
      `Q${x0 + barW},${top} ${x0 + barW},${top + r} L${x0 + barW},${baseY} Z`;
  };
  const selected = bars[at];
  const st = seriesStats(bars.map((b) => b.value));
  const last = bars[n - 1];
  const summary = st && last
    ? `Gráfico de barras: ${seriesLabel}, ${n} ${n === 1 ? 'valor' : 'valores'}. Último ${format(st.last)} em ${last.label}` +
      `${last.note ? ` (${last.note})` : ''}, mínimo ${format(st.min)}, máximo ${format(st.max)}.`
    : `Gráfico de barras: ${seriesLabel}, sem dados.`;

  return (
    <View style={{ gap: space.xs }}>
      {selected && (
        <Readout
          title={selected.label}
          items={[{
            label: selected.note ? `${seriesLabel} · ${selected.note}` : seriesLabel,
            value: format(selected.value),
            key: { label: seriesLabel, kind: 'bar', color: selected.color ?? colors.accent },
          }]}
        />
      )}
      <View onLayout={onLayout} {...handlers} accessible accessibilityLabel={summary}>
        {width > 0 && n > 0 && (
          <Svg width={width} height={height}>
            <Grid d={d} width={width} height={height} format={format} refs={refs} />
            {bars.map((b, i) => (
              <Path key={i} d={barPath(i, b.value)} fill={b.color ?? colors.accent}
                opacity={sel == null || i === at ? 1 : 0.55} />
            ))}
            <XLabels labels={bars.map((b) => b.label)} width={width} height={height} n={n} />
          </Svg>
        )}
      </View>
    </View>
  );
}

/** A headline number with its context: the right form when the job is a single value. */
export function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View style={{ flex: 1, gap: 2, minWidth: 96 }}>
      <T variant="label">{label}</T>
      <T variant="metric" style={{ fontSize: 24 }}>{value}</T>
      {detail && <T variant="hint">{detail}</T>}
    </View>
  );
}
