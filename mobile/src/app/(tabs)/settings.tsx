import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { Athlete, Sex, Tier } from '../../api/types';
import { clearToken } from '../../auth';
import { useDevices, type FoundDevice } from '../../ble/devices';
import { Badge, Button, Divider, Field, Panel, Row, T } from '../../components/ui';
import { isoDay } from '../../engine/format';
import { healthProvider, syncNight } from '../../health';
import { cancelEarlyBird } from '../../notifications';
import {
  clearLocalData,
  healthSyncEnabled,
  pendingTotal,
  setHealthSyncEnabled,
  storeAthlete,
  storedAthlete,
} from '../../storage/db';
import type { DeviceRole } from '../../storage/db';
import { flushAll } from '../../sync';
import { colors, space } from '../../theme';

const TIER_LABEL: Record<Tier, string> = { vigilante: 'Vigilante', dark_knight: 'Dark Knight', brawler: 'Brawler' };
const ROLE_LABEL: Record<DeviceRole, string> = { hr: 'Cinta cardíaca', bike: 'AirBike / bike (FTMS)' };

const str = (v: number | null | undefined) => (v == null ? '' : String(v));
const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);

export default function Settings() {
  const router = useRouter();
  const devices = useDevices();
  const [athlete, setAthlete] = useState<Athlete | null>(storedAthlete());
  const [form, setForm] = useState(() => ({
    name: athlete?.name ?? '',
    weight: str(athlete?.bodyweight_kg),
    bf: str(athlete?.body_fat_pct),
    height: str(athlete?.height_cm),
    birth: str(athlete?.birth_year),
    hrmax: str(athlete?.hr_max_override),
    sex: athlete?.sex ?? null,
  }));
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [health, setHealth] = useState(healthSyncEnabled());

  if (!athlete) return <Redirect href="/onboarding" />;

  async function save(body: Parameters<typeof api.updateAthlete>[1], okText: string) {
    if (!athlete) return;
    try {
      const a = await api.updateAthlete(athlete.id, body);
      storeAthlete(a);
      setAthlete(a);
      setMsg({ text: okText, tone: 'ok' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Falha ao salvar', tone: 'err' });
    }
  }

  function changeTier(tier: Tier) {
    if (!athlete || tier === athlete.tier) return;
    const go = (waiver: boolean) =>
      save({ tier, accept_brawler_waiver: waiver }, `Tier ${TIER_LABEL[tier]}: novo ciclo começa hoje.`);
    if (tier === 'brawler' && !athlete.waiver_accepted_at) {
      Alert.alert(
        'Termo de responsabilidade',
        'O Brawler exige até 6 sessões de ~90 min a cada 8 dias e não substitui acompanhamento médico. ' +
          'Declaro estar apto e assumo os riscos.',
        [{ text: 'Cancelar', style: 'cancel' }, { text: 'Aceito', onPress: () => go(true) }],
      );
    } else {
      Alert.alert('Trocar de tier?', 'O ciclo reinicia hoje no dia 1.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Trocar', onPress: () => go(false) },
      ]);
    }
  }

  async function toggleHealth() {
    const p = healthProvider();
    if (!p) return;
    if (health) {
      setHealthSyncEnabled(false);
      setHealth(false);
      return;
    }
    try {
      if (!(await p.available())) throw new Error(`${p.name} indisponível neste aparelho`);
      if (!(await p.requestAccess())) throw new Error('Permissão negada');
      setHealthSyncEnabled(true);
      setHealth(true);
      await syncNow();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'err' });
    }
  }

  async function syncNow() {
    if (!athlete) return;
    try {
      const r = await syncNight(athlete.id, isoDay());
      setMsg(r ? { text: `Prontidão atualizada: ${r.score}`, tone: 'ok' } : { text: 'Nenhum dado da última noite', tone: 'err' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'err' });
    }
  }

  async function signOut() {
    await api.logout().catch(() => {});
    await cancelEarlyBird();
    await clearToken();
    await clearLocalData();
    router.replace('/login');
  }

  async function logout() {
    // Signing out wipes the device, so upload what is queued first.
    if (athlete) await flushAll(athlete.id);
    const pending = await pendingTotal();
    if (pending === 0) return signOut();
    Alert.alert(
      'Dados não sincronizados',
      `${pending} ${pending === 1 ? 'item ainda não foi enviado' : 'itens ainda não foram enviados'} ao servidor e serão perdidos ao sair.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sair mesmo assim', style: 'destructive', onPress: signOut },
      ],
    );
  }

  const provider = healthProvider();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <T variant="title">Ajustes</T>
        {msg && (
          <Panel accent={msg.tone === 'ok' ? colors.kryptonite : colors.amber}>
            <T color={msg.tone === 'ok' ? colors.kryptonite : colors.amber}>{msg.text}</T>
          </Panel>
        )}

        <Panel>
          <T variant="label">Perfil</T>
          <Field label="Nome" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
          <Row>
            <Field label="Peso kg" value={form.weight} onChangeText={(v) => setForm({ ...form, weight: v })} keyboardType="decimal-pad" />
            <Field label="Gordura %" value={form.bf} onChangeText={(v) => setForm({ ...form, bf: v })} keyboardType="decimal-pad" />
            <Field label="Altura cm" value={form.height} onChangeText={(v) => setForm({ ...form, height: v })} keyboardType="number-pad" />
          </Row>
          <Row>
            <Field label="Nascimento" value={form.birth} onChangeText={(v) => setForm({ ...form, birth: v })} keyboardType="number-pad" />
            <Field label="FC máx (opc.)" value={form.hrmax} onChangeText={(v) => setForm({ ...form, hrmax: v })}
              keyboardType="number-pad" placeholder={athlete.hr_max ? String(athlete.hr_max) : '—'} />
          </Row>
          <Row>
            {(['male', 'female'] as Sex[]).map((v) => (
              <Button key={v} tone={form.sex === v ? 'primary' : 'ghost'} label={v === 'male' ? 'Masculino' : 'Feminino'}
                onPress={() => setForm({ ...form, sex: v })} style={{ flex: 1 }} />
            ))}
          </Row>
          <Button
            label="Salvar perfil"
            onPress={() =>
              save(
                {
                  name: form.name.trim() || athlete.name,
                  bodyweight_kg: num(form.weight) ?? athlete.bodyweight_kg,
                  body_fat_pct: num(form.bf),
                  height_cm: num(form.height),
                  birth_year: num(form.birth),
                  hr_max_override: num(form.hrmax),
                  sex: form.sex,
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                },
                'Perfil salvo.',
              )
            }
          />
        </Panel>

        <Panel>
          <T variant="label">Nível de operação</T>
          <Row>
            {(Object.keys(TIER_LABEL) as Tier[]).map((t) => (
              <Button key={t} tone={athlete.tier === t ? 'primary' : 'ghost'} label={TIER_LABEL[t]}
                onPress={() => changeTier(t)} style={{ flex: 1, paddingHorizontal: 4 }} />
            ))}
          </Row>
          <T variant="label" style={{ textTransform: 'none' }}>Ciclo atual iniciado em {athlete.cycle_start}.</T>
        </Panel>

        <Panel>
          <T variant="label">Dispositivos Bluetooth</T>
          {(['hr', 'bike'] as DeviceRole[]).map((role) => (
            <Row key={role} style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <T>{ROLE_LABEL[role]}</T>
                <T variant="label" color={devices.connected[role] ? colors.kryptonite : colors.concrete}>
                  {devices.connected[role] ?? 'desconectado'}
                </T>
              </View>
              {devices.connected[role] && (
                <Pressable onPress={() => devices.forget(role)} hitSlop={10} accessibilityRole="button">
                  <T variant="label">Esquecer</T>
                </Pressable>
              )}
            </Row>
          ))}
          <Button tone="ghost" label={devices.scanning ? 'Buscando…' : 'Buscar dispositivos'} onPress={devices.scan}
            disabled={devices.scanning} />
          {devices.error && <T color={colors.amber}>{devices.error}</T>}
          {devices.found.map((d: FoundDevice) => (
            <View key={d.id} style={{ gap: space.xs }}>
              <Divider />
              <Row style={{ justifyContent: 'space-between' }}>
                <T style={{ flex: 1 }} numberOfLines={1}>{d.name}</T>
                <T variant="label">{d.rssi} dBm</T>
              </Row>
              <Row>
                {d.roles.map((role) => (
                  <Button key={role} tone="ghost" label={`Usar como ${role === 'hr' ? 'cinta' : 'bike'}`}
                    onPress={() => devices.connect(d, role)} style={{ flex: 1 }} />
                ))}
              </Row>
            </View>
          ))}
        </Panel>

        {provider && (
          <Panel>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="label">{provider.name}</T>
              <Badge label={health ? 'Ativo' : 'Desligado'} color={health ? colors.kryptonite : colors.concrete} />
            </Row>
            <T variant="label" style={{ textTransform: 'none' }}>
              VFC, FC de repouso e sono da última noite alimentam o Batsuit Readiness Score. Garmin, Oura e Whoop
              entram via sincronização do app do fabricante com o {provider.name}.
            </T>
            <Row>
              <Button tone={health ? 'ghost' : 'primary'} label={health ? 'Desativar' : 'Conectar'} onPress={toggleHealth}
                style={{ flex: 1 }} />
              {health && <Button tone="ghost" label="Sincronizar agora" onPress={syncNow} style={{ flex: 1 }} />}
            </Row>
          </Panel>
        )}

        <Panel>
          <T variant="label">Conta</T>
          <T variant="label" style={{ textTransform: 'none' }}>
            Servidor: {process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'}
          </T>
          <Button tone="alert" label="Sair" onPress={logout} />
        </Panel>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
});
