// API types, generated from the backend's OpenAPI schema (`npm run gen:api` after
// `python -m knightfall.openapi > mobile/src/api/openapi.json`). Do not hand-edit
// shapes here: change the backend models and regenerate, so the two never drift.

import type { components } from './schema';

type S = components['schemas'];

// --- training ------------------------------------------------------------------
export type Tier = S['Tier'];
export type Mode = S['Mode'];
export type Modality = S['Modality'];
export type Pattern = S['Pattern'];
export type Implement = S['Implement'];
export type BlockKind = S['BlockKind'];
export type ExecutionStyle = S['ExecutionStyle'];
export type Tempo = S['Tempo'];
export type Prescription = S['Prescription'];
export type Block = S['Block'];
export type ReadinessSummary = S['ReadinessSummary'];
export type ReadinessLevel = ReadinessSummary['level'];
export type Session = S['Session'];
export type TierInfo = S['TierOut'];
export type Athlete = S['AthleteOut'];
export type Sex = NonNullable<Athlete['sex']>;
export type ProfileInput = S['AthleteUpdate'];
export type AthleteCreate = S['AthleteCreate'];
export type AuthResult = S['AuthOut'];
export type SetLog = S['SetLogIn'];
export type ArmorLoad = S['ArmorLoadOut'];
export type ReadinessInput = S['ReadinessIn'];
export type StrengthEntry = S['StrengthOut'];
export type Missed = S['MissedOut'];

// --- body weight / progress ---------------------------------------------------------
export type WeighInInput = S['WeighInIn'];
export type Weight = S['WeightOut'];
export type WeightPoint = S['WeightPointOut'];
export type Progress = S['ProgressOut'];
export type ReadinessDay = S['ReadinessDayOut'];
export type ArmorCycle = S['ArmorCycleOut'];
export type DietDay = S['DietDayOut'];
export type AttendanceDay = S['AttendanceDayOut'];
export type MuscleVolume = S['MuscleVolumeOut'];
export type Measurements = S['MeasurementsOut'];
export type MeasurementSite = S['MeasurementSiteOut'];
export type MeasurementsInput = S['MeasurementsIn'];
export type NutritionGoal = Athlete['nutrition_goal'];

// --- nutrition ---------------------------------------------------------------
export type Meal = S['Meal'];
export type Dairy = S['Dairy'];
export type FoodCategory = S['Category'];
export type Macros = S['MacrosOut'];
export type Totals = S['TotalsOut'];
export type Staple = S['StapleOut'];
export type Alert = S['AlertOut'];
export type MealPlan = S['MealPlanOut'];
export type Supplement = S['SupplementOut'];
export type FoodEntry = S['FoodEntryOut'];
export type FoodEntryInput = S['FoodEntryIn'];
export type NutritionDay = S['NutritionDayOut'];
export type Product = S['ProductOut'];

// --- telemetry / early bird ----------------------------------------------------
export type TelemetrySample = S['SampleIn'];
export type SampleKind = TelemetrySample['kind'];
export type EarlyBird = S['EarlyBirdOut'];

// --- Batfleck routine ------------------------------------------------------------
export type Routine = S['RoutineOut'];
export type RoutineItem = S['RoutineItemOut'];
export type RoutineDay = S['RoutineDayOut'];
export type RoutineOption = S['RoutineOptionOut'];
export type RoutineCheck = S['RoutineCheckIn'];
