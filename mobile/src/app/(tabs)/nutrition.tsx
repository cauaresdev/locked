import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert as Dialog, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { Alert, FoodEntryInput, Meal, NutritionDay, NutritionGoal } from '../../api/types';
import { FoodPicker } from '../../components/FoodPicker';
import { Meter } from '../../components/Meter';
import { Icon } from '../../components/Icon';
import { Badge, Button, Checkbox, Chip, Divider, Panel, ProgressBar, Row, ScreenHeader, Section, T } from '../../components/ui';
import { addDays, isoDay } from '../../engine/format';
import { MEAL_LABEL, withPending, withoutDeleted } from '../../engine/nutrition';
import {
  cacheNutrition,
  cachedNutrition,
  deleteFoodEntry,
  enqueueFood,
  pendingFood,
  pendingFoodDeletes,
  storeAthlete,
  storedAthlete,
} from '../../storage/db';
import { flushNutrition } from '../../sync';
import { colors, radius, space } from '../../theme';

const ALERT_COLOR: Record<Alert['level'], string> = { red: colors.danger, amber: colors.warning, info: colors.textMuted };
const ALERT_TEXT: Record<Alert['level'], string> = { red: colors.danger, amber: colors.warning, info: colors.textMuted };
const SOURCE_LABEL = { telemetry: 'medido pela frequência cardíaca', estimate: 'estimado', none: 'descanso' } as const;
const LBM_LABEL = { body_fat: '% gordura', boer: 'fórmula de Boer', assumed: 'estimada — informe % gordura' } as const;

/** Upload queued entries and deletes, then the day from the server (cached), or the cache when offline. */
async function fetchDay(athleteId: string, day: string): Promise<{ day: NutritionDay | null; offline: boolean }> {
  await flushNutrition(athleteId).catch(() => {});
  try {
    const d = await api.nutrition(athleteId, day);
    await cacheNutrition(d);
    return { day: d, offline: false };
  } catch {
    return { day: await cachedNutrition(day), offline: true };
  }
}

