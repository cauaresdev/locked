import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { ArmorLoad, Session, StrengthEntry, Weight } from '../../api/types';
import { LiveHr } from '../../components/LiveHr';
import { Badge, Button, Divider, Field, Panel, Row, T } from '../../components/ui';
import { addDays, cycleStructureLabel, decimal, formatKgM, isoDay, parseDecimal as num, rxSummary } from '../../engine/format';
import { syncNight } from '../../health';
import {
  cachedRange,
  cachedSession,
  clearSessionCache,
  healthSyncEnabled,
  loadProgress,
  pendingCount,
  pendingTotal,
  rejectedCount,
  storeAthlete,
  storedAthlete,
} from '../../storage/db';
import { flushAll, loadSession, prefetchSchedule, refreshAthlete, type Source } from '../../sync';
import { colors, levelColor, levelTextColor, space } from '../../theme';

const TIER_NAME = { vigilante: 'Vigilante', dark_knight: 'Dark Knight', brawler: 'Brawler' } as const;

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
      const [, armorRes, weightRes] = await others;
      if (!live()) return;
      if (res) await showSession(res.session, res.source);
      else if (!cached) setError('Sem conexão e sem sessão em cache para hoje.');
      if (armorRes) setArmor(armorRes);
      if (strengthRes) setStrength(strengthRes);
      if (weightRes) setWeight(weightRes);
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

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.concrete} />}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="label">{TIER_NAME[athlete.tier]} · {athlete.name}</T>
          <Row>
            <LiveHr />
            {pending > 0 && <Badge label={`${pending} na fila`} color={colors.amber} />}
            {rejected > 0 && <Badge label={`${rejected} recusados`} color={colors.redText} />}
            <Badge
              label={source === 'live' ? 'Online' : loading ? 'Atualizando…' : 'Sem conexão'}
              color={source === 'live' || loading ? colors.concrete : colors.amber}
            />
          </Row>
        </Row>

        {error && <Panel accent={colors.amber}><T color={colors.amber}>{error}</T></Panel>}

        {missed.length > 0 && (
          <Panel accent={colors.amber}>
            <T variant="label">Treino perdido</T>
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
              <Button tone="ghost" label="Seguir o calendário" onPress={followCalendar} style={{ flex: 1 }} />
            </Row>
          </Panel>
        )}

        {session && (
          <>
            <View>
              <T variant="label">Ciclo {session.cycle_index + 1} · {cycleStructureLabel(session.cycle_structure)}</T>
              <Row style={{ alignItems: 'baseline' }}>
                <T variant="hero">{String(session.cycle_day).padStart(2, '0')}</T>
                <T variant="metric" color={colors.concrete}>/{session.cycle_length}</T>
              </Row>
              <T variant="title">{session.day_name}</T>
              {session.deload && <Badge label="Deload · semana de descarga" color={colors.amber} />}
            </View>

            <CycleStrip sessions={strip} current={session.cycle_day} />

            {session.notices.map((n) => (
              <Panel key={n} accent={colors.amber}><T color={colors.amber}>{n}</T></Panel>
            ))}

            <ReadinessPanel session={session} athleteId={athlete.id} day={today} onUpdated={refresh} offline={source !== 'live'} />

            <Panel>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="label">Sessão</T>
                <T variant="label">{session.target_duration_minutes} min</T>
              </Row>
              {session.blocks.map((b) => (
                <View key={b.order} style={{ gap: 2, marginTop: space.sm }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T style={{ fontSize: 13, flex: 1 }}>{b.order}. {b.name}</T>
                    <T variant="label">{b.duration_minutes} min</T>
                  </Row>
                  {b.exercises.map((e, i) => (
                    <T key={i} variant="hint" numberOfLines={1}>
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

        <WeightPanel athleteId={athlete.id} day={today} weight={weight} onSaved={setWeight} />
        {armor && <ArmorPanel armor={armor} />}
        {strength.length > 0 && <StrengthPanel entries={strength} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function CycleStrip({ sessions, current }: { sessions: (Session | null)[]; current: number }) {
  // One summary for screen readers instead of a stop per cell.
  const off = sessions.flatMap((s, i) => (s && !s.is_training_day ? [i + 1] : []));
  const summary =
    `Ciclo de ${sessions.length} dias, hoje é o dia ${current}.` +
    (off.length ? ` Folga ${off.length === 1 ? 'no dia' : 'nos dias'} ${off.join(', ')}.` : '');
  return (
    <View style={styles.strip} accessible accessibilityLabel={summary}>
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
            <T variant="label" style={{ fontSize: 10 }}>{training ? `Dia ${day}` : 'Folga'}</T>
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
  const [hrv, setHrv] = useState('');
  const [sleep, setSleep] = useState('');
  const [soreness, setSoreness] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      await onUpdated();
    } catch {
      setErr('Não foi possível atualizar: confira os valores e a conexão.');
    } finally {
      setBusy(false);
    }
  }

  const hasScore = r && !r.reasons.includes('sem dados de prontidão');
  return (
    <Panel accent={hasScore ? levelColor[r.level] : undefined}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="label">Batsuit Readiness · prontidão do dia</T>
        {hasScore && <T variant="metric" color={levelTextColor[r.level]}>{r.score}</T>}
      </Row>
      {hasScore && r.reasons.map((x) => <T key={x} variant="hint">▸ {x}</T>)}
      {hasScore && r.mobility_expanded && <T color={colors.amber}>Bloco 1 expandido para mobilidade.</T>}
      <Row style={{ alignItems: 'flex-end' }}>
        <Field label="VFC (ms)" value={hrv} onChangeText={setHrv} keyboardType="decimal-pad" />
        <Field label="Sono (h)" value={sleep} onChangeText={setSleep} keyboardType="decimal-pad" />
        <Field label="Dor 1–5" value={soreness} onChangeText={setSoreness} keyboardType="number-pad" />
      </Row>
      <T variant="hint">
        VFC: variabilidade da frequência cardíaca, medida ao acordar, em milissegundos. Dor muscular: 1 = nenhuma,
        5 = muita.
      </T>
      <Button
        tone="ghost"
        label={offline ? 'Requer conexão' : busy ? 'Calculando…' : 'Atualizar prontidão'}
        onPress={submit}
        disabled={offline || busy || !(hrv || sleep || soreness)}
      />
      {err && <T color={colors.amber}>{err}</T>}
    </Panel>
  );
}

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
    <Panel>
      <T variant="label">Peso corporal</T>
      {weight?.trend_kg != null ? (
        <Row style={{ alignItems: 'baseline' }}>
          <T variant="metric">{decimal(weight.trend_kg)}</T>
          <T variant="label">kg · média de 7 dias</T>
          {change != null && Math.abs(change) >= 0.1 && (
            <T variant="label" color={colors.concrete}>({change > 0 ? '+' : ''}{decimal(change)} na semana)</T>
          )}
        </Row>
      ) : (
        <T variant="hint">
          Pese-se ao acordar. A média dos últimos 7 dias define calorias, proteína e cargas.
        </T>
      )}
      <Row style={{ alignItems: 'flex-end' }}>
        <Field label={loggedToday ? 'Corrigir peso de hoje (kg)' : 'Peso de hoje (kg)'} value={kg} onChangeText={setKg}
          keyboardType="decimal-pad" />
        <Button tone="ghost" label={busy ? '…' : 'Salvar'} onPress={save} disabled={busy || num(kg) == null} />
      </Row>
      {err && <T color={colors.amber}>{err}</T>}
    </Panel>
  );
}

function ArmorPanel({ armor }: { armor: ArmorLoad }) {
  const delta = armor.current_cycle_kg_m - armor.previous_cycle_kg_m;
  const kind = (k: string) => armor.by_kind[k] ?? 0;
  return (
    <Panel>
      <T variant="label">Capacidade de Carga Operacional</T>
      <Row style={{ alignItems: 'baseline' }}>
        <T variant="metric">{formatKgM(armor.total_kg_m)}</T>
        <T variant="label">kg·m (quilos × metros)</T>
      </Row>
      <Divider />
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <T variant="label">Carregamentos {formatKgM(kind('carry'))}</T>
        <T variant="label">Trenó {formatKgM(kind('sled'))}</T>
        <T variant="label">Barra com lastro {formatKgM(kind('weighted_pull'))}</T>
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
      <T variant="label">Força estimada · 1RM (carga máxima para 1 repetição)</T>
      {top.map((e) => {
        const prev = e.history.length > 1 ? e.history[e.history.length - 2][1] : null;
        const delta = prev != null ? e.e1rm_kg - prev : 0;
        return (
          <Row key={e.exercise_id} style={{ justifyContent: 'space-between' }}>
            <T numberOfLines={1} style={{ flex: 1, fontSize: 13 }}>{e.name}</T>
            <T variant="label" color={delta > 0 ? colors.kryptonite : colors.concrete}>
              {decimal(e.e1rm_kg)} kg{delta ? ` (${delta > 0 ? '+' : ''}${decimal(delta)})` : ''}
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
  strip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
