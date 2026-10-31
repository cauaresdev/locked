import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, ApiError } from '../api/client';
import type { Sex, Tier } from '../api/types';
import { Icon } from '../components/Icon';
import { Button, Checkbox, Chip, Field, Panel, Row, ScreenHeader, T } from '../components/ui';
import { GYM_PRESETS, PROGRAMS } from '../engine/programs';
import { storeAthlete } from '../storage/db';
import { colors, space } from '../theme';


const HEALTH_CONSENT =
  'Autorizo o tratamento dos meus dados de saúde (frequência cardíaca, VFC — variabilidade da frequência cardíaca —, ' +
  'sono, peso e treinos) para calcular a programação, a prontidão e a dieta. Posso exportar ou excluir tudo a qualquer ' +
  'momento em Perfil, como garante a LGPD (Lei Geral de Proteção de Dados).';

const WAIVER =
  'O protocolo Brawler exige 6 sessões pesadas a cada 8 dias, com pliometria e AMRAP. Ele não substitui ' +
  'acompanhamento médico ou profissional. Declaro estar apto para exercício de alta intensidade, ' +
  'assumo os riscos e interromperei o treino diante de dor articular, tontura ou dor no peito.';

export default function Onboarding() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [height, setHeight] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [tier, setTier] = useState<Tier>('batfleck');
  const [gym, setGym] = useState(GYM_PRESETS[0].id);
  const [waiver, setWaiver] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);
  const kg = Number(weight.replace(',', '.'));
  const valid = name.trim().length > 0 && kg >= 30 && kg <= 250 && consent && (tier !== 'brawler' || waiver);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const athlete = await api.createAthlete({
        name: name.trim(),
        tier,
        bodyweight_kg: kg,
        body_fat_pct: num(bodyFat),
        height_cm: num(height),
        birth_year: num(birthYear),
        sex,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        equipment: GYM_PRESETS.find((p) => p.id === gym)?.equipment ?? null,
        accept_brawler_waiver: tier === 'brawler' && waiver,
        accept_health_data: consent,
      });
      storeAthlete(athlete);
      router.replace('/today');
    } catch (e) {
      // The account already has a profile (e.g. a login that dropped before loading it): use that one.
      const existing = e instanceof ApiError && e.status === 409 ? await api.me().catch(() => null) : null;
      if (existing) {
        storeAthlete(existing);
        router.replace('/today');
        return;
      }
      setError(e instanceof Error ? e.message : 'Falha de conexão');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader overline="Project Knightfall" title="Seu perfil" />

          <Row style={{ alignItems: 'flex-end' }}>
            <Field label="Nome" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name"
              textContentType="name" />
            <Field label="Peso (kg)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
          </Row>

          <Row style={{ alignItems: 'flex-end' }}>
            <Field label="Gordura %" value={bodyFat} onChangeText={setBodyFat} keyboardType="decimal-pad" placeholder="opcional" />
            <Field label="Altura cm" value={height} onChangeText={setHeight} keyboardType="number-pad" />
            <Field label="Nascimento" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" placeholder="ano"
              maxLength={4} />
          </Row>
          <Row>
            {(['male', 'female'] as const).map((v) => (
              <Chip key={v} selected={sex === v} label={v === 'male' ? 'Masculino' : 'Feminino'}
                onPress={() => setSex(v)} style={{ flex: 1 }} />
            ))}
          </Row>
          <T variant="hint">
            O % de gordura define a massa magra, base das calorias da dieta Jalali. Idade e sexo definem a frequência
            cardíaca máxima e o gasto calórico do treino.
          </T>

          <T variant="title" style={{ marginTop: space.lg }} accessibilityRole="header">Programa</T>
          {PROGRAMS.map((t) => {
            const selected = t.tier === tier;
            return (
              <Pressable key={t.tier} onPress={() => setTier(t.tier)} accessibilityRole="radio"
                accessibilityState={{ checked: selected }}>
                <Panel raised={selected} style={[styles.option, selected && styles.optionOn]}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T variant="title" style={{ flex: 1 }}>{t.name}</T>
                    {selected && <Icon name="check" size={20} color={colors.accent} strokeWidth={2.5} />}
                  </Row>
                  <T variant="label">{t.spec}</T>
                  <T variant="hint">{t.body}</T>
                </Panel>
              </Pressable>
            );
          })}

          <T variant="title" style={{ marginTop: space.lg }} accessibilityRole="header">Sua academia</T>
          <Row style={{ flexWrap: 'wrap' }}>
            {GYM_PRESETS.map((p) => (
              <Chip key={p.id} label={p.label} selected={gym === p.id} onPress={() => setGym(p.id)} />
            ))}
          </Row>
          <T variant="hint">
            Os treinos escolhem a máquina primeiro e trocam por smith, halteres ou peso corporal quando falta algo.
            Ajuste aparelho por aparelho depois, em Perfil.
          </T>

          {tier === 'brawler' && (
            <Panel accent={colors.warning} style={{ gap: space.md }}>
              <T variant="title" color={colors.warning}>Termo de responsabilidade</T>
              <T variant="hint">{WAIVER}</T>
              <Checkbox checked={waiver} onChange={setWaiver} color={colors.warning} borderColor={colors.warning}>
                <T>Li e aceito</T>
              </Checkbox>
            </Panel>
          )}

          <Panel style={{ gap: space.md }}>
            <T variant="title">Dados de saúde</T>
            <T variant="hint">{HEALTH_CONSENT}</T>
            <Checkbox checked={consent} onChange={setConsent} color={colors.success} borderColor={colors.textMuted}>
              <T>Autorizo</T>
            </Checkbox>
          </Panel>

          {error && <T color={colors.warning}>{error}</T>}
          <Button label={busy ? 'Conectando…' : 'Começar'} onPress={submit} disabled={!valid || busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  option: { borderWidth: 1.5, borderColor: 'transparent' },
  optionOn: { borderColor: colors.accent },
});
