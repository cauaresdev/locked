import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import { isRejection } from '../../engine/deliver';
import type { Athlete, Routine, RoutineCheck, RoutineItem } from '../../api/types';
import { GuidedRoutine } from '../../components/GuidedRoutine';
import { Icon } from '../../components/Icon';
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  CountUp,
  Dots,
  FadeIn,
  Field,
  ListRow,
  Panel,
  ProgressBar,
  Row,
  ScreenHeader,
  Section,
  Skeleton,
  T,
  TextLink,
} from '../../components/ui';
import { parseTime } from '../../engine/format';
import { useToday } from '../../hooks/useToday';
import { routineSummary, SECTION_TITLE, withCheck } from '../../engine/routine';
import { cancelRoutineReminders, requestNotificationPermission, scheduleRoutineReminders } from '../../notifications';
import { refreshTrainingReminders } from '../../reminders';
import {
  cachedRoutine,
  healthSyncEnabled,
  pendingRoutineChecks,
  removeRoutineCheck,
  queueRoutineCheck,
  routineRemindersEnabled,
  setRoutineRemindersEnabled,
  storeAthlete,
  storedAthlete,
  storeRoutine,
} from '../../storage/db';
import { syncSteps } from '../../health';
import { flushRoutine, withPendingChecks } from '../../sync';
import { colors, radius, space } from '../../theme';

const WEEKDAY = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const SLEEP_TARGETS = [7, 7.5, 8, 8.5, 9];
const STEP_TARGETS = [6000, 8000, 10000, 12000];
const SECTIONS = ['morning', 'day', 'night'] as const;

const OFFLINE_TICKS = 'Sem conexão: marcações salvas no aparelho. Elas sobem quando a internet voltar.';

function hours(h: number): string {
  return `${String(h).replace('.', ',')} h`;
}

