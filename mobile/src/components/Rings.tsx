import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { ms, reduceMotion } from './motion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Ring that fills to `value` (0–1): grows from empty on mount and glides to new values.
 * `duration` lets a countdown drive it linearly instead (the rest timer).
 */
export function ProgressRing({
  value,
  size = 72,
  stroke = 8,
  color = colors.accent,
  track = colors.surfaceHigh,
  duration = 900,
  linear = false,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  duration?: number;
  linear?: boolean;
  children?: ReactNode;
}) {
  const target = Math.max(0, Math.min(1, value));
  const fill = useState(() => new Animated.Value(reduceMotion() ? target : linear ? target : 0))[0];
  useEffect(() => {
    const run = Animated.timing(fill, {
      toValue: target,
      duration: ms(duration),
      easing: linear ? Easing.linear : Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    run.start();
    return () => run.stop();
  }, [fill, target, duration, linear]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = fill.interpolate({ inputRange: [0, 1], outputRange: [c, 0] });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={offset}
          rotation={-90} origin={`${size / 2}, ${size / 2}`} />
      </Svg>
      {children}
    </View>
  );
}

/** Flame for a streak: breathes gently while the streak is alive, grey at zero. */
export function Flame({ alive, size = 20 }: { alive: boolean; size?: number }) {
  const t = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (!alive || reduceMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [alive, t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });
  return (
    <Animated.View style={{ transform: [{ scale }, { rotate }] }}>
      <Icon name="flame" size={size} color={alive ? colors.warning : colors.textFaint} strokeWidth={2.2} />
    </Animated.View>
  );
}

/** Round medal badge: filled when earned, a muted lock when not. */
export function MedalBadge({ icon, unlocked, size = 64 }: { icon: IconName; unlocked: boolean; size?: number }) {
  return (
    <View style={[styles.medal, { width: size, height: size, borderRadius: size / 2 },
      unlocked ? { backgroundColor: colors.accent } : { backgroundColor: colors.surfaceHigh }]}>
      <Icon name={unlocked ? icon : 'lock'} size={size * 0.42} color={unlocked ? colors.onAccent : colors.textFaint}
        strokeWidth={2.2} />
      {unlocked && <View style={[styles.medalRing, { borderRadius: size / 2 }]} />}
    </View>
  );
}

/** Rays turning slowly behind a medal just earned. */
export function Rays({ size = 220, color = colors.accent }: { size?: number; color?: string }) {
  const spin = useState(() => new Animated.Value(0))[0];
  const started = useRef(false);
  useEffect(() => {
    if (started.current || reduceMotion()) return;
    started.current = true;
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 12000, easing: Easing.linear, useNativeDriver: true })).start();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', transform: [{ rotate }] }]}
      pointerEvents="none">
      {Array.from({ length: 12 }, (_, i) => (
        <View key={i} style={{ position: 'absolute', width: 6, height: size / 2, borderRadius: radius.pill,
          backgroundColor: color, opacity: 0.16, transform: [{ rotate: `${i * 30}deg` }, { translateY: -size / 4 }] }} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  medal: { alignItems: 'center', justifyContent: 'center' },
  medalRing: { ...StyleSheet.absoluteFill, borderWidth: 3, borderColor: 'rgba(255,255,255,0.35)', margin: 4 },
});
