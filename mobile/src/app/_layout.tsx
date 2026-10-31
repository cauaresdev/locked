import { JetBrainsMono_400Regular, JetBrainsMono_700Bold, useFonts } from '@expo-google-fonts/jetbrains-mono';
import { setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { clearToken, onUnauthorized } from '../auth';
import { DevicesProvider } from '../ble/devices';
import { CuesProvider } from '../hooks/useCues';
import { configureNotifications } from '../notifications';
import { colors } from '../theme';

SplashScreen.preventAutoHideAsync();
configureNotifications();

export default function RootLayout() {
  const router = useRouter();
  const [loaded, error] = useFonts({ JetBrainsMono_400Regular, JetBrainsMono_700Bold });

  useEffect(() => {
    // Cues and voice play over the user's own music instead of stopping it.
    setAudioModeAsync({ interruptionMode: 'mixWithOthers', playsInSilentMode: true });
  }, []);

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  // Expired / revoked token: back to login. Local data stays: the outboxes may
  // hold sets logged offline, and they upload once the same user signs back in.
  useEffect(
    () =>
      onUnauthorized(async () => {
        await clearToken();
        router.replace('/login');
      }),
    [router],
  );

  // Tapping the wake alarm opens Early Bird; a routine reminder opens the routine.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const route = r.notification.request.content.data?.route;
      if (route === '/early-bird' || route === '/routine') router.push(route);
    });
    return () => sub.remove();
  }, [router]);

  if (!loaded && !error) return null;

  return (
    <CuesProvider>
      <DevicesProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="scan" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
      </DevicesProvider>
    </CuesProvider>
  );
}
