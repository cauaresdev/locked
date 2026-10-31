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

import { colors, fonts, radius, space } from '../theme';
import { Icon, type IconName } from './Icon';

// display: screen titles. title: card/section titles. label: short muted captions next to values.
// hint: explanatory sentences, readable at arm's length mid-set. metric/hero: numbers (monospace,
// tabular figures). tag: tiny uppercase tags (badges only).
type TextVariant = 'display' | 'title' | 'body' | 'label' | 'hint' | 'metric' | 'hero' | 'tag';

export function T({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
  accessibilityRole,
}: {
  children: ReactNode;
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  accessibilityRole?: 'header' | 'text';
}) {
  return (
    <Text numberOfLines={numberOfLines} accessibilityRole={accessibilityRole} style={[styles[variant], color ? { color } : null, style]}>
      {children}
    </Text>
  );
}

/** Screen header: large title, optional muted line above it and an element on the right. */
export function ScreenHeader({ title, overline, right }: { title: string; overline?: string; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1, gap: 2 }}>
        {overline ? <T variant="label">{overline}</T> : null}
        <T variant="display" accessibilityRole="header">{title}</T>
      </View>
      {right}
    </View>
  );
}

/** A titled group of content without a box around it. */
export function Section({
  title,
  right,
  children,
  style,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: space.md }, style]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="title" accessibilityRole="header">{title}</T>
        {right}
      </Row>
      {children}
    </View>
  );
}

/**
 * Card. `accent` tints the card with a state color (warning, danger, success) instead of a
 * neutral surface; `raised` uses the lighter surface (a card inside a card).
 */
export function Panel({
  children,
  style,
  accent,
  raised,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accent?: string;
  raised?: boolean;
}) {
  return (
    <View style={[styles.panel, raised && { backgroundColor: colors.surfaceHigh }, accent ? tint(accent) : null, style]}>
      {children}
    </View>
  );
}

/** Translucent state tint: the color at ~10 % over the background. */
export function tint(color: string): ViewStyle {
  if (color === colors.danger) return { backgroundColor: colors.dangerFill };
  if (color === colors.warning) return { backgroundColor: colors.warningFill };
  return { backgroundColor: /^#[0-9a-f]{6}$/i.test(color) ? `${color}1A` : colors.surface };
}

type Tone = 'primary' | 'secondary' | 'ghost' | 'danger' | 'alert';

/**
 * primary: accent fill (one per screen). secondary / ghost: neutral fill. danger / alert: destructive
 * or risky actions, danger-colored label. `icon` adds a leading icon.
 */
export function Button({
  label,
  onPress,
  disabled,
  tone = 'primary',
  icon,
  style,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void | Promise<unknown>;
  disabled?: boolean;
  tone?: Tone;
  icon?: IconName;
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
  const primary = tone === 'primary';
  const danger = tone === 'danger' || tone === 'alert';
  const fg = primary ? colors.onAccent : danger ? colors.danger : colors.text;
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
        !primary && styles.buttonSecondary,
        off && styles.buttonDisabled,
        pressed && !off && styles.buttonPressed,
        style,
      ]}
    >
      {icon && <Icon name={icon} size={18} color={fg} />}
      <Text style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Small status pill: colored text on a tint of the same color. */
export function Badge({ label, color = colors.textMuted }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, color === colors.textMuted ? { backgroundColor: colors.surfaceHigh } : tint(color)]}>
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
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        {...props}
        style={[styles.input, props.style]}
      />
    </View>
  );
}

/** Selectable pill, at least 44 pt tall. Single-choice groups use "radio", toggles "checkbox". */
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
      <Text style={[styles.chipText, { color: selected ? colors.bg : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

/** Round checkbox with its label; the whole row (at least 44 pt) is the target. */
export function Checkbox({
  checked,
  onChange,
  children,
  color = colors.success,
  borderColor = colors.textMuted,
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
      <View style={[styles.box, { borderColor }, checked && { backgroundColor: color, borderColor: color }]}>
        {checked && <Icon name="check" size={14} color={colors.bg} strokeWidth={3} />}
      </View>
      {children}
    </Pressable>
  );
}

/** Text action; the hit area is padded out to ~44 pt without changing the layout. */
export function TextLink({
  label,
  onPress,
  color = colors.accent,
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
      <T variant="label" color={color} style={{ fontWeight: '600' }}>{label}</T>
    </Pressable>
  );
}

const LINK_SLOP = { top: 14, bottom: 14, left: 8, right: 8 };

/** Tappable list row: title, optional caption, optional value and a chevron. At least 56 pt tall. */
export function ListRow({
  title,
  caption,
  value,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  caption?: string;
  value?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.surfaceHigh }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T>{title}</T>
        {caption ? <T variant="hint">{caption}</T> : null}
      </View>
      {value ? <T variant="label">{value}</T> : null}
      {onPress && <Icon name="chevron-right" size={18} color={colors.textFaint} />}
    </Pressable>
  );
}

/** Thin progress track, 0–1. */
export function ProgressBar({ value, color = colors.accent }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={styles.track}>
      <View style={[styles.trackFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

/** Row of dots: `done` filled out of `total` (e.g. a daily routine 4/6). Decorative: label it on the parent. */
export function Dots({ done, total, color = colors.accent }: { done: number; total: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dot, { backgroundColor: i < done ? color : colors.surfaceHigh }]} />
      ))}
    </View>
  );
}

/** A labelled number: big value with its unit and a caption below. */
export function Stat({ value, unit, label, color }: { value: string; unit?: string; label: string; color?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Row style={{ alignItems: 'baseline', gap: space.xs }}>
        <T variant="metric" color={color}>{value}</T>
        {unit ? <T variant="label">{unit}</T> : null}
      </Row>
      <T variant="label">{label}</T>
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
  display: { fontSize: 30, fontWeight: '700', color: colors.text, letterSpacing: -0.5, lineHeight: 36 },
  title: { fontSize: 18, fontWeight: '600', color: colors.text, lineHeight: 24 },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  label: { fontSize: 13, fontWeight: '500', color: colors.textMuted, lineHeight: 18 },
  hint: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  tag: { fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' },
  metric: { fontFamily: fonts.monoBold, fontSize: 28, color: colors.text, fontVariant: ['tabular-nums'] },
  hero: { fontFamily: fonts.monoBold, fontSize: 64, color: colors.text, fontVariant: ['tabular-nums'], lineHeight: 72 },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingTop: space.sm, paddingBottom: space.xs },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  button: {
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: space.md + 2,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonSecondary: { backgroundColor: colors.surfaceHigh },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.75 },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.sm + 2, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  input: {
    fontSize: 17,
    color: colors.text,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    minHeight: 48,
    fontVariant: ['tabular-nums'],
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  chip: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipOn: { backgroundColor: colors.text },
  chipText: { fontSize: 14, fontWeight: '500' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  box: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
