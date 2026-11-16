import type { BottomTabBarProps } from 'expo-router/js-tabs';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space, themed } from '../theme';
import { ms, reduceMotion } from './motion';

/**
 * Bottom tabs with a pill that slides to the selected tab and an icon that hops when chosen.
 * Routes hidden from the bar (href: null) are skipped.
 */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => {
    const o = descriptors[r.key].options as { href?: unknown; tabBarItemStyle?: { display?: string } };
    return o.href !== null && o.tabBarItemStyle?.display !== 'none';
  });
  const focusedKey = state.routes[state.index]?.key;
  const index = Math.max(0, routes.findIndex((r) => r.key === focusedKey));
  const [width, setWidth] = useState(0);
  const slot = routes.length ? width / routes.length : 0;
  const x = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (!slot) return;
    Animated.spring(x, { toValue: index * slot, useNativeDriver: true, speed: 18, bounciness: reduceMotion() ? 0 : 7 })
      .start();
  }, [index, slot, x]);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (!width) x.setValue(index * (w / Math.max(1, routes.length)));
    setWidth(w);
  };

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + 6 }]}>
      <View style={styles.row} onLayout={onLayout}>
        {slot > 0 && (
          <Animated.View pointerEvents="none" style={[styles.pillSlot, { width: slot, transform: [{ translateX: x }] }]}>
            <View style={styles.pill} />
          </Animated.View>
        )}
        {routes.map((route) => {
          const { options } = descriptors[route.key];
          const focused = route.key === focusedKey;
          const label = typeof options.title === 'string' ? options.title : route.name;
          const color = focused ? colors.accent : colors.textFaint;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              Haptics.selectionAsync().catch(() => {});
              navigation.navigate(route.name, route.params);
            }
          };
          return (
            <Pressable key={route.key} onPress={onPress} style={styles.item} accessibilityRole="tab"
              accessibilityState={{ selected: focused }} accessibilityLabel={label}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}>
              <Hop active={focused}>
                {options.tabBarIcon?.({ focused, color, size: 22 })}
              </Hop>
              <Animated.Text style={[styles.label, { color }]} numberOfLines={1}>{label}</Animated.Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Lifts and springs back when its tab becomes the selected one. */
function Hop({ active, children }: { active: boolean; children: React.ReactNode }) {
  const t = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (!active || reduceMotion()) return;
    t.setValue(0);
    Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: ms(120), useNativeDriver: true }),
      Animated.spring(t, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 14 }),
    ]).start();
  }, [active, t]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  return <Animated.View style={{ transform: [{ translateY }, { scale }] }}>{children}</Animated.View>;
}

const styles = themed(() => StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 6,
    paddingHorizontal: space.sm,
  },
  row: { flexDirection: 'row' },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 54 },
  label: { fontSize: 11, fontWeight: '600' },
  pillSlot: { position: 'absolute', top: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  pill: { width: '82%', height: '100%', borderRadius: radius.md, backgroundColor: `${colors.accent}1F` },
}));
