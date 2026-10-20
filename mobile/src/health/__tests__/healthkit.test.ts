jest.mock('@kingstinct/react-native-healthkit', () => {
  // Mirrors the native module: newest first unless `ascending: true`.
  const store: Record<string, { quantity: number; startDate: Date }[]> = {
    HKQuantityTypeIdentifierRestingHeartRate: [
      { quantity: 58, startDate: new Date('2026-10-15T22:00:00Z') },
      { quantity: 52, startDate: new Date('2026-10-16T06:00:00Z') },
    ],
    HKQuantityTypeIdentifierBodyMass: [
      { quantity: 81.24, startDate: new Date('2026-10-15T19:00:00Z') },
      { quantity: 80.46, startDate: new Date('2026-10-16T07:00:00Z') },
    ],
    HKQuantityTypeIdentifierHeartRateVariabilitySDNN: [{ quantity: 60, startDate: new Date('2026-10-16T03:00:00Z') }],
  };
  return {
    isHealthDataAvailable: () => true,
    requestAuthorization: async () => true,
    queryCategorySamples: jest.fn(async () => []),
    queryQuantitySamples: jest.fn(async (id: string, o: { ascending?: boolean }) => {
      const rows = [...(store[id] ?? [])].sort((a, b) => +a.startDate - +b.startDate);
      return o.ascending ? rows : rows.reverse();
    }),
  };
});

/* eslint-disable import/first */
import { queryQuantitySamples } from '@kingstinct/react-native-healthkit';

import healthkit from '../healthkit';
/* eslint-enable import/first */

test('takes the newest resting HR and weigh-in of the night', async () => {
  const night = await healthkit.readNight('2026-10-16');
  expect(night).toMatchObject({ resting_hr: 52, weight_kg: 80.5, hrv_ms: 60, hrv_method: 'sdnn' });
  const calls = (queryQuantitySamples as jest.Mock).mock.calls.filter(([id]) => !String(id).includes('Variability'));
  for (const [, options] of calls) expect(options.ascending).toBe(false);
});
