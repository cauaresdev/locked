import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, api } from '../api/client';
import type { Alert, Meal, Product } from '../api/types';
import { Badge, Button, Field, Panel, Row, T } from '../components/ui';
import { isoDay } from '../engine/format';
import { MEAL_LABEL, entryFromProduct, portionAlerts } from '../engine/nutrition';
import { cachedNutrition, enqueueFood, storedAthlete } from '../storage/db';
import { flushFood } from '../sync';
import { colors, space } from '../theme';

const MEALS: Meal[] = ['breakfast', 'post_workout', 'snack', 'dinner'];
const LEVEL_COLOR = { red: colors.red, amber: colors.amber, info: colors.concrete } as const;

export default function Scan() {
  const router = useRouter();
  const params = useLocalSearchParams<{ meal?: Meal; day?: string }>();
  const day = params.day ?? isoDay();
  const athlete = storedAthlete();
  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = useState<string | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grams, setGrams] = useState('100');
  const [meal, setMeal] = useState<Meal>(params.meal ?? 'breakfast');
  const [mealSodium, setMealSodium] = useState<Record<Meal, number>>({ breakfast: 0, post_workout: 0, snack: 0, dinner: 0 });

  useEffect(() => {
    cachedNutrition(day).then((d) => {
      if (d) setMealSodium(Object.fromEntries(d.meals.map((m) => [m.meal, m.consumed.sodium_mg])) as Record<Meal, number>);
    });
  }, [day]);

  async function onScanned(r: BarcodeScanningResult) {
    if (code) return;
    setCode(r.data);
    setError(null);
    try {
      const p = await api.product(r.data);
      setProduct(p);
      if (p.serving_g) setGrams(String(p.serving_g));
      const red = p.alerts.some((a) => a.level === 'red');
      Haptics.notificationAsync(red ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sem conexão: registre o alimento manualmente.');
    }
  }

  function reset() {
    setCode(null);
    setProduct(null);
    setError(null);
  }

  async function add() {
    if (!product || !athlete) return;
    await enqueueFood(entryFromProduct(Crypto.randomUUID(), day, meal, product, Number(grams.replace(',', '.'))));
    await flushFood(athlete.id);
    router.back();
  }

  const g = Number(grams.replace(',', '.')) || 0;
  // Product-level alerts from the server, plus this portion against what the meal already has.
  const alerts: Alert[] = product?.found
    ? [
        ...portionAlerts(product, g, mealSodium[meal]),
        ...product.alerts.filter((a) => !a.code.startsWith('dairy') && a.code !== 'whey_isolate' && a.code !== 'sodium_portion'),
      ]
    : [];
  const red = alerts.some((a) => a.level === 'red');

  if (!permission) return <View style={styles.root} />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.root, { padding: space.lg, gap: space.lg }]}>
        <T variant="title">Câmera</T>
        <T color={colors.concrete}>A câmera lê o código de barras para checar sódio e laticínios.</T>
        <Button label="Permitir câmera" onPress={requestPermission} />
        <Button tone="ghost" label="Voltar" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <Row style={{ justifyContent: 'space-between', padding: space.lg }}>
        <T variant="title" style={{ fontSize: 18 }}>Scanner</T>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <T variant="label">Fechar</T>
        </Pressable>
      </Row>

      {!code && (
        <View style={styles.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
            onBarcodeScanned={onScanned}
          />
          <View style={styles.reticle} pointerEvents="none" />
          <T variant="label" style={styles.hint}>Aponte para o código de barras</T>
        </View>
      )}

      {code && (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
          <T variant="label">EAN {code}</T>
          {!product && !error && <T color={colors.concrete}>Consultando base de alimentos…</T>}
          {error && <Panel accent={colors.amber}><T color={colors.amber}>{error}</T></Panel>}
          {product && !product.found && (
            <Panel accent={colors.amber}><T color={colors.amber}>Produto não encontrado. Use a entrada manual.</T></Panel>
          )}
          {product?.found && (
            <>
              {red && (
                <View style={styles.redBanner}>
                  <T variant="title" color={colors.void}>Alerta vermelho</T>
                </View>
              )}
              <Panel accent={red ? colors.red : colors.kryptonite}>
                <T style={{ fontSize: 16 }}>{product.name}</T>
                {product.brand && <T variant="label">{product.brand}</T>}
                <T variant="label" style={{ textTransform: 'none' }}>
                  /100 g · {product.kcal_100g ?? '?'} kcal · P {product.protein_100g ?? '?'} · C {product.carbs_100g ?? '?'} ·
                  G {product.fat_100g ?? '?'} · Na {product.sodium_mg_100g ?? '?'} mg
                </T>
              </Panel>
              {alerts.map((a, i) => (
                <Panel key={i} accent={LEVEL_COLOR[a.level]}>
                  <T color={LEVEL_COLOR[a.level]}>{a.message}</T>
                </Panel>
              ))}
              <Row style={{ flexWrap: 'wrap' }}>
                {MEALS.map((m) => (
                  <Pressable key={m} onPress={() => setMeal(m)} accessibilityRole="radio" accessibilityState={{ selected: m === meal }}>
                    <Badge label={MEAL_LABEL[m]} color={m === meal ? colors.bone : colors.seam} />
                  </Pressable>
                ))}
              </Row>
              <Row style={{ alignItems: 'flex-end' }}>
                <Field label="Gramas" value={grams} onChangeText={setGrams} keyboardType="decimal-pad" />
                <Button tone={red ? 'alert' : 'primary'} label={red ? 'Registrar mesmo assim' : 'Registrar'}
                  onPress={add} disabled={!g} style={{ flex: 2 }} />
              </Row>
            </>
          )}
          <Button tone="ghost" label="Escanear outro" onPress={reset} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  cameraWrap: { flex: 1, margin: space.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.seam },
  reticle: {
    position: 'absolute', left: '10%', right: '10%', top: '38%', height: '24%',
    borderWidth: 2, borderColor: colors.amber,
  },
  hint: { position: 'absolute', bottom: space.lg, alignSelf: 'center' },
  redBanner: { backgroundColor: colors.red, padding: space.md, alignItems: 'center' },
});
