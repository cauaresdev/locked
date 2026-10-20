import { Platform } from 'react-native';

import { api } from '../api/client';
import type { ReadinessSummary } from '../api/types';
import type { HealthProvider } from './types';

/**
 * Platform health store: Apple Health on iOS, Health Connect on Android.
 * Garmin, Oura, Whoop etc. reach the app through these stores (enable the
 * vendor's sync to Apple Health / Health Connect).
 */
export function healthProvider(): HealthProvider | null {
  // Lazy requires keep each native module out of the other platform's bundle path.
  /* eslint-disable @typescript-eslint/no-require-imports */
  if (Platform.OS === 'ios') return (require('./healthkit') as typeof import('./healthkit')).default;
  if (Platform.OS === 'android') return (require('./healthconnect') as typeof import('./healthconnect')).default;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return null;
}

/**
 * Reads last night's HRV (heart rate variability), resting heart rate and sleep and pushes
 * them as readiness input; a morning weigh-in from a synced scale goes to the weight log.
 */
export async function syncNight(athleteId: string, day: string): Promise<ReadinessSummary | null> {
  const p = healthProvider();
  if (!p || !(await p.available())) return null;
  const night = await p.readNight(day);
  if (!night) return null;
  if (night.weight_kg != null && night.weight_kg >= 30 && night.weight_kg <= 250) {
    await api.putWeight(athleteId, { day, weight_kg: night.weight_kg, source: p.source }).catch(() => null);
  }
  if (night.hrv_ms == null && night.sleep_hours == null && night.resting_hr == null) return null;
  return api.putReadiness(athleteId, {
    day,
    ...(night.hrv_ms != null ? { hrv_ms: night.hrv_ms, hrv_method: night.hrv_method } : {}),
    ...(night.resting_hr != null ? { resting_hr: night.resting_hr } : {}),
    ...(night.sleep_hours != null ? { sleep_hours: night.sleep_hours } : {}),
    source: p.source,
  });
}
