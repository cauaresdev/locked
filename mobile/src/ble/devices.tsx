import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import BleManager, { type Peripheral, type PeripheralInfo } from 'react-native-ble-manager';

import type { TelemetrySample } from '../api/types';
import { enqueueTelemetry, saveDevices, savedDevices, type DeviceRole, type SavedDevices } from '../storage/db';
import {
  CHARACTERISTICS,
  SERVICES,
  parseCyclingPower,
  parseHeartRate,
  parseIndoorBikeData,
  shortUuid,
  type BikeReading,
} from './parsers';

const SCAN_SECONDS = 10;
const FLUSH_MS = 10_000;
const STALE_MS = 5_000; // a reading older than this is shown as "no signal"
const RECONNECT_FIRST_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;

export interface Live {
  value: number;
  at: number;
}

export interface FoundDevice {
  id: string;
  name: string;
  rssi: number;
  roles: DeviceRole[];
}

interface DevicesState {
  hr: Live | null;
  power: Live | null;
  cadence: Live | null;
  connected: Partial<Record<DeviceRole, string>>; // role -> name
  scanning: boolean;
  found: FoundDevice[];
  error: string | null;
  scan: () => Promise<void>;
  connect: (d: FoundDevice, role: DeviceRole) => Promise<void>;
  forget: (role: DeviceRole) => Promise<void>;
}

const Ctx = createContext<DevicesState | null>(null);

async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted =
    Number(Platform.Version) >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return Object.values(result).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
}

function rolesFromAdvert(p: Peripheral): DeviceRole[] {
  const uuids = (p.advertising?.serviceUUIDs ?? []).map(shortUuid);
  const roles: DeviceRole[] = [];
  if (uuids.includes(SERVICES.heartRate)) roles.push('hr');
  if (uuids.includes(SERVICES.fitnessMachine) || uuids.includes(SERVICES.cyclingPower)) roles.push('bike');
  return roles;
}

function hasChar(info: PeripheralInfo, service: string, characteristic: string): boolean {
  return (info.characteristics ?? []).some(
    (c) => shortUuid(c.service) === service && shortUuid(c.characteristic) === characteristic,
  );
}

/**
 * BLE heart-rate straps (Heart Rate Service) and bikes (FTMS / Cycling Power).
 * Saved devices reconnect automatically; every reading is buffered as
 * telemetry (1 Hz per kind) and flushed to the offline outbox.
 */
