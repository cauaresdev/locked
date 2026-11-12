import type { Athlete } from './api/types';
import { addDays } from './engine/format';
import {
  cancelTrainingReminders,
  scheduleTrainingReminders,
  TRAINING_REMINDER_DAYS,
  trainingReminderPlan,
} from './notifications';
import { cachedRange } from './storage/db';

/**
 * Re-plans the training-day reminders from the cached schedule (run after it is fetched, or when the
 * training time changes). Without a training time there are none.
 */
export async function refreshTrainingReminders(athlete: Athlete, today: string): Promise<boolean> {
  if (!athlete.training_time) {
    await cancelTrainingReminders();
    return true;
  }
  const days = Array.from({ length: TRAINING_REMINDER_DAYS }, (_, i) => addDays(today, i));
  const cached = await cachedRange(days);
  const sessions = days.flatMap((day) => (cached[day] ? [{ ...cached[day], day }] : []));
  return scheduleTrainingReminders(trainingReminderPlan(athlete.training_time, sessions));
}
