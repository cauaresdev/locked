import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Prescription } from '../api/types';
import { EXERCISE_FRAMES } from '../engine/exerciseMedia';
import { rxSummary } from '../engine/format';
import { HOW_TO } from '../engine/howTo';
import { colors, radius, space } from '../theme';
import { Icon } from './Icon';
import { T, TextLink } from './ui';

const FRAME_MS = 1100; // start and end position alternate like a slow GIF
const ASPECT = 3 / 2; // the photos are 600 x 400

export function hasDemo(exerciseId: string): boolean {
  return exerciseId in EXERCISE_FRAMES || exerciseId in HOW_TO;
}

/** Start-position photo, small, for exercise cards. Nothing when the exercise has no photos. */
export function ExerciseThumb({ exerciseId, size = 56 }: { exerciseId: string; size?: number }) {
  const frames = EXERCISE_FRAMES[exerciseId];
  if (!frames) return null;
  return (
    <Image source={frames[0]} accessibilityIgnoresInvertColors accessible={false}
      style={{ width: size * ASPECT, height: size, borderRadius: radius.sm, backgroundColor: colors.surfaceHigh }} />
  );
}

/** Both positions alternating, so the movement reads without a video. Tap to hold a frame. */
function Frames({ exerciseId }: { exerciseId: string }) {
  const frames = EXERCISE_FRAMES[exerciseId];
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  // Explicit size: a percentage width with aspectRatio rendered cropped and too tall on Android.
  const width = useWindowDimensions().width - 2 * space.lg;
  useEffect(() => {
    if (!frames || paused) return;
    const id = setInterval(() => setFrame((f) => 1 - f), FRAME_MS);
    return () => clearInterval(id);
  }, [frames, paused]);
  if (!frames) return null;
  return (
    <Pressable onPress={() => setPaused((p) => !p)} accessibilityRole="button"
      accessibilityLabel={paused ? 'Retomar a animação' : 'Pausar a animação'}>
      <Image source={frames[frame]} accessibilityIgnoresInvertColors
        accessibilityLabel={frame === 0 ? 'Posição inicial' : 'Posição final'}
        resizeMode="contain" style={[styles.photo, { width, height: width / ASPECT }]} />
      <View style={styles.frameBar}>
        {(['Início', 'Fim'] as const).map((label, i) => (
          <Pressable key={label} onPress={() => { setPaused(true); setFrame(i); }} accessibilityRole="button"
            accessibilityState={{ selected: frame === i }} style={[styles.framePill, frame === i && styles.framePillOn]}>
            <T variant="tag" color={frame === i ? colors.onAccent : colors.text}>{label}</T>
          </Pressable>
        ))}
        {paused && <Icon name="pause" size={16} color={colors.textMuted} />}
      </View>
    </Pressable>
  );
}

/** Full-screen how-to: photos (or written steps) plus the prescription's own cues. */
export function ExerciseDemo({ rx, visible, onClose }: { rx: Prescription; visible: boolean; onClose: () => void }) {
  const steps = HOW_TO[rx.exercise_id];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <T variant="title" style={{ flex: 1 }} accessibilityRole="header">{rx.name}</T>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar" hitSlop={8}
            style={styles.close}>
            <Icon name="close" size={20} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xxl }}>
          <Frames exerciseId={rx.exercise_id} />
          <T variant="label">{rxSummary(rx)}</T>
          {steps && (
            <View style={{ gap: space.sm }}>
              {steps.map((s, i) => (
                <View key={s} style={styles.step}>
                  <View style={styles.stepNum}><T variant="tag" color={colors.onAccent}>{i + 1}</T></View>
                  <T style={{ flex: 1 }}>{s}</T>
                </View>
              ))}
            </View>
          )}
          {rx.cues.length > 0 && (
            <View style={{ gap: space.xs }}>
              <T variant="label">Pontos de atenção</T>
              {rx.cues.map((c) => <T key={c}>· {c}</T>)}
            </View>
          )}
          {!steps && !(rx.exercise_id in EXERCISE_FRAMES) && (
            <T variant="hint">Sem demonstração para este exercício ainda.</T>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** "Como fazer" link that opens the demo inside the app. */
export function HowToLink({ rx }: { rx: Prescription }) {
  const [open, setOpen] = useState(false);
  if (!hasDemo(rx.exercise_id) && rx.cues.length === 0) return null;
  return (
    <>
      <TextLink label="Como fazer" accessibilityLabel={`Como fazer: ${rx.name}`} onPress={() => setOpen(true)} />
      {open && <ExerciseDemo rx={rx} visible onClose={() => setOpen(false)} />}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  close: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  photo: { borderRadius: radius.lg, backgroundColor: colors.surfaceHigh },
  frameBar: { flexDirection: 'row', gap: space.sm, alignItems: 'center', marginTop: space.sm },
  framePill: { paddingHorizontal: space.md, minHeight: 32, justifyContent: 'center', borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh },
  framePillOn: { backgroundColor: colors.accent },
  step: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  stepNum: { width: 24, height: 24, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center',
    justifyContent: 'center', marginTop: 2 },
});
