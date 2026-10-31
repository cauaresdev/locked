import { emitUnauthorized, getToken } from '../auth';
import type {
  Athlete,
  AthleteCreate,
  ArmorLoad,
  AuthResult,
  EarlyBird,
  FoodEntryInput,
  Measurements,
  MeasurementsInput,
  Missed,
  NutritionDay,
  Prescription,
  Progress,
  ProfileInput,
  Product,
  ReadinessInput,
  ReadinessSummary,
  Routine,
  RoutineCheck,
  Session,
  SetLog,
  Staple,
  StrengthEntry,
  Supplement,
  TelemetrySample,
  TierInfo,
  WeighInInput,
  Weight,
} from './types';

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const TIMEOUT_MS = 10000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Sync = { accepted: number; duplicates: number };

/** Readable message from an error body: FastAPI's 422 detail is a list of {loc, msg}. */
export function errorDetail(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((d: { loc?: unknown[]; msg?: unknown }) => {
        const field = (d.loc ?? []).filter((p) => p !== 'body' && typeof p !== 'number').join('.');
        const msg = typeof d.msg === 'string' ? d.msg : 'inválido';
        return field ? `${field}: ${msg}` : msg;
      })
      .join('; ');
  }
  return `HTTP ${status}`;
}

type Init = RequestInit & { auth?: boolean; token?: string };

async function request<T>(path: string, init?: Init): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const { auth, token: explicit, ...rest } = init ?? {};
  const token = auth === false ? null : (explicit ?? getToken());
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
    });
    // Only the session still in use is over: a stale request must not sign out a newer login.
    if (res.status === 401 && token && token === getToken()) emitUnauthorized();
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, errorDetail(body, res.status));
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

export const api = {
  register: (email: string, password: string) =>
    request<AuthResult>('/auth/register', { ...json('POST', { email, password }), auth: false }),
  login: (email: string, password: string) =>
    request<AuthResult>('/auth/login', { ...json('POST', { email, password }), auth: false }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: (token?: string) => request<Athlete | null>('/auth/me', { token }),

  tiers: () => request<TierInfo[]>('/tiers'),
  createAthlete: (body: AthleteCreate) => request<Athlete>('/athletes', json('POST', body)),
  athlete: (id: string, token?: string) => request<Athlete>(`/athletes/${id}`, { token }),
  updateAthlete: (id: string, body: ProfileInput) => request<Athlete>(`/athletes/${id}`, json('PATCH', body)),

  session: (id: string, day: string) => request<Session>(`/athletes/${id}/sessions/${day}`),
  schedule: (id: string, start: string, days = 16) =>
    request<Session[]>(`/athletes/${id}/schedule?start=${start}&days=${days}`),
  putReadiness: (id: string, body: ReadinessInput) =>
    request<ReadinessSummary>(`/athletes/${id}/readiness`, json('PUT', body)),
  postLogs: (id: string, logs: SetLog[]) => request<Sync>(`/athletes/${id}/logs`, json('POST', logs)),
  deleteLog: (id: string, logId: string) => request<void>(`/athletes/${id}/logs/${logId}`, { method: 'DELETE' }),
  alternatives: (id: string, day: string, block: number, index: number) =>
    request<Prescription[]>(`/athletes/${id}/sessions/${day}/alternatives?block=${block}&index=${index}`),
  missed: (id: string, day: string) => request<Missed>(`/athletes/${id}/cycle/missed?day=${day}`),
  shiftCycle: (id: string, days: number) => request<Athlete>(`/athletes/${id}/cycle/shift`, json('POST', { days })),
  armorLoad: (id: string, on: string) => request<ArmorLoad>(`/athletes/${id}/armor-load?on=${on}`),
  strength: (id: string) => request<StrengthEntry[]>(`/athletes/${id}/strength`),

  nutrition: (id: string, day: string) => request<NutritionDay>(`/athletes/${id}/nutrition/${day}`),
  postFood: (id: string, entries: FoodEntryInput[]) =>
    request<Sync>(`/athletes/${id}/food-entries`, json('POST', entries)),
  deleteFood: (id: string, entryId: string) =>
    request<void>(`/athletes/${id}/food-entries/${entryId}`, { method: 'DELETE' }),
  setSupplement: (id: string, day: string, item_id: string, taken: boolean) =>
    request<Supplement[]>(`/athletes/${id}/supplements/${day}`, json('PUT', { item_id, taken })),
  staples: () => request<Staple[]>('/foods/staples'),
  product: (barcode: string) => request<Product>(`/foods/barcode/${barcode}`),

  putWeight: (id: string, body: WeighInInput) => request<Weight>(`/athletes/${id}/weight`, json('PUT', body)),
  weight: (id: string, days = 90) => request<Weight>(`/athletes/${id}/weight?days=${days}`),
  progress: (id: string, days = 60) => request<Progress>(`/athletes/${id}/progress?days=${days}`),
  measurements: (id: string) => request<Measurements>(`/athletes/${id}/measurements`),
  putMeasurements: (id: string, body: MeasurementsInput) =>
    request<Measurements>(`/athletes/${id}/measurements`, json('PUT', body)),

  exportData: () => request<Record<string, unknown>>('/auth/export'),
  deleteAccount: (password: string) => request<void>('/auth/account', json('DELETE', { password })),

  postTelemetry: (id: string, samples: TelemetrySample[]) =>
    request<Sync>(`/athletes/${id}/telemetry`, json('POST', samples)),
  earlyBird: (id: string, day: string) => request<EarlyBird>(`/athletes/${id}/early-bird/${day}`),
  wake: (id: string, day: string, wokeAt: string) =>
    request<EarlyBird>(`/athletes/${id}/early-bird/${day}/wake`, json('PUT', { woke_at: wokeAt })),

  routine: (id: string, day: string) => request<Routine>(`/athletes/${id}/routine/${day}`),
  setRoutineItem: (id: string, day: string, item: string, body: RoutineCheck) =>
    request<Routine>(`/athletes/${id}/routine/${day}/items/${item}`, json('PUT', body)),
};
