import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, ApiError } from '../api/client';
import type { Sex, Tier } from '../api/types';
import { Badge, Button, Checkbox, Field, Panel, Row, T } from '../components/ui';
import { storeAthlete } from '../storage/db';
import { colors, space } from '../theme';

const TIERS: { tier: Tier; name: string; spec: string; body: string }[] = [
  {
    tier: 'vigilante',
    name: 'Vigilante',
    spec: '45 MIN · 4 SESSÕES / 7 DIAS',
    body: 'Mobilidade obrigatória + composto pesado + circuito final, com metade das séries.',
  },
  {
    tier: 'dark_knight',
    name: 'Dark Knight',
    spec: '60 MIN · 5 SESSÕES / 7 DIAS',
    body: 'Ponto de equilíbrio para atletas amadores avançados. 75% do volume integral.',
  },
  {
    tier: 'brawler',
    name: 'Brawler / preparação BvS',
    spec: '94 MIN · 6 DIAS DE TREINO + 2 DE FOLGA',
    body: 'Protocolo integral da preparação de Batman vs Superman (BvS). Recomendado apenas para ciclos de choque de 12 a 16 semanas.',
  },
];

const HEALTH_CONSENT =
  'Autorizo o tratamento dos meus dados de saúde (frequência cardíaca, VFC — variabilidade da frequência cardíaca —, ' +
  'sono, peso e treinos) para calcular a programação, a prontidão e a dieta. Posso exportar ou excluir tudo a qualquer ' +
  'momento em Ajustes, como garante a LGPD (Lei Geral de Proteção de Dados).';

const WAIVER =
  'O protocolo Brawler exige até 6 sessões de ~90 minutos a cada 8 dias. Ele não substitui ' +
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
  const [tier, setTier] = useState<Tier>('dark_knight');
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
          <T variant="label">Project Knightfall</T>
          <T variant="title">Configuração do operador</T>

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
              <Button key={v} tone={sex === v ? 'primary' : 'ghost'} label={v === 'male' ? 'Masculino' : 'Feminino'}
                onPress={() => setSex(v)} style={{ flex: 1 }} />
            ))}
          </Row>
          <T variant="hint">
            O % de gordura define a massa magra, base das calorias da dieta Jalali. Idade e sexo definem a frequência
            cardíaca máxima e o gasto calórico do treino.
          </T>

          <T variant="label" style={{ marginTop: space.lg }}>Nível de operação</T>
          {TIERS.map((t) => {
            const selected = t.tier === tier;
            return (
              <Pressable key={t.tier} onPress={() => setTier(t.tier)} accessibilityRole="radio"
                accessibilityState={{ checked: selected }}>
                <Panel accent={selected ? colors.bone : undefined} style={!selected && { opacity: 0.6 }}>
                  <T variant="title" style={{ fontSize: 18 }}>{t.name}</T>
                  <T variant="label">{t.spec}</T>
                  <T color={colors.concrete}>{t.body}</T>
                </Panel>
              </Pressable>
            );
          })}

          {tier === 'brawler' && (
            <Panel accent={colors.amber}>
              <Badge label="Termo de responsabilidade" color={colors.amber} />
              <T color={colors.concrete}>{WAIVER}</T>
              <Checkbox checked={waiver} onChange={setWaiver} color={colors.amber} borderColor={colors.amber}>
                <T>Li e aceito</T>
              </Checkbox>
            </Panel>
          )}

          <Panel>
            <Badge label="Dados de saúde" color={colors.concrete} />
            <T color={colors.concrete}>{HEALTH_CONSENT}</T>
            <Checkbox checked={consent} onChange={setConsent} color={colors.bone} borderColor={colors.bone}>
              <T>Autorizo</T>
            </Checkbox>
          </Panel>

          {error && <T color={colors.amber}>{error}</T>}
          <Button label={busy ? 'Conectando…' : 'Iniciar protocolo'} onPress={submit} disabled={!valid || busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
});
