import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { ArmorLoad, Session, StrengthEntry } from '../../api/types';
import { LiveHr } from '../../components/LiveHr';
import { Badge, Button, Divider, Field, Panel, Row, T } from '../../components/ui';
import { addDays, formatKgM, isoDay, rxSummary } from '../../engine/format';
import { syncNight } from '../../health';
import { cachedRange, healthSyncEnabled, pendingCount, rejectedCount, storedAthlete } from '../../storage/db';
import { flushAll, loadSession, prefetchSchedule, refreshAthlete, type Source } from '../../sync';
import { colors, levelColor, space } from '../../theme';

const TIER_NAME = { vigilante: 'Vigilante', dark_knight: 'Dark Knight', brawler: 'Brawler' } as const;

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
  const [pending, setPending] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!athleteId) return;
    setLoading(true);
    setError(null);
    await refreshAthlete(athleteId);
    const cycleStart = storedAthlete()?.cycle_start ?? today; // freshly refreshed profile
    await flushAll(athleteId);
    // Last night's HRV / resting HR / sleep feed the readiness score before today's session is built.
    if (healthSyncEnabled()) await syncNight(athleteId, today).catch(() => null);
    await prefetchSchedule(athleteId, today, cycleStart);
    try {
      const res = await loadSession(athleteId, today);
      setSession(res.session);
      setSource(res.source);
      const first = addDays(today, -(res.session.cycle_day - 1));
      const days = Array.from({ length: res.session.cycle_length }, (_, i) => addDays(first, i));
      const cached = await cachedRange(days);
      setStrip(days.map((d) => cached[d] ?? null));
    } catch {
      setError('Sem conexão e sem sessão em cache para hoje.');
    }
    setArmor(await api.armorLoad(athleteId, today).catch(() => null));
    setStrength(await api.strength(athleteId).catch(() => []));
    setPending(await pendingCount());
    setRejected(await rejectedCount());
    setLoading(false);
  }, [athleteId, today]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!athlete) return <Redirect href="/onboarding" />;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.concrete} />}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="label">{TIER_NAME[athlete.tier]} · {athlete.name}</T>
          <Row>
            <LiveHr />
            {pending > 0 && <Badge label={`${pending} na fila`} color={colors.amber} />}
            {rejected > 0 && <Badge label={`${rejected} recusados`} color={colors.red} />}
            <Badge label={source === 'live' ? 'Online' : 'Offline'} color={source === 'live' ? colors.concrete : colors.amber} />
          </Row>
        </Row>

        {error && <Panel accent={colors.amber}><T color={colors.amber}>{error}</T></Panel>}

        {session && (
          <>
            <View>
              <T variant="label">Ciclo {session.cycle_index + 1} · {session.cycle_structure.replaceAll('_', ' ')}</T>
              <Row style={{ alignItems: 'baseline' }}>
                <T variant="hero">{String(session.cycle_day).padStart(2, '0')}</T>
                <T variant="metric" color={colors.concrete}>/{session.cycle_length}</T>
              </Row>
              <T variant="title">{session.day_name}</T>
            </View>

            <CycleStrip sessions={strip} current={session.cycle_day} />

            {session.notices.map((n) => (
              <Panel key={n} accent={colors.amber}><T color={colors.amber}>{n}</T></Panel>
            ))}

            <ReadinessPanel session={session} athleteId={athlete.id} day={today} onUpdated={load} offline={source !== 'live'} />

            <Panel>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="label">Sessão</T>
                <T variant="label">{session.target_duration_minutes} min</T>
              </Row>
              {session.blocks.map((b) => (
                <View key={b.order} style={{ gap: 2, marginTop: space.sm }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T style={{ fontSize: 13 }}>{b.order}. {b.name}</T>
                    <T variant="label">{b.duration_minutes}′</T>
                  </Row>
                  {b.exercises.map((e, i) => (
                    <T key={i} variant="label" numberOfLines={1} style={{ textTransform: 'none' }}>
                      {e.name} — {rxSummary(e)}
                    </T>
                  ))}
                </View>
              ))}
            </Panel>

            <Button
              label={session.is_training_day ? 'Iniciar sessão' : 'Iniciar recuperação ativa'}
              onPress={() => router.push({ pathname: '/session/[day]', params: { day: today } })}
            />
          </>
        )}

        {armor && <ArmorPanel armor={armor} />}
        {strength.length > 0 && <StrengthPanel entries={strength} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function CycleStrip({ sessions, current }: { sessions: (Session | null)[]; current: number }) {
  return (
    <Row style={{ gap: 4 }}>
      {sessions.map((s, i) => {
        const day = i + 1;
        const isCurrent = day === current;
        const training = s?.is_training_day ?? true;
        return (
          <View
            key={i}
            style={[
              styles.cell,
              !training && styles.cellOff,
              day < current && { opacity: 0.4 },
              isCurrent && { borderColor: colors.bone, borderWidth: 2 },
            ]}
          >
            <T variant="label" style={{ fontSize: 10 }}>{training ? `D${day}` : 'OFF'}</T>
          </View>
        );
      })}
    </Row>
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
  onUpdated: () => void;
  offline: boolean;
}) {
  const r = session.readiness;
  const [hrv, setHrv] = useState('');
  const [sleep, setSleep] = useState('');
  const [soreness, setSoreness] = useState('');
  const [busy, setBusy] = useState(false);
  const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);

  async function submit() {
    setBusy(true);
    try {
      await api.putReadiness(athleteId, { day, hrv_ms: num(hrv), hrv_method: 'rmssd', sleep_hours: num(sleep), soreness: num(soreness) });
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  const hasScore = r && !r.reasons.includes('sem dados de prontidão');
  return (
    <Panel accent={hasScore ? levelColor[r.level] : undefined}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="label">Batsuit Readiness</T>
        {hasScore && <T variant="metric" color={levelColor[r.level]}>{r.score}</T>}
      </Row>
      {hasScore && r.reasons.map((x) => <T key={x} variant="label" style={{ textTransform: 'none' }}>▸ {x}</T>)}
      {hasScore && r.mobility_expanded && <T color={colors.amber}>Bloco 1 expandido para mobilidade.</T>}
      <Row style={{ alignItems: 'flex-end' }}>
        <Field label="VFC (ms)" value={hrv} onChangeText={setHrv} keyboardType="decimal-pad" />
        <Field label="Sono (h)" value={sleep} onChangeText={setSleep} keyboardType="decimal-pad" />
        <Field label="Dor 1-5" value={soreness} onChangeText={setSoreness} keyboardType="number-pad" />
      </Row>
      <Button
        tone="ghost"
        label={offline ? 'Requer conexão' : busy ? 'Calculando…' : 'Atualizar prontidão'}
        onPress={submit}
        disabled={offline || busy || !(hrv || sleep || soreness)}
      />
    </Panel>
  );
}

function ArmorPanel({ armor }: { armor: ArmorLoad }) {
  const delta = armor.current_cycle_kg_m - armor.previous_cycle_kg_m;
  return (
    <Panel>
      <T variant="label">Capacidade de Carga Operacional</T>
      <Row style={{ alignItems: 'baseline' }}>
        <T variant="metric">{formatKgM(armor.total_kg_m)}</T>
        <T variant="label">kg·m</T>
      </Row>
      <Divider />
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="label">Carries {formatKgM(armor.by_kind.carry)}</T>
        <T variant="label">Trenó {formatKgM(armor.by_kind.sled)}</T>
        <T variant="label">Barra {formatKgM(armor.by_kind.weighted_pull)}</T>
      </Row>
      <T variant="label" color={delta > 0 ? colors.kryptonite : colors.concrete}>
        Ciclo atual {formatKgM(armor.current_cycle_kg_m)} ({delta >= 0 ? '+' : ''}{formatKgM(delta)} vs. anterior)
      </T>
    </Panel>
  );
}

function StrengthPanel({ entries }: { entries: StrengthEntry[] }) {
  const top = [...entries].sort((a, b) => b.e1rm_kg - a.e1rm_kg).slice(0, 6);
  return (
    <Panel>
      <T variant="label">Força estimada · e1RM</T>
      {top.map((e) => {
        const prev = e.history.length > 1 ? e.history[e.history.length - 2][1] : null;
        const delta = prev != null ? e.e1rm_kg - prev : 0;
        return (
          <Row key={e.exercise_id} style={{ justifyContent: 'space-between' }}>
            <T numberOfLines={1} style={{ flex: 1, fontSize: 13 }}>{e.name}</T>
            <T variant="label" color={delta > 0 ? colors.kryptonite : colors.concrete}>
              {e.e1rm_kg.toFixed(1)} kg{delta ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(1)})` : ''}
            </T>
          </Row>
        );
      })}
    </Panel>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  cell: {
    flex: 1,
    height: 36,
    backgroundColor: colors.gunmetal,
    borderColor: colors.seam,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellOff: { backgroundColor: 'transparent' },
});
