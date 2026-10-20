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
