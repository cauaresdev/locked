import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { ms, reduceMotion } from './motion';

type Tone = 'error' | 'info' | 'success';
type Message = { id: number; title: string; body?: string; tone: Tone };

const TONE: Record<Tone, { color: string; icon: IconName }> = {
  error: { color: colors.danger, icon: 'alert' },
  info: { color: colors.accent, icon: 'info' },
  success: { color: colors.success, icon: 'check' },
};
const SHOW_MS = 4000;

let show: ((m: Message) => void) | null = null;
let seq = 0;

/**
 * A short notice that slides in at the top and leaves on its own (or on a tap). For errors and
 * information only: anything that asks for a decision stays a dialog.
 */
export function toast(title: string, body?: string, tone: Tone = 'error') {
  show?.({ id: ++seq, title, body, tone });
}

/** Mounted once, above the navigator. */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<Message | null>(null);
  const t = useState(() => new Animated.Value(0))[0];

  // A newer message interrupts the exit animation, so only a finished exit clears the slot.
  const hide = useCallback(
    () =>
      Animated.timing(t, { toValue: 0, duration: ms(180), easing: Easing.in(Easing.cubic), useNativeDriver: true })
        .start(({ finished }) => finished && setMsg(null)),
    [t],
  );

  useEffect(() => {
    show = setMsg;
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (!msg) return;
    AccessibilityInfo.announceForAccessibility([msg.title, msg.body].filter(Boolean).join('. '));
    if (msg.tone === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    if (reduceMotion()) t.setValue(1);
    else Animated.spring(t, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 5 }).start();
    const id = setTimeout(() => hide(), SHOW_MS);
    return () => clearTimeout(id);
  }, [msg, t, hide]);

  if (!msg) return null;
  const tone = TONE[msg.tone];
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + space.sm, opacity: t, transform: [{ translateY }] }]}
    >
      <Pressable onPress={hide} accessibilityRole="alert" accessibilityHint="Toque para fechar" style={styles.card}>
        <View style={[styles.bar, { backgroundColor: tone.color }]} />
        <Icon name={tone.icon} size={20} color={tone.color} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>{msg.title}</Text>
          {msg.body ? <Text style={styles.body}>{msg.body}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, zIndex: 100, elevation: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingLeft: space.lg,
    paddingRight: space.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 13, lineHeight: 18, color: colors.textMuted },
});
