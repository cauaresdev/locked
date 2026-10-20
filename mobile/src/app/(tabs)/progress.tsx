import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { Progress, ReadinessLevel } from '../../api/types';
import { BarChart, ChartCard, LineChart, StatTile, type Bar } from '../../components/charts';
import { Badge, Chip, Panel, Row, T } from '../../components/ui';
import { shortDay } from '../../engine/chart';
import { decimal, formatKgM } from '../../engine/format';
import { storedAthlete, storedProgressReport, storeProgressReport } from '../../storage/db';
import { colors, fonts, levelColor, space } from '../../theme';

const RANGES = [30, 60, 90] as const;
const DEFAULT_RANGE = 60;
const LEVEL_LABEL: Record<ReadinessLevel, string> = { green: 'verde', amber: 'amarelo', red: 'vermelho' };
const kg = (v: number) => `${decimal(v)} kg`;
const pct = (v: number) => `${Math.round(v)}%`;

export default function ProgressScreen() {
  const athleteId = storedAthlete()?.id;
  const [days, setDays] = useState<(typeof RANGES)[number]>(DEFAULT_RANGE);
  const [data, setData] = useState<Progress | null>(() => storedProgressReport(DEFAULT_RANGE));
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lift, setLift] = useState<string | null>(null);
  const run = useRef(0); // only the latest range may write state: a slow 90-day reply must not land under "30 dias"

  const load = useCallback(async () => {
    if (!athleteId) return;
    const id = ++run.current;
    const live = () => id === run.current;
    setLoading(true);
    try {
      const p = await api.progress(athleteId, days);
      if (!live()) return;
      setData(p);
      storeProgressReport(days, p);
      setOffline(false);
    } catch {
      if (!live()) return;
      setOffline(true);
    } finally {
      if (live()) setLoading(false);
    }
  }, [athleteId, days]);

  function pickRange(r: (typeof RANGES)[number]) {
    if (r === days) return;
    setDays(r);
    setData(storedProgressReport(r)); // the saved report for this range, or none: never another range's
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!athleteId) return <Redirect href="/onboarding" />;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.concrete} />}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="title">Progresso</T>
          {offline && <Badge label="Sem conexão · dados salvos" color={colors.amber} />}
        </Row>

        {/* One range control, above everything it scopes. */}
        <Row style={{ gap: space.xs }}>
          {RANGES.map((r) => (
            <Chip key={r} label={`${r} dias`} selected={days === r} onPress={() => pickRange(r)} />
          ))}
        </Row>

        {!data ? (
          <T color={colors.concrete}>{loading ? 'Carregando…' : 'Sem dados ainda. Abra com conexão.'}</T>
        ) : (
          <View style={{ gap: space.lg, opacity: loading ? 0.6 : 1 }}>
            <Summary data={data} />
            <StrengthCard data={data} lift={lift} onLift={setLift} />
            <WeightCard data={data} />
            <ReadinessCard data={data} />
            <SleepAndHrv data={data} />
            <ArmorCard data={data} />
            <DietCard data={data} />
            <AttendanceCard data={data} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Summary({ data }: { data: Progress }) {
  const planned = data.attendance.filter((d) => d.planned);
  const done = planned.filter((d) => d.trained).length;
  const onTarget = data.diet.filter((d) => d.kcal_target > 0 && Math.abs(d.kcal / d.kcal_target - 1) <= 0.1).length;
  return (
    <Panel>
      <Row style={{ flexWrap: 'wrap', alignItems: 'flex-start', gap: space.lg }}>
        <StatTile label="Treinos feitos" value={`${done}/${planned.length}`}
          detail={planned.length ? `${Math.round((100 * done) / planned.length)}% do planejado` : undefined} />
        <StatTile label="Peso" value={data.weight.trend_kg != null ? kg(data.weight.trend_kg) : '—'}
          detail="média de 7 dias" />
        <StatTile label="Dieta na meta" value={`${onTarget}/${data.diet.length}`}
          detail="dias a ±10% das calorias" />
      </Row>
    </Panel>
  );
}

function StrengthCard({ data, lift, onLift }: { data: Progress; lift: string | null; onLift: (id: string) => void }) {
  if (data.strength.length === 0) return null;
  const sorted = [...data.strength].sort((a, b) => b.history.length - a.history.length);
  const current = sorted.find((s) => s.exercise_id === lift) ?? sorted[0];
  return (
    <ChartCard
      title="Força · 1RM estimado"
      note="1RM: a carga máxima para uma repetição, estimada pelas séries com repetições e esforço registrados."
      table={{ headers: ['Dia', '1RM estimado'], rows: current.history.map(([d, v]) => [shortDay(d), kg(v)]) }}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
        {sorted.map((s) => (
          <Chip key={s.exercise_id} label={s.name} selected={s.exercise_id === current.exercise_id}
            onPress={() => onLift(s.exercise_id)} />
        ))}
      </ScrollView>
      <LineChart
        series={[{ label: current.name, color: colors.bone, kind: 'line', values: current.history.map(([, v]) => v) }]}
        xLabels={current.history.map(([d]) => shortDay(d))}
        format={(v) => decimal(v, 0)}
      />
    </ChartCard>
  );
}

function WeightCard({ data }: { data: Progress }) {
  const e = data.weight.entries;
  if (e.length === 0) return null;
  return (
    <ChartCard
      title="Peso corporal"
      note="A média de 7 dias é o peso usado nas metas de calorias, proteína e carga."
      legend={[
        { label: 'média de 7 dias', kind: 'line', color: colors.bone },
        { label: 'pesagem', kind: 'dot', color: colors.concrete },
      ]}
      table={{ headers: ['Dia', 'Pesagem', 'Média 7 dias'], rows: e.map((p) => [shortDay(p.day), kg(p.weight_kg), kg(p.trend_kg)]) }}
    >
      <LineChart
        series={[
          { label: 'pesagem', color: colors.concrete, kind: 'dot', values: e.map((p) => p.weight_kg) },
          { label: 'média de 7 dias', color: colors.bone, kind: 'line', values: e.map((p) => p.trend_kg) },
        ]}
        xLabels={e.map((p) => shortDay(p.day))}
        format={(v) => decimal(v, 0)}
      />
    </ChartCard>
  );
}

function ReadinessCard({ data }: { data: Progress }) {
  const days = data.readiness.filter((r) => r.score != null && r.level != null);
  if (days.length === 0) return null;
  const bars: Bar[] = days.map((r) => ({
    label: shortDay(r.day),
    value: r.score as number,
    color: levelColor[r.level as ReadinessLevel],
    note: LEVEL_LABEL[r.level as ReadinessLevel], // the level is written, never color alone
  }));
  return (
    <ChartCard
      title="Prontidão (0–100)"
      note="Verde a partir de 70, amarelo de 50 a 69, vermelho abaixo de 50."
      table={{ headers: ['Dia', 'Nota', 'Nível'], rows: days.map((r) => [shortDay(r.day), String(r.score),
        LEVEL_LABEL[r.level as ReadinessLevel]]) }}
    >
      <BarChart bars={bars} seriesLabel="prontidão" format={(v) => String(Math.round(v))}
        refs={[{ y: 70, label: 'verde ≥ 70' }, { y: 50, label: 'vermelho < 50' }]} />
    </ChartCard>
  );
}

function SleepAndHrv({ data }: { data: Progress }) {
  const sleep = data.readiness.filter((r) => r.sleep_hours != null);
  const hrv = data.readiness.filter((r) => r.hrv_ms != null);
  // HRV readings from different methods are not comparable: chart the most common one.
  const method = hrv.filter((r) => r.hrv_method === 'sdnn').length > hrv.length / 2 ? 'sdnn' : 'rmssd';
  const sameMethod = hrv.filter((r) => r.hrv_method === method);
  return (
    <>
      {sleep.length > 0 && (
        <ChartCard title="Sono (horas)"
          table={{ headers: ['Dia', 'Horas'], rows: sleep.map((r) => [shortDay(r.day), decimal(r.sleep_hours as number)]) }}>
          <BarChart bars={sleep.map((r) => ({ label: shortDay(r.day), value: r.sleep_hours as number }))}
            seriesLabel="horas de sono" format={(v) => decimal(v, 0)} refs={[{ y: 7, label: '7 h' }]} />
        </ChartCard>
      )}
      {sameMethod.length > 1 && (
        <ChartCard
          title="VFC · variabilidade da frequência cardíaca (ms)"
          note={method === 'sdnn'
            ? 'Medida pelo Apple Health (método SDNN, desvio padrão dos intervalos entre batimentos).'
            : 'Método RMSSD (variação entre batimentos consecutivos), padrão de cintas e Health Connect.'}
          table={{ headers: ['Dia', 'VFC (ms)'], rows: sameMethod.map((r) => [shortDay(r.day), decimal(r.hrv_ms as number)]) }}
        >
          <LineChart series={[{ label: 'VFC', color: colors.bone, kind: 'line', values: sameMethod.map((r) => r.hrv_ms) }]}
            xLabels={sameMethod.map((r) => shortDay(r.day))} format={(v) => decimal(v, 0)} />
        </ChartCard>
      )}
    </>
  );
}

function ArmorCard({ data }: { data: Progress }) {
  if (data.armor_cycles.length === 0) return null;
  return (
    <ChartCard
      title="Capacidade de Carga Operacional por ciclo"
      note="kg·m: quilos carregados × metros percorridos em carregamentos, trenó e barra com lastro."
      table={{ headers: ['Ciclo', 'Início', 'kg·m'], rows: data.armor_cycles.map((c) => [String(c.cycle_index + 1),
        shortDay(c.start), formatKgM(c.kg_m)]) }}
    >
      <BarChart bars={data.armor_cycles.map((c) => ({ label: `ciclo ${c.cycle_index + 1}`, value: c.kg_m }))}
        seriesLabel="kg·m" format={formatKgM} />
    </ChartCard>
  );
}

function DietCard({ data }: { data: Progress }) {
  const days = data.diet.filter((d) => d.kcal_target > 0);
  if (days.length === 0) return null;
  const kcalPct = days.map((d) => (100 * d.kcal) / d.kcal_target);
  const protPct = days.map((d) => (d.protein_target_g > 0 ? (100 * d.protein_g) / d.protein_target_g : 0));
  return (
    <>
      <ChartCard
        title="Calorias · % da meta do dia"
        note="A meta muda com o gasto do treino de cada dia; 100% é exatamente a meta."
        table={{ headers: ['Dia', 'Consumido', 'Meta'], rows: days.map((d) => [shortDay(d.day), `${Math.round(d.kcal)} kcal`,
          `${Math.round(d.kcal_target)} kcal`]) }}
      >
        <BarChart bars={days.map((d, i) => ({ label: shortDay(d.day), value: kcalPct[i] }))} seriesLabel="da meta de calorias"
          format={pct} refs={[{ y: 100, label: 'meta' }]} />
      </ChartCard>
      <ChartCard
        title="Proteína · % da meta do dia"
        table={{ headers: ['Dia', 'Consumido', 'Meta'], rows: days.map((d) => [shortDay(d.day), `${Math.round(d.protein_g)} g`,
          `${Math.round(d.protein_target_g)} g`]) }}
      >
        <BarChart bars={days.map((d, i) => ({ label: shortDay(d.day), value: protPct[i] }))} seriesLabel="da meta de proteína"
          format={pct} refs={[{ y: 100, label: 'meta' }]} />
      </ChartCard>
    </>
  );
}

function AttendanceCard({ data }: { data: Progress }) {
  if (data.attendance.length === 0) return null;
  const status = (d: Progress['attendance'][number]) =>
    d.trained ? 'treinou' : d.planned ? 'treino perdido' : 'folga';
  const planned = data.attendance.filter((d) => d.planned || d.trained);
  const trained = data.attendance.filter((d) => d.trained).length;
  const missed = planned.length - trained;
  // One summary for screen readers instead of a stop per cell; the table view has every day.
  const summary =
    `Frequência em ${data.attendance.length} dias: ${trained} ${trained === 1 ? 'treino feito' : 'treinos feitos'}, ` +
    `${missed} ${missed === 1 ? 'perdido' : 'perdidos'}.`;
  return (
    <ChartCard
      title="Frequência"
      legend={[
        { label: 'treinou', kind: 'bar', color: colors.bone },
        { label: 'treino perdido', kind: 'bar', color: colors.amber },
        { label: 'folga', kind: 'bar', color: colors.seam },
      ]}
      table={{ headers: ['Dia', 'Situação'], rows: data.attendance.map((d) => [shortDay(d.day), status(d)]) }}
    >
      <View style={styles.calendar} accessible accessibilityLabel={summary}>
        {data.attendance.map((d) => (
          <View key={d.day}
            style={[styles.cell, d.trained ? styles.cellDone : d.planned ? styles.cellMissed : styles.cellRest]}>
            {/* Missed days also carry a mark, so the state is not color alone. */}
            {!d.trained && d.planned && <T style={styles.cellMark}>×</T>}
          </View>
        ))}
      </View>
    </ChartCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  calendar: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  cell: { width: 18, height: 18, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  cellDone: { backgroundColor: colors.bone },
  cellMissed: { borderWidth: 1, borderColor: colors.amber },
  cellRest: { backgroundColor: colors.seam },
  cellMark: { color: colors.amber, fontFamily: fonts.monoBold, fontSize: 11, lineHeight: 14 },
});
