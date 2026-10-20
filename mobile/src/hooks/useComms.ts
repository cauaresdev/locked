import * as Speech from 'expo-speech';
import { useCallback, useState } from 'react';

import { commsMuted, setCommsMuted } from '../storage/db';

/**
 * "Comms da Caverna": short, cold voice commands over the user's own music.
 * No built-in soundtrack.
 */
export function useComms() {
  const [muted, setMuted] = useState(commsMuted);

  // The stored flag, not this hook's copy: a toggle on one screen applies to every screen.
  const say = useCallback((text: string) => {
    if (commsMuted()) return;
    Speech.stop();
    Speech.speak(text, { language: 'pt-BR', rate: 1.05, pitch: 0.85 });
  }, []);

  const toggle = useCallback(() => {
    const next = !commsMuted();
    setCommsMuted(next);
    if (next) Speech.stop();
    setMuted(next);
  }, []);

  return { say, muted, toggle };
}
