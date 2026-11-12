import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Animated,
  Easing,
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
import { ms, reduceMotion } from './motion';
import { toast } from './Toast';


const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Scale that sinks while a finger is down and springs back on release. */
function usePressScale(to: number) {
  const scale = useState(() => new Animated.Value(1))[0];
  const go = (v: number, bounce: number) => {
    if (reduceMotion()) return;
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: bounce }).start();
  };
  return { scale, onPressIn: () => go(to, 0), onPressOut: () => go(1, 6) };
}

/** A tappable card or area: sinks slightly under the finger. */
export function Tappable({
  children,
  onPress,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
}: {
  children: ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: { expanded?: boolean };
}) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.97);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      style={[{ transform: [{ scale }] }, style]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Content that rises and fades in on mount; `delay` staggers a list of them. */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const t = useState(() => new Animated.Value(reduceMotion() ? 1 : 0))[0];
  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: ms(360),
      delay: ms(delay),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [t, delay]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  return <Animated.View style={[{ opacity: t, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

/** A number that counts up to its value (and glides between values when it changes). */
export function CountUp({
  value,
  digits = 0,
  variant = 'metric',
  color,
  style,
  format,
}: {
  value: number;
  digits?: number;
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  /** Overrides `digits`: e.g. thousands separators. */
  format?: (n: number) => string;
}) {
  const anim = useState(() => new Animated.Value(reduceMotion() ? value : 0))[0];
  const [shown, setShown] = useState(reduceMotion() ? value : 0);
  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setShown(v));
    const run = Animated.timing(anim, { toValue: value, duration: ms(700), easing: Easing.out(Easing.cubic),
      useNativeDriver: false });
    // Only a finished run snaps to the target: an interrupted one (new value) would flash the old target.
    run.start(({ finished }) => finished && setShown(value));
    return () => {
      run.stop();
      anim.removeListener(id);
    };
  }, [anim, value]);
  const fmt = format ?? ((n: number) => n.toFixed(digits).replace('.', ','));
  return (
    <View accessible accessibilityLabel={fmt(value)}>
      <T variant={variant} color={color} style={style}>{fmt(shown)}</T>
    </View>
  );
}

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
    r.catch((e: unknown) => toast('Algo deu errado', e instanceof Error ? e.message : String(e))).finally(() => {
      pending.current = false;
      setBusy(false);
    });
  };
  const { scale, onPressIn, onPressOut } = usePressScale(0.96);
  const primary = tone === 'primary';
  const danger = tone === 'danger' || tone === 'alert';
  const fg = primary ? colors.onAccent : danger ? colors.danger : colors.text;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      disabled={off}
      onPress={press}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[
        styles.button,
        !primary && styles.buttonSecondary,
        off && styles.buttonDisabled,
        { transform: [{ scale }] },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={18} color={fg} />}
      <Text style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
    </AnimatedPressable>
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
  // A tick pops: the box overshoots and settles.
  const pop = useState(() => new Animated.Value(1))[0];
  const toggle = () => {
    Haptics.selectionAsync().catch(() => {});
    if (!checked && !reduceMotion()) {
      pop.setValue(0.6);
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 14 }).start();
    }
    onChange(!checked);
  };
  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      style={styles.checkRow}
    >
      <Animated.View
        style={[styles.box, { borderColor }, checked && { backgroundColor: color, borderColor: color }, { transform: [{ scale: pop }] }]}
      >
        {checked && <Icon name="check" size={14} color={colors.bg} strokeWidth={3} />}
      </Animated.View>
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

/** An animated width for a bar fill, 0–1: grows from empty on mount and glides to new values. */
export function useFillWidth(fraction: number) {
  const target = Math.max(0, Math.min(1, fraction));
  const anim = useState(() => new Animated.Value(reduceMotion() ? target : 0))[0];
  useEffect(() => {
    Animated.timing(anim, { toValue: target, duration: ms(700), easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [anim, target]);
  return anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
}

/** Thin progress track, 0–1. */
export function ProgressBar({ value, color = colors.accent }: { value: number; color?: string }) {
  const width = useFillWidth(value);
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.trackFill, { width, backgroundColor: color }]} />
    </View>
  );
}

/** Row of dots: `done` filled out of `total` (e.g. a daily routine 4/6). Decorative: label it on the parent. */
export function Dots({ done, total, color = colors.accent }: { done: number; total: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: total }, (_, i) => (
        <Dot key={i} on={i < done} color={color} />
      ))}
    </View>
  );
}

/** One dot; filling it pops it (a set just logged, a habit just ticked). */
function Dot({ on, color }: { on: boolean; color: string }) {
  const scale = useState(() => new Animated.Value(1))[0];
  const mounted = useRef(false);
  useEffect(() => {
    // Not on mount: only a dot that fills while on screen pops.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!on || reduceMotion()) return;
    scale.setValue(1.8);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 12 }).start();
  }, [on, scale]);
  return <Animated.View style={[styles.dot, { backgroundColor: on ? color : colors.surfaceHigh, transform: [{ scale }] }]} />;
}

/** Content that pops in on mount: a check that just appeared, a badge just earned. */
export function PopIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const scale = useState(() => new Animated.Value(reduceMotion() ? 1 : 0.4))[0];
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 12 }).start();
  }, [scale]);
  return <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>;
}

/** Placeholder block that pulses while content loads. */
export function Skeleton({ height = 16, width = '100%', style }: { height?: number; width?: ViewStyle['width']; style?: StyleProp<ViewStyle> }) {
  const t = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (reduceMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ height, width, borderRadius: radius.sm, backgroundColor: colors.surfaceHigh, opacity }, style]}
    />
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
  // The display face carries its own weight: a fontWeight on a custom family breaks it on Android.
  display: { fontFamily: fonts.display, fontSize: 36, color: colors.text, letterSpacing: 0.2, lineHeight: 40 },
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
