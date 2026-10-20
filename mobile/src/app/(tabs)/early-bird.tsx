import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Redirect, useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { Athlete, EarlyBird } from '../../api/types';
import { fresh, useDeviceControls, useLiveHr } from '../../ble/devices';
import { Meter } from '../../components/Meter';
import { Badge, Button, Panel, Row, T } from '../../components/ui';
import { clock, isoDay } from '../../engine/format';
import { useComms } from '../../hooks/useComms';
import { cancelEarlyBird, scheduleEarlyBird } from '../../notifications';
import { storeAthlete, storedAthlete } from '../../storage/db';
import { flushTelemetry } from '../../sync';
import { colors, space } from '../../theme';

const STATUS_TEXT: Record<EarlyBird['status'], string> = {
  not_started: 'Aguardando check-in',
  in_window: 'Janela aberta',
  complete: 'Protocolo cumprido',
  missed: 'Janela perdida',
  no_hr_max: 'Defina o ano de nascimento ou a frequência cardíaca máxima em Ajustes',
};

function shiftTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

const KEEP_AWAKE_TAG = 'early-bird';

export default function EarlyBirdScreen() {
  const focused = useIsFocused();
  const router = useRouter();
  const comms = useComms();
  const hr = useLiveHr();
  const { connected } = useDeviceControls();
  const [athlete, setAthlete] = useState<Athlete | null>(storedAthlete());
  const [eb, setEb] = useState<EarlyBird | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [localZoneSeconds, setLocalZoneSeconds] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const wasInZone = useRef<boolean | null>(null);
  const tick = useRef<() => void>(() => {});
  const day = isoDay();
  const athleteId = athlete?.id;

  const refresh = useCallback(async () => {
    if (!athleteId) return;
    try {
      await flushTelemetry(athleteId);
      const r = await api.earlyBird(athleteId, day);
      setEb(r);
      setError(null);
    } catch {
      setError('Sem conexão: minutos contados localmente até sincronizar.');
    }
  }, [athleteId, day]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const pull = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const zone = eb?.zone_bpm ?? (athlete?.hr_max ? [Math.round(athlete.hr_max * 0.7), Math.round(athlete.hr_max * 0.8)] : null);
  const windowEnd = eb?.window_ends_at ? Date.parse(eb.window_ends_at) : null;
  const inWindow = windowEnd != null && now <= windowEnd && eb?.status !== 'complete';
  const bpm = fresh(hr, now);
  const inZone = bpm != null && zone != null && bpm >= zone[0] && bpm <= zone[1];

  // 1 s clock: local time-in-zone estimate and zone-change voice cues while the window is open.
  // The tick reads the latest render's values through a ref, so the interval itself never restarts.
  useEffect(() => {
    tick.current = () => {
      if (!inWindow) return;
      if (inZone) setLocalZoneSeconds((n) => n + 1);
      if (wasInZone.current !== null && wasInZone.current !== inZone && bpm != null && zone) {
        comms.say(inZone ? 'Na zona.' : bpm < zone[0] ? 'Abaixo da zona. Acelere.' : 'Acima da zona. Reduza.');
      }
      wasInZone.current = inZone;
    };
  });
  // Tabs stay mounted: tick only while this tab is on screen.
  useEffect(() => {
    if (!focused) return;
    const id = setInterval(() => {
      setNow(Date.now());
      tick.current();
    }, 1000);
    return () => clearInterval(id);
  }, [focused]);

  // Screen stays on only during the open window on this tab, not in the rest of the app.
  useEffect(() => {
    if (!focused || !inWindow) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [focused, inWindow]);

  // Sync with the server every 30 s during the window.
  useEffect(() => {
    if (!inWindow) return;
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [inWindow, refresh]);

  if (!athlete) return <Redirect href="/onboarding" />;

  async function saveAlarm(enabled: boolean, wake: string) {
    if (!athlete) return;
    try {
      if (enabled && !(await scheduleEarlyBird(wake))) {
        setError('Permissão de notificação negada.');
        return;
      }
      if (!enabled) await cancelEarlyBird();
      const a = await api.updateAthlete(athlete.id, { early_bird_enabled: enabled, wake_time: wake });
      storeAthlete(a);
      setAthlete(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar');
    }
  }

  async function checkIn() {
    if (!athlete) return;
    try {
      setLocalZoneSeconds(0);
      setEb(await api.wake(athlete.id, day, new Date().toISOString()));
      comms.say('Check-in. Trinta minutos. Zona aeróbica em jejum.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no check-in');
    }
  }

  const minutes = Math.max(eb?.minutes_in_zone ?? 0, localZoneSeconds / 60);
  const required = eb?.required_minutes ?? 20;
  const bpmColor = bpm == null ? colors.concrete : inZone ? colors.kryptonite : zone && bpm > zone[1] ? colors.amber : colors.bone;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={colors.concrete} />}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="title">Gotham Early Bird</T>
          {eb && eb.streak > 0 && <Badge label={`${eb.streak} dias`} color={colors.kryptonite} />}
        </Row>

        <Panel>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="label">Alarme diário</T>
            <Badge label={athlete.early_bird_enabled ? 'Ativo' : 'Desligado'}
              color={athlete.early_bird_enabled ? colors.bone : colors.concrete} />
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Button tone="ghost" label="−15" accessibilityLabel="Alarme 15 min mais cedo"
              onPress={() => saveAlarm(athlete.early_bird_enabled, shiftTime(athlete.wake_time, -15))} />
            <T variant="hero" style={{ fontSize: 48, lineHeight: 56 }}>{athlete.wake_time}</T>
            <Button tone="ghost" label="+15" accessibilityLabel="Alarme 15 min mais tarde"
              onPress={() => saveAlarm(athlete.early_bird_enabled, shiftTime(athlete.wake_time, 15))} />
          </Row>
          <Button tone={athlete.early_bird_enabled ? 'ghost' : 'primary'}
            label={athlete.early_bird_enabled ? 'Desligar alarme' : 'Ativar alarme'}
            onPress={() => saveAlarm(!athlete.early_bird_enabled, athlete.wake_time)} />
        </Panel>

        {error && <Panel accent={colors.amber}><T color={colors.amber}>{error}</T></Panel>}

        <Panel accent={eb?.status === 'complete' ? colors.kryptonite : inWindow ? colors.bone : undefined}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="label">{eb ? STATUS_TEXT[eb.status] : 'Carregando…'}</T>
            {inWindow && windowEnd && <T variant="label">{clock((windowEnd - now) / 1000)} restantes</T>}
          </Row>

          <View style={{ alignItems: 'center', paddingVertical: space.md }}>
            <T variant="hero" color={bpmColor}>{bpm ?? '--'}</T>
            <T variant="label">
              batimentos/min · zona alvo {zone ? `${zone[0]}–${zone[1]}` : '—'} (≈75% da freq. cardíaca máx.)
            </T>
          </View>

          {!connected.hr && (
            <Button tone="alert" label="Parear cinta cardíaca" onPress={() => router.push('/settings')} />
          )}

          <Meter label="Minutos na zona" value={minutes} target={required} unit="min" />

          {(eb?.status === 'not_started' || !eb?.woke_at) && eb?.status !== 'no_hr_max' && (
            <Button label="Acordei · iniciar janela" onPress={checkIn} />
          )}
          {eb?.status === 'complete' && (
            <T color={colors.kryptonite}>Cardio em jejum cumprido. Média {eb.avg_hr ?? '—'} bpm.</T>
          )}
          {eb?.status === 'missed' && (
            <T color={colors.amber}>
              {Math.round(eb.minutes_in_zone)} de {eb.required_minutes} min na zona dentro da janela.
            </T>
          )}
        </Panel>

        <T variant="hint">
          Protocolo: nos primeiros 30 min após acordar, acumular {required} min com FC entre 70% e 80% da FC máx.,
          em jejum. A FC vem da cinta Bluetooth e é enviada ao servidor, que valida a janela.
        </T>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
});
