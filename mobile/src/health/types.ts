export interface NightReading {
  hrv_ms: number | null;
  hrv_method: 'rmssd' | 'sdnn';
  resting_hr: number | null;
  sleep_hours: number | null;
}

export interface HealthProvider {
  name: string;
  source: 'healthkit' | 'health_connect';
  available(): Promise<boolean>;
  requestAccess(): Promise<boolean>;
  readNight(day: string): Promise<NightReading | null>;
}
