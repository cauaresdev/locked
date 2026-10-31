import { Pressable, StyleSheet } from 'react-native';

import { clock } from '../engine/format';
import { useCountdown } from '../hooks/useCountdown';
import { useCues } from '../hooks/useCues';
import { colors, fonts, radius, space } from '../theme';
import { T } from './ui';

/** Compact countdown for checklist items and AMRAP sprints. */
export function TimerButton({ seconds, onDone }: { seconds: number; onDone?: () => void }) {
  const play = useCues();
  const timer = useCountdown(seconds, () => {
    play('done');
    onDone?.();
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={timer.running ? 'Parar timer' : 'Iniciar timer'}
      onPress={() => {
        if (timer.running) timer.stop();
        else {
          play('phase');
          timer.start();
        }
      }}
      style={[styles.btn, timer.running && { backgroundColor: colors.accent }]}
    >
      <T style={styles.time} color={timer.running ? colors.onAccent : colors.text}>
        {clock(timer.running ? timer.remainingSeconds : seconds)}
      </T>
      <T variant="label" style={{ fontSize: 11 }} color={timer.running ? colors.onAccent : colors.textMuted}>
        {timer.running ? 'parar' : 'iniciar'}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
    minHeight: 48,
  },
  time: { fontFamily: fonts.monoBold, fontSize: 16, fontVariant: ['tabular-nums'] },
});
