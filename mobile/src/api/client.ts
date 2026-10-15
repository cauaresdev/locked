import { emitUnauthorized, getToken } from '../auth';
import type {
  Athlete,
  ArmorLoad,
  AuthResult,
  EarlyBird,
  FoodEntryInput,
  NutritionDay,
  ProfileInput,
  Product,
  ReadinessInput,
  ReadinessSummary,
  Session,
  SetLog,
  Staple,
  StrengthEntry,
  Supplement,
  TelemetrySample,
  Tier,
  TierInfo,
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

async function request<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const token = init?.auth === false ? null : getToken();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    if (res.status === 401 && token) emitUnauthorized();
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`;
      throw new ApiError(res.status, detail);
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
  me: () => request<Athlete | null>('/auth/me'),

  tiers: () => request<TierInfo[]>('/tiers'),
  createAthlete: (body: ProfileInput & { name: string; tier: Tier; bodyweight_kg: number }) =>
    request<Athlete>('/athletes', json('POST', body)),
  athlete: (id: string) => request<Athlete>(`/athletes/${id}`),
  updateAthlete: (id: string, body: ProfileInput) => request<Athlete>(`/athletes/${id}`, json('PATCH', body)),

  session: (id: string, day: string) => request<Session>(`/athletes/${id}/sessions/${day}`),
  schedule: (id: string, start: string, days = 16) =>
    request<Session[]>(`/athletes/${id}/schedule?start=${start}&days=${days}`),
  putReadiness: (id: string, body: ReadinessInput) =>
    request<ReadinessSummary>(`/athletes/${id}/readiness`, json('PUT', body)),
  postLogs: (id: string, logs: SetLog[]) => request<Sync>(`/athletes/${id}/logs`, json('POST', logs)),
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

  postTelemetry: (id: string, samples: TelemetrySample[]) =>
    request<Sync>(`/athletes/${id}/telemetry`, json('POST', samples)),
  earlyBird: (id: string, day: string) => request<EarlyBird>(`/athletes/${id}/early-bird/${day}`),
  wake: (id: string, day: string, wokeAt: string) =>
    request<EarlyBird>(`/athletes/${id}/early-bird/${day}/wake`, json('PUT', { woke_at: wokeAt })),
};
