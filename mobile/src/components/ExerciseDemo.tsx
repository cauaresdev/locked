import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Prescription, Session } from '../api/types';
import { EXERCISE_CREDITS, EXERCISE_FRAMES } from '../engine/exerciseMedia';
import { rxSummary } from '../engine/format';
import { HOW_TO } from '../engine/howTo';
import { colors, radius, space, themed } from '../theme';
import { Icon } from './Icon';
import { ms } from './motion';
import { T, TextLink } from './ui';

const HOLD_MS = 700; // each position stays still this long
const FADE_MS = 650; // then blends into the other
const ASPECT = 3 / 2; // the photos are 600 x 400

export function hasDemo(exerciseId: string): boolean {
  return exerciseId in EXERCISE_FRAMES || exerciseId in HOW_TO;
}

/**
 * Start-position photo, cropped to fill its box. Exercises without photos get a neutral tile with a
 * dumbbell, so lists keep their rhythm; `placeholder={false}` renders nothing instead.
 */
export function ExerciseThumb({
  exerciseId,
  size = 56,
  width,
  radius: r = radius.sm,
  placeholder = true,
  style,
}: {
  exerciseId: string;
  size?: number; // height
  width?: number; // defaults to the photos' 3:2
  radius?: number;
  placeholder?: boolean;
  style?: StyleProp<ImageStyle>;
}) {
  const frames = EXERCISE_FRAMES[exerciseId];
  const box = { width: width ?? size * ASPECT, height: size, borderRadius: r, backgroundColor: colors.surfaceHigh };
  if (!frames) {
    if (!placeholder) return null;
    return (
      <View style={[box, { alignItems: 'center', justifyContent: 'center' }, style as StyleProp<ViewStyle>]}
        accessible={false}>
        <Icon name="dumbbell" size={Math.min(28, size * 0.4)} color={colors.textFaint} />
      </View>
    );
  }
  return (
    <Image source={frames[0]} accessibilityIgnoresInvertColors accessible={false} resizeMode="cover"
      style={[box, style]} />
  );
}

/** Whether an exercise has photos (for picking a cover image). */
export function hasPhoto(exerciseId: string): boolean {
  return exerciseId in EXERCISE_FRAMES;
}

/** The start-position photo itself, for covers. */
export function photoOf(exerciseId: string) {
  return EXERCISE_FRAMES[exerciseId]?.[0] ?? null;
}

/** Cover photo: the first main lift with a photo, else any exercise with one. */
export function sessionCover(session: Session) {
  const all = session.blocks.flatMap((b) => b.exercises.map((e) => ({ kind: b.kind, id: e.exercise_id })));
  const pick = all.find((e) => e.kind === 'strength' && photoOf(e.id)) ?? all.find((e) => photoOf(e.id));
  return pick ? photoOf(pick.id) : null;
}

/**
 * Both positions blending into each other, like a slow GIF: the end photo fades in over the start
 * one and back. Tap to hold a frame; the pills jump to either position.
 */
function Frames({ exerciseId }: { exerciseId: string }) {
  const frames = EXERCISE_FRAMES[exerciseId];
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const fade = useState(() => new Animated.Value(0))[0]; // opacity of the end photo
  // Explicit size: a percentage width with aspectRatio rendered cropped and too tall on Android.
  const width = useWindowDimensions().width - 2 * space.lg;
  useEffect(() => {
    if (!frames || frames.length < 2 || paused) return; // a single image shows both positions itself
    const id = setInterval(() => setFrame((f) => 1 - f), HOLD_MS + FADE_MS);
    return () => clearInterval(id);
  }, [frames, paused]);
  useEffect(() => {
    const run = Animated.timing(fade, { toValue: frame, duration: ms(FADE_MS), easing: Easing.inOut(Easing.quad),
      useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [fade, frame]);
  if (!frames) return null;
  const size = { width, height: width / ASPECT };
  const credit = EXERCISE_CREDITS[exerciseId];
  if (frames.length === 1) {
    return (
      <View style={{ gap: space.xs }}>
        <Image source={frames[0]} accessibilityIgnoresInvertColors resizeMode="contain"
          accessibilityLabel="Posição inicial e final" style={[styles.photo, size]} />
        {credit && <T variant="hint" style={{ fontSize: 11 }}>{credit}</T>}
      </View>
    );
  }
  return (
    <Pressable onPress={() => setPaused((p) => !p)} accessibilityRole="button"
      accessibilityLabel={paused ? 'Retomar a animação' : 'Pausar a animação'}>
      <View style={[styles.photo, size]}>
        <Image source={frames[0]} accessibilityIgnoresInvertColors resizeMode="contain"
          accessibilityLabel={frame === 0 ? 'Posição inicial' : 'Posição final'} style={size} />
        <Animated.Image source={frames[1] ?? frames[0]} accessibilityIgnoresInvertColors accessible={false} resizeMode="contain"
          style={[StyleSheet.absoluteFill, size, { opacity: fade }]} />
      </View>
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

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  close: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  photo: { borderRadius: radius.lg, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  frameBar: { flexDirection: 'row', gap: space.sm, alignItems: 'center', marginTop: space.sm },
  framePill: { paddingHorizontal: space.md, minHeight: 32, justifyContent: 'center', borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh },
  framePillOn: { backgroundColor: colors.accent },
  step: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  stepNum: { width: 24, height: 24, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center',
    justifyContent: 'center', marginTop: 2 },
}));
