// Mirrors backend/knightfall/domain.py and api.py response models.

export type Tier = 'vigilante' | 'dark_knight' | 'brawler';
export type Mode = 'timed' | 'reps' | 'hold';
export type Modality =
  | 'strength'
  | 'tempo'
  | 'isometric'
  | 'explosive'
  | 'hypertrophy'
  | 'conditioning'
  | 'prep';
export type BlockKind = 'prep' | 'strength' | 'conditioning' | 'recovery';
export type ExecutionStyle = 'straight_sets' | 'amrap' | 'checklist';
export type ReadinessLevel = 'green' | 'amber' | 'red';

export interface Tempo {
  eccentric: number;
  bottom_pause: number;
  concentric: number;
  top_pause: number;
}

export interface Prescription {
  exercise_id: string;
  name: string;
  pattern: string;
  implement: string;
  modality: Modality;
  mode: Mode;
  sets: number;
  duration_seconds: number | null;
  reps: number | null;
  reps_per_side: number | null;
  reps_sequence: number[] | null;
  hold_seconds: number | null;
  intra_set_rest_seconds: number | null;
  tempo: Tempo | null;
  unilateral: boolean;
  target_rpe: number | null;
  suggested_load_kg: number | null;
  intensity: string | null;
  cues: string[];
}

export interface Block {
  order: number;
  kind: BlockKind;
  name: string;
  duration_minutes: number;
  execution_style: ExecutionStyle;
  mandatory_lock: boolean;
  rest_seconds: number;
  exercises: Prescription[];
}

export interface ReadinessSummary {
  score: number;
  level: ReadinessLevel;
  mobility_expanded: boolean;
  reasons: string[];
}

export interface Session {
  protocol_id: string;
  tier: Tier;
  cycle_index: number;
  cycle_day: number;
  cycle_length: number;
  cycle_structure: string;
  is_training_day: boolean;
  day_name: string;
  target_duration_minutes: number;
  rest_cap_seconds: number;
  readiness: ReadinessSummary | null;
  notices: string[];
  blocks: Block[];
}

export interface TierInfo {
  tier: Tier;
  protocol_id: string;
  cycle_structure: string;
  cycle_length: number;
  sessions_per_cycle: number;
  target_minutes: number;
  requires_waiver: boolean;
  max_recommended_weeks: number | null;
}

export type Sex = 'male' | 'female';

export interface Athlete {
  id: string;
  name: string;
  tier: Tier;
  cycle_start: string;
  bodyweight_kg: number;
  body_fat_pct: number | null;
  height_cm: number | null;
  birth_year: number | null;
  sex: Sex | null;
  hr_max_override: number | null;
  hr_max: number | null;
  timezone: string;
  early_bird_enabled: boolean;
  wake_time: string; // HH:MM
  waiver_accepted_at: string | null;
  cycle_length: number;
  cycle_structure: string;
}

export interface ProfileInput {
  name?: string;
  tier?: Tier;
  bodyweight_kg?: number;
  body_fat_pct?: number | null;
  height_cm?: number | null;
  birth_year?: number | null;
  sex?: Sex | null;
  hr_max_override?: number | null;
  timezone?: string;
  early_bird_enabled?: boolean;
  wake_time?: string;
  accept_brawler_waiver?: boolean;
}

export interface AuthResult {
  token: string;
  user_id: string;
  athlete_id: string | null;
}

export interface SetLog {
  id: string;
  performed_on: string; // YYYY-MM-DD
  exercise_id: string;
  set_index: number;
  reps?: number | null;
  load_kg?: number | null;
  duration_seconds?: number | null;
  distance_m?: number | null;
  rpe?: number | null;
}

export interface ArmorLoad {
  total_kg_m: number;
  by_kind: Record<'carry' | 'sled' | 'weighted_pull', number>;
  current_cycle_kg_m: number;
  previous_cycle_kg_m: number;
}

export interface ReadinessInput {
  day: string;
  hrv_ms?: number | null;
  hrv_method?: 'rmssd' | 'sdnn';
  resting_hr?: number | null;
  sleep_hours?: number | null;
  soreness?: number | null;
  source?: 'manual' | 'healthkit' | 'health_connect';
}

export interface StrengthEntry {
  exercise_id: string;
  name: string;
  e1rm_kg: number;
  history: [string, number][];
}

// --- nutrition ---------------------------------------------------------------

export type Meal = 'breakfast' | 'post_workout' | 'snack' | 'dinner';
export type Dairy = 'none' | 'traces' | 'contains' | 'isolate';
export type FoodCategory = 'carb' | 'protein' | 'veg' | 'fat' | 'supplement';

export interface Macros {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Totals extends Macros {
  sodium_mg: number;
}

export interface Staple {
  id: string;
  name: string;
  category: FoodCategory;
  kcal: number; // per 100 g
  protein: number;
  carbs: number;
  fat: number;
  sodium_mg: number;
  default_g: number;
  dairy: Dairy;
}

export interface Alert {
  level: 'red' | 'amber' | 'info';
  code: string;
  message: string;
  meal: Meal | null;
  entry_id: string | null;
}

export interface MealPlan {
  meal: Meal;
  target: Macros;
  carb_curfew: boolean;
  suggestions: Staple[];
  consumed: Totals;
}

export interface Supplement {
  item_id: string;
  label: string;
  meal: Meal;
  taken: boolean;
}

export interface FoodEntry {
  id: string;
  day: string;
  meal: Meal;
  name: string;
  barcode: string | null;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sodium_mg: number;
  dairy: Dairy;
  category: FoodCategory | null;
}

export interface FoodEntryInput {
  id: string;
  day: string;
  meal: Meal;
  name: string;
  grams: number;
  staple_id?: string;
  barcode?: string;
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  sodium_mg?: number;
  dairy?: Dairy;
  category?: FoodCategory;
}

export interface NutritionDay {
  day: string;
  is_training_day: boolean;
  lbm_kg: number;
  lbm_source: 'body_fat' | 'boer' | 'assumed';
  kcal_floor: number;
  kcal_ceiling: number;
  session_kcal: number;
  session_kcal_source: 'telemetry' | 'estimate' | 'none';
  target: Macros;
  sodium_min_mg: number;
  sodium_max_mg: number;
  consumed: Totals;
  meals: MealPlan[];
  alerts: Alert[];
  supplements: Supplement[];
  entries: FoodEntry[];
}

export interface Product {
  barcode: string;
  found: boolean;
  name: string;
  brand: string | null;
  kcal_100g: number | null;
  protein_100g: number | null;
  carbs_100g: number | null;
  fat_100g: number | null;
  sodium_mg_100g: number | null;
  serving_g: number | null;
  dairy: Dairy;
  dairy_evidence: string;
  alerts: Alert[];
}

// --- telemetry / early bird ----------------------------------------------------

export type SampleKind = 'hr' | 'power' | 'cadence';

export interface TelemetrySample {
  ts: string; // ISO with offset
  kind: SampleKind;
  value: number;
}

export interface EarlyBird {
  day: string;
  enabled: boolean;
  wake_time: string;
  status: 'not_started' | 'in_window' | 'complete' | 'missed' | 'no_hr_max';
  woke_at: string | null;
  window_ends_at: string | null;
  minutes_in_zone: number;
  required_minutes: number;
  zone_bpm: [number, number] | null;
  avg_hr: number | null;
  streak: number;
}
