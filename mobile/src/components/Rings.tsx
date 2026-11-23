import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors } from '../theme';
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
