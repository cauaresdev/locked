import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import BleManager, { type Peripheral, type PeripheralInfo } from 'react-native-ble-manager';

import type { TelemetrySample } from '../api/types';
import { enqueueTelemetry, saveDevices, savedDevices, type DeviceRole, type SavedDevices } from '../storage/db';
import {
  CHARACTERISTICS,
  SERVICES,
  mergeAdvert,
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
const LIVE_MS = 950; // bikes notify several times a second; the screen needs ~1 Hz

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

/** Connection state and actions: changes only when a device connects or drops. */
interface DeviceControls {
  connected: Partial<Record<DeviceRole, string>>; // role -> name
  connect: (d: FoundDevice, role: DeviceRole) => Promise<void>;
  forget: (role: DeviceRole) => Promise<void>;
  /** Disconnect everything and drop unsaved samples (sign-out / account switch). */
  reset: () => Promise<void>;
}

/** Scan state: changes with every advertisement while scanning, so only the pairing screen reads it. */
interface DeviceScan {
  scanning: boolean;
  found: FoundDevice[];
  error: string | null; // last scan or connect failure
  scan: () => Promise<void>;
}

interface Bike {
  power: Live | null;
  cadence: Live | null;
}

type DevicesState = DeviceControls & DeviceScan & Bike & { hr: Live | null };

const Ctx = createContext<DeviceControls | null>(null);
const ScanCtx = createContext<DeviceScan | null>(null);
const HrCtx = createContext<Live | null>(null);
const BikeCtx = createContext<Bike>({ power: null, cadence: null });

// Registered by the mounted provider so non-React code (sign-out, 401) can reach it.
let resetMounted: (() => Promise<void>) | null = null;

// Without a usable adapter (Bluetooth off, emulators) some native calls never settle; sign-in
// and sign-out await these, so each one gets a bound instead of hanging the screen.
const BLE_CALL_MS = 2000;
const bounded = (p: Promise<unknown>) =>
  Promise.race([p.catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, BLE_CALL_MS))]);