export default function RoutineScreen() {
  const router = useRouter();
  const [athlete, setAthlete] = useState<Athlete | null>(storedAthlete());
  const day = useToday();
  const [routine, setRoutine] = useState<Routine | null>(() => cachedRoutine(day));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [guided, setGuided] = useState(false);
  const [reminders, setReminders] = useState(routineRemindersEnabled);
  const run = useRef(0); // a slow response must not overwrite a newer tick
  const athleteId = athlete?.id;

  // Ticks still queued on the device stay ticked over whatever the server last knew.
  const show = useCallback((r: Routine) => {
    const view = withPendingChecks(r);
    setRoutine(view);
    storeRoutine(view);
  }, []);

  const load = useCallback(async () => {
    if (!athleteId) return;
    const id = ++run.current;
    try {
      if (pendingRoutineChecks().length) await flushRoutine(athleteId);
      const counted = healthSyncEnabled() ? await syncSteps(athleteId, day).catch(() => null) : null;
      const r = counted ?? await api.routine(athleteId, day);
      if (id !== run.current) return;
      show(r);
      setError(pendingRoutineChecks(day).length ? OFFLINE_TICKS : null);
    } catch {
      if (id === run.current) setError('Sem conexão: mostrando a última versão salva.');
    }
  }, [athleteId, day, show]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!athlete) return <Redirect href="/onboarding" />;

  async function set(item: RoutineItem, body: RoutineCheck) {
    if (!athleteId || !routine) return;
    const before = routine;
    const id = ++run.current;
    const optimistic = withCheck(routine, item.id, body);
    setRoutine(optimistic); // instant; the server's answer replaces it
    // The tick queued before this request is superseded by it; one queued while it was in flight is newer.
    const superseded = pendingRoutineChecks(day).find((c) => c.item === item.id);
    try {
      const r = await api.setRoutineItem(athleteId, day, item.id, body);
      if (superseded) removeRoutineCheck(superseded);
      if (id === run.current) show(r);
      setError(pendingRoutineChecks(day).length ? OFFLINE_TICKS : null);
    } catch (e) {
      if (isRejection(e)) {
        if (id === run.current) setRoutine(before);
        setError('O servidor recusou esta marcação.');
        return;
      }
      // Offline (the gym basement): keep the tick on the device and send it with the next sync.
      queueRoutineCheck({ day, item: item.id, body });
      storeRoutine(optimistic);
      setError(OFFLINE_TICKS);
    }
  }

  async function saveProfile(body: Parameters<typeof api.updateAthlete>[1]) {
    if (!athleteId) return;
    try {
      const a = await api.updateAthlete(athleteId, body);
      storeAthlete(a);
      setAthlete(a);
      const r = await api.routine(athleteId, day);
      show(r);
      setError(null);
      // New sleep target: bedtime and screens-off move, so do their reminders.
      if (reminders) await scheduleRoutineReminders(a.wake_time, r.screens_off, r.bedtime);
      if ('training_time' in body) {
        if (a.training_time) await requestNotificationPermission();
        await refreshTrainingReminders(a, day);
      }
    } catch {
      setError('Não salvou: sem conexão. Tente de novo quando a internet voltar.');
    }
  }

  async function toggleReminders() {
    if (!routine) return;
    if (reminders) {
      await cancelRoutineReminders();
    } else if (!(await scheduleRoutineReminders(routine.wake_time, routine.screens_off, routine.bedtime))) {
      setError('Permissão de notificação negada.');
      return;
    }
    setRoutineRemindersEnabled(!reminders);
    setReminders(!reminders);
  }

  const summary = routine ? routineSummary(routine) : null;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.textMuted}
          />
        }
      >
        <ScreenHeader
          overline="Rotina Batfleck"
          title="Rotina"
          right={routine && routine.streak > 0
            ? <Badge label={`${routine.streak} ${routine.streak === 1 ? 'dia' : 'dias'} seguidos`} color={colors.success} />
            : undefined}
        />

        {error && <Panel accent={colors.warning}><T color={colors.warning}>{error}</T></Panel>}

        {!routine ? (
          <View style={{ gap: space.lg }} accessible accessibilityLabel="Carregando rotina">
            <Skeleton height={150} />
            <Skeleton height={20} width="40%" />
            <Skeleton height={180} />
          </View>
        ) : (
          <>
            <FadeIn>
            <Panel accent={routine.complete ? colors.success : undefined} style={{ gap: space.md }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <View accessible accessibilityLabel={`${routine.done} de ${routine.total} hábitos feitos hoje`}>
                  <Row style={{ alignItems: 'baseline', gap: 0 }}>
                    <CountUp variant="hero" value={routine.done} color={routine.complete ? colors.success : colors.text} />
                    <T variant="hero" color={colors.textFaint}>/{routine.total}</T>
                  </Row>
                  <T variant="label">{summary?.headline}</T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <T variant="label">Recorde</T>
                  <T variant="title">{routine.best_streak} {routine.best_streak === 1 ? 'dia' : 'dias'}</T>
                </View>
              </Row>
              <ProgressBar value={routine.total ? routine.done / routine.total : 0}
                color={routine.complete ? colors.success : colors.accent} />
              <Row style={{ justifyContent: 'space-between' }}>
                {routine.week.map((d) => {
                  const date = new Date(`${d.day}T12:00:00`);
                  const isToday = d.day === day;
                  const partial = !d.complete && d.done > 0;
                  return (
                    <View key={d.day} style={styles.weekDay}
                      accessible accessibilityLabel={`${date.toLocaleDateString('pt-BR', { weekday: 'long' })}: ${d.done} de ${d.total}${d.complete ? ', cumprido' : ''}`}>
                      <View style={[
                        styles.weekDot,
                        d.complete && { backgroundColor: colors.success },
                        partial && { backgroundColor: colors.surfaceHigh, borderColor: colors.textMuted },
                        isToday && !d.complete && { borderColor: colors.accent },
                      ]} />
                      <T variant="tag" color={isToday ? colors.text : colors.textMuted}>{WEEKDAY[date.getDay()]}</T>
                    </View>
                  );
                })}
              </Row>
            </Panel>
            </FadeIn>

            {SECTIONS.map((section, si) => {
              const items = routine.items.filter((i) => i.section === section);
              if (!items.length) return null;
              const done = items.filter((i) => i.done).length;
              return (
                <FadeIn key={section} delay={(si + 1) * 60}>
                <Section title={SECTION_TITLE[section]}
                  right={<View accessible accessibilityLabel={`${done} de ${items.length}`}><Dots done={done} total={items.length} color={colors.success} /></View>}>
                  <Panel style={{ gap: space.xs, paddingVertical: space.sm }}>
                    {items.map((item) => item.kind === 'water'
                      ? <WaterRow key={item.id} item={item} onSet={(ml) => set(item, { value: ml })} />
                      : <HabitRow key={item.id} item={item} onToggle={(v) => set(item, { done: v })} />)}
                  </Panel>
                  {section === 'night' && items.some((i) => i.id === 'mobility') && (
                    <Button tone="secondary" icon="moon" label="Mobilidade e respiração guiadas · 10 min"
                      onPress={() => setGuided(true)} />
                  )}
                  {section === 'morning' && (
                    <ListRow
                      title="Early Bird"
                      caption={athlete.early_bird_enabled
                        ? `Alarme às ${athlete.wake_time} · cardio em jejum com a cinta`
                        : 'Alarme desligado · configure o despertar e o cardio em jejum'}
                      onPress={() => router.navigate('/early-bird')}
                    />
                  )}
                </Section>
                </FadeIn>
              );
            })}

            <Section title="Lembretes">
              <Panel style={{ gap: space.md }}>
                <T variant="hint">
                  Água três vezes ao dia, telas desligadas às {routine.screens_off}, cama às {routine.bedtime} e a
                  revisão da semana no domingo.
                </T>
                <Button tone={reminders ? 'secondary' : 'primary'} icon="bell"
                  label={reminders ? 'Desligar lembretes' : 'Ativar lembretes'} onPress={toggleReminders} />
              </Panel>
            </Section>

            <Section title="Personalizar"
              right={<TextLink label={editing ? 'Fechar' : 'Editar'} onPress={() => setEditing(!editing)} />}>
              {editing ? (
                <Panel style={{ gap: space.lg }}>
                  <View style={{ gap: space.sm }}>
                    <T variant="label">Horário de treino</T>
                    <TrainingTime value={athlete.training_time ?? null}
                      onSave={(t) => saveProfile({ training_time: t })} />
                    <T variant="hint">
                      Nos dias de treino: aviso da refeição pré-treino 1 h 30 antes e do treino 15 min antes.
                    </T>
                  </View>
                  <View style={{ gap: space.sm }}>
                    <T variant="label">Meta de passos</T>
                    <Row style={{ flexWrap: 'wrap', gap: space.sm }}>
                      {STEP_TARGETS.map((n) => (
                        <Chip key={n} label={n.toLocaleString('pt-BR')} selected={athlete.steps_target === n}
                          onPress={() => saveProfile({ steps_target: n })} />
                      ))}
                    </Row>
                    <T variant="hint">
                      Com a saúde ativa em Perfil, os passos vêm do relógio ou do celular e o item marca sozinho.
                    </T>
                  </View>
                  <View style={{ gap: space.sm }}>
                    <T variant="label">Meta de sono</T>
                    <Row style={{ flexWrap: 'wrap', gap: space.sm }}>
                      {SLEEP_TARGETS.map((h) => (
                        <Chip key={h} label={hours(h)} selected={routine.sleep_target_hours === h}
                          onPress={() => saveProfile({ sleep_target_hours: h })} />
                      ))}
                    </Row>
                    <T variant="hint">
                      Acordando às {routine.wake_time}, a cama fica às {routine.bedtime}. O horário de acordar se
                      ajusta no Early Bird.
                    </T>
                  </View>
                  <View style={{ gap: space.sm }}>
                    <T variant="label">Hábitos</T>
                    <Row style={{ flexWrap: 'wrap', gap: space.sm }}>
                      {routine.options.map((o) => (
                        <Chip key={o.id} role="checkbox" label={o.title} selected={o.enabled}
                          onPress={() => saveProfile({
                            routine_items: routine.options
                              .filter((x) => (x.id === o.id ? !x.enabled : x.enabled))
                              .map((x) => x.id),
                          })} />
                      ))}
                    </Row>
                  </View>
                </Panel>
              ) : (
                <T variant="hint">
                  Sono de {hours(routine.sleep_target_hours)} · água {(routine.water_target_ml / 1000).toFixed(2).replace('.', ',')} L
                  hoje · o dia conta como cumprido com 80% dos hábitos.
                </T>
              )}
            </Section>
          </>
        )}
      </ScrollView>
      <GuidedRoutine
        visible={guided}
        onClose={() => setGuided(false)}
        onDone={() => {
          const mobility = routine?.items.find((i) => i.id === 'mobility');
          if (mobility && !mobility.done) set(mobility, { done: true });
        }}
      />
    </SafeAreaView>
  );
}

