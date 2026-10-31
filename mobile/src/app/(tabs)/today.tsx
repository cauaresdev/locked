import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { ArmorLoad, Routine, Session, StrengthEntry, Weight } from '../../api/types';
import { LiveHr } from '../../components/LiveHr';
import { Badge, Button, Divider, Dots, Field, Panel, Row, ScreenHeader, Section, T, TextLink } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { routineSummary } from '../../engine/routine';
import { addDays, cycleStructureLabel, decimal, formatKgM, isoDay, parseDecimal as num, rxSummary } from '../../engine/format';
import { PROGRAM_NAME } from '../../engine/programs';
import { syncNight } from '../../health';
import {
  cachedRange,
  cachedRoutine,
  cachedSession,
  clearSessionCache,
  healthSyncEnabled,
  loadProgress,
  pendingCount,
  pendingTotal,
  rejectedCount,
  storeAthlete,
  storedAthlete,
  storeRoutine,
} from '../../storage/db';
import { flushAll, loadSession, prefetchSchedule, refreshAthlete, type Source } from '../../sync';
import { colors, levelColor, levelTextColor, space } from '../../theme';


// Re-fetching on every tab switch made the app feel slow; within this window the screen
// only refreshes local state (queue counts). Pull-to-refresh always goes to the server.
const STALE_MS = 60_000;
const DISMISSED_KEY = 'knightfall_missed_dismissed'; // day the athlete chose to follow the calendar

