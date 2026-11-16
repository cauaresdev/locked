import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { clock } from '../engine/format';
import { useCountdown } from '../hooks/useCountdown';
import { useCues } from '../hooks/useCues';
import { scheduleRestAlert, shouldSoundLateEnd, type RestAlert } from '../notifications';
import { colors, fonts, radius, space, themed } from '../theme';
import { T } from './ui';

const LATE_MS = 1500; // past this, JS was suspended and the OS alert may already have rung

/**
 * Compact countdown for checklist items and AMRAP sprints. Like the rest timer, it leaves an OS
 * alert behind, so the end still sounds with the app in the background or the screen locked.
 */
export function TimerButton({ seconds, onDone, label }: { seconds: number; onDone?: () => void; label?: string }) {
  const play = useCues();
  const alert = useRef<RestAlert | null>(null);
  const timer = useCountdown(seconds, async (lateMs) => {
    if (lateMs <= LATE_MS || (await shouldSoundLateEnd(alert.current))) play('done');
    alert.current = null;
    onDone?.();
  });
  // Leaving the screen (or the item ticked by hand) drops the pending alert.
  useEffect(() => () => alert.current?.cancel(), []);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={timer.running ? 'Parar timer' : 'Iniciar timer'}
      onPress={() => {
        if (timer.running) {
          timer.stop();
          alert.current?.cancel();
          alert.current = null;
        } else {
          play('phase');
          timer.start();
          alert.current = scheduleRestAlert(seconds, label ? `${label}: tempo encerrado.` : 'Tempo encerrado.',
            'Timer encerrado');
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

const styles = themed(() => StyleSheet.create({
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
}));
