import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Animated, Modal, StyleSheet, View } from 'react-native';

import type { Medal } from '../engine/achievements';
import { cardShadow, colors, radius, space, themed } from '../theme';
import { ms, reduceMotion } from './motion';
import { MedalBadge, Rays } from './Rings';
import { Button, T } from './ui';

/** The moment a medal is earned: it spins in over turning rays, with a success buzz. */
export function MedalUnlocked({ medals, onClose, onOpenAll }: { medals: Medal[]; onClose: () => void; onOpenAll: () => void }) {
  const pop = useState(() => new Animated.Value(reduceMotion() ? 1 : 0))[0];
  const fade = useState(() => new Animated.Value(reduceMotion() ? 1 : 0))[0];
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: ms(220), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(ms(120)),
        Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 9, bounciness: 14 }),
      ]),
    ]).start();
  }, [fade, pop]);
  const first = medals[0];
  if (!first) return null;
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const rotate = pop.interpolate({ inputRange: [0, 1], outputRange: ['-200deg', '0deg'] });
  const rise = fade.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
  const others = medals.slice(1);
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Animated.View style={[styles.card, { transform: [{ translateY: rise }] }]} accessibilityViewIsModal>
          <View style={styles.stage}>
            <Rays size={230} />
            <Animated.View style={{ transform: [{ scale }, { rotate }] }}>
              <MedalBadge icon={first.icon} unlocked size={104} />
            </Animated.View>
          </View>
          <T variant="tag" color={colors.accent}>Conquista desbloqueada</T>
          <T variant="display" style={{ textAlign: 'center', fontSize: 26, lineHeight: 32 }} accessibilityRole="header">
            {first.title}
          </T>
          <T variant="hint" style={{ textAlign: 'center' }}>{first.description}</T>
          {others.length > 0 && (
            <T variant="label" style={{ textAlign: 'center' }}>
              E mais {others.length}: {others.map((m) => m.title).join(', ')}
            </T>
          )}
          <View style={{ alignSelf: 'stretch', gap: space.sm, marginTop: space.sm }}>
            <Button label="Ver conquistas" icon="trophy" onPress={onOpenAll} />
            <Button tone="ghost" label="Continuar" onPress={onClose} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,7,10,0.72)', justifyContent: 'center', padding: space.xl },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.xl, alignItems: 'center', gap: space.sm,
    ...cardShadow,
  },
  stage: { width: 230, height: 190, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
}));
