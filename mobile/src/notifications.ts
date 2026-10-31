import { requireOptionalNativeModule } from 'expo';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Channel sound/importance can't change after creation on Android: bump the id to change them.
const CHANNEL = 'early_bird_v1';
const REST_CHANNEL = 'rest_v1';
const ALARM_ID = 'early-bird-alarm';

export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // In the foreground the rest timer beeps by itself; its notification is for a locked or
      // backgrounded phone only.
      const quiet = n.request.content.data?.kind === 'rest';
      return { shouldShowBanner: !quiet, shouldShowList: !quiet, shouldPlaySound: !quiet, shouldSetBadge: false };
    },
  });
}

async function ensureRestChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REST_CHANNEL, {
    name: 'Fim do descanso',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'rest.wav',
    vibrationPattern: [0, 300, 150, 300, 150, 300],
  });
}

// Local module (modules/exact-alarm): Android 12+ only, absent elsewhere.
const ExactAlarm = requireOptionalNativeModule<{ canScheduleExactAlarms(): boolean; openSettings(): void }>(
  'ExactAlarm',
);

/**
 * Without "Alarms & reminders" (denied by default from Android 14), Android may hold a scheduled
 * notification back by most of its interval: a 60 s rest alert arrived 47 s late in testing.
 */
export function exactAlarmsAllowed(): boolean {
  return ExactAlarm?.canScheduleExactAlarms() ?? true;
}

export function openExactAlarmSettings(): void {
  ExactAlarm?.openSettings();
}

/**
 * Asks once, at the start of a session, so the first rest alert isn't lost to a prompt.
 * Resolves true when alerts are on but would be late: the caller offers the exact-alarm setting.
 */
export async function prepareRestAlerts(): Promise<boolean> {
  await ensureRestChannel(); // Android 13+ only prompts once a channel exists
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  return perm.granted && !exactAlarmsAllowed();
}

/**
 * End-of-rest alert delivered by the OS: with the screen locked or the app in the background the
 * JS countdown is suspended and can't beep. Returns a cancel that also clears it from the tray.
 */
export function scheduleRestAlert(seconds: number, body: string): () => void {
  let id: string | null = null;
  let cancelled = false;
  const drop = (n: string) => {
    Notifications.cancelScheduledNotificationAsync(n).catch(() => {});
    Notifications.dismissNotificationAsync(n).catch(() => {});
  };
  (async () => {
    await ensureRestChannel();
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    id = await Notifications.scheduleNotificationAsync({
      content: { title: 'Descanso encerrado', body, sound: 'rest.wav', data: { kind: 'rest' } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(seconds)),
        channelId: REST_CHANNEL,
      },
    });
    if (cancelled) drop(id); // skipped while the schedule call was in flight
  })().catch(() => {});
  return () => {
    cancelled = true;
    if (id) drop(id);
  };
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Gotham Early Bird',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'alarm.wav',
    vibrationPattern: [0, 500, 250, 500, 250, 500],
    bypassDnd: false,
  });
}

/** Daily wake alarm at HH:MM local. Returns false when permission is denied. */
export async function scheduleEarlyBird(wakeTime: string): Promise<boolean> {
  await ensureChannel(); // Android 13+ only prompts once a channel exists
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return false;
  await cancelEarlyBird();
  const [hour, minute] = wakeTime.split(':').map(Number);
  await Notifications.scheduleNotificationAsync({
    identifier: ALARM_ID,
    content: {
      title: 'GOTHAM EARLY BIRD',
      body: 'Acordar. Cinta no peito. 30 minutos para a zona aeróbica em jejum.',
      sound: 'alarm.wav',
      data: { route: '/early-bird' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: CHANNEL },
  });
  return true;
}

export async function cancelEarlyBird(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(ALARM_ID).catch(() => {});
}

// --- Batfleck routine reminders ---------------------------------------------------

const ROUTINE_CHANNEL = 'routine_v1';
const ROUTINE_IDS = ['routine-water-1', 'routine-water-2', 'routine-water-3', 'routine-screens', 'routine-bed'];

async function ensureRoutineChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ROUTINE_CHANNEL, {
    name: 'Rotina',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Daily reminders: water three times between waking and screens-off, then screens off and bedtime. */
export function routineReminderTimes(wake: string, screensOff: string, bedtime: string) {
  const start = minutesOf(wake);
  let end = minutesOf(screensOff);
  if (end <= start) end += 24 * 60;
  const span = end - start;
  const at = (m: number) => {
    const t = Math.round(m) % (24 * 60);
    return { hour: Math.floor(t / 60), minute: t % 60 };
  };
  return [
    { id: ROUTINE_IDS[0], ...at(start + span * 0.25), title: 'Água', body: 'Meio litro agora. A meta do dia está na aba Rotina.' },
    { id: ROUTINE_IDS[1], ...at(start + span * 0.5), title: 'Água', body: 'Metade do dia: confira quanto falta da meta.' },
    { id: ROUTINE_IDS[2], ...at(start + span * 0.75), title: 'Água', body: 'Última rodada antes da noite.' },
    { id: ROUTINE_IDS[3], ...at(end), title: 'Telas desligadas', body: 'Uma hora para dormir. Celular fora do quarto.' },
    { id: ROUTINE_IDS[4], ...at(minutesOf(bedtime)), title: 'Hora de dormir', body: `Na cama agora para acordar às ${wake}.` },
  ];
}

/** Returns false when notification permission is denied. */
export async function scheduleRoutineReminders(wake: string, screensOff: string, bedtime: string): Promise<boolean> {
  await ensureRoutineChannel();
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return false;
  await cancelRoutineReminders();
  for (const r of routineReminderTimes(wake, screensOff, bedtime)) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { route: '/routine' } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: r.hour,
        minute: r.minute,
        channelId: ROUTINE_CHANNEL,
      },
    });
  }
  return true;
}

export async function cancelRoutineReminders(): Promise<void> {
  await Promise.all(ROUTINE_IDS.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}
