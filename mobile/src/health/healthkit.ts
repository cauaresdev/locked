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

const provider: HealthProvider = {
  name: 'Apple Health',
  source: 'healthkit',
  async available() {
    return isHealthDataAvailable();
  },
  async requestAccess() {
    return requestAuthorization({ toRead: [HRV, RESTING, SLEEP] });
  },
  async readNight(day) {
    const { start, end } = nightWindow(day);
    const filter = { date: { startDate: start, endDate: end } };
    const [hrv, rhr, sleep] = await Promise.all([
      queryQuantitySamples(HRV, { limit: 0, unit: 'ms', filter }),
      queryQuantitySamples(RESTING, { limit: 0, unit: 'count/min', filter }),
      queryCategorySamples(SLEEP, { limit: 0, filter }),
    ]);
    return {
      hrv_ms: mean(hrv.map((s) => s.quantity)),
      hrv_method: 'sdnn', // Apple Health exposes SDNN, not RMSSD
      resting_hr: rhr.length ? Math.round(rhr[rhr.length - 1].quantity) : null,
      sleep_hours: sleepHoursHealthKit(sleep.map((s) => ({ value: Number(s.value), startDate: s.startDate,
        endDate: s.endDate }))),
    };
  },
};

export default provider;
