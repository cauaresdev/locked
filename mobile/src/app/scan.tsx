import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, api } from '../api/client';
import type { Alert, Meal, Product } from '../api/types';
import { Button, Chip, Field, Panel, Row, T } from '../components/ui';
import { isoDay, parseDecimal } from '../engine/format';
import { MEAL_LABEL, entryFromProduct, portionAlerts } from '../engine/nutrition';
import { cachedNutrition, enqueueFood, storedAthlete } from '../storage/db';
import { flushNutrition } from '../sync';
import { colors, space } from '../theme';

const MEALS: Meal[] = ['breakfast', 'post_workout', 'snack', 'dinner'];
const LEVEL_COLOR = { red: colors.red, amber: colors.amber, info: colors.concrete } as const;
const LEVEL_TEXT = { red: colors.redText, amber: colors.amber, info: colors.concrete } as const;

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
  const [torch, setTorch] = useState(false);

  useEffect(() => {
    cachedNutrition(day)
      .then((d) => {
        if (d) setMealSodium(Object.fromEntries(d.meals.map((m) => [m.meal, m.consumed.sodium_mg])) as Record<Meal, number>);
      })
      .catch(() => {}); // no cached day: the portion alerts count from zero
  }, [day]);

  // The camera fires several events per barcode before React re-renders: a ref, not state, gates them.
  const scanned = useRef(false);
  const adding = useRef(false);

  async function onScanned(r: BarcodeScanningResult) {
    if (scanned.current) return;
    scanned.current = true;
    setCode(r.data);
    setError(null);
    try {
      const p = await api.product(r.data);
      setProduct(p);
      if (p.serving_g) setGrams(String(p.serving_g));
      const red = p.alerts.some((a) => a.level === 'red');
      Haptics.notificationAsync(red ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success)
        .catch(() => {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sem conexão: registre o alimento manualmente.');
    }
  }

  function reset() {
    scanned.current = false;
    setCode(null);
    setProduct(null);
    setError(null);
  }

  async function add() {
    if (!product || !athlete || adding.current || g <= 0) return;
    adding.current = true;
    try {
      await enqueueFood(entryFromProduct(Crypto.randomUUID(), day, meal, product, g));
    } catch {
      adding.current = false;
      setError('Não foi possível salvar no aparelho. Tente de novo.');
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    // Saved locally: close now and upload in the background instead of waiting on the network.
    flushNutrition(athlete.id).catch(() => {});
    router.back();
  }

  const g = parseDecimal(grams) ?? 0;
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
        <Row style={{ gap: space.xl }}>
          {!code && (
            <Pressable onPress={() => setTorch((t) => !t)} hitSlop={14} accessibilityRole="switch"
              accessibilityLabel="Lanterna" accessibilityState={{ checked: torch }}>
              <T variant="label" color={torch ? colors.amber : colors.concrete}>{torch ? 'Lanterna ligada' : 'Lanterna'}</T>
            </Pressable>
          )}
          <Pressable onPress={() => router.back()} hitSlop={14} accessibilityRole="button">
            <T variant="label">Fechar</T>
          </Pressable>
        </Row>
      </Row>

      {!code && (
        <View style={styles.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
            onBarcodeScanned={onScanned}
          />
          <View style={styles.reticle} pointerEvents="none" />
          <T variant="label" style={styles.hint}>Aponte para o código de barras</T>
        </View>
      )}

      {code && (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets>
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
                <T variant="hint">
                  /100 g · {product.kcal_100g ?? '?'} kcal · proteína {product.protein_100g ?? '?'} g · carboidrato{' '}
                  {product.carbs_100g ?? '?'} g · gordura {product.fat_100g ?? '?'} g · sódio {product.sodium_mg_100g ?? '?'} mg
                </T>
              </Panel>
              {alerts.map((a, i) => (
                <Panel key={i} accent={LEVEL_COLOR[a.level]}>
                  <T color={LEVEL_TEXT[a.level]}>{a.message}</T>
                </Panel>
              ))}
              <Row style={{ flexWrap: 'wrap', gap: space.xs }}>
                {MEALS.map((m) => (
                  <Chip key={m} label={MEAL_LABEL[m]} selected={m === meal} onPress={() => setMeal(m)} />
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
