import { getSdkStatus, initialize, readRecords, requestPermission, SdkAvailabilityStatus } from 'react-native-health-connect';

import { mean, nightWindow, sleepHoursHealthConnect } from './aggregate';
import type { HealthProvider } from './types';

const PERMISSIONS = [
  { accessType: 'read', recordType: 'HeartRateVariabilityRmssd' },
  { accessType: 'read', recordType: 'RestingHeartRate' },
  { accessType: 'read', recordType: 'SleepSession' },
] as const;

let initialized = false;

async function ready(): Promise<boolean> {
  if ((await getSdkStatus()) !== SdkAvailabilityStatus.SDK_AVAILABLE) return false;
  if (!initialized) initialized = await initialize();
  return initialized;
}

const provider: HealthProvider = {
  name: 'Health Connect',
  source: 'health_connect',
  available: ready,
  async requestAccess() {
    if (!(await ready())) return false;
    const granted = await requestPermission([...PERMISSIONS]);
    return granted.length > 0;
  },
  async readNight(day) {
    if (!(await ready())) return null;
    const { start, end } = nightWindow(day);
    const timeRangeFilter = { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() };
    const [hrv, rhr, sleep] = await Promise.all([
      readRecords('HeartRateVariabilityRmssd', { timeRangeFilter }),
      readRecords('RestingHeartRate', { timeRangeFilter }),
      readRecords('SleepSession', { timeRangeFilter }),
    ]);
    const lastRhr = rhr.records[rhr.records.length - 1];
    return {
      hrv_ms: mean(hrv.records.map((r) => r.heartRateVariabilityMillis)),
      hrv_method: 'rmssd',
      resting_hr: lastRhr ? lastRhr.beatsPerMinute : null,
      sleep_hours: sleepHoursHealthConnect(sleep.records.map((r) => ({ startTime: r.startTime, endTime: r.endTime,
        stages: r.stages?.map((s) => ({ startTime: s.startTime, endTime: s.endTime, stage: s.stage })) }))),
    };
  },
};

export default provider;