function TrainingTime({ value, onSave }: { value: string | null; onSave: (t: string | null) => void }) {
  const [text, setText] = useState(value ?? '');
  const parsed = parseTime(text);
  return (
    <Row style={{ alignItems: 'flex-end' }}>
      <Field label="HH:MM" value={text} onChangeText={setText} placeholder="18:00" keyboardType="numbers-and-punctuation"
        maxLength={5} />
      <Button tone="secondary" label="Salvar" disabled={!parsed || parsed === value} onPress={() => onSave(parsed)} />
      {value && <Button tone="secondary" label="Remover" onPress={() => { setText(''); onSave(null); }} />}
    </Row>
  );
}

function HabitRow({ item, onToggle }: { item: RoutineItem; onToggle: (done: boolean) => void }) {
  const locked = item.auto && item.done; // ticked by data: a manual untick would not change it
  const body = (
    <View style={{ flex: 1, gap: 2 }}>
      <T style={item.done ? { color: colors.textMuted } : undefined}>{item.title}</T>
      {item.detail ? <T variant="label">{item.detail}</T> : null}
      {locked ? <T variant="tag" color={colors.success}>Marcado automaticamente</T> : null}
    </View>
  );
  if (locked) {
    return (
      <View style={styles.habit} accessible accessibilityLabel={`${item.title}: feito automaticamente`}>
        <View style={[styles.autoBox]}><Icon name="check" size={14} color={colors.bg} strokeWidth={3} /></View>
        {body}
      </View>
    );
  }
  return (
    <Checkbox checked={item.done} onChange={onToggle} accessibilityLabel={item.title}>
      {body}
    </Checkbox>
  );
}

