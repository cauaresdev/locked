import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { AccessibilityInfo, Alert, AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { Athlete, Implement, Sex, Tier } from '../../api/types';
import { clearToken } from '../../auth';
import { useDeviceControls, useDeviceScan, type FoundDevice } from '../../ble/devices';
import { Icon } from '../../components/Icon';
import { Badge, Button, Chip, Divider, Field, Panel, Row, ScreenHeader, T, TextLink } from '../../components/ui';
import { isoDay } from '../../engine/format';
import { GLOSSARY, signalLabel } from '../../engine/glossary';
import { ALL_EQUIPMENT, EQUIPMENT_GROUPS, GYM_PRESETS, PROGRAM_NAME, PROGRAMS } from '../../engine/programs';
import { healthProvider, syncNight } from '../../health';
import { cancelEarlyBird, exactAlarmsAllowed, openExactAlarmSettings } from '../../notifications';
import {
  clearLocalData,
  healthSyncEnabled,
  pendingTotal,
  rejectedCount,
  setHealthSyncEnabled,
  storeAthlete,
  storedAthlete,
} from '../../storage/db';
import type { DeviceRole } from '../../storage/db';
import { flushAll } from '../../sync';
import { colors, radius, space } from '../../theme';

const ROLE_LABEL: Record<DeviceRole, string> = {
  hr: 'Cinta cardíaca',
  bike: 'AirBike / bike (padrão FTMS: Bluetooth de aparelhos de academia)',
};


const str = (v: number | null | undefined) => (v == null ? '' : String(v));
const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);
const formOf = (a: Athlete | null) => ({
  name: a?.name ?? '',
  weight: str(a?.bodyweight_kg),
  bf: str(a?.body_fat_pct),
  height: str(a?.height_cm),
  birth: str(a?.birth_year),
  hrmax: str(a?.hr_max_override),
  sex: a?.sex ?? null,
});

type Form = ReturnType<typeof formOf>;
// Feedback shows next to the panel that caused it, not at the top of a long screen.
type Where = 'profile' | 'tier' | 'health' | 'equipment' | 'account';
type Msg = { text: string; tone: 'ok' | 'err'; at: Where };
const MSG_MS = { ok: 4000, err: 8000 } as const; // errors stay a little longer to be read

function Feedback({ msg, at }: { msg: Msg | null; at: Where }) {
  if (!msg || msg.at !== at) return null;
  return <T color={msg.tone === 'ok' ? colors.success : colors.warning}>{msg.text}</T>;
}

