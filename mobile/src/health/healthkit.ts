import {
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  queryStatisticsForQuantity,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';

import { dayWindow, mean, nightWindow, sleepHoursHealthKit } from './aggregate';
import type { HealthProvider } from './types';

const HRV = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN';
const RESTING = 'HKQuantityTypeIdentifierRestingHeartRate';
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const BODY_MASS = 'HKQuantityTypeIdentifierBodyMass';
const STEPS = 'HKQuantityTypeIdentifierStepCount';

const provider: HealthProvider = {
  name: 'Apple Health',
  source: 'healthkit',
  async available() {
    return isHealthDataAvailable();
  },
  async requestAccess() {
    return requestAuthorization({ toRead: [HRV, RESTING, SLEEP, BODY_MASS, STEPS] });
  },
  async readNight(day) {
    const { start, end } = nightWindow(day);
    const filter = { date: { startDate: start, endDate: end } };
    // Newest first, explicitly: the latest resting HR / weigh-in of the window is the one that counts.
    const newest = { limit: 0, filter, ascending: false } as const;
    const [hrv, rhr, sleep, mass] = await Promise.all([
      queryQuantitySamples(HRV, { limit: 0, unit: 'ms', filter }),
      queryQuantitySamples(RESTING, { ...newest, unit: 'count/min' }),
      queryCategorySamples(SLEEP, { limit: 0, filter }),
      queryQuantitySamples(BODY_MASS, { ...newest, unit: 'kg' }),
    ]);
    return {
      hrv_ms: mean(hrv.map((s) => s.quantity)),
      hrv_method: 'sdnn', // Apple Health exposes SDNN, not RMSSD
      resting_hr: rhr.length ? Math.round(rhr[0].quantity) : null,
      sleep_hours: sleepHoursHealthKit(sleep.map((s) => ({ value: Number(s.value), startDate: s.startDate,
        endDate: s.endDate }))),
      weight_kg: mass.length ? Math.round(mass[0].quantity * 10) / 10 : null,
    };
  },
  async readSteps(day) {
    const { start, end } = dayWindow(day);
    // A statistics query deduplicates iPhone + Apple Watch counting the same walk.
    const r = await queryStatisticsForQuantity(STEPS, ['cumulativeSum'], {
      filter: { date: { startDate: start, endDate: end } },
      unit: 'count',
    });
    const n = r.sumQuantity?.quantity;
    return n != null && n > 0 ? Math.round(n) : null;
  },
};

export default provider;