function WaterRow({ item, onSet }: { item: RoutineItem; onSet: (ml: number) => void }) {
  const value = item.value ?? 0;
  const target = item.target ?? 1;
  return (
    <View style={{ gap: space.sm, paddingVertical: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: space.sm }}>
          <Icon name="droplet" size={18} color={item.done ? colors.success : colors.accent} />
          <T>{item.title}</T>
        </Row>
        <T variant="label">{item.detail}</T>
      </Row>
      <ProgressBar value={value / target} color={item.done ? colors.success : colors.accent} />
      <Row style={{ gap: space.sm }}>
        <Pressable style={styles.waterBtn} accessibilityRole="button" accessibilityLabel="Tirar 250 ml"
          disabled={value <= 0} onPress={() => onSet(Math.max(0, value - 250))}>
          <T color={value <= 0 ? colors.textFaint : colors.text}>−</T>
        </Pressable>
        <Button style={{ flex: 1 }} tone="secondary" label="+ 250 ml" onPress={() => onSet(value + 250)} />
        <Button style={{ flex: 1 }} tone="secondary" label="+ 500 ml" onPress={() => onSet(value + 500)} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  weekDay: { alignItems: 'center', gap: space.xs, minWidth: 32 },
  weekDot: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surfaceHigh,
  },
  habit: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, paddingVertical: space.xs },
  autoBox: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waterBtn: {
    minWidth: 48,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
