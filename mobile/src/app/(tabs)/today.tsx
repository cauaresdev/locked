import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { ArmorLoad, Block, Routine, Session, StrengthEntry, Weight } from '../../api/types';
import { ExerciseThumb, sessionCover } from '../../components/ExerciseDemo';
import { ON_PHOTO, ON_PHOTO_MUTED, PhotoCover } from '../../components/PhotoCover';
import { LiveHr } from '../../components/LiveHr';
import { adherence, weekGoal, weekOf, type AttendanceDay } from '../../engine/attendance';
import { statsOf, updateAttendance } from '../../engine/attendanceStore';
import { useToday } from '../../hooks/useToday';
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
  Section,
  T,
  Tappable,
  TextLink,
} from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { routineSummary } from '../../engine/routine';
import { BUDGET_OPTIONS, estimateMinutes, fitToBudget } from '../../engine/timeBudget';
import { addDays, cycleStructureLabel, decimal, formatKgM, greeting, longDate, parseDecimal as num, rxSummary } from '../../engine/format';
import { applySwaps, blockComplete, emptyProgress, itemKey, type Progress } from '../../engine/progress';
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
  pendingTotal,
  rejectedCount,
  sessionCacheEpoch,
  setTimeBudget,
  storeAthlete,
  storedAthlete,
  storedAttendance,
  storeRoutine,
  timeBudget,
} from '../../storage/db';
import { flushAll, loadSession, prefetchSchedule, refreshAthlete, withPendingChecks, type Source } from '../../sync';
import { colors, levelColor, levelTextColor, radius, space, themed } from '../../theme';


// Re-fetching on every tab switch made the app feel slow; within this window the screen
// only refreshes local state (queue counts). Pull-to-refresh always goes to the server.
const STALE_MS = 60_000;
let remindersPlanned: string | null = null; // day + program the training reminders were last planned for
const DISMISSED_KEY = 'knightfall_missed_dismissed'; // day the athlete chose to follow the calendar

