import * as Crypto from 'expo-crypto';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { Alert, FoodEntryInput, Meal, NutritionDay } from '../../api/types';
import { FoodPicker } from '../../components/FoodPicker';
import { Meter } from '../../components/Meter';
import { Badge, Button, Divider, Panel, Row, T } from '../../components/ui';
import { addDays, isoDay } from '../../engine/format';
import { MEAL_LABEL, withPending } from '../../engine/nutrition';
import { cacheNutrition, cachedNutrition, enqueueFood, pendingFood, removeFood, storedAthlete } from '../../storage/db';
import { flushFood } from '../../sync';
import { colors, space } from '../../theme';

const ALERT_COLOR: Record<Alert['level'], string> = { red: colors.red, amber: colors.amber, info: colors.concrete };
const SOURCE_LABEL = { telemetry: 'medido (FC)', estimate: 'estimado', none: 'descanso' } as const;
const LBM_LABEL = { body_fat: '% gordura', boer: 'fórmula de Boer', assumed: 'estimada — informe % gordura' } as const;

/** Upload queued entries, then the day from the server (cached), or the cache when offline. */
async function fetchDay(athleteId: string, day: string): Promise<{ day: NutritionDay | null; offline: boolean }> {
  await flushFood(athleteId);
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
  const [day, setDay] = useState(isoDay());
  const [data, setData] = useState<NutritionDay | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState<Meal | null>(null);

  const load = useCallback(async () => {
    if (!athleteId) return;
    setLoading(true);
    const { day: d, offline: off } = await fetchDay(athleteId, day);
    setOffline(off);
    setData(d ? withPending(d, await pendingFood()) : null);
    setLoading(false);
  }, [athleteId, day]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!athleteId) return <Redirect href="/onboarding" />;

  async function add(entry: FoodEntryInput) {
    setPicker(null);
    await enqueueFood(entry);
    await load();
  }

  async function remove(id: string) {
    if (!athleteId) return;
    await removeFood([id]); // still queued: just drop it
    await api.deleteFood(athleteId, id).catch(() => {});
    await load();
  }

  async function toggleSupplement(itemId: string, taken: boolean) {
    if (!athleteId || !data) return;
    const supplements = await api.setSupplement(athleteId, day, itemId, taken).catch(() => null);
    if (supplements) setData({ ...data, supplements });
  }

  const isToday = day === isoDay();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.concrete} />}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <Pressable onPress={() => setDay(addDays(day, -1))} hitSlop={12} accessibilityRole="button">
            <T variant="label">◂ anterior</T>
          </Pressable>
          <T variant="label" color={colors.bone}>{isToday ? 'Hoje' : day}</T>
          <Pressable onPress={() => setDay(addDays(day, 1))} hitSlop={12} accessibilityRole="button">
            <T variant="label">próximo ▸</T>
          </Pressable>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="title">Six Pack Protocol</T>
          {offline && <Badge label="Offline" color={colors.amber} />}
        </Row>

        {!data && <Panel><T color={colors.concrete}>Sem dados em cache para este dia.</T></Panel>}

        {data && (
          <>
            <Panel>
              <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <T variant="metric">{data.consumed.kcal}</T>
                <T variant="label">de {data.target.kcal} kcal</T>
              </Row>
              <T variant="label" style={{ textTransform: 'none' }}>
                Massa magra {data.lbm_kg} kg ({LBM_LABEL[data.lbm_source]}) · faixa {data.kcal_floor}–{data.kcal_ceiling} ·
                treino +{data.session_kcal} kcal {SOURCE_LABEL[data.session_kcal_source]}
              </T>
              <Divider />
              <Meter label="Proteína" value={data.consumed.protein_g} target={data.target.protein_g} unit="g" />
              <Meter label="Carboidrato" value={data.consumed.carbs_g} target={data.target.carbs_g} unit="g" />
              <Meter label="Gordura" value={data.consumed.fat_g} target={data.target.fat_g} unit="g" />
              <Meter label="Sódio" value={data.consumed.sodium_mg} target={data.sodium_max_mg} min={data.sodium_min_mg}
                max={data.sodium_max_mg} unit="mg" />
            </Panel>

            {data.alerts.map((a, i) => (
              <Panel key={`${a.code}-${i}`} accent={ALERT_COLOR[a.level]}>
                <T color={ALERT_COLOR[a.level]}>{a.message}</T>
              </Panel>
            ))}

            {data.meals.map((m) => {
              const entries = data.entries.filter((e) => e.meal === m.meal);
              return (
                <Panel key={m.meal}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T style={{ fontSize: 16 }}>{MEAL_LABEL[m.meal]}</T>
                    {m.carb_curfew && <Badge label="Toque de recolher" color={colors.amber} />}
                  </Row>
                  <T variant="label" style={{ textTransform: 'none' }}>
                    Meta {m.target.kcal} kcal · P {m.target.protein_g} · C {m.target.carbs_g} · G {m.target.fat_g}
                    {'  '}| feito {m.consumed.kcal} kcal · Na {m.consumed.sodium_mg} mg
                  </T>
                  {m.carb_curfew && (
                    <T variant="label" style={{ textTransform: 'none' }}>
                      Só proteína magra + crucíferos (brócolis, couve-de-bruxelas, espinafre).
                    </T>
                  )}
                  {entries.map((e) => (
                    <Row key={e.id} style={{ justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <T numberOfLines={1} color={e.dairy === 'contains' ? colors.red : colors.bone}>{e.name}</T>
                        <T variant="label" style={{ textTransform: 'none' }}>
                          {e.grams} g · {Math.round(e.kcal)} kcal · Na {Math.round(e.sodium_mg)} mg
                        </T>
                      </View>
                      <Pressable onPress={() => remove(e.id)} hitSlop={10} accessibilityRole="button"
                        accessibilityLabel={`Remover ${e.name}`}>
                        <T variant="label">✕</T>
                      </Pressable>
                    </Row>
                  ))}
                  <Row>
                    <Button tone="ghost" label="+ Alimento" onPress={() => setPicker(m.meal)} style={{ flex: 1 }} />
                    <Button tone="ghost" label="Escanear" style={{ flex: 1 }}
                      onPress={() => router.push({ pathname: '/scan', params: { meal: m.meal, day } })} />
                  </Row>
                </Panel>
              );
            })}

            <Panel>
              <T variant="label">Suplementação</T>
              {data.supplements.map((s) => (
                <Pressable key={s.item_id} onPress={() => toggleSupplement(s.item_id, !s.taken)}
                  accessibilityRole="checkbox" accessibilityState={{ checked: s.taken }}>
                  <Row>
                    <View style={[styles.box, s.taken && { backgroundColor: colors.kryptonite, borderColor: colors.kryptonite }]} />
                    <T style={{ flex: 1, fontSize: 13 }} color={s.taken ? colors.kryptonite : colors.bone}>{s.label}</T>
                    <T variant="label">{MEAL_LABEL[s.meal]}</T>
                  </Row>
                </Pressable>
              ))}
            </Panel>

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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  box: { width: 16, height: 16, borderWidth: 1, borderColor: colors.concrete },
});