/** Disconnect all BLE devices and drop buffered samples, so nothing reaches the next account. */
export async function disconnectAllDevices(): Promise<void> {
  await resetMounted?.();
}

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
  const [found, setFoundState] = useState<FoundDevice[]>([]);
  const foundRef = useRef<FoundDevice[]>([]); // read by the advertisement handler without re-subscribing
  const [error, setError] = useState<string | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const current = useRef<Partial<Record<DeviceRole, string>>>({}); // role -> peripheral id in use
  const buffer = useRef<TelemetrySample[]>([]);
  const lastSampleAt = useRef<Record<string, number>>({});
  const lastLiveAt = useRef<Record<string, number>>({});
  const reconnectTimers = useRef<Partial<Record<DeviceRole, ReturnType<typeof setTimeout>>>>({});

  const setFound = useCallback((list: FoundDevice[]) => {
    foundRef.current = list;
    setFoundState(list);
  }, []);

  // Live values re-render every screen that shows them: at most ~1 Hz per kind.
  const due = useCallback((kind: string, now: number) => {
    if (now - (lastLiveAt.current[kind] ?? 0) < LIVE_MS) return false;
    lastLiveAt.current[kind] = now;
    return true;
  }, []);

  const roleOf = useCallback(
    (id: string) => (Object.keys(current.current) as DeviceRole[]).find((r) => current.current[r] === id),
    [],
  );

  const dropRole = useCallback(
    (role: DeviceRole) =>
      setConnected((c) => {
        const next = { ...c };
        delete next[role];
        return next;
      }),
    [],
  );

  const record = useCallback((kind: TelemetrySample['kind'], value: number) => {
    const now = Date.now();
    if (now - (lastSampleAt.current[kind] ?? 0) < 950) return; // 1 Hz is plenty
    lastSampleAt.current[kind] = now;
    buffer.current.push({ ts: new Date(now).toISOString(), kind, value });
  }, []);

  const flushBuffer = useCallback(() => {
    if (buffer.current.length === 0) return;
    const batch = buffer.current;
    buffer.current = [];
    enqueueTelemetry(batch).catch(() => {
      buffer.current = [...batch, ...buffer.current];
    });
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
        throw new Error('Aparelho sem os padrões Bluetooth de bike (FTMS ou Cycling Power)');
      }
    },
    [],
  );

  const connectId = useCallback(
    async (id: string, name: string, role: DeviceRole) => {
      await start();
      await BleManager.connect(id);
      current.current[role] = id;
      await subscribe(id, role);
      setConnected((c) => ({ ...c, [role]: name }));
    },
    [start, subscribe],
  );

  // Straps drop out between sets and may be off at launch: keep retrying the saved device,
  // backing off up to a minute, until it comes back or the user forgets / replaces it.
  const reconnect = useCallback(
    (role: DeviceRole, id: string) => {
      const attempt = (delay: number) => {
        clearTimeout(reconnectTimers.current[role]);
        reconnectTimers.current[role] = setTimeout(() => {
          const saved = savedDevices()[role];
          if (saved?.id !== id) return;
          connectId(saved.id, saved.name, role).catch(() => attempt(Math.min(delay * 2, RECONNECT_MAX_MS)));
        }, delay);
      };
      attempt(RECONNECT_FIRST_MS);
    },
    [connectId],
  );

  useEffect(() => {
    const subs = [
      BleManager.onDiscoverPeripheral((p) => {
        const roles = rolesFromAdvert(p);
        if (roles.length === 0) return;
        const name = p.name ?? p.advertising?.localName ?? p.id.slice(0, 8);
        const next = mergeAdvert(foundRef.current, { id: p.id, name, rssi: p.rssi, roles });
        if (next) setFound(next); // RSSI jitter on a listed device re-renders nothing
      }),
      BleManager.onStopScan(() => setScanning(false)),
      BleManager.onDisconnectPeripheral(({ peripheral }) => {
        const role = roleOf(peripheral);
        if (!role) return; // a device we already replaced or reset
        delete current.current[role];
        dropRole(role);
        if (savedDevices()[role]?.id === peripheral) reconnect(role, peripheral);
      }),
      BleManager.onDidUpdateValueForCharacteristic(({ peripheral, characteristic, value }) => {
        if (!roleOf(peripheral)) return;
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
        if (bike.powerW != null && bike.powerW >= 0) {
          if (due('power', now)) setPower({ value: bike.powerW, at: now });
          record('power', bike.powerW);
        }
        if (bike.cadenceRpm != null && bike.cadenceRpm >= 0) {
          if (due('cadence', now)) setCadence({ value: bike.cadenceRpm, at: now });
          record('cadence', bike.cadenceRpm);
        }
      }),
      AppState.addEventListener('change', (state) => {
        if (state === 'background') flushBuffer();
      }),
    ];

    // Reconnect saved devices on launch, all roles at once; an unreachable one keeps retrying.
    (async () => {
      const saved = savedDevices();
      if (!saved.hr && !saved.bike) return;
      if (!(await ensurePermissions())) return;
      await Promise.all(
        (['hr', 'bike'] as const).map(async (role) => {
          const d = saved[role];
          if (d) await connectId(d.id, d.name, role).catch(() => reconnect(role, d.id));
        }),
      );
    })().catch(() => {}); // permission request failed: pairing from Ajustes still works

    const flush = setInterval(flushBuffer, FLUSH_MS);

    const timers = reconnectTimers.current;
    return () => {
      subs.forEach((s) => s.remove());
      clearInterval(flush);
      Object.values(timers).forEach(clearTimeout);
      flushBuffer();
    };
  }, [connectId, dropRole, due, flushBuffer, reconnect, record, roleOf, setFound]);

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
  }, [start, setFound]);

  const connect = useCallback(
    async (d: FoundDevice, role: DeviceRole) => {
      setError(null);
      try {
        await BleManager.stopScan().catch(() => {});
        const previous = current.current[role] ?? savedDevices()[role]?.id;
        if (previous && previous !== d.id) {
          // Replacing the device for this role: its disconnect event must not trigger a reconnect.
          clearTimeout(reconnectTimers.current[role]);
          delete current.current[role];
          dropRole(role);
          await BleManager.disconnect(previous).catch(() => {});
        }
        await connectId(d.id, d.name, role);
        const saved: SavedDevices = { ...savedDevices(), [role]: { id: d.id, name: d.name } };
        saveDevices(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [connectId, dropRole],
  );

  const forget = useCallback(async (role: DeviceRole) => {
    clearTimeout(reconnectTimers.current[role]);
    const saved = savedDevices();
    const d = saved[role];
    delete saved[role];
    saveDevices(saved);
    const id = current.current[role] ?? d?.id;
    delete current.current[role];
    if (id) await BleManager.disconnect(id).catch(() => {});
    dropRole(role);
  }, [dropRole]);

  const reset = useCallback(async () => {
    for (const role of Object.keys(reconnectTimers.current) as DeviceRole[]) {
      clearTimeout(reconnectTimers.current[role]);
      delete reconnectTimers.current[role];
    }
    const ids = Object.values(current.current);
    current.current = {}; // from here on, readings and disconnects are ignored
    buffer.current = [];
    lastSampleAt.current = {};
    lastLiveAt.current = {};
    await bounded(BleManager.stopScan());
    await Promise.all(ids.map((id) => (id ? bounded(BleManager.disconnect(id)) : null)));
    setConnected({});
    setFound([]);
    setHr(null);
    setPower(null);
    setCadence(null);
  }, [setFound]);

  useEffect(() => {
    resetMounted = reset;
    return () => {
      if (resetMounted === reset) resetMounted = null;
    };
  }, [reset]);

  const controls = useMemo(() => ({ connected, connect, forget, reset }), [connected, connect, forget, reset]);
  const scanState = useMemo(() => ({ scanning, found, error, scan }), [scanning, found, error, scan]);
  const bike = useMemo(() => ({ power, cadence }), [power, cadence]);
  return (
    <Ctx.Provider value={controls}>
      <ScanCtx.Provider value={scanState}>
        <BikeCtx.Provider value={bike}>
          <HrCtx.Provider value={hr}>{children}</HrCtx.Provider>
        </BikeCtx.Provider>
      </ScanCtx.Provider>
    </Ctx.Provider>
  );
}

/** Connections and actions only; does not re-render on readings or scan results. */
export function useDeviceControls(): DeviceControls {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDeviceControls outside DevicesProvider');
  return ctx;
}

/** Scan results and the scan action (re-renders as devices are found). */
export function useDeviceScan(): DeviceScan {
  const ctx = useContext(ScanCtx);
  if (!ctx) throw new Error('useDeviceScan outside DevicesProvider');
  return ctx;
}

/** Latest heart-rate reading (updates ~1 Hz). */
export function useLiveHr(): Live | null {
  return useContext(HrCtx);
}

/** Latest bike power / cadence readings (update ~1 Hz). */
export function useLiveBike(): Bike {
  return useContext(BikeCtx);
}

/** Everything at once (re-renders on every reading); prefer the narrower hooks above. */
export function useDevices(): DevicesState {
  const controls = useDeviceControls();
  const scan = useDeviceScan();
  const hr = useLiveHr();
  const bike = useLiveBike();
  return useMemo(() => ({ ...controls, ...scan, ...bike, hr }), [controls, scan, bike, hr]);
}

/** Latest reading, or null when it is older than a few seconds (strap off / out of range). */
export function fresh(l: Live | null, now = Date.now()): number | null {
  return l && now - l.at < STALE_MS ? l.value : null;
}
