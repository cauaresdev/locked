import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { FadeIn, Panel, Row, Stat, T } from '../components/ui';
import { adherence, weekOf, type AttendanceDay } from '../engine/attendance';
import { statsOf } from '../engine/attendanceStore';
import { addDays } from '../engine/format';
import { useToday } from '../hooks/useToday';
import { storedAttendance } from '../storage/db';
import { colors, radius, space, themed } from '../theme';

const WEEKS = 12;
const WINDOW = 90;
const WEEKDAYS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

/** The training record: adherence, the last 12 weeks day by day, and lifetime totals. No scores. */
export default function History() {
  const router = useRouter();
  const today = useToday();
  const { stats, rate, weeks, since } = useMemo(() => {
    const store = storedAttendance();
    const byDay = new Map(store.attendance.map((d) => [d.day, d]));
    const monday = weekOf(today)[0];
    const grid = Array.from({ length: WEEKS }, (_, w) => weekOf(addDays(monday, (w - WEEKS + 1) * 7))
      .map((day) => ({ day, entry: byDay.get(day) })));
    const since = store.attendance[0]?.day ?? today; // before the record starts there is nothing to show
    return { stats: statsOf(store, today), rate: adherence(store.attendance, today, WINDOW), weeks: grid, since };
  }, [today]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <T variant="display" style={{ flex: 1 }} accessibilityRole="header">Histórico</T>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Fechar" hitSlop={8}
          style={styles.close}>
          <Icon name="close" size={20} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <FadeIn>
          <Panel style={{ gap: space.md }}>
            <T variant="tag">Assiduidade · {WINDOW} dias</T>
            {rate ? (
              <View accessible accessibilityLabel={`${Math.round(rate.rate * 100)}%: ${rate.done} de ${rate.planned} sessões planejadas`}>
                <T variant="hero">{Math.round(rate.rate * 100)}%</T>
                <T variant="label">{rate.done} de {rate.planned} sessões planejadas</T>
              </View>
            ) : (
              <T variant="hint">Ainda sem sessões planejadas registradas.</T>
            )}
            <Calendar weeks={weeks} today={today} since={since} />
            <Row style={{ gap: space.lg, flexWrap: 'wrap' }}>
              <Legend style={{ backgroundColor: colors.accent }} label="Feita" />
              <Legend style={styles.missed} label="Não feita" />
              <Legend style={{ backgroundColor: colors.surfaceHigh }} label="Folga" />
            </Row>
          </Panel>
        </FadeIn>

        <FadeIn delay={60}>
          <Panel style={{ gap: space.lg }}>
            <T variant="tag">Totais</T>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}><Stat value={String(stats.sessions)} label="sessões concluídas" /></View>
              <View style={{ flex: 1 }}><Stat value={String(stats.records)} label="recordes pessoais" /></View>
            </Row>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}><Stat value={String(stats.streak)} label="em sequência agora" /></View>
              <View style={{ flex: 1 }}><Stat value={String(stats.bestStreak)} label="maior sequência" /></View>
            </Row>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}><Stat value={String(stats.perfectWeeks)} label="semanas sem falta" /></View>
            </Row>
            <T variant="hint">
              Sequência: sessões feitas sem faltar a nenhuma planejada. Folga não conta como falta.
            </T>
          </Panel>
        </FadeIn>

        <FadeIn delay={100}>
          <Panel style={{ gap: space.xs }}>
            <Row style={{ gap: space.sm }}>
              <Icon name="info" size={16} color={colors.accent} />
              <T variant="title">Por que acompanhar isto</T>
            </Row>
            <T variant="hint">
              O que move força e composição corporal é a regularidade ao longo de meses. Manter 80% ou mais de
              assiduidade rende mais do que semanas perfeitas seguidas de pausas longas.
            </T>
          </Panel>
        </FadeIn>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Twelve weeks side by side, Monday at the top: one square per day. */
function Calendar({ weeks, today, since }: { weeks: { day: string; entry?: AttendanceDay }[][]; today: string; since: string }) {
  return (
    <View style={styles.calendar} accessible accessibilityLabel={`Calendário das últimas ${WEEKS} semanas`}>
      <View style={styles.column}>
        {WEEKDAYS.map((w, i) => (
          <View key={i} style={[styles.cell, styles.weekday]}><T variant="hint" style={{ fontSize: 10, lineHeight: 12 }}>{w}</T></View>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0].day} style={styles.column}>
          {week.map(({ day, entry }) => {
            const past = day < today;
            const style = entry?.trained ? { backgroundColor: colors.accent }
              : entry?.planned && past ? styles.missed
              : entry?.planned ? styles.ahead
              : day > today || day < since ? styles.future
              : { backgroundColor: colors.surfaceHigh };
            return <View key={day} style={[styles.cell, style, day === today && styles.today]} />;
          })}
        </View>
      ))}
    </View>
  );
}

function Legend({ style, label }: { style: object; label: string }) {
  return (
    <Row style={{ gap: 6 }}>
      <View style={[styles.legend, style]} />
      <T variant="label">{label}</T>
    </Row>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  close: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  content: { padding: space.lg, paddingTop: 0, gap: space.lg, paddingBottom: space.xxl },
  calendar: { flexDirection: 'row', gap: 4 },
  column: { flex: 1, gap: 4 },
  cell: { aspectRatio: 1, borderRadius: 4 },
  missed: { borderWidth: 1.5, borderColor: colors.danger },
  ahead: { borderWidth: 1.5, borderColor: colors.accent },
  future: { backgroundColor: 'transparent' },
  weekday: { alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 2, borderColor: colors.text },
  legend: { width: 12, height: 12, borderRadius: 3 },
}));
