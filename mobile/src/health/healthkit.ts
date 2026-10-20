import {
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';

import { mean, nightWindow, sleepHoursHealthKit } from './aggregate';
import type { HealthProvider } from './types';

const HRV = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN';
const RESTING = 'HKQuantityTypeIdentifierRestingHeartRate';
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const BODY_MASS = 'HKQuantityTypeIdentifierBodyMass';

const provider: HealthProvider = {
  name: 'Apple Health',
  source: 'healthkit',
  async available() {
    return isHealthDataAvailable();
  },
  async requestAccess() {
    return requestAuthorization({ toRead: [HRV, RESTING, SLEEP, BODY_MASS] });
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
};

export default provider;
