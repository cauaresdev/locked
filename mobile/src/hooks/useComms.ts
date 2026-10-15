import * as Speech from 'expo-speech';
import { useCallback, useState } from 'react';

import { commsMuted, setCommsMuted } from '../storage/db';

/**
 * "Comms da Caverna": short, cold voice commands over the user's own music.
 * No built-in soundtrack.
 */
export function useComms() {
  const [muted, setMuted] = useState(commsMuted);

  const say = useCallback(
    (text: string) => {
      if (muted) return;
      Speech.stop();
      Speech.speak(text, { language: 'pt-BR', rate: 1.05, pitch: 0.85 });
    },
    [muted],
  );

  const toggle = useCallback(() => {
    setMuted((m) => {
      setCommsMuted(!m);
      if (!m) Speech.stop();
      return !m;
    });
  }, []);

  return { say, muted, toggle };
}
