import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../api/client';
import type { Dairy, FoodEntryInput, Meal, Staple } from '../api/types';
import { MEAL_LABEL, entryFromStaple } from '../engine/nutrition';
import { colors, space } from '../theme';
import { Badge, Button, Divider, Field, Panel, Row, T } from './ui';

const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : 0);

/** Add food to a meal: protocol staples (suggested first) or a manual entry. */
export function FoodPicker({
  visible,
  meal,
  day,
  suggestions,
  newId,
  onAdd,
  onClose,
}: {
  visible: boolean;
  meal: Meal;
  day: string;
  suggestions: Staple[];
  newId: () => string;
  onAdd: (e: FoodEntryInput) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<Staple[]>(suggestions);
  const [picked, setPicked] = useState<Staple | null>(null);
  const [grams, setGrams] = useState('');
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ name: '', grams: '', kcal: '', p: '', c: '', f: '', na: '' });
  const [dairy, setDairy] = useState<Dairy>('none');

  // The picker is mounted fresh for each meal, so this runs once per opening.
  // (`suggestions` is rebuilt on every parent render; depending on it would refetch each time.)
  useEffect(() => {
    api.staples().then(setAll).catch(() => {});
  }, []);

  const ids = new Set(suggestions.map((s) => s.id));
  const ordered = [...suggestions, ...all.filter((s) => !ids.has(s.id))];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={styles.root}>
        <Row style={{ justifyContent: 'space-between', padding: space.lg }}>
          <T variant="title" style={{ fontSize: 18 }}>{MEAL_LABEL[meal]}</T>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <T variant="label">Fechar</T>
          </Pressable>
        </Row>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Button tone={manual ? 'ghost' : 'primary'} label="Protocolo" onPress={() => setManual(false)} style={{ flex: 1 }} />
            <Button tone={manual ? 'primary' : 'ghost'} label="Manual" onPress={() => setManual(true)} style={{ flex: 1 }} />
          </Row>

          {!manual &&
            ordered.map((s) => {
              const selected = picked?.id === s.id;
              return (
                <Pressable key={s.id} onPress={() => { setPicked(s); setGrams(String(s.default_g)); }}
                  accessibilityRole="button">
                  <Panel accent={selected ? colors.bone : undefined}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <T style={{ flex: 1 }}>{s.name}</T>
                      {ids.has(s.id) && <Badge label="Sugerido" />}
                    </Row>
                    <T variant="label" style={{ textTransform: 'none' }}>
                      /100 g · {s.kcal} kcal · P {s.protein} · C {s.carbs} · G {s.fat} · Na {s.sodium_mg} mg
                    </T>
                    {selected && (
                      <Row style={{ alignItems: 'flex-end' }}>
                        <Field label="Gramas" value={grams} onChangeText={setGrams} keyboardType="decimal-pad" autoFocus />
                        <Button label="Adicionar" disabled={!num(grams)} style={{ flex: 1 }}
                          onPress={() => onAdd(entryFromStaple(newId(), day, meal, s, num(grams)))} />
                      </Row>
                    )}
                  </Panel>
                </Pressable>
              );
            })}

          {manual && (
            <Panel>
              <Field label="Alimento" value={m.name} onChangeText={(v) => setM({ ...m, name: v })} />
              <Row>
                <Field label="Gramas" value={m.grams} onChangeText={(v) => setM({ ...m, grams: v })} keyboardType="decimal-pad" />
                <Field label="kcal" value={m.kcal} onChangeText={(v) => setM({ ...m, kcal: v })} keyboardType="decimal-pad" />
                <Field label="Sódio mg" value={m.na} onChangeText={(v) => setM({ ...m, na: v })} keyboardType="decimal-pad" />
              </Row>
              <Row>
                <Field label="Prot g" value={m.p} onChangeText={(v) => setM({ ...m, p: v })} keyboardType="decimal-pad" />
                <Field label="Carb g" value={m.c} onChangeText={(v) => setM({ ...m, c: v })} keyboardType="decimal-pad" />
                <Field label="Gord g" value={m.f} onChangeText={(v) => setM({ ...m, f: v })} keyboardType="decimal-pad" />
              </Row>
              <T variant="label">Valores para a porção informada</T>
              <Divider />
              <Row>
                {(['none', 'traces', 'contains'] as const).map((d) => (
                  <Button key={d} tone={dairy === d ? (d === 'none' ? 'primary' : 'alert') : 'ghost'}
                    label={d === 'none' ? 'Sem leite' : d === 'traces' ? 'Traços' : 'Laticínio'}
                    onPress={() => setDairy(d)} style={{ flex: 1, paddingHorizontal: 4 }} />
                ))}
              </Row>
              <Button
                label="Adicionar"
                disabled={!m.name.trim() || !num(m.grams)}
                onPress={() =>
                  onAdd({
                    id: newId(), day, meal, name: m.name.trim(), grams: num(m.grams), kcal: num(m.kcal),
                    protein_g: num(m.p), carbs_g: num(m.c), fat_g: num(m.f), sodium_mg: num(m.na), dairy,
                  })
                }
              />
            </Panel>
          )}
          <View style={{ height: space.xxl }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  content: { paddingHorizontal: space.lg, gap: space.sm },
});