export function DevicesProvider({ children }: { children: ReactNode }) {
  const [hr, setHr] = useState<Live | null>(null);
  const [power, setPower] = useState<Live | null>(null);
  const [cadence, setCadence] = useState<Live | null>(null);
  const [connected, setConnected] = useState<Partial<Record<DeviceRole, string>>>({});
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<FoundDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const roleOf = useRef<Record<string, DeviceRole>>({}); // peripheral id -> role
  const buffer = useRef<TelemetrySample[]>([]);
  const lastSampleAt = useRef<Record<string, number>>({});
  const reconnectTimers = useRef<Partial<Record<DeviceRole, ReturnType<typeof setTimeout>>>>({});

  const record = useCallback((kind: TelemetrySample['kind'], value: number) => {
    const now = Date.now();
    if (now - (lastSampleAt.current[kind] ?? 0) < 950) return; // 1 Hz is plenty
    lastSampleAt.current[kind] = now;
    buffer.current.push({ ts: new Date(now).toISOString(), kind, value });
  }, []);

  const start = useCallback(() => {
    ready.current ??= BleManager.start({ showAlert: false }).catch((e) => {
      ready.current = null;
      throw e;
    });
    return ready.current;
  }, []);

  const subscribe = useCallback(
    async (id: string, role: DeviceRole) => {
      const info = await BleManager.retrieveServices(id);
      if (role === 'hr') {
        await BleManager.startNotification(id, SERVICES.heartRate, CHARACTERISTICS.heartRateMeasurement);
      } else if (hasChar(info, SERVICES.fitnessMachine, CHARACTERISTICS.indoorBikeData)) {
        await BleManager.startNotification(id, SERVICES.fitnessMachine, CHARACTERISTICS.indoorBikeData);
      } else if (hasChar(info, SERVICES.cyclingPower, CHARACTERISTICS.cyclingPowerMeasurement)) {
        await BleManager.startNotification(id, SERVICES.cyclingPower, CHARACTERISTICS.cyclingPowerMeasurement);
      } else {
        throw new Error('Aparelho sem FTMS ou Cycling Power');
      }
    },
    [],
  );

  const connectId = useCallback(
    async (id: string, name: string, role: DeviceRole) => {
      await start();
      await BleManager.connect(id);
      roleOf.current[id] = role;
      await subscribe(id, role);
      setConnected((c) => ({ ...c, [role]: name }));
    },
    [start, subscribe],
  );

  useEffect(() => {
    const subs = [
      BleManager.onDiscoverPeripheral((p) => {
        const roles = rolesFromAdvert(p);
        if (roles.length === 0) return;
        setFound((list) => {
          const rest = list.filter((d) => d.id !== p.id);
          const name = p.name ?? p.advertising?.localName ?? p.id.slice(0, 8);
          return [...rest, { id: p.id, name, rssi: p.rssi, roles }].sort((a, b) => b.rssi - a.rssi);
        });
      }),
      BleManager.onStopScan(() => setScanning(false)),
      BleManager.onDisconnectPeripheral(({ peripheral }) => {
        const role = roleOf.current[peripheral];
        if (!role) return;
        setConnected((c) => {
          const next = { ...c };
          delete next[role];
          return next;
        });
        // Straps drop out between sets: keep retrying the saved device, backing off up to a minute,
        // until it comes back or the user forgets it.
        const retry = (delay: number) => {
          clearTimeout(reconnectTimers.current[role]);
          reconnectTimers.current[role] = setTimeout(() => {
            const saved = savedDevices()[role];
            if (saved?.id !== peripheral) return;
            connectId(saved.id, saved.name, role).catch(() => retry(Math.min(delay * 2, RECONNECT_MAX_MS)));
          }, delay);
        };
        if (savedDevices()[role]?.id === peripheral) retry(RECONNECT_FIRST_MS);
      }),
      BleManager.onDidUpdateValueForCharacteristic(({ characteristic, value }) => {
        const c = shortUuid(characteristic);
        const now = Date.now();
        if (c === CHARACTERISTICS.heartRateMeasurement) {
          const r = parseHeartRate(value);
          if (r && r.bpm > 0 && r.contact !== false) {
            setHr({ value: r.bpm, at: now });
            record('hr', r.bpm);
          }
          return;
        }
        let bike: BikeReading | null = null;
        if (c === CHARACTERISTICS.indoorBikeData) bike = parseIndoorBikeData(value);
        else if (c === CHARACTERISTICS.cyclingPowerMeasurement) bike = parseCyclingPower(value);
        if (!bike) return;
        if (bike.powerW != null) {
          setPower({ value: bike.powerW, at: now });
          record('power', bike.powerW);
        }
        if (bike.cadenceRpm != null) {
          setCadence({ value: bike.cadenceRpm, at: now });
          record('cadence', bike.cadenceRpm);
        }
      }),
    ];

    // Reconnect saved devices on launch.
    (async () => {
      const saved = savedDevices();
      if (!saved.hr && !saved.bike) return;
      if (!(await ensurePermissions())) return;
      for (const role of ['hr', 'bike'] as const) {
        const d = saved[role];
        if (d) await connectId(d.id, d.name, role).catch(() => {});
      }
    })();

    const flush = setInterval(() => {
      if (buffer.current.length === 0) return;
      const batch = buffer.current;
      buffer.current = [];
      enqueueTelemetry(batch).catch(() => {
        buffer.current = [...batch, ...buffer.current];
      });
    }, FLUSH_MS);

    const timers = reconnectTimers.current;
    return () => {
      subs.forEach((s) => s.remove());
      clearInterval(flush);
      Object.values(timers).forEach(clearTimeout);
    };
  }, [connectId, record]);

  const scan = useCallback(async () => {
    setError(null);
    try {
      if (!(await ensurePermissions())) throw new Error('Permissão de Bluetooth negada');
      await start();
      setFound([]);
      setScanning(true);
      await BleManager.scan({
        serviceUUIDs: [SERVICES.heartRate, SERVICES.fitnessMachine, SERVICES.cyclingPower],
        seconds: SCAN_SECONDS,
      });
    } catch (e) {
      setScanning(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [start]);

  const connect = useCallback(
    async (d: FoundDevice, role: DeviceRole) => {
      setError(null);
      try {
        await BleManager.stopScan().catch(() => {});
        await connectId(d.id, d.name, role);
        const saved: SavedDevices = { ...savedDevices(), [role]: { id: d.id, name: d.name } };
        saveDevices(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [connectId],
  );

  const forget = useCallback(async (role: DeviceRole) => {
    clearTimeout(reconnectTimers.current[role]);
    const saved = savedDevices();
    const d = saved[role];
    delete saved[role];
    saveDevices(saved);
    if (d) await BleManager.disconnect(d.id).catch(() => {});
    setConnected((c) => {
      const next = { ...c };
      delete next[role];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ hr, power, cadence, connected, scanning, found, error, scan, connect, forget }),
    [hr, power, cadence, connected, scanning, found, error, scan, connect, forget],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDevices(): DevicesState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDevices outside DevicesProvider');
  return ctx;
}

/** Latest reading, or null when it is older than a few seconds (strap off / out of range). */
export function fresh(l: Live | null, now = Date.now()): number | null {
  return l && now - l.at < STALE_MS ? l.value : null;
}
