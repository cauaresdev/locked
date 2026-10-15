import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, fonts, space } from '../theme';

type TextVariant = 'label' | 'body' | 'title' | 'metric' | 'hero';

export function T({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[styles[variant], color ? { color } : null, style]}>
      {children}
    </Text>
  );
}

export function Panel({
  children,
  style,
  accent,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accent?: string;
}) {
  return <View style={[styles.panel, accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : null, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  disabled,
  tone = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'ghost' | 'alert';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'ghost' && styles.buttonGhost,
        tone === 'alert' && styles.buttonAlert,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
        style,
      ]}
    >
      <Text style={[styles.buttonLabel, tone !== 'primary' && { color: colors.bone }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, color = colors.concrete }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: space.xs, flex: 1 }}>
      <T variant="label">{label}</T>
      <TextInput
        placeholderTextColor={colors.seam}
        selectionColor={colors.amber}
        {...props}
        style={[styles.input, props.style]}
      />
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.concrete,
    textTransform: 'uppercase',
  },
  body: { fontFamily: fonts.mono, fontSize: 14, color: colors.bone, lineHeight: 20 },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.bone, letterSpacing: 1, textTransform: 'uppercase' },
  metric: { fontFamily: fonts.monoBold, fontSize: 28, color: colors.bone, fontVariant: ['tabular-nums'] },
  hero: { fontFamily: fonts.monoBold, fontSize: 72, color: colors.bone, fontVariant: ['tabular-nums'], lineHeight: 80 },
  panel: {
    backgroundColor: colors.gunmetal,
    borderColor: colors.seam,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.sm,
  },
  button: {
    backgroundColor: colors.bone,
    paddingVertical: space.md + 2,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.seam },
  buttonAlert: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.amber },
  buttonDisabled: { opacity: 0.35 },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: {
    fontFamily: fonts.monoBold,
    fontSize: 14,
    letterSpacing: 2,
    color: colors.void,
    textTransform: 'uppercase',
  },
  badge: { borderWidth: 1, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' },
  input: {
    fontFamily: fonts.mono,
    fontSize: 18,
    color: colors.bone,
    borderBottomWidth: 1,
    borderBottomColor: colors.seam,
    paddingVertical: space.sm,
    fontVariant: ['tabular-nums'],
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.seam },
});
