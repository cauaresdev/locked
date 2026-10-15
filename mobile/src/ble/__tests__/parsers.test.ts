import { parseCyclingPower, parseHeartRate, parseIndoorBikeData, shortUuid } from '../parsers';

describe('heart rate measurement', () => {
  it('parses uint8 bpm without contact support', () => {
    expect(parseHeartRate([0x00, 72])).toEqual({ bpm: 72, contact: null, rrMs: [] });
  });

  it('parses uint16 bpm, contact, energy and RR intervals', () => {
    // flags: uint16 HR | contact supported+detected | energy | RR
    const flags = 0x01 | 0x06 | 0x08 | 0x10;
    const bytes = [flags, 0x2c, 0x01, 0x10, 0x00, 0x00, 0x04, 0x00, 0x02];
    expect(parseHeartRate(bytes)).toEqual({ bpm: 300, contact: true, rrMs: [1000, 500] });
  });

  it('reports lost contact', () => {
    expect(parseHeartRate([0x04, 60])?.contact).toBe(false);
  });

  it('rejects short payloads', () => {
    expect(parseHeartRate([0x01, 0x40])).toBeNull();
  });
});

describe('FTMS indoor bike data', () => {
  it('reads speed, cadence and power when flagged', () => {
    // flags: cadence (bit2) + power (bit6); bit0 clear => speed present
    const flags = 0x0004 | 0x0040;
    const bytes = [flags & 0xff, flags >> 8, 0xc4, 0x09, 0xb4, 0x00, 0x5e, 0x01];
    expect(parseIndoorBikeData(bytes)).toEqual({ speedKmh: 25, cadenceRpm: 90, powerW: 350 });
  });

  it('skips unrequested fields and reads heart rate', () => {
    // More Data set (no speed), total distance + resistance + power + energy + HR
    const flags = 0x0001 | 0x0010 | 0x0020 | 0x0040 | 0x0100 | 0x0200;
    const bytes = [
      flags & 0xff, flags >> 8,
      0x10, 0x27, 0x00, // distance
      0x05, 0x00, // resistance
      0xe8, 0x03, // power 1000 W
      0x00, 0x00, 0x00, 0x00, 0x00, // energy
      0x9b, // HR 155
    ];
    expect(parseIndoorBikeData(bytes)).toEqual({ powerW: 1000, heartRate: 155 });
  });
});

describe('cycling power', () => {
  it('reads signed instantaneous power', () => {
    expect(parseCyclingPower([0x00, 0x00, 0x2c, 0x01])).toEqual({ powerW: 300 });
  });
});

it('normalises SIG UUIDs', () => {
  expect(shortUuid('0000180D-0000-1000-8000-00805F9B34FB')).toBe('180d');
  expect(shortUuid('180D')).toBe('180d');
});
