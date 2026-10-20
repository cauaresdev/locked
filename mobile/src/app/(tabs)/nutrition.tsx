import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert as Dialog, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { Alert, FoodEntryInput, Meal, NutritionDay } from '../../api/types';
import { FoodPicker } from '../../components/FoodPicker';
import { Meter } from '../../components/Meter';
import { Badge, Button, Checkbox, Divider, Panel, Row, T } from '../../components/ui';
import { addDays, isoDay } from '../../engine/format';
import { MEAL_LABEL, withPending, withoutDeleted } from '../../engine/nutrition';
import {
  cacheNutrition,
  cachedNutrition,
  deleteFoodEntry,
  enqueueFood,
  pendingFood,
  pendingFoodDeletes,
  storedAthlete,
} from '../../storage/db';
import { flushNutrition } from '../../sync';
import { colors, space } from '../../theme';

const ALERT_COLOR: Record<Alert['level'], string> = { red: colors.red, amber: colors.amber, info: colors.concrete };
const ALERT_TEXT: Record<Alert['level'], string> = { red: colors.redText, amber: colors.amber, info: colors.concrete };
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

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.concrete} />}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <Pressable onPress={() => page(-1)} hitSlop={14} accessibilityRole="button" accessibilityLabel="Dia anterior">
            <T variant="label">◂ anterior</T>
          </Pressable>
          <T variant="label" color={colors.bone}>{isToday ? 'Hoje' : day}</T>
          <Pressable onPress={() => page(1)} hitSlop={14} accessibilityRole="button" accessibilityLabel="Próximo dia">
            <T variant="label">próximo ▸</T>
          </Pressable>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="title">Six Pack Protocol</T>
          {offline && <Badge label="Offline" color={colors.amber} />}
        </Row>

        {!data && (
          <Panel>
            <T color={colors.concrete}>{loaded && !loading ? 'Sem dados em cache para este dia.' : 'Carregando…'}</T>
          </Panel>
        )}

        {data && (
          <>
            <Panel>
              <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <T variant="metric">{data.consumed.kcal}</T>
                <T variant="label">de {data.target.kcal} kcal</T>
              </Row>
              <T variant="hint">
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
                <T color={ALERT_TEXT[a.level]}>{a.message}</T>
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
                  <T variant="hint">
                    Meta {m.target.kcal} kcal · proteína {m.target.protein_g} g · carboidrato {m.target.carbs_g} g · gordura{' '}
                    {m.target.fat_g} g | feito {m.consumed.kcal} kcal · sódio {m.consumed.sodium_mg} mg
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
                            color={e.dairy === 'contains' ? colors.redText : colors.bone}>{e.name}</T>
                          {/* Written, so the flag is not color alone. */}
                          {e.dairy === 'contains' && <Badge label="Laticínio" color={colors.redText} />}
                        </Row>
                        <T variant="hint">
                          {e.grams} g · {Math.round(e.kcal)} kcal · sódio {Math.round(e.sodium_mg)} mg
                        </T>
                      </View>
                      <Pressable onPress={() => remove(e.id)} hitSlop={14} accessibilityRole="button"
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
                <Checkbox key={s.item_id} checked={s.taken} onChange={(v) => toggleSupplement(s.item_id, v)}
                  accessibilityLabel={`${s.label}, ${MEAL_LABEL[s.meal]}`}>
                  <T style={{ flex: 1, fontSize: 13 }} color={s.taken ? colors.kryptonite : colors.bone}>{s.label}</T>
                  <T variant="label">{MEAL_LABEL[s.meal]}</T>
                </Checkbox>
              ))}
              {supplementError && <T color={colors.amber}>{supplementError}</T>}
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
});
