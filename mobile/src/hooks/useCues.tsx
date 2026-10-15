import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, type ReactNode } from 'react';

export type CueKind = 'tick' | 'phase' | 'done';
type Play = (kind: CueKind) => void;

const SOURCES = {
  tick: require('../../assets/sounds/tick.wav'),
  phase: require('../../assets/sounds/phase.wav'),
  done: require('../../assets/sounds/done.wav'),
};

const CuesContext = createContext<Play>(() => {});

/** One set of preloaded players shared by every timer and metronome. */
export function CuesProvider({ children }: { children: ReactNode }) {
  const tick = useAudioPlayer(SOURCES.tick, { keepAudioSessionActive: true });
  const phase = useAudioPlayer(SOURCES.phase, { keepAudioSessionActive: true });
  const done = useAudioPlayer(SOURCES.done, { keepAudioSessionActive: true });

  const play = useCallback<Play>(
    (kind) => {
      const player = kind === 'tick' ? tick : kind === 'phase' ? phase : done;
      player.seekTo(0);
      player.play();
      if (kind === 'tick') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (kind === 'phase') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [tick, phase, done],
  );

  return <CuesContext.Provider value={play}>{children}</CuesContext.Provider>;
}

/** Dry beeps + haptics for the cadence metronome and timers. */
export function useCues(): Play {
  return useContext(CuesContext);
}
