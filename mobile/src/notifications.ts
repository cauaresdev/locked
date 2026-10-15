import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Channel sound/importance can't change after creation on Android: bump the id to change them.
const CHANNEL = 'early_bird_v1';
const ALARM_ID = 'early-bird-alarm';

export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
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