export default function Nutrition() {
  const router = useRouter();
  const athleteId = storedAthlete()?.id;
  const [day, setDay] = useState(isoDay);
  const [data, setData] = useState<NutritionDay | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false); // first load finished: "no data" is now a fact, not a wait
  const [picker, setPicker] = useState<Meal | null>(null);
  const [supplementError, setSupplementError] = useState<string | null>(null);
  const run = useRef(0); // only the latest load may write state (fast day paging overlaps loads)
  const paged = useRef(false); // the athlete moved off today by hand

  const load = useCallback(async () => {
    if (!athleteId) return;
    const id = ++run.current;
    const live = () => id === run.current;
    setLoading(true);
    try {
      const { day: d, offline: off } = await fetchDay(athleteId, day);
      const [pending, deleted] = await Promise.all([pendingFood(), pendingFoodDeletes()]);
      if (!live()) return;
      setOffline(off);
      setData(d ? withoutDeleted(withPending(d, pending), deleted) : null);
    } catch {
      // Local storage failed: keep what is on screen; pull-to-refresh tries again.
    } finally {
      if (live()) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, [athleteId, day]);

  useFocusEffect(
    useCallback(() => {
      // Tabs stay mounted across midnight: back on screen, follow the new day unless the athlete paged away.
      const today = isoDay();
      if (!paged.current && day !== today) {
        setData(null);
        setDay(today); // the new `load` runs this effect again
        return;
      }
      load();
    }, [load, day]),
  );

  if (!athleteId) return <Redirect href="/onboarding" />;

  function page(delta: number) {
    const next = addDays(day, delta);
    paged.current = next !== isoDay();
    setSupplementError(null);
    setData(null); // never yesterday's numbers under today's header while the new day loads
    setDay(next);
  }

  async function add(entry: FoodEntryInput) {
    // Saved before the picker closes: a failed write leaves it open with what was typed.
    try {
      await enqueueFood(entry);
    } catch {
      Dialog.alert('Não foi possível salvar', 'O alimento não foi registrado no aparelho. Tente de novo.');
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setPicker(null);
    await load();
  }

  async function remove(id: string) {
    if (!athleteId) return;
    try {
      await deleteFoodEntry(id); // drops it if still queued and queues the server delete
    } catch {
      Dialog.alert('Não foi possível remover', 'Tente de novo.');
      return;
    }
    await load();
  }

  async function toggleSupplement(itemId: string, taken: boolean) {
    if (!athleteId || !data) return;
    const forDay = data.day;
    // Optimistic: the box flips at once and flips back if the server refuses.
    const mark = (value: boolean) =>
      setData((d) =>
        d && d.day === forDay
          ? { ...d, supplements: d.supplements.map((s) => (s.item_id === itemId ? { ...s, taken: value } : s)) }
          : d,
      );
    mark(taken);
    setSupplementError(null);
    try {
      const supplements = await api.setSupplement(athleteId, forDay, itemId, taken);
      setData((d) => (d && d.day === forDay ? { ...d, supplements } : d));
    } catch {
      mark(!taken);
      setSupplementError('Sem conexão: a suplementação não foi salva.');
    }
  }

  const isToday = day === isoDay();

  async function setGoal(goal: NutritionGoal) {
    if (!athleteId || goal === data?.goal) return;
    try {
      storeAthlete(await api.updateAthlete(athleteId, { nutrition_goal: goal }));
      await load();
    } catch {
      setSupplementError('Não salvou o objetivo: sem conexão.');
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.textMuted} />}
      >
        <ScreenHeader overline={GOAL[data?.goal ?? 'cut'].overline} title="Nutrição"
          right={offline ? <Badge label="Offline" color={colors.warning} /> : undefined} />
        <View style={styles.dayNav}>
          <Pressable onPress={() => page(-1)} hitSlop={10} style={styles.navBtn} accessibilityRole="button"
            accessibilityLabel="Dia anterior">
            <Icon name="chevron-left" size={20} color={colors.textMuted} />
          </Pressable>
          <T style={{ fontWeight: '600' }}>{isToday ? 'Hoje' : day}</T>
          <Pressable onPress={() => page(1)} hitSlop={10} style={styles.navBtn} accessibilityRole="button"
            accessibilityLabel="Próximo dia">
            <Icon name="chevron-right" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        {!data && (
          <Panel>
            <T color={colors.textMuted}>{loaded && !loading ? 'Sem dados em cache para este dia.' : 'Carregando…'}</T>
          </Panel>
        )}

        {data && (
          <>
            <Panel style={{ gap: space.md, padding: space.xl }}>
              <Row style={{ alignItems: 'baseline', gap: space.xs }}>
                <T variant="metric" style={{ fontSize: 36 }}>{data.consumed.kcal}</T>
                <T variant="label">de {data.target.kcal} kcal</T>
              </Row>
              <ProgressBar value={data.target.kcal > 0 ? data.consumed.kcal / data.target.kcal : 0}
                color={data.consumed.kcal > data.kcal_ceiling ? colors.warning : colors.accent} />
              <T variant="hint">
                {data.goal === 'cycle'
                  ? `Faixa do dia ${data.kcal_floor}–${data.kcal_ceiling} kcal, pelas gramas por kg de peso corporal`
                  : `Massa magra ${data.lbm_kg} kg (${LBM_LABEL[data.lbm_source]}) · faixa ${data.kcal_floor}–${data.kcal_ceiling} · treino +${data.session_kcal} kcal ${SOURCE_LABEL[data.session_kcal_source]}`}
              </T>
              <GoalPicker goal={data.goal} onPick={setGoal} />
              {data.day_kind && <T variant="label" color={colors.accent}>{DAY_KIND[data.day_kind]}</T>}
              <Divider />
              <Meter label="Proteína" value={data.consumed.protein_g} target={data.target.protein_g} unit="g" />
              <Meter label="Carboidrato" value={data.consumed.carbs_g} target={data.target.carbs_g} unit="g" />
              <Meter label="Gordura" value={data.consumed.fat_g} target={data.target.fat_g} unit="g" />
              <Meter label="Sódio" value={data.consumed.sodium_mg} target={data.sodium_max_mg} min={data.sodium_min_mg}
                max={data.sodium_max_mg} unit="mg" />
            </Panel>

            {data.alerts.map((a, i) => (
              <Panel key={`${a.code}-${i}`} accent={ALERT_COLOR[a.level]}>
                <T color={ALERT_TEXT[a.level]}>{a.message}</T>
              </Panel>
            ))}

            {data.meals.map((m) => {
              const entries = data.entries.filter((e) => e.meal === m.meal);
              return (
                <Panel key={m.meal} style={{ gap: space.md }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T variant="title">{MEAL_LABEL[m.meal]}</T>
                    <T variant="label">{m.consumed.kcal} / {m.target.kcal} kcal</T>
                  </Row>
                  {m.carb_curfew && <Badge label="Sem carboidrato" color={colors.warning} />}
                  <T variant="hint">
                    Meta: proteína {m.target.protein_g} g · carboidrato {m.target.carbs_g} g · gordura {m.target.fat_g} g ·
                    sódio feito {m.consumed.sodium_mg} mg
                  </T>
                  {m.carb_curfew && (
                    <T variant="hint">
                      Só proteína magra + crucíferos (brócolis, couve-de-bruxelas, espinafre).
                    </T>
                  )}
                  {entries.map((e) => (
                    <Row key={e.id} style={{ justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Row>
                          <T numberOfLines={1} style={{ flexShrink: 1 }}
                            color={e.dairy === 'contains' ? colors.danger : colors.text}>{e.name}</T>
                          {/* Written, so the flag is not color alone. */}
                          {e.dairy === 'contains' && <Badge label="Laticínio" color={colors.danger} />}
                        </Row>
                        <T variant="hint">
                          {e.grams} g · {Math.round(e.kcal)} kcal · sódio {Math.round(e.sodium_mg)} mg
                        </T>
                      </View>
                      <Pressable onPress={() => remove(e.id)} hitSlop={14} accessibilityRole="button"
                        accessibilityLabel={`Remover ${e.name}`}>
                        <Icon name="close" size={18} color={colors.textMuted} />
                      </Pressable>
                    </Row>
                  ))}
                  <Row>
                    <Button tone="secondary" icon="plus" label="Alimento" onPress={() => setPicker(m.meal)} style={{ flex: 1 }} />
                    <Button tone="secondary" icon="camera" label="Escanear" style={{ flex: 1 }}
                      onPress={() => router.push({ pathname: '/scan', params: { meal: m.meal, day } })} />
                  </Row>
                </Panel>
              );
            })}

            <Section title="Suplementação">
              <Panel style={{ paddingVertical: space.sm }}>
              {data.supplements.map((s) => (
                <Checkbox key={s.item_id} checked={s.taken} onChange={(v) => toggleSupplement(s.item_id, v)}
                  accessibilityLabel={`${s.label}, ${MEAL_LABEL[s.meal]}`}>
                  <T style={{ flex: 1 }} color={s.taken ? colors.textMuted : colors.text}>{s.label}</T>
                  <T variant="label">{MEAL_LABEL[s.meal]}</T>
                </Checkbox>
              ))}
              {supplementError && <T color={colors.warning}>{supplementError}</T>}
              </Panel>
            </Section>

            {picker && (
              <FoodPicker
                visible
                meal={picker}
                day={day}
                suggestions={data.meals.find((x) => x.meal === picker)?.suggestions ?? []}
                newId={Crypto.randomUUID}
                onAdd={add}
                onClose={() => setPicker(null)}
              />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const GOAL: Record<NutritionGoal, { label: string; overline: string; hint: string }> = {
  cut: { label: 'Secar', overline: 'Six Pack Protocol', hint: 'Dieta Jalali: 12–14 kcal por libra de massa magra.' },
  maintain: { label: 'Manter', overline: 'Manutenção', hint: 'Estimativa de manutenção: 15–17 kcal por libra de massa magra.' },
  bulk: {
    label: 'Ganhar massa',
    overline: 'Fase de massa (BvS)',
    hint: 'Superávit leve: 17–19 kcal por libra de massa magra. Se a média de 7 dias subir mais de 0,5 kg por semana, volte para Manter.',
  },
  cycle: {
    label: 'Crescimento limpo',
    overline: 'Jalali otimizado · ciclagem de carboidrato',
    hint: 'Proteína 2,0–2,2 g/kg e gordura 0,8–1,0 g/kg todo dia; carboidrato pelo treino (pernas, força máxima e sprint 4–5 g/kg, superior 3–3,5 g/kg, descanso 2–2,5 g/kg), 60% dele no pré e no pós-treino. Sem corte de carboidrato à noite, sem restrição de laticínio e sódio entre 3.000 e 4.000 mg.',
  },
};

const DAY_KIND: Record<NonNullable<NutritionDay['day_kind']>, string> = {
  high: 'Dia de carboidrato alto: pernas, força máxima ou sprint',
  medium: 'Dia de carboidrato médio: superior',
  rest: 'Dia de carboidrato baixo: descanso',
};

/** Cut, maintain or bulk: moves the calorie band; protein stays tied to lean mass. */
function GoalPicker({ goal, onPick }: { goal: NutritionGoal; onPick: (g: NutritionGoal) => void }) {
  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
        {(Object.keys(GOAL) as NutritionGoal[]).map((g) => (
          <Chip key={g} label={GOAL[g].label} selected={goal === g} onPress={() => onPick(g)} />
        ))}
      </Row>
      <T variant="hint">{GOAL[goal].hint}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.xs,
  },
  navBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
