import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { ArmorLoad, Routine, Session, StrengthEntry, Weight } from '../../api/types';
import { LiveHr } from '../../components/LiveHr';
import {
  Badge,
  Button,
  Chip,
  CountUp,
  Divider,
  FadeIn,
  Field,
  Panel,
  ProgressBar,
  Row,
  ScreenHeader,
  Section,
  T,
  Tappable,
  TextLink,
} from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { routineSummary } from '../../engine/routine';
import { BUDGET_OPTIONS, estimateMinutes, fitToBudget } from '../../engine/timeBudget';
import { addDays, cycleStructureLabel, decimal, formatKgM, isoDay, parseDecimal as num, rxSummary } from '../../engine/format';
import { PROGRAM_NAME } from '../../engine/programs';
import { syncNight, syncSteps } from '../../health';
import { refreshTrainingReminders } from '../../reminders';
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
  setTimeBudget,
  storeAthlete,
  storedAthlete,
  storeRoutine,
  timeBudget,
} from '../../storage/db';
import { flushAll, loadSession, prefetchSchedule, refreshAthlete, withPendingChecks, type Source } from '../../sync';
import { colors, fonts, levelColor, levelTextColor, space } from '../../theme';


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
  const [, setPending] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState<number | null>(() => timeBudget(today));
  const [showExercises, setShowExercises] = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState<boolean | null>(null); // null: follow the level

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
        prefetchSchedule(athleteId, today, storedAthlete()?.cycle_start ?? today).then((ok) => {
          const a = storedAthlete();
          if (a) refreshTrainingReminders(a, today).catch(() => {}); // re-planned from the fresh schedule
          return ok;
        }),
        api.armorLoad(athleteId, today).catch(() => null),
        api.weight(athleteId, 14).catch(() => null),
        refreshAthlete(athleteId),
        // Steps from the watch go up with the routine they tick; without health sync, just the routine.
        (healthSyncEnabled() ? syncSteps(athleteId, today).catch(() => null) : Promise.resolve(null))
          .then((r) => r ?? api.routine(athleteId, today).catch(() => null)),
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
        const view = withPendingChecks(routineRes); // ticks made offline and not uploaded yet
        setRoutine(view);
        storeRoutine(view);
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
      toast('Não foi possível ajustar o ciclo', e instanceof Error ? e.message : String(e));
    }
  }

  function followCalendar() {
    Storage.setItemSync(DISMISSED_KEY, today);
    setMissed([]);
  }

  // Machine programs carry nothing: a panel of zeros is noise.
  const carried = !!armor && armor.total_kg_m > 0;
  const fitted = session ? fitToBudget(session, budget) : null;
  const plan = fitted?.session ?? session;
  const exerciseCount = plan ? plan.blocks.reduce((n, b) => n + b.exercises.length, 0) : 0;
  const fullMinutes = session ? estimateMinutes(session) : 0;
  const budgets = BUDGET_OPTIONS.filter((m) => m < fullMinutes);
  const pickBudget = (m: number | null) => {
    setTimeBudget(today, m);
    setBudget(m);
  };

  const canBudget = !!session?.is_training_day && budgets.length > 0;
  const r = session?.readiness;
  const hasScore = !!r && !r.reasons.includes('sem dados de prontidão');
  // Amber / red explain themselves up front: they are why today's session is lighter.
  const readinessShown = readinessOpen ?? (hasScore && r.level !== 'green');

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
            // Sync runs on its own; only what needs the athlete's attention shows up here.
            <View style={styles.status}>
              <LiveHr />
              {rejected > 0 && <Badge label={`${rejected} recusados`} color={colors.danger} />}
              {source !== 'live' && !loading && <Badge label="Offline" color={colors.warning} />}
            </View>
          }
        />

        {error && <Panel accent={colors.warning}><T color={colors.warning}>{error}</T></Panel>}

        {missed.length > 0 && (
          <FadeIn>
            <Panel accent={colors.warning} style={{ gap: space.md }}>
              <Row style={{ gap: space.sm }}>
                <Icon name="alert" size={18} color={colors.warning} />
                <T variant="title">{missed.length === 1 ? 'Treino de ontem perdido' : `${missed.length} treinos perdidos`}</T>
              </Row>
              <T variant="hint">
                Repor faz o treino perdido hoje e empurra o ciclo {missed.length} {missed.length === 1 ? 'dia' : 'dias'}.
              </T>
              <Row>
                <Button label="Repor hoje" onPress={makeUp} style={{ flex: 1 }} />
                <Button tone="secondary" label="Seguir calendário" onPress={followCalendar} style={{ flex: 1 }} />
              </Row>
            </Panel>
          </FadeIn>
        )}

        {session && (
          <>
            <FadeIn>
              <Panel style={styles.hero}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="tag">
                    Dia {session.cycle_day} de {session.cycle_length}
                    {session.meso_week != null && session.meso_length != null
                      ? ` · semana ${session.meso_week} de ${session.meso_length}`
                      : ''}
                  </T>
                  {session.deload && <Badge label="Deload" color={colors.warning} />}
                </Row>
                <T variant="display" style={styles.dayName} numberOfLines={2}>{session.day_name}</T>
                {session.blocks.length > 0 ? (
                  <Row style={{ gap: space.lg }}>
                    <Meta icon="timer" text={`${plan?.target_duration_minutes ?? session.target_duration_minutes} min`} />
                    <Meta icon="dumbbell" text={`${exerciseCount} ${exerciseCount === 1 ? 'exercício' : 'exercícios'}`} />
                    {budget != null && <Badge label="Ajustado" color={colors.accent} />}
                  </Row>
                ) : (
                  <T variant="label">Descanso completo hoje</T>
                )}
                <CycleStrip sessions={strip} current={session.cycle_day} structure={session.cycle_structure} />
                {/* A full rest day has no session: nothing to list or start. */}
                {session.blocks.length > 0 && (
                  <>
                    <Button
                      icon="play"
                      label={session.is_training_day ? 'Começar treino' : 'Começar recuperação'}
                      onPress={() => router.push({ pathname: '/session/[day]', params: { day: today } })}
                      style={{ marginTop: space.md }}
                    />
                    <SessionOutline session={plan ?? session} open={showExercises} />
                    <Row style={{ gap: space.xl }}>
                      <TextLink label={showExercises ? 'Ocultar exercícios' : 'Ver exercícios'}
                        onPress={() => setShowExercises(!showExercises)} />
                      {canBudget && (
                        <TextLink
                          label={budget != null ? `Tempo: ${budget} min` : 'Tenho menos tempo'}
                          color={colors.textMuted}
                          onPress={() => setShowBudget(!showBudget)}
                        />
                      )}
                    </Row>
                    {canBudget && showBudget && (
                      <FadeIn style={{ gap: space.sm }}>
                        <Row style={{ flexWrap: 'wrap' }}>
                          <Chip label="Completo" selected={budget == null} onPress={() => pickBudget(null)} />
                          {budgets.map((m) => (
                            <Chip key={m} label={`${m} min`} selected={budget === m} onPress={() => pickBudget(m)}
                              accessibilityLabel={`Tenho só ${m} minutos`} />
                          ))}
                        </Row>
                        {fitted && fitted.changes.length > 0 && (
                          <T variant="hint" color={fitted.fits ? colors.textMuted : colors.warning}>
                            {fitted.fits ? 'Ajustado: ' : `Mesmo ajustado, cerca de ${fitted.minutes} min: `}
                            {fitted.changes.join(' · ')}.
                          </T>
                        )}
                      </FadeIn>
                    )}
                  </>
                )}
              </Panel>
            </FadeIn>

            <FadeIn delay={80}>
              <Row style={{ alignItems: 'stretch', gap: space.md }}>
                <Tile
                  label="Prontidão"
                  expanded={readinessShown}
                  onPress={() => setReadinessOpen(!readinessShown)}
                  accessibilityLabel={hasScore ? `Prontidão ${r.score}, ${LEVEL_LABEL[r.level]}` : 'Prontidão: sem dados hoje'}
                >
                  {hasScore ? (
                    <CountUp value={r.score} color={levelTextColor[r.level]} />
                  ) : (
                    <T variant="metric" color={colors.textFaint}>—</T>
                  )}
                  <T variant="label" numberOfLines={1}>{hasScore ? LEVEL_SHORT[r.level] : 'Registrar dados'}</T>
                  <ProgressBar value={hasScore ? r.score / 100 : 0} color={hasScore ? levelColor[r.level] : colors.textFaint} />
                </Tile>
                {routine && <RoutineTile routine={routine} onPress={() => router.navigate('/routine')} />}
              </Row>
            </FadeIn>

            {readinessShown && (
              <FadeIn>
                <ReadinessPanel session={session} athleteId={athlete.id} day={today} onUpdated={refresh}
                  offline={source !== 'live'} />
              </FadeIn>
            )}

            {session.notices.map((n) => (
              <Panel key={n} accent={colors.warning}><T color={colors.warning}>{n}</T></Panel>
            ))}

            {/* Sunday and Monday: the week just closed is worth a look before the next one starts. */}
            {[0, 1].includes(new Date().getDay()) && (
              <FadeIn delay={120}>
                <Tappable onPress={() => router.navigate('/progress')} accessibilityLabel="Abrir a revisão da semana">
                  <Panel style={{ gap: space.xs }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Row style={{ gap: space.sm }}>
                        <Icon name="chart" size={18} color={colors.accent} />
                        <T variant="title">Revisão da semana</T>
                      </Row>
                      <Icon name="chevron-right" size={18} color={colors.textFaint} />
                    </Row>
                    <T variant="hint">Treinos, sono, força e peso dos últimos 7 dias, e o que ajustar.</T>
                  </Panel>
                </Tappable>
              </FadeIn>
            )}
          </>
        )}

        <FadeIn delay={160}>
          <WeightPanel athleteId={athlete.id} day={today} weight={weight} onSaved={setWeight} />
        </FadeIn>

        {(carried || strength.length > 0) && (
          <FadeIn delay={200}>
            <Section title="Indicadores">
              {strength.length > 0 && <StrengthPanel entries={strength} />}
              {armor && carried && <ArmorPanel armor={armor} />}
            </Section>
          </FadeIn>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** A small icon + text pair for the hero's facts. */
function Meta({ icon, text }: { icon: IconName; text: string }) {
  return (
    <Row style={{ gap: 6 }}>
      <Icon name={icon} size={16} color={colors.textMuted} />
      <T variant="label">{text}</T>
    </Row>
  );
}

/** Half-width summary card: caption and chevron on top, a big value, a line, a bar. */
function Tile({
  label,
  children,
  onPress,
  expanded,
  accessibilityLabel,
}: {
  label: string;
  children: ReactNode;
  onPress: () => void;
  expanded?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Tappable onPress={onPress} style={{ flex: 1 }} accessibilityLabel={accessibilityLabel}
      accessibilityState={expanded == null ? undefined : { expanded }}>
      <Panel style={{ flex: 1, gap: space.xs }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="tag">{label}</T>
          <Icon name={expanded == null ? 'chevron-right' : expanded ? 'chevron-down' : 'chevron-right'} size={16}
            color={colors.textFaint} />
        </Row>
        {children}
      </Panel>
    </Tappable>
  );
}

/** The session's blocks, one numbered line each; `open` lists their exercises too. */
function SessionOutline({ session, open }: { session: Session; open: boolean }) {
  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      {session.blocks.map((b, i) => (
        <View key={b.order} style={{ gap: 2 }}>
          <Row>
            <T variant="label" color={colors.textFaint} style={styles.blockNo}>{String(i + 1).padStart(2, '0')}</T>
            <T style={{ flex: 1 }} numberOfLines={1}>{b.name}</T>
            <T variant="label">{b.duration_minutes} min</T>
          </Row>
          {open && (
            <FadeIn style={{ paddingLeft: 30, gap: 2 }}>
              {b.exercises.map((e, j) => (
                <T key={j} variant="hint" numberOfLines={1}>{e.name} · {rxSummary(e)}</T>
              ))}
            </FadeIn>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * The cycle as a row of marks: filled for training, a ring for active recovery, a small dot for full
 * rest. Past days fade; today is the accent.
 */
function CycleStrip({ sessions, current, structure }: { sessions: (Session | null)[]; current: number; structure: string }) {
  // One summary for screen readers instead of a stop per mark.
  const rest = sessions.flatMap((s, i) => (s && !s.is_training_day && s.blocks.length === 0 ? [i + 1] : []));
  const recovery = sessions.flatMap((s, i) => (s && !s.is_training_day && s.blocks.length > 0 ? [i + 1] : []));
  const summary =
    `${cycleStructureLabel(structure)}. Ciclo de ${sessions.length} dias, hoje é o dia ${current}.` +
    (recovery.length ? ` Recuperação ativa ${recovery.length === 1 ? 'no dia' : 'nos dias'} ${recovery.join(', ')}.` : '') +
    (rest.length ? ` Folga ${rest.length === 1 ? 'no dia' : 'nos dias'} ${rest.join(', ')}.` : '');
  return (
    <View style={styles.strip} accessible accessibilityLabel={summary}>
      {sessions.map((s, i) => {
        const day = i + 1;
        const training = s?.is_training_day ?? true;
        const recoveryDay = !training && !!s && s.blocks.length > 0;
        const isCurrent = day === current;
        const tone = isCurrent ? colors.accent : colors.textMuted;
        return (
          <View key={i} style={[styles.cell, day < current && { opacity: 0.35 }]}>
            <View style={styles.markBox}>
              <View
                style={[
                  training ? styles.markTraining : recoveryDay ? styles.markRecovery : styles.markRest,
                  training || !recoveryDay ? { backgroundColor: tone } : { borderColor: tone },
                ]}
              />
            </View>
            <T variant="label" style={{ fontSize: 11 }} color={isCurrent ? colors.text : colors.textFaint}>{day}</T>
          </View>
        );
      })}
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
  const hasScore = !!r && !r.reasons.includes('sem dados de prontidão');
  const [hrv, setHrv] = useState('');
  const [sleep, setSleep] = useState('');
  const [soreness, setSoreness] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Nothing to explain without a score: go straight to the form.
  const [editing, setEditing] = useState(!hasScore);

  async function submit() {
    const [hrvMs, sleepH] = [num(hrv), num(sleep)];
    if (sleepH != null && (sleepH < 0 || sleepH > 24)) return setErr('Sono: de 0 a 24 h.');
    setBusy(true);
    setErr(null);
    try {
      await api.putReadiness(athleteId, {
        day,
        // Only fields filled in: an empty field must not overwrite what Apple Health / Health
        // Connect sent, and the method goes with a typed HRV only (manual apps report RMSSD).
        ...(hrvMs != null ? { hrv_ms: hrvMs, hrv_method: 'rmssd' as const } : {}),
        ...(sleepH != null ? { sleep_hours: sleepH } : {}),
        ...(soreness != null ? { soreness } : {}),
        source: 'manual',
      });
      setHrv('');
      setSleep('');
      setSoreness(null);
      setEditing(false);
      await onUpdated();
    } catch {
      setErr('Não foi possível atualizar: confira os valores e a conexão.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel style={{ gap: space.md }}>
      {hasScore && (
        <View style={{ gap: space.xs }}>
          <T variant="title">{LEVEL_LABEL[r.level]}</T>
          {r.reasons.map((x) => (
            <Row key={x} style={{ alignItems: 'flex-start' }}>
              <View style={[styles.bullet, { backgroundColor: levelColor[r.level] }]} />
              <T variant="hint" style={{ flex: 1 }}>{x}</T>
            </Row>
          ))}
          {r.mobility_expanded && <T variant="hint" color={colors.warning}>Bloco 1 expandido para mobilidade.</T>}
        </View>
      )}
      {editing ? (
        <>
          {!hasScore && <T variant="title">Como você acordou?</T>}
          <Row style={{ alignItems: 'flex-end' }}>
            <Field label="Sono (h)" value={sleep} onChangeText={setSleep} keyboardType="decimal-pad" placeholder="7,5" />
            <Field label="VFC ao acordar (ms)" value={hrv} onChangeText={setHrv} keyboardType="decimal-pad" placeholder="—" />
          </Row>
          <View style={{ gap: space.xs }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="label">Dor muscular</T>
              <T variant="label" color={colors.textFaint}>1 nenhuma · 5 muita</T>
            </Row>
            <Row style={{ gap: space.xs }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Chip key={n} label={String(n)} selected={soreness === n} style={{ flex: 1, paddingHorizontal: 0 }}
                  accessibilityLabel={`Dor ${n} de 5`} onPress={() => setSoreness(soreness === n ? null : n)} />
              ))}
            </Row>
          </View>
          <Row>
            {hasScore && <Button tone="secondary" label="Cancelar" onPress={() => setEditing(false)} style={{ flex: 1 }} />}
            <Button
              tone="secondary"
              label={offline ? 'Requer conexão' : busy ? 'Calculando…' : 'Salvar'}
              onPress={submit}
              disabled={offline || busy || !(hrv || sleep || soreness != null)}
              style={{ flex: 1 }}
            />
          </Row>
        </>
      ) : (
        <TextLink label="Registrar sono, VFC e dor" onPress={() => setEditing(true)} />
      )}
      {err && <T color={colors.warning}>{err}</T>}
    </Panel>
  );
}

const LEVEL_LABEL = { green: 'Verde: treino completo', amber: 'Amarelo: esforço reduzido', red: 'Vermelho: sessão aliviada' } as const;
const LEVEL_SHORT = { green: 'Treino completo', amber: 'Esforço reduzido', red: 'Sessão aliviada' } as const;

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

/** The day's routine at a glance; the tile opens the Rotina tab. */
function RoutineTile({ routine, onPress }: { routine: Routine; onPress: () => void }) {
  const next = routine.items.find((i) => !i.done);
  const color = routine.complete ? colors.success : colors.accent;
  return (
    <Tile label="Rotina" onPress={onPress}
      accessibilityLabel={`Rotina: ${routine.done} de ${routine.total} hábitos. ${routineSummary(routine).headline}`}>
      <Row style={{ alignItems: 'baseline', gap: 2 }}>
        <CountUp value={routine.done} color={routine.complete ? colors.success : undefined} />
        <T variant="label">/{routine.total}</T>
        {routine.streak > 0 && (
          <T variant="label" color={colors.success} style={{ marginLeft: 'auto' }}>{routine.streak}d seguidos</T>
        )}
      </Row>
      <T variant="label" numberOfLines={1}>{routine.complete ? 'Rotina completa' : next ? next.title : routineSummary(routine).headline}</T>
      <ProgressBar value={routine.total ? routine.done / routine.total : 0} color={color} />
    </Tile>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  status: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.xs, maxWidth: '55%' },
  hero: { gap: space.sm, padding: space.xl },
  dayName: { fontSize: 44, lineHeight: 46, marginTop: space.xs },
  blockNo: { width: 22, fontFamily: fonts.mono, fontSize: 12 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.md },
  cell: { alignItems: 'center', gap: 6, flex: 1 },
  markBox: { height: 14, justifyContent: 'center', alignItems: 'center' },
  markTraining: { width: 14, height: 14, borderRadius: 7 },
  markRecovery: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  markRest: { width: 6, height: 6, borderRadius: 3 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
});
