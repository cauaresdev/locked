import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { Athlete, Routine, RoutineCheck, RoutineItem } from '../../api/types';
import { GuidedRoutine } from '../../components/GuidedRoutine';
import { Icon } from '../../components/Icon';
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  Dots,
  ListRow,
  Panel,
  ProgressBar,
  Row,
  ScreenHeader,
  Section,
  T,
  TextLink,
} from '../../components/ui';
import { isoDay } from '../../engine/format';
import { routineSummary, SECTION_TITLE, withCheck } from '../../engine/routine';
import { cancelRoutineReminders, scheduleRoutineReminders } from '../../notifications';
import {
  cachedRoutine,
  routineRemindersEnabled,
  setRoutineRemindersEnabled,
  storeAthlete,
  storedAthlete,
  storeRoutine,
} from '../../storage/db';
import { colors, radius, space } from '../../theme';

const WEEKDAY = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const SLEEP_TARGETS = [7, 7.5, 8, 8.5, 9];
const SECTIONS = ['morning', 'day', 'night'] as const;

function hours(h: number): string {
  return `${String(h).replace('.', ',')} h`;
}

export default function RoutineScreen() {
  const router = useRouter();
  const [athlete, setAthlete] = useState<Athlete | null>(storedAthlete());
  const day = isoDay();
  const [routine, setRoutine] = useState<Routine | null>(() => cachedRoutine(day));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [guided, setGuided] = useState(false);
  const [reminders, setReminders] = useState(routineRemindersEnabled());
  const run = useRef(0); // a slow response must not overwrite a newer tick
  const athleteId = athlete?.id;

  const show = useCallback((r: Routine) => {
    setRoutine(r);
    storeRoutine(r);
  }, []);

  const load = useCallback(async () => {
    if (!athleteId) return;
    const id = ++run.current;
    try {
      const r = await api.routine(athleteId, day);
      if (id !== run.current) return;
      show(r);
      setError(null);
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
    setRoutine(withCheck(routine, item.id, body)); // instant; the server's answer replaces it
    try {
      const r = await api.setRoutineItem(athleteId, day, item.id, body);
      if (id === run.current) show(r);
      setError(null);
    } catch {
      if (id === run.current) setRoutine(before);
      setError('Não salvou: sem conexão. Tente de novo quando a internet voltar.');
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
          <T variant="label">Carregando…</T>
        ) : (
          <>
            <Panel accent={routine.complete ? colors.success : undefined} style={{ gap: space.md }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <View accessible accessibilityLabel={`${routine.done} de ${routine.total} hábitos feitos hoje`}>
                  <T variant="hero" color={routine.complete ? colors.success : colors.text}>
                    {routine.done}/{routine.total}
                  </T>
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

            {SECTIONS.map((section) => {
              const items = routine.items.filter((i) => i.section === section);
              if (!items.length) return null;
              const done = items.filter((i) => i.done).length;
              return (
                <Section key={section} title={SECTION_TITLE[section]}
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
              );
            })}

            <Section title="Lembretes">
              <Panel style={{ gap: space.md }}>
                <T variant="hint">
                  Água três vezes ao dia, telas desligadas às {routine.screens_off} e cama às {routine.bedtime}.
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
