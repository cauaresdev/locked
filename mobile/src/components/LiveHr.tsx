import { useEffect, useState } from 'react';

import { fresh, useDeviceControls, useLiveHr } from '../ble/devices';
import { storedAthlete } from '../storage/db';
import { colors } from '../theme';
import { Badge } from './ui';

const ZONE_COLOR = [colors.concrete, colors.concrete, colors.concrete, colors.bone, colors.amber, colors.redText];

export function zoneOf(bpm: number, hrMax: number | null): number | null {
  if (!hrMax) return null;
  const f = bpm / hrMax;
  return [0.5, 0.6, 0.7, 0.8, 0.9].filter((lb) => f >= lb).length;
}

/** Live heart rate (beats per minute) from the paired strap, with its zone (needs HRmax in the profile). */
export function LiveHr() {
  const hr = useLiveHr();
  const { connected } = useDeviceControls();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 2000); // re-evaluate staleness
    return () => clearInterval(id);
  }, []);
  if (!connected.hr) return null;
  const bpm = fresh(hr);
  if (bpm == null) return <Badge label="♥ sem sinal" color={colors.amber} />;
  const zone = zoneOf(bpm, storedAthlete()?.hr_max ?? null);
  return (
    <Badge label={`♥ ${bpm}/min${zone ? ` · zona ${zone}` : ''}`} color={zone != null ? ZONE_COLOR[zone] : colors.bone} />
  );
}
