import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { Flame, MedalBadge, ProgressRing } from '../components/Rings';
import { FadeIn, Panel, ProgressBar, Row, T } from '../components/ui';
import { medalStates } from '../engine/achievements';
import { statsOf } from '../engine/achievementsStore';
import { useToday } from '../hooks/useToday';
import { cachedRoutine, storedAchievements } from '../storage/db';
import { colors, radius, space, themed } from '../theme';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Streak, totals and every medal: earned ones in color, the rest with how far along they are. */
export default function Achievements() {
  const router = useRouter();
  const today = useToday();
  const { stats, medals } = useMemo(() => {
    const store = storedAchievements();
    const s = statsOf(store, today, cachedRoutine(today)?.streak ?? 0);
    return { stats: s, medals: medalStates(s, store.earned) };
  }, [today]);
  const earned = medals.filter((m) => m.unlocked).length;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <T variant="display" style={{ flex: 1 }} accessibilityRole="header">Conquistas</T>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Fechar" hitSlop={8}
          style={styles.close}>
          <Icon name="close" size={20} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <FadeIn>
          <Panel style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            <ProgressRing value={earned / medals.length} size={84} stroke={9}>
              <T variant="title">{earned}/{medals.length}</T>
            </ProgressRing>
            <View style={{ flex: 1, gap: 6 }}>
              <Row style={{ gap: 6 }}>
                <Flame alive={stats.streak > 0} size={22} />
                <T variant="title">{stats.streak} {stats.streak === 1 ? 'treino seguido' : 'treinos seguidos'}</T>
              </Row>
              <T variant="hint">Recorde de sequência: {stats.bestStreak}. Folgas não quebram; faltar a um treino sim.</T>
              <T variant="label">
                {plural(stats.sessions, 'treino', 'treinos')} · {plural(stats.records, 'recorde', 'recordes')} ·{' '}
                {plural(stats.perfectWeeks, 'semana perfeita', 'semanas perfeitas')}
              </T>
            </View>
          </Panel>
        </FadeIn>

        <View style={styles.grid}>
          {medals.map((m, i) => (
            <FadeIn key={m.medal.id} delay={60 + i * 35} style={styles.cell}>
              <View style={[styles.tile, !m.unlocked && { opacity: 0.85 }]}
                accessible accessibilityLabel={`${m.medal.title}: ${m.medal.description} ${
                  m.unlocked ? 'Conquistada.' : `${m.value} de ${m.medal.goal}.`}`}>
                <MedalBadge icon={m.medal.icon} unlocked={m.unlocked} size={58} />
                <T variant="label" color={m.unlocked ? colors.text : colors.textMuted} numberOfLines={2}
                  style={{ textAlign: 'center', fontWeight: '600' }}>{m.medal.title}</T>
                {m.unlocked ? (
                  <T variant="hint" style={{ fontSize: 11, textAlign: 'center' }} numberOfLines={2}>{m.medal.description}</T>
                ) : (
                  <View style={{ alignSelf: 'stretch', gap: 4 }}>
                    <ProgressBar value={m.value / m.medal.goal} />
                    <T variant="hint" style={{ fontSize: 11, textAlign: 'center' }}>{m.value}/{m.medal.goal}</T>
                  </View>
                )}
              </View>
            </FadeIn>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  cell: { width: '33.333%', padding: space.xs },
  tile: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, alignItems: 'center', gap: space.sm,
    minHeight: 170,
  },
}));
