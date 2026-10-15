// Bluetooth SIG GATT payload parsers. Values arrive as byte arrays (little-endian).

export const SERVICES = {
  heartRate: '180d',
  fitnessMachine: '1826',
  cyclingPower: '1818',
} as const;

export const CHARACTERISTICS = {
  heartRateMeasurement: '2a37',
  indoorBikeData: '2ad2',
  cyclingPowerMeasurement: '2a63',
} as const;

const u16 = (b: number[], i: number) => b[i] | (b[i + 1] << 8);
const s16 = (b: number[], i: number) => {
  const v = u16(b, i);
  return v & 0x8000 ? v - 0x10000 : v;
};

export interface HeartRateReading {
  bpm: number;
  contact: boolean | null; // null when the strap doesn't report contact
  rrMs: number[];
}

/** Heart Rate Measurement (0x2A37). */
export function parseHeartRate(b: number[]): HeartRateReading | null {
  if (b.length < 2) return null;
  const flags = b[0];
  let i = 1;
  let bpm: number;
  if (flags & 0x01) {
    if (b.length < 3) return null;
    bpm = u16(b, i);
    i += 2;
  } else {
    bpm = b[i];
    i += 1;
  }
  const contactSupported = (flags & 0x04) !== 0;
  const contact = contactSupported ? (flags & 0x02) !== 0 : null;
  if (flags & 0x08) i += 2; // energy expended
  const rrMs: number[] = [];
  if (flags & 0x10) {
    for (; i + 1 < b.length; i += 2) rrMs.push(Math.round((u16(b, i) / 1024) * 1000));
  }
  return { bpm, contact, rrMs };
}

export interface BikeReading {
  speedKmh?: number;
  cadenceRpm?: number;
  powerW?: number;
  heartRate?: number;
}

/** FTMS Indoor Bike Data (0x2AD2). Fields are present according to the flag bits, in order. */
export function parseIndoorBikeData(b: number[]): BikeReading | null {
  if (b.length < 2) return null;
  const flags = u16(b, 0);
  let i = 2;
  const out: BikeReading = {};
  const need = (n: number) => i + n <= b.length;
  // Bit 0 is "More Data": instantaneous speed is present when it is CLEAR.
  if (!(flags & 0x0001)) {
    if (!need(2)) return out;
    out.speedKmh = u16(b, i) / 100;
    i += 2;
  }
  if (flags & 0x0002) i += 2; // average speed
  if (flags & 0x0004) {
    if (!need(2)) return out;
    out.cadenceRpm = u16(b, i) / 2;
    i += 2;
  }
  if (flags & 0x0008) i += 2; // average cadence
  if (flags & 0x0010) i += 3; // total distance (uint24)
  if (flags & 0x0020) i += 2; // resistance level
  if (flags & 0x0040) {
    if (!need(2)) return out;
    out.powerW = s16(b, i);
    i += 2;
  }
  if (flags & 0x0080) i += 2; // average power
  if (flags & 0x0100) i += 5; // expended energy: total(2) + per hour(2) + per minute(1)
  if (flags & 0x0200) {
    if (!need(1)) return out;
    out.heartRate = b[i];
    i += 1;
  }
  return out;
}

/** Cycling Power Measurement (0x2A63): flags (2 bytes) then instantaneous power (sint16). */
export function parseCyclingPower(b: number[]): BikeReading | null {
  if (b.length < 4) return null;
  return { powerW: s16(b, 2) };
}

/** Normalises a 16- or 128-bit UUID string to its short form when it's a SIG base UUID. */
export function shortUuid(uuid: string): string {
  const u = uuid.toLowerCase();
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(u);
  return m ? m[1] : u;
}