export default function Today() {
  const router = useRouter();
  const athlete = storedAthlete();
  const athleteId = athlete?.id;
  const today = isoDay();
  const [session, setSession] = useState<Session | null>(null);
  const [source, setSource] = useState<Source>('cache');
  const [strip, setStrip] = useState<(Session | null)[]>([]);
  const [armor, setArmor] = useState<ArmorLoad | null>(null);
  const [strength, setStrength] = useState<StrengthEntry[]>([]);
  const [missed, setMissed] = useState<string[]>([]);
  const [weight, setWeight] = useState<Weight | null>(null);
  const [routine, setRoutine] = useState<Routine | null>(() => cachedRoutine(today));
  const [pending, setPending] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchedAt = useRef(0);
  const run = useRef(0); // only the latest network load may write state
  const shown = useRef(false);

  const showSession = useCallback(async (s: Session, src: Source) => {
    shown.current = true;
    setSession(s);
    setSource(src);
    const first = addDays(today, -(s.cycle_day - 1));
    const days = Array.from({ length: s.cycle_length }, (_, i) => addDays(first, i));
    const cached = await cachedRange(days);
    setStrip(days.map((d) => cached[d] ?? null));
  }, [today]);

  const refreshCounts = useCallback(async () => {
    const [p, r] = await Promise.all([pendingCount(), rejectedCount()]);
    setPending(p);
    setRejected(r);
  }, []);

  const load = useCallback(async (force = false) => {
    if (!athleteId) return;
    // Instant: what the device already has. The screen never waits on the network to appear.
    const [cached] = await Promise.all([cachedSession(today), refreshCounts()]);
    if (cached && !shown.current) await showSession(cached, 'cache');
    if (!force && Date.now() - fetchedAt.current < STALE_MS) return;
    fetchedAt.current = Date.now();
    const id = ++run.current;
    const live = () => id === run.current;
    setLoading(true);
    setError(null);
    try {
      const fetchSession = () => loadSession(athleteId, today).catch(() => null);
      // Everything that does not depend on uploads goes out at once.
      const others = Promise.all([
        prefetchSchedule(athleteId, today, storedAthlete()?.cycle_start ?? today),
        api.armorLoad(athleteId, today).catch(() => null),
        api.weight(athleteId, 14).catch(() => null),
        refreshAthlete(athleteId),
        api.routine(athleteId, today).catch(() => null),
      ]);
      // Queued sets (e1RM, missed days) and last night's HRV/sleep change today's session:
      // upload them first only when there is something to upload.
      const hasQueue = (await pendingTotal()) > 0;
      const health = healthSyncEnabled() ? syncNight(athleteId, today).catch(() => null) : null;
      let res = hasQueue || health ? null : await fetchSession();
      await Promise.all([hasQueue ? flushAll(athleteId).catch(() => {}) : null, health]);
      res ??= await fetchSession();
      const [strengthRes, missedRes, todayProgress] = await Promise.all([
        api.strength(athleteId).catch(() => null),
        api.missed(athleteId, today).catch(() => null),
        loadProgress(today),
      ]);
      const [, armorRes, weightRes, , routineRes] = await others;
      if (!live()) return;
      if (res) await showSession(res.session, res.source);
      else if (!cached) setError('Sem conexão e sem sessão em cache para hoje.');
      if (armorRes) setArmor(armorRes);
      if (strengthRes) setStrength(strengthRes);
      if (weightRes) setWeight(weightRes);
      if (routineRes) {
        setRoutine(routineRes);
        storeRoutine(routineRes);
      }
      // Offer a make-up only before today's session has started, and not after "Seguir o calendário".
      const dismissed = Storage.getItemSync(DISMISSED_KEY) === today;
      setMissed(todayProgress.startedAt == null && !dismissed ? (missedRes?.missed ?? []) : []);
      await refreshCounts();
    } finally {
      if (live()) setLoading(false);
    }
  }, [athleteId, today, showSession, refreshCounts]);

  const refresh = useCallback(() => load(true), [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!athlete) return <Redirect href="/onboarding" />;

  async function makeUp() {
    if (!athleteId || missed.length === 0) return;
    const days = missed.length;
    setMissed([]); // the panel goes away at once: a second tap can't shift the cycle twice
    try {
      storeAthlete(await api.shiftCycle(athleteId, days));
      await clearSessionCache(); // every cached date now maps to a different session
      await load(true);
    } catch (e) {
      setMissed(missed);
      Alert.alert('Não foi possível ajustar o ciclo', e instanceof Error ? e.message : String(e));
    }
  }

  function followCalendar() {
    Storage.setItemSync(DISMISSED_KEY, today);
    setMissed([]);
  }

  // Machine programs carry nothing: a panel of zeros is noise.
  const carried = !!armor && armor.total_kg_m > 0;
  const exerciseCount = session ? session.blocks.reduce((n, b) => n + b.exercises.length, 0) : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.textMuted} />}
      >
        <ScreenHeader
          overline={`${PROGRAM_NAME[athlete.tier]} · ${athlete.name}`}
          title="Hoje"
          right={
            <View style={styles.status}>
              <LiveHr />
              {pending > 0 && <Badge label={`${pending} na fila`} color={colors.warning} />}
              {rejected > 0 && <Badge label={`${rejected} recusados`} color={colors.danger} />}
              {source !== 'live' && (
                <Badge label={loading ? 'Atualizando…' : 'Sem conexão'} color={loading ? colors.textMuted : colors.warning} />
              )}
            </View>
          }
        />

        {error && <Panel accent={colors.warning}><T color={colors.warning}>{error}</T></Panel>}

        {missed.length > 0 && (
          <Panel accent={colors.warning} style={{ gap: space.md }}>
            <T variant="title">Treino perdido</T>
            <T>
              {missed.length === 1
                ? 'O treino de ontem ficou sem nenhuma série registrada.'
                : `Os últimos ${missed.length} dias de treino ficaram sem nenhuma série registrada.`}
            </T>
            <T variant="hint">
              Repor empurra o ciclo {missed.length} {missed.length === 1 ? 'dia' : 'dias'}: hoje você faz o treino
              perdido e o resto da programação anda junto. O que já foi registrado não muda.
            </T>
            <Row>
              <Button label="Repor hoje" onPress={makeUp} style={{ flex: 1 }} />
              <Button tone="secondary" label="Seguir calendário" onPress={followCalendar} style={{ flex: 1 }} />
            </Row>
          </Panel>
        )}

        {session && (
          <>
            <Panel style={styles.hero}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="label">
                  Dia {session.cycle_day} de {session.cycle_length} · ciclo {session.cycle_index + 1}
                </T>
                {session.deload && <Badge label="Deload" color={colors.warning} />}
              </Row>
              <T variant="display" style={{ fontSize: 26, lineHeight: 32 }}>{session.day_name}</T>
              <T variant="label">
                {session.blocks.length > 0
                  ? `${session.target_duration_minutes} min · ${exerciseCount} ${exerciseCount === 1 ? 'exercício' : 'exercícios'}`
                  : 'Sem sessão hoje'}
              </T>
              <CycleStrip sessions={strip} current={session.cycle_day} structure={session.cycle_structure} />
              {/* A full rest day has no session: nothing to list or start. */}
              {session.blocks.length > 0 && (
                <>
                  <Button
                    icon="play"
                    label={session.is_training_day ? 'Começar treino' : 'Começar recuperação'}
                    onPress={() => router.push({ pathname: '/session/[day]', params: { day: today } })}
                    style={{ marginTop: space.sm }}
                  />
                  <SessionOutline session={session} />
                </>
              )}
            </Panel>

            {routine && <RoutineCard routine={routine} onPress={() => router.navigate('/routine')} />}

            {session.notices.map((n) => (
              <Panel key={n} accent={colors.warning}><T color={colors.warning}>{n}</T></Panel>
            ))}

            <ReadinessPanel session={session} athleteId={athlete.id} day={today} onUpdated={refresh} offline={source !== 'live'} />
          </>
        )}

        <WeightPanel athleteId={athlete.id} day={today} weight={weight} onSaved={setWeight} />

        {(carried || strength.length > 0) && (
          <Section title="Indicadores">
            {strength.length > 0 && <StrengthPanel entries={strength} />}
            {armor && carried && <ArmorPanel armor={armor} />}
          </Section>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The session's blocks, collapsed to one line each until opened. */
function SessionOutline({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.sm, marginTop: space.xs }}>
      {session.blocks.map((b) => (
        <View key={b.order} style={{ gap: 2 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T style={{ flex: 1 }} numberOfLines={1}>{b.name}</T>
            <T variant="label">{b.duration_minutes} min</T>
          </Row>
          {open && b.exercises.map((e, i) => (
            <T key={i} variant="hint" numberOfLines={1}>{e.name} · {rxSummary(e)}</T>
          ))}
        </View>
      ))}
      <TextLink label={open ? 'Ocultar exercícios' : 'Ver exercícios'} onPress={() => setOpen(!open)} />
    </View>
  );
}

function CycleStrip({ sessions, current, structure }: { sessions: (Session | null)[]; current: number; structure: string }) {
  // One summary for screen readers instead of a stop per dot.
  const off = sessions.flatMap((s, i) => (s && !s.is_training_day ? [i + 1] : []));
  const summary =
    `Ciclo de ${sessions.length} dias, hoje é o dia ${current}.` +
    (off.length ? ` Folga ${off.length === 1 ? 'no dia' : 'nos dias'} ${off.join(', ')}.` : '');
  return (
    <View style={{ gap: space.xs, marginTop: space.sm }} accessible accessibilityLabel={summary}>
      <View style={styles.strip}>
        {sessions.map((s, i) => {
          const day = i + 1;
          const training = s?.is_training_day ?? true;
          const isCurrent = day === current;
          return (
            <View key={i} style={styles.cell}>
              <View
                style={[
                  styles.dot,
                  training ? styles.dotTraining : styles.dotOff,
                  day < current && { opacity: 0.35 },
                  isCurrent && styles.dotCurrent,
                ]}
              />
              <T variant="label" style={{ fontSize: 11 }} color={isCurrent ? colors.text : colors.textFaint}>
                {/* Off days: active recovery has a session to run, a full rest day has none. */}
                {training ? day : s && s.blocks.length > 0 ? 'R' : '–'}
              </T>
            </View>
          );
        })}
      </View>
      <T variant="label" style={{ fontSize: 12 }} color={colors.textFaint}>
        {cycleStructureLabel(structure)} · R = recuperação ativa, – = folga
      </T>
    </View>
  );
}

function ReadinessPanel({
  session,
  athleteId,
  day,
  onUpdated,
  offline,
}: {
  session: Session;
  athleteId: string;
  day: string;
  onUpdated: () => Promise<void>;
  offline: boolean;
}) {
  const r = session.readiness;
  const [hrv, setHrv] = useState('');
  const [sleep, setSleep] = useState('');
  const [soreness, setSoreness] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function submit() {
    const [hrvMs, sleepH, sore] = [num(hrv), num(sleep), num(soreness)];
    if (sore != null && (sore < 1 || sore > 5 || !Number.isInteger(sore))) return setErr('Dor: de 1 a 5.');
    if (sleepH != null && (sleepH < 0 || sleepH > 24)) return setErr('Sono: de 0 a 24 h.');
    setBusy(true);
    setErr(null);
    try {
      await api.putReadiness(athleteId, {
        day,
        // Only fields typed in: an empty field must not overwrite what Apple Health / Health
        // Connect sent, and the method goes with a typed HRV only (manual apps report RMSSD).
        ...(hrvMs != null ? { hrv_ms: hrvMs, hrv_method: 'rmssd' as const } : {}),
        ...(sleepH != null ? { sleep_hours: sleepH } : {}),
        ...(sore != null ? { soreness: sore } : {}),
        source: 'manual',
      });
      setHrv('');
      setSleep('');
      setSoreness('');
      setEditing(false);
      await onUpdated();
    } catch {
      setErr('Não foi possível atualizar: confira os valores e a conexão.');
    } finally {
      setBusy(false);
    }
  }

  const hasScore = r && !r.reasons.includes('sem dados de prontidão');
  return (
    <Panel style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="title">Prontidão</T>
          <T variant="label">
            {hasScore ? LEVEL_LABEL[r.level] : 'Sem dados hoje: registre VFC, sono ou dor'}
          </T>
        </View>
        {hasScore && <T variant="metric" color={levelTextColor[r.level]}>{r.score}</T>}
      </Row>
      {hasScore && (
        <View style={styles.levelTrack}>
          <View style={[styles.levelFill, { width: `${r.score}%`, backgroundColor: levelColor[r.level] }]} />
        </View>
      )}
      {hasScore && r.reasons.map((x) => <T key={x} variant="hint">· {x}</T>)}
      {hasScore && r.mobility_expanded && <T color={colors.warning}>Bloco 1 expandido para mobilidade.</T>}
      {editing ? (
        <>
          <Row style={{ alignItems: 'flex-end' }}>
            <Field label="VFC (ms)" value={hrv} onChangeText={setHrv} keyboardType="decimal-pad" />
            <Field label="Sono (h)" value={sleep} onChangeText={setSleep} keyboardType="decimal-pad" />
            <Field label="Dor 1–5" value={soreness} onChangeText={setSoreness} keyboardType="number-pad" />
          </Row>
          <T variant="hint">
            VFC: variabilidade da frequência cardíaca, medida ao acordar, em milissegundos. Dor muscular: 1 = nenhuma,
            5 = muita.
          </T>
          <Row>
            <Button tone="secondary" label="Cancelar" onPress={() => setEditing(false)} style={{ flex: 1 }} />
            <Button
              tone="secondary"
              label={offline ? 'Requer conexão' : busy ? 'Calculando…' : 'Atualizar'}
              onPress={submit}
              disabled={offline || busy || !(hrv || sleep || soreness)}
              style={{ flex: 1 }}
            />
          </Row>
        </>
      ) : (
        <TextLink label="Registrar VFC, sono e dor" onPress={() => setEditing(true)} />
      )}
      {err && <T color={colors.warning}>{err}</T>}
    </Panel>
  );
}

const LEVEL_LABEL = { green: 'Verde: treino completo', amber: 'Amarelo: esforço reduzido', red: 'Vermelho: sessão aliviada' } as const;

function WeightPanel({
  athleteId,
  day,
  weight,
  onSaved,
}: {
  athleteId: string;
  day: string;
  weight: Weight | null;
  onSaved: (w: Weight) => void;
}) {
  const [kg, setKg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const entries = weight?.entries ?? [];
  const weekAgo = entries.find((e) => e.day >= addDays(day, -7));
  const change = weight?.trend_kg != null && weekAgo ? weight.trend_kg - weekAgo.trend_kg : null;
  const loggedToday = entries.some((e) => e.day === day);

  async function save() {
    const value = num(kg);
    if (value == null) return;
    setBusy(true);
    setErr(null);
    try {
      onSaved(await api.putWeight(athleteId, { day, weight_kg: value, source: 'manual' }));
      setKg('');
    } catch {
      setErr('Sem conexão: tente de novo com sinal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="title">Peso</T>
          <T variant="label">
            {weight?.trend_kg != null
              ? `Média de 7 dias${change != null && Math.abs(change) >= 0.1 ? ` · ${change > 0 ? '+' : ''}${decimal(change)} kg na semana` : ''}`
              : 'Pese-se ao acordar: a média de 7 dias define calorias, proteína e cargas.'}
          </T>
        </View>
        {weight?.trend_kg != null && (
          <Row style={{ alignItems: 'baseline', gap: space.xs }}>
            <T variant="metric">{decimal(weight.trend_kg)}</T>
            <T variant="label">kg</T>
          </Row>
        )}
      </Row>
      <Row style={{ alignItems: 'flex-end' }}>
        <Field label={loggedToday ? 'Corrigir peso de hoje (kg)' : 'Peso de hoje (kg)'} value={kg} onChangeText={setKg}
          keyboardType="decimal-pad" />
        <Button tone="secondary" label={busy ? '…' : 'Salvar'} onPress={save} disabled={busy || num(kg) == null} />
      </Row>
      {err && <T color={colors.warning}>{err}</T>}
    </Panel>
  );
}

function ArmorPanel({ armor }: { armor: ArmorLoad }) {
  const delta = armor.current_cycle_kg_m - armor.previous_cycle_kg_m;
  const kind = (k: string) => armor.by_kind[k] ?? 0;
  return (
    <Panel style={{ gap: space.md }}>
      <View style={{ gap: 2 }}>
        <T variant="title">Capacidade de carga</T>
        <T variant="label">Quilos × metros carregados (kg·m)</T>
      </View>
      <Row style={{ alignItems: 'baseline', gap: space.xs }}>
        <T variant="metric">{formatKgM(armor.total_kg_m)}</T>
        <T variant="label">kg·m no total</T>
      </Row>
      <T variant="label" color={delta > 0 ? colors.success : colors.textMuted}>
        Ciclo atual {formatKgM(armor.current_cycle_kg_m)} ({delta >= 0 ? '+' : ''}{formatKgM(delta)} vs. anterior)
      </T>
      <Divider />
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <T variant="hint">Carregamentos {formatKgM(kind('carry'))}</T>
        <T variant="hint">Trenó {formatKgM(kind('sled'))}</T>
        <T variant="hint">Barra com lastro {formatKgM(kind('weighted_pull'))}</T>
      </Row>
    </Panel>
  );
}

function StrengthPanel({ entries }: { entries: StrengthEntry[] }) {
  const top = [...entries].sort((a, b) => b.e1rm_kg - a.e1rm_kg).slice(0, 6);
  return (
    <Panel style={{ gap: space.md }}>
      <View style={{ gap: 2 }}>
        <T variant="title">Força estimada</T>
        <T variant="label">1RM: carga máxima para 1 repetição</T>
      </View>
      {top.map((e) => {
        const prev = e.history.length > 1 ? e.history[e.history.length - 2][1] : null;
        const delta = prev != null ? e.e1rm_kg - prev : 0;
        return (
          <Row key={e.exercise_id} style={{ justifyContent: 'space-between' }}>
            <T numberOfLines={1} style={{ flex: 1 }}>{e.name}</T>
            <T variant="label" color={delta > 0 ? colors.success : colors.textMuted}>
              {decimal(e.e1rm_kg)} kg{delta ? ` (${delta > 0 ? '+' : ''}${decimal(delta)})` : ''}
            </T>
          </Row>
        );
      })}
    </Panel>
  );
}

/** The day's routine at a glance; the whole card opens the Rotina tab. */
function RoutineCard({ routine, onPress }: { routine: Routine; onPress: () => void }) {
  const next = routine.items.find((i) => !i.done);
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`Rotina: ${routine.done} de ${routine.total} hábitos. ${routineSummary(routine).headline}`}>
      <Panel accent={routine.complete ? colors.success : undefined} style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="title">Rotina</T>
          <Row style={{ gap: space.sm }}>
            {routine.streak > 0 && <Badge label={`${routine.streak} ${routine.streak === 1 ? 'dia' : 'dias'}`} color={colors.success} />}
            <Icon name="chevron-right" size={18} color={colors.textMuted} />
          </Row>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Dots done={routine.done} total={routine.total} color={routine.complete ? colors.success : colors.accent} />
          <T variant="label">{routine.done}/{routine.total}</T>
        </Row>
        <T variant="label">{next ? `Próximo: ${next.title}` : routineSummary(routine).headline}</T>
      </Panel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  status: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.xs, maxWidth: '55%' },
  hero: { gap: space.sm, padding: space.xl },
  strip: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: { alignItems: 'center', gap: 6, flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotTraining: { backgroundColor: colors.textMuted },
  dotOff: { borderWidth: 1.5, borderColor: colors.textFaint },
  dotCurrent: { backgroundColor: colors.accent, borderColor: colors.accent, transform: [{ scale: 1.35 }], opacity: 1 },
  levelTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  levelFill: { height: 6, borderRadius: 3 },
});