export default function Settings() {
  const router = useRouter();
  const devices = useDeviceControls();
  const scan = useDeviceScan();
  const [athlete, setAthlete] = useState<Athlete | null>(storedAthlete());
  const [form, setForm] = useState(() => formOf(athlete));
  const edited = useRef(false); // unsaved typing in the profile form
  const [msg, setMsgState] = useState<Msg | null>(null);
  const [health, setHealth] = useState(healthSyncEnabled());

  const setMsg = useCallback((m: Msg) => {
    setMsgState(m);
    AccessibilityInfo.announceForAccessibility(m.text);
  }, []);

  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsgState(null), MSG_MS[msg.tone]);
    return () => clearTimeout(id);
  }, [msg]);

  // Other screens refresh the stored profile (e.g. the 7-day weight trend): show the current one,
  // unless the athlete has unsaved edits in the form.
  useFocusEffect(
    useCallback(() => {
      const a = storedAthlete();
      setAthlete(a);
      if (!edited.current) setForm(formOf(a));
    }, []),
  );

  if (!athlete) return <Redirect href="/onboarding" />;

  const edit = (patch: Partial<Form>) => {
    edited.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };

  async function save(body: Parameters<typeof api.updateAthlete>[1], okText: string, at: Where) {
    if (!athlete) return;
    try {
      const a = await api.updateAthlete(athlete.id, body);
      storeAthlete(a);
      setAthlete(a);
      if (at === 'profile') edited.current = false;
      if (at === 'profile' || !edited.current) setForm(formOf(a));
      setMsg({ text: okText, tone: 'ok', at });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Falha ao salvar', tone: 'err', at });
    }
  }

  function changeTier(tier: Tier) {
    if (!athlete || tier === athlete.tier) return;
    const go = (waiver: boolean) =>
      save({ tier, accept_brawler_waiver: waiver }, `Programa ${PROGRAM_NAME[tier]}: novo ciclo começa hoje.`, 'tier');
    if (tier === 'brawler' && !athlete.waiver_accepted_at) {
      Alert.alert(
        'Termo de responsabilidade',
        'O Brawler exige até 6 sessões de ~90 min a cada 8 dias e não substitui acompanhamento médico. ' +
          'Declaro estar apto e assumo os riscos.',
        [{ text: 'Cancelar', style: 'cancel' }, { text: 'Aceito', onPress: () => go(true) }],
      );
    } else {
      Alert.alert('Trocar de programa?', 'O ciclo reinicia hoje no dia 1.', [
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
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'err', at: 'health' });
    }
  }

  async function syncNow() {
    if (!athlete) return;
    try {
      const r = await syncNight(athlete.id, isoDay());
      setMsg(r
        ? { text: `Prontidão atualizada: ${r.score}`, tone: 'ok', at: 'health' }
        : { text: 'Nenhum dado de VFC ou sono da última noite', tone: 'err', at: 'health' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'err', at: 'health' });
    }
  }

  async function signOut() {
    await api.logout().catch(() => {});
    await cancelEarlyBird();
    await devices.reset(); // a live strap would keep queueing HR into the next account
    await clearToken();
    await clearLocalData();
    router.replace('/login');
  }

  async function logout() {
    // Signing out wipes the device, so upload what is queued first.
    if (athlete) await flushAll(athlete.id).catch(() => {});
    const [pending, rejected] = await Promise.all([pendingTotal(), rejectedCount()]);
    if (pending + rejected === 0) return signOut();
    const parts = [
      pending > 0 && `${pending} ${pending === 1 ? 'item ainda não foi enviado' : 'itens ainda não foram enviados'} ao servidor`,
      rejected > 0 && `${rejected} ${rejected === 1 ? 'item foi recusado' : 'itens foram recusados'} pelo servidor`,
    ].filter(Boolean);
    Alert.alert(
      'Dados não sincronizados',
      `${parts.join(' e ')}. Tudo isso será perdido ao sair.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sair mesmo assim', style: 'destructive', onPress: signOut },
      ],
    );
  }

  async function exportData() {
    try {
      const data = await api.exportData();
      const file = new File(Paths.cache, `knightfall-dados-${isoDay()}.json`);
      file.write(JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) {
        try {
          await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Seus dados do Knightfall' });
        } finally {
          // Health data must not linger in the cache once it has been handed over.
          try {
            if (file.exists) file.delete();
          } catch {
            // the OS cleans the cache eventually
          }
        }
      } else {
        setMsg({ text: `Arquivo salvo em ${file.uri}`, tone: 'ok', at: 'account' });
      }
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Falha ao exportar (requer conexão)', tone: 'err', at: 'account' });
    }
  }

  async function deleteAccount(password: string) {
    try {
      await api.deleteAccount(password);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Falha ao excluir (requer conexão)', tone: 'err', at: 'account' });
      return;
    }
    await cancelEarlyBird();
    await devices.reset();
    await clearToken();
    await clearLocalData();
    router.replace('/login');
  }

  const provider = healthProvider();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <ScreenHeader title="Perfil" overline={athlete.name} />

        <Panel style={styles.panel}>
          <T variant="title">Dados pessoais</T>
          <Field label="Nome" value={form.name} onChangeText={(v) => edit({ name: v })} autoComplete="name" />
          <Row>
            <Field label="Peso kg" value={form.weight} onChangeText={(v) => edit({ weight: v })} keyboardType="decimal-pad" />
            <Field label="Gordura %" value={form.bf} onChangeText={(v) => edit({ bf: v })} keyboardType="decimal-pad" />
            <Field label="Altura cm" value={form.height} onChangeText={(v) => edit({ height: v })} keyboardType="number-pad" />
          </Row>
          <Row>
            <Field label="Nascimento" value={form.birth} onChangeText={(v) => edit({ birth: v })} keyboardType="number-pad"
              maxLength={4} placeholder="ano" />
            <Field label="Freq. cardíaca máx. (opcional)" value={form.hrmax} onChangeText={(v) => edit({ hrmax: v })}
              keyboardType="number-pad" placeholder={athlete.hr_max ? String(athlete.hr_max) : '—'} />
          </Row>
          <Row>
            {(['male', 'female'] as Sex[]).map((v) => (
              <Chip key={v} selected={form.sex === v} label={v === 'male' ? 'Masculino' : 'Feminino'}
                onPress={() => edit({ sex: v })} style={{ flex: 1 }} />
            ))}
          </Row>
          <Button
            tone="secondary"
            label="Salvar perfil"
            onPress={() =>
              save(
                {
                  name: form.name.trim() || athlete.name,
                  // Only a typed change: resending the stored value would override the 7-day trend.
                  ...(form.weight !== str(athlete.bodyweight_kg) && num(form.weight) != null
                    ? { bodyweight_kg: num(form.weight) }
                    : {}),
                  body_fat_pct: num(form.bf),
                  height_cm: num(form.height),
                  birth_year: num(form.birth),
                  hr_max_override: num(form.hrmax),
                  sex: form.sex,
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                },
                'Perfil salvo.',
                'profile',
              )
            }
          />
          <Feedback msg={msg} at="profile" />
        </Panel>

        <Panel style={styles.panel}>
          <T variant="title">Programa</T>
          <View style={{ gap: space.sm }}>
            {PROGRAMS.map((p) => {
              const on = athlete.tier === p.tier;
              return (
                <Pressable key={p.tier} onPress={() => changeTier(p.tier)} accessibilityRole="radio"
                  accessibilityState={{ checked: on }} accessibilityLabel={`${p.name}. ${p.spec}. ${p.body}`}
                  style={[styles.program, on && styles.programOn]}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T variant="title" color={on ? colors.accent : colors.text}>{p.name}</T>
                    {on && <Icon name="check" size={18} color={colors.accent} />}
                  </Row>
                  <T variant="label">{p.spec}</T>
                  <T variant="hint">{p.body}</T>
                </Pressable>
              );
            })}
          </View>
          <T variant="hint">Ciclo atual iniciado em {athlete.cycle_start}.</T>
          <Feedback msg={msg} at="tier" />
        </Panel>

        <Panel style={styles.panel}>
          <T variant="title">Dispositivos Bluetooth</T>
          {(['hr', 'bike'] as DeviceRole[]).map((role) => (
            <Row key={role} style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <T>{ROLE_LABEL[role]}</T>
                <T variant="label" color={devices.connected[role] ? colors.success : colors.textMuted}>
                  {devices.connected[role] ?? 'desconectado'}
                </T>
              </View>
              {devices.connected[role] && (
                <TextLink label="Esquecer" accessibilityLabel={`Esquecer ${devices.connected[role]}`}
                  onPress={() => devices.forget(role)} />
              )}
            </Row>
          ))}
          <Button tone="secondary" icon="bluetooth" label={scan.scanning ? 'Buscando…' : 'Buscar dispositivos'} onPress={scan.scan}
            disabled={scan.scanning} />
          {scan.error && <T color={colors.warning}>{scan.error}</T>}
          {scan.found.map((d: FoundDevice) => (
            <View key={d.id} style={{ gap: space.xs }}>
              <Divider />
              <Row style={{ justifyContent: 'space-between' }}>
                <T style={{ flex: 1 }} numberOfLines={1}>{d.name}</T>
                <T variant="label">{signalLabel(d.rssi)} ({d.rssi} dBm)</T>
              </Row>
              <Row>
                {d.roles.map((role) => (
                  <Button key={role} tone="secondary" label={`Usar como ${role === 'hr' ? 'cinta' : 'bike'}`}
                    onPress={() => devices.connect(d, role)} style={{ flex: 1 }} />
                ))}
              </Row>
            </View>
          ))}
        </Panel>

        {provider && (
          <Panel style={styles.panel}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="title">{provider.name}</T>
              <Badge label={health ? 'Ativo' : 'Desligado'} color={health ? colors.success : colors.textMuted} />
            </Row>
            <T variant="hint">
              VFC (variabilidade da frequência cardíaca), frequência cardíaca de repouso e sono da última noite
              alimentam a prontidão; o peso de uma balança conectada entra na média de 7 dias. Garmin, Oura e Whoop
              entram via sincronização do app do fabricante com o {provider.name}.
            </T>
            <Row>
              <Button tone="secondary" label={health ? 'Desativar' : 'Conectar'} onPress={toggleHealth}
                style={{ flex: 1 }} />
              {health && <Button tone="secondary" label="Sincronizar agora" onPress={syncNow} style={{ flex: 1 }} />}
            </Row>
            <Feedback msg={msg} at="health" />
          </Panel>
        )}

        <ExactAlarmPanel />

        <EquipmentPanel athlete={athlete} onSave={(equipment) => save({ equipment }, 'Equipamentos salvos.', 'equipment')}
          feedback={<Feedback msg={msg} at="equipment" />} />

        <Panel style={styles.panel}>
          <T variant="title">Conta e dados</T>
          <T variant="hint">
            Servidor: {process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'}
          </T>
          <T variant="hint">
            Pela LGPD (Lei Geral de Proteção de Dados) você pode baixar tudo o que o app guarda sobre você e excluir a
            conta a qualquer momento.
          </T>
          <Button tone="secondary" label="Exportar meus dados" onPress={exportData} />
          <Button tone="secondary" label="Sair" onPress={logout} />
          <DeleteAccount onDelete={deleteAccount} />
          <Feedback msg={msg} at="account" />
        </Panel>

        <Glossary />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Only while Android may hold alarms back; coming back from the system screen checks again. */
function ExactAlarmPanel() {
  const [allowed, setAllowed] = useState(exactAlarmsAllowed);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setAllowed(exactAlarmsAllowed());
    });
    return () => sub.remove();
  }, []);
  if (allowed) return null;
  return (
    <Panel accent={colors.warning} style={styles.panel}>
      <T variant="title">Avisos na hora certa</T>
      <T variant="hint">
        Com a tela travada, o Android pode atrasar o fim do descanso e o despertador do Early Bird. Ative
        “Alarmes e lembretes” para o Knightfall e eles tocam no segundo exato.
      </T>
      <Button tone="secondary" label="Ativar alarmes e lembretes" onPress={openExactAlarmSettings} />
    </Panel>
  );
}

function EquipmentPanel({
  athlete,
  onSave,
  feedback,
}: {
  athlete: Athlete;
  onSave: (e: Implement[] | null) => Promise<void>;
  feedback: ReactNode;
}) {
  const [picked, setPicked] = useState<Set<Implement>>(() => new Set(athlete.equipment));
  const full = ALL_EQUIPMENT.every((id) => picked.has(id));
  const toggle = (id: Implement) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Panel style={styles.panel}>
      <T variant="title">Equipamentos da academia</T>
      <T variant="hint">
        Os treinos usam só o que estiver marcado (peso corporal sempre conta): na falta de uma máquina entra a
        próxima opção da lista, como smith, halteres ou peso corporal. Na sessão, “Trocar exercício” mostra as
        alternativas.
      </T>
      <View style={styles.chips}>
        {GYM_PRESETS.map((p) => (
          <Chip key={p.id} label={p.label} selected={false} accessibilityLabel={`Marcar: ${p.label}`}
            onPress={() => setPicked(new Set(p.equipment ?? ALL_EQUIPMENT))} />
        ))}
      </View>
      {EQUIPMENT_GROUPS.map((g) => (
        <View key={g.title} style={{ gap: space.sm }}>
          <T variant="label">{g.title}</T>
          <View style={styles.chips}>
            {g.items.map((e) => (
              <Chip key={e.id} role="checkbox" label={e.label} selected={picked.has(e.id)} onPress={() => toggle(e.id)} />
            ))}
          </View>
        </View>
      ))}
      <Button label="Salvar equipamentos"
        onPress={() => onSave(full ? null : [...[...picked].filter((id) => ALL_EQUIPMENT.includes(id)), 'bodyweight'])} />
      {feedback}
    </Panel>
  );
}

function DeleteAccount({ onDelete }: { onDelete: (password: string) => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  if (!open) return <Button tone="danger" label="Excluir minha conta" onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: space.sm }}>
      <T color={colors.danger}>
        Apaga a conta e todos os treinos, pesagens, dieta e dados de saúde do servidor. Não dá para desfazer.
      </T>
      <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry placeholder="Confirme com sua senha"
        autoComplete="current-password" textContentType="password" style={{ fontSize: 16 }} />
      <Row>
        <Button tone="secondary" label="Cancelar" onPress={() => setOpen(false)} style={{ flex: 1 }} />
        <Button tone="danger" label="Excluir tudo" disabled={!password}
          onPress={() =>
            Alert.alert('Excluir a conta?', 'Todos os dados serão apagados permanentemente.', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Excluir', style: 'destructive', onPress: () => onDelete(password) },
            ])
          }
          style={{ flex: 1 }} />
      </Row>
    </View>
  );
}

function Glossary() {
  const [open, setOpen] = useState(false);
  return (
    <Panel>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ minHeight: 44, justifyContent: 'center' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="title">Glossário</T>
          <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
            <Icon name="chevron-right" size={20} color={colors.textMuted} />
          </View>
        </Row>
      </Pressable>
      {open &&
        GLOSSARY.map((g) => (
          <View key={g.term} style={{ gap: 2, marginTop: space.sm }}>
            <T>
              <T style={{ fontWeight: '700' }}>{g.term}</T> — {g.meaning}
            </T>
            <T variant="hint">{g.detail}</T>
          </View>
        ))}
    </Panel>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  panel: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  program: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceHigh },
  programOn: { borderWidth: 1, borderColor: colors.accent },
});
