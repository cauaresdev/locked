import * as Haptics from 'expo-haptics';
import { useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Alert,
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

// label: short uppercase tags. hint: explanatory sentences, readable at arm's length mid-set.
type TextVariant = 'label' | 'hint' | 'body' | 'title' | 'metric' | 'hero';

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
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void | Promise<unknown>;
  disabled?: boolean;
  tone?: 'primary' | 'ghost' | 'alert';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  // An async handler holds the button until it settles: a double tap never runs it twice.
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const off = disabled || busy;
  const press = () => {
    if (pending.current) return;
    const r = onPress();
    if (!(r instanceof Promise)) return;
    pending.current = true;
    setBusy(true);
    // Handlers report their own expected failures; anything that still escapes is shown, not swallowed.
    r.catch((e: unknown) => Alert.alert('Erro', e instanceof Error ? e.message : String(e))).finally(() => {
      pending.current = false;
      setBusy(false);
    });
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      disabled={off}
      onPress={press}
      style={({ pressed }) => [
        styles.button,
        tone === 'ghost' && styles.buttonGhost,
        tone === 'alert' && styles.buttonAlert,
        off && styles.buttonDisabled,
        pressed && !off && styles.buttonPressed,
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

export function Field({ label, ref, ...props }: TextInputProps & { label: string; ref?: Ref<TextInput> }) {
  return (
    <View style={{ gap: space.xs, flex: 1 }}>
      {/* The input carries the label itself; the visible one would be read twice. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <T variant="label">{label}</T>
      </View>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.concrete}
        selectionColor={colors.amber}
        {...props}
        style={[styles.input, props.style]}
      />
    </View>
  );
}

/** Selectable chip, at least 44 pt tall. Single-choice groups use "radio", toggles "checkbox". */
export function Chip({
  label,
  selected,
  onPress,
  role = 'radio',
  accessibilityLabel,
  style,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: 'radio' | 'checkbox';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel}
      style={[styles.chip, selected && styles.chipOn, style]}
    >
      <T variant="label" style={{ textTransform: 'none' }} color={selected ? colors.void : colors.bone}>{label}</T>
    </Pressable>
  );
}

/** Square checkbox with its label; the whole row (at least 44 pt) is the target. */
export function Checkbox({
  checked,
  onChange,
  children,
  color = colors.kryptonite,
  borderColor = colors.concrete,
  accessibilityLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  color?: string; // fill (and border) when checked
  borderColor?: string; // border when unchecked
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onChange(!checked);
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      style={styles.checkRow}
    >
      <View style={[styles.box, { borderColor }, checked && { backgroundColor: color, borderColor: color }]} />
      {children}
    </Pressable>
  );
}

/** Underlined text action; the hit area is padded out to ~44 pt without changing the layout. */
export function TextLink({
  label,
  onPress,
  color,
  role = 'button',
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  role?: 'button' | 'link';
  accessibilityLabel?: string;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole={role} accessibilityLabel={accessibilityLabel} hitSlop={LINK_SLOP}>
      <T variant="label" color={color} style={{ textTransform: 'none', textDecorationLine: 'underline' }}>{label}</T>
    </Pressable>
  );
}

const LINK_SLOP = { top: 14, bottom: 14, left: 8, right: 8 };

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
  hint: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.concrete, lineHeight: 18 },
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
  chip: { borderWidth: 1, borderColor: colors.seam, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 44,
    justifyContent: 'center' },
  chipOn: { backgroundColor: colors.bone, borderColor: colors.bone },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  box: { width: 20, height: 20, borderWidth: 1 },
});
