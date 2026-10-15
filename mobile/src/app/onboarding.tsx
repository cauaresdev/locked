import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../api/client';
import type { Sex, Tier } from '../api/types';
import { Badge, Button, Field, Panel, Row, T } from '../components/ui';
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
    name: 'Brawler / BvS Spec',
    spec: '94 MIN · 6 ON / 2 OFF',
    body: 'Protocolo integral. Recomendado apenas para ciclos de choque de 12 a 16 semanas.',
  },
];

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);
  const kg = Number(weight.replace(',', '.'));
  const valid = name.trim().length > 0 && kg >= 30 && kg <= 250 && (tier !== 'brawler' || waiver);

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
      });
      storeAthlete(athlete);
      router.replace('/today');
    } catch (e) {
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
            <Field label="Nome" value={name} onChangeText={setName} autoCapitalize="words" />
            <Field label="Peso (kg)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
          </Row>

          <Row style={{ alignItems: 'flex-end' }}>
            <Field label="Gordura %" value={bodyFat} onChangeText={setBodyFat} keyboardType="decimal-pad" placeholder="opcional" />
            <Field label="Altura cm" value={height} onChangeText={setHeight} keyboardType="number-pad" />
            <Field label="Nascimento" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" placeholder="ano" />
          </Row>
          <Row>
            {(['male', 'female'] as const).map((v) => (
              <Button key={v} tone={sex === v ? 'primary' : 'ghost'} label={v === 'male' ? 'Masculino' : 'Feminino'}
                onPress={() => setSex(v)} style={{ flex: 1 }} />
            ))}
          </Row>
          <T variant="label" style={{ textTransform: 'none' }}>
            Gordura corporal define a massa magra (calorias Jalali). Idade e sexo definem FC máx. e gasto calórico.
          </T>

          <T variant="label" style={{ marginTop: space.lg }}>Nível de operação</T>
          {TIERS.map((t) => {
            const selected = t.tier === tier;
            return (
              <Pressable key={t.tier} onPress={() => setTier(t.tier)} accessibilityRole="radio"
                accessibilityState={{ selected }}>
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
              <Pressable onPress={() => setWaiver((w) => !w)} accessibilityRole="checkbox"
                accessibilityState={{ checked: waiver }}>
                <Row>
                  <View style={[styles.box, waiver && { backgroundColor: colors.amber }]} />
                  <T>Li e aceito</T>
                </Row>
              </Pressable>
            </Panel>
          )}

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
  box: { width: 20, height: 20, borderWidth: 1, borderColor: colors.amber },
});
