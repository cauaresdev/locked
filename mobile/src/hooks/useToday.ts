import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { isoDay } from '../engine/format';

/**
 * Today's date (YYYY-MM-DD) that follows midnight. Tabs stay mounted and are not re-focused when the
 * app returns from the background, so a plain `isoDay()` at render would keep yesterday's date: a
 * workout started next morning would be logged under the previous day.
 */
export function useToday(): string {
  const [day, setDay] = useState(isoDay);
  const sync = useCallback(() => setDay(isoDay()), []); // same string: React skips the re-render

  useFocusEffect(sync);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && sync());
    return () => sub.remove();
  }, [sync]);

  // Open across midnight: roll over on time.
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const id = setTimeout(sync, next.getTime() - now.getTime());
    return () => clearTimeout(id);
  }, [day, sync]);

  return day;
}