export default function Today() {
  const router = useRouter();
  const athlete = storedAthlete();
  const athleteId = athlete?.id;
  // Derived before the callbacks: the compiler treats a call on `athlete` after them as a possible mutation.
  const hello = firstName(athlete?.name ?? '');
  const avatar = initial(athlete?.name ?? '');
  const today = useToday();
  const [session, setSession] = useState<Session | null>(null);
  const [source, setSource] = useState<Source>('cache');
  const [strip, setStrip] = useState<(Session | null)[]>([]);
  const [armor, setArmor] = useState<ArmorLoad | null>(null);
  const [strength, setStrength] = useState<StrengthEntry[]>([]);
  const [missed, setMissed] = useState<string[]>([]);
  const [weight, setWeight] = useState<Weight | null>(null);
  const [routine, setRoutine] = useState<Routine | null>(() => cachedRoutine(today));
  const [rejected, setRejected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState<number | null>(() => timeBudget(today));
  const [dayProgress, setDayProgress] = useState<Progress>(emptyProgress);
  const [attendance, setAttendance] = useState(() => storedAttendance());
  const [weekPlan, setWeekPlan] = useState<Set<string>>(new Set());
  const [showBudget, setShowBudget] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState<boolean | null>(null); // null: follow the level

  const scrollY = useState(() => new Animated.Value(0))[0];
  const fetchedAt = useRef(0);
  const run = useRef(0); // only the latest network load may write state
  const shown = useRef(false);
  const epoch = useRef(sessionCacheEpoch());

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
    setRejected(await rejectedCount());
  }, []);

  // A new day (morning after, app left open on Hoje): start over from that day's cache and fetch it now.
  // The refs reset in an effect declared before the focus effect, so the new day's load sees them cleared.
  useEffect(() => {
    shown.current = false;
    fetchedAt.current = 0;
  }, [today]);
  const [shownDay, setShownDay] = useState(today);
  if (shownDay !== today) {
    setShownDay(today);
    setSession(null);
    setStrip([]);
    setRoutine(cachedRoutine(today));
    setBudget(timeBudget(today));
    setShowBudget(false);
  }

  const load = useCallback(async (force = false) => {
    if (!athleteId) return;
    // Program, equipment or cycle changed elsewhere: the session in memory and in the cache is stale.
    if (epoch.current !== sessionCacheEpoch()) {
      epoch.current = sessionCacheEpoch();
      shown.current = false;
      force = true;
    }
    // Instant: what the device already has. The screen never waits on the network to appear.
    const [cached] = await Promise.all([cachedSession(today), refreshCounts()]);
    setDayProgress(await loadProgress(today)); // ticks made in the session screen show on the plan at once
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
          // Re-planned from the fresh schedule once per day and program change, not on every visit:
          // it cancels and re-creates up to 14 OS notifications.
          const plan = `${today}:${sessionCacheEpoch()}:${a?.tier}:${a?.training_time}`;
          if (a && ok && plan !== remindersPlanned) {
            remindersPlanned = plan;
            refreshTrainingReminders(a, today).catch(() => (remindersPlanned = null));
          }
          return ok;
        }),
        api.armorLoad(athleteId, today).catch(() => null),
        api.progress(athleteId, 90).catch(() => null), // training calendar and records, for attendance
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
      const [, armorRes, report, weightRes, , routineRes] = await others;
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
      const week = weekOf(today);
      const weekSessions = await cachedRange(week);
      setWeekPlan(new Set(week.filter((d) => weekSessions[d]?.is_training_day)));
      setAttendance(updateAttendance(report, today, todayProgress.finishedAt != null));
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
  const cover = plan ? sessionCover(plan) : null;
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
      <Animated.ScrollView
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.textMuted} />}
      >
        <Row style={styles.header}>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="tag">{longDate(today)}</T>
            <T variant="display" accessibilityRole="header">{greeting(new Date().getHours())}, {hello}.</T>
            <T variant="hint">
              {PROGRAM_NAME[athlete.tier]}
              {session ? (session.is_training_day ? ' · dia de treino' : ' · dia de recuperação') : ''}
            </T>
          </View>
          {/* Sync runs on its own; only what needs the athlete's attention shows up here. */}
          <View style={styles.status}>
            <LiveHr />
            {rejected > 0 && <Badge label={`${rejected} recusados`} color={colors.danger} />}
            {source !== 'live' && !loading && <Badge label="Offline" color={colors.warning} />}
          </View>
          <Tappable onPress={() => router.navigate('/settings')} accessibilityLabel="Abrir o perfil">
            <View style={styles.avatar}>
              <T variant="title" color={colors.accent}>{avatar}</T>
            </View>
          </Tappable>
        </Row>

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
              <WeekStrip sessions={strip} current={session.cycle_day} structure={session.cycle_structure} today={today} />
            </FadeIn>

            <FadeIn delay={40}>
              <PhotoCover source={cover} scrollY={scrollY} height={session.blocks.length > 0 ? 250 : 170}>
                <Row style={{ gap: space.xs, flexWrap: 'wrap' }}>
                  <View style={styles.coverTag}>
                    <T variant="tag" color={ON_PHOTO}>
                      {session.is_training_day ? 'Foco de hoje' : 'Recuperação'} · dia {session.cycle_day}/{session.cycle_length}
                      {session.meso_week != null && session.meso_length != null
                        ? ` · sem. ${session.meso_week}/${session.meso_length}`
                        : ''}
                    </T>
                  </View>
                  {session.deload && <View style={styles.coverTag}><T variant="tag" color={ON_PHOTO}>Deload</T></View>}
                  {budget != null && <View style={styles.coverTag}><T variant="tag" color={ON_PHOTO}>Ajustado</T></View>}
                </Row>
                <T variant="display" color={ON_PHOTO} style={styles.dayName} numberOfLines={2}>{session.day_name}</T>
                {session.blocks.length > 0 ? (
                  <Row style={{ gap: space.lg }}>
                    <Meta icon="timer" text={`${plan?.target_duration_minutes ?? session.target_duration_minutes} min`} />
                    <Meta icon="dumbbell" text={`${exerciseCount} ${exerciseCount === 1 ? 'exercício' : 'exercícios'}`} />
                  </Row>
                ) : (
                  <T color={ON_PHOTO_MUTED}>Descanso completo hoje. Sono, comida e passos.</T>
                )}
                {/* A full rest day has no session: nothing to list or start. */}
                {session.blocks.length > 0 && (
                  <Button
                    icon="play"
                    tone={cover ? 'primary' : 'secondary'} // on the plain blue card, a blue button would vanish
                    label={dayProgress.finishedAt ? 'Ver treino concluído'
                      : dayProgress.startedAt ? 'Continuar treino'
                      : session.is_training_day ? 'Começar treino' : 'Começar recuperação'}
                    onPress={() => router.push({ pathname: '/session/[day]', params: { day: today } })}
                    style={{ marginTop: space.sm }}
                  />
                )}
              </PhotoCover>
            </FadeIn>

            <FadeIn delay={70}>
              <WeekCard
                today={today}
                planned={weekPlan}
                attendance={attendance.attendance}
                finishedToday={dayProgress.finishedAt != null}
                streak={statsOf(attendance, today).streak}
                onOpen={() => router.push('/history')}
              />
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

            {session.blocks.length > 0 && plan && (
              <FadeIn delay={60}>
                <Section
                  title="Plano de hoje"
                  right={canBudget ? (
                    <TextLink
                      label={budget != null ? `Tempo: ${budget} min` : 'Tenho menos tempo'}
                      onPress={() => setShowBudget(!showBudget)}
                    />
                  ) : undefined}
                >
                  {canBudget && showBudget && (
                    <FadeIn style={{ gap: space.sm }}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                        <Chip label="Completo" selected={budget == null} onPress={() => pickBudget(null)} />
                        {budgets.map((m) => (
                          <Chip key={m} label={`${m} min`} selected={budget === m} onPress={() => pickBudget(m)}
                            accessibilityLabel={`Tenho só ${m} minutos`} />
                        ))}
                      </ScrollView>
                      {fitted && fitted.changes.length > 0 && (
                        <T variant="hint" color={fitted.fits ? colors.textMuted : colors.warning}>
                          {fitted.fits ? 'Ajustado: ' : `Mesmo ajustado, cerca de ${fitted.minutes} min: `}
                          {fitted.changes.join(' · ')}.
                        </T>
                      )}
                    </FadeIn>
                  )}
                  <PlanList session={plan} progress={dayProgress}
                    onOpen={() => router.push({ pathname: '/session/[day]', params: { day: today } })} />
                </Section>
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
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

/**
 * The week as a ledger: one segment per planned session (filled when done), the count, and the
 * 90-day adherence behind it. Opens the full history.
 */
function WeekCard({ today, planned, attendance, finishedToday, streak, onOpen }: {
  today: string;
  planned: Set<string>;
  attendance: AttendanceDay[];
  finishedToday: boolean;
  streak: number;
  onOpen: () => void;
}) {
  const week = weekOf(today);
  const plannedDays = new Set([...planned, ...attendance.filter((d) => d.planned).map((d) => d.day)]);
  const trained = new Set(attendance.filter((d) => d.trained).map((d) => d.day));
  if (finishedToday) trained.add(today);
  const { planned: goal, done } = weekGoal(week, plannedDays, trained);
  const rate = adherence(attendance, today, 90);
  const pct = rate ? Math.round(rate.rate * 100) : null;
  const facts = [pct != null ? `Assiduidade em 90 dias: ${pct}%` : null, streak > 0 ? `${streak} em sequência` : null]
    .filter(Boolean).join(' · ');
  return (
    <Tappable onPress={onOpen}
      accessibilityLabel={`Semana: ${done} de ${goal} sessões. ${facts}. Abrir o histórico`}>
      <Panel style={{ gap: space.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="tag">Semana</T>
          <Icon name="chevron-right" size={18} color={colors.textFaint} />
        </Row>
        <Row style={{ alignItems: 'baseline', gap: space.xs }}>
          <T variant="metric">{done}</T>
          <T variant="label">{goal === 0 ? 'sem sessões planejadas' : `de ${goal} ${goal === 1 ? 'sessão' : 'sessões'}`}</T>
        </Row>
        {goal > 0 && (
          <Row style={{ gap: 4 }}>
            {Array.from({ length: Math.max(goal, done) }, (_, i) => (
              <View key={i} style={[styles.segment, { backgroundColor: i < done ? colors.accent : colors.surfaceHigh }]} />
            ))}
          </Row>
        )}
        {facts ? <T variant="hint">{facts}</T> : null}
      </Panel>
    </Tappable>
  );
}

/** A small icon + text pair for the hero's facts. */
function Meta({ icon, text }: { icon: IconName; text: string }) {
  return (
    <Row style={{ gap: 6 }}>
      <Icon name={icon} size={16} color={ON_PHOTO_MUTED} />
      <T variant="label" color={ON_PHOTO_MUTED}>{text}</T>
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

type Status = 'done' | 'doing' | 'next';

function statusOf(block: Block, index: number, view: Session, p: Progress): { status: Status; text: string } {
  const key = itemKey(block.order, index);
  if (block.execution_style === 'straight_sets') {
    const rx = block.exercises[index];
    const n = Math.min(rx.sets, p.setsDone[key] ?? 0);
    if (n >= rx.sets) return { status: 'done', text: 'Concluído' };
    return n > 0 ? { status: 'doing', text: `${n}/${rx.sets} séries` } : { status: 'next', text: `${rx.sets} ${rx.sets === 1 ? 'série' : 'séries'}` };
  }
  if (block.execution_style === 'checklist') {
    return p.checked[key] ? { status: 'done', text: 'Feito' } : { status: 'next', text: 'A fazer' };
  }
  if (blockComplete(view, block.order, p)) return { status: 'done', text: 'Concluído' };
  return (p.amrapRounds[block.order] ?? 0) > 0
    ? { status: 'doing', text: `${p.amrapRounds[block.order]} rodadas` }
    : { status: 'next', text: 'Rodadas' };
}

/** The day's exercises as photo rows, grouped by block, each with its status. Tapping opens the session. */
function PlanList({ session, progress, onOpen }: { session: Session; progress: Progress; onOpen: () => void }) {
  const view = applySwaps(session, progress);
  let n = 0;
  return (
    <View style={{ gap: space.lg }}>
      {view.blocks.map((b) => (
        <View key={b.order} style={{ gap: space.sm }}>
          <T variant="tag">{b.name} · {b.duration_minutes} min</T>
          {b.exercises.map((e, i) => {
            const { status, text } = statusOf(b, i, view, progress);
            const no = ++n;
            const tone = status === 'done' ? colors.success : status === 'doing' ? colors.accent : colors.textMuted;
            return (
              <Tappable key={i} onPress={onOpen} accessibilityLabel={`${no}. ${e.name}, ${rxSummary(e)}. ${text}`}>
                <View style={styles.planRow}>
                  <ExerciseThumb exerciseId={e.exercise_id} size={60} width={72} radius={radius.md} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Row style={{ gap: space.xs + 2 }}>
                      <View style={[styles.planNo, status === 'done' && { backgroundColor: colors.success }]}>
                        {status === 'done'
                          ? <Icon name="check" size={12} color={colors.surface} strokeWidth={3} />
                          : <T variant="tag" color={colors.onAccent} style={{ letterSpacing: 0 }}>{no}</T>}
                      </View>
                      <T numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}
                        color={status === 'done' ? colors.textMuted : colors.text}>{e.name}</T>
                    </Row>
                    <T variant="hint" numberOfLines={1}>{rxSummary(e)}</T>
                    <Badge label={text} color={tone} />
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.textFaint} />
                </View>
              </Tappable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * The cycle as a row of day cards (weekday and date): today filled blue, past days faded. A dot
 * under the date marks training, a ring active recovery, nothing a full rest day.
 */
function WeekStrip({ sessions, current, structure, today }: {
  sessions: (Session | null)[];
  current: number;
  structure: string;
  today: string;
}) {
  // One summary for screen readers instead of a stop per day.
  const rest = sessions.flatMap((s, i) => (s && !s.is_training_day && s.blocks.length === 0 ? [i + 1] : []));
  const recovery = sessions.flatMap((s, i) => (s && !s.is_training_day && s.blocks.length > 0 ? [i + 1] : []));
  const summary =
    `${cycleStructureLabel(structure)}. Ciclo de ${sessions.length} dias, hoje é o dia ${current}.` +
    (recovery.length ? ` Recuperação ativa ${recovery.length === 1 ? 'no dia' : 'nos dias'} ${recovery.join(', ')}.` : '') +
    (rest.length ? ` Folga ${rest.length === 1 ? 'no dia' : 'nos dias'} ${rest.join(', ')}.` : '');
  const first = addDays(today, -(current - 1));
  return (
    <View accessible accessibilityLabel={summary}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {sessions.map((s, i) => {
          const day = i + 1;
          const date = addDays(first, i);
          const [y, m, d] = date.split('-').map(Number);
          const weekday = WEEKDAY[new Date(y, m - 1, d).getDay()];
          const training = s?.is_training_day ?? true;
          const recoveryDay = !training && !!s && s.blocks.length > 0;
          const isCurrent = day === current;
          const fg = isCurrent ? colors.onAccent : colors.text;
          return (
            <View key={i} style={[styles.dayCard, isCurrent && styles.dayCardOn, day < current && { opacity: 0.45 }]}>
              <T variant="label" color={isCurrent ? colors.onAccent : colors.textMuted} style={{ fontSize: 12 }}>{weekday}</T>
              <T variant="title" color={fg}>{d}</T>
              <View style={[
                styles.mark,
                training ? { backgroundColor: isCurrent ? colors.onAccent : colors.accent }
                  : recoveryDay ? { borderWidth: 1.5, borderColor: isCurrent ? colors.onAccent : colors.accent }
                  : { opacity: 0 },
              ]} />
            </View>
          );
        })}
      </ScrollView>
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
      </Row>
      <T variant="label" numberOfLines={1}>{routine.complete ? 'Rotina completa' : next ? next.title : routineSummary(routine).headline}</T>
      <ProgressBar value={routine.total ? routine.done / routine.total : 0} color={color} />
    </Tile>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  header: { gap: space.md, paddingTop: space.sm, alignItems: 'center' },
  status: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.xs, maxWidth: '40%' },
  avatar: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.accent,
  },
  coverTag: {
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: radius.pill, paddingHorizontal: space.sm + 2,
    paddingVertical: 4, alignSelf: 'flex-start',
  },
  dayName: { fontSize: 34, lineHeight: 38 },
  strip: { gap: space.sm, paddingVertical: 2 },
  dayCard: {
    width: 52, paddingVertical: space.sm + 2, borderRadius: radius.md, alignItems: 'center', gap: 2,
    backgroundColor: colors.surface,
  },
  dayCardOn: { backgroundColor: colors.accent },
  mark: { width: 6, height: 6, borderRadius: 3, marginTop: 3 },
  planRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, paddingRight: space.md,
    borderRadius: radius.lg, backgroundColor: colors.surface,
  },
  planNo: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  segment: { flex: 1, height: 6, borderRadius: 3 },
}));
