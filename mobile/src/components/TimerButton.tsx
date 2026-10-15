import { Pressable, StyleSheet } from 'react-native';

import { clock } from '../engine/format';
import { useCountdown } from '../hooks/useCountdown';
import { useCues } from '../hooks/useCues';
import { colors, fonts, space } from '../theme';
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
      style={[styles.btn, timer.running && { borderColor: colors.bone }]}
    >
      <T style={styles.time}>{clock(timer.running ? timer.remainingSeconds : seconds)}</T>
      <T variant="label" style={{ fontSize: 9 }}>{timer.running ? 'parar' : 'iniciar'}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 1,
    borderColor: colors.seam,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    alignItems: 'center',
    minWidth: 72,
  },
  time: { fontFamily: fonts.monoBold, fontSize: 16, fontVariant: ['tabular-nums'] },
});
