import { cancelEarlyBird, cancelRoutineReminders, cancelTrainingReminders } from './notifications';
import { clearLocalData } from './storage/db';

/**
 * Everything the device holds for an account: data and the OS notifications scheduled from it.
 * Sign-out, account deletion and a login as someone else all go through here, so reminders of the
 * previous account never keep firing for the next one.
 */
export async function wipeDevice(): Promise<void> {
  await Promise.all(
    [cancelEarlyBird, cancelRoutineReminders, cancelTrainingReminders].map((cancel) => cancel().catch(() => {})),
  );
  await clearLocalData();
}
