import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_700Bold, useFonts } from '@expo-google-fonts/jetbrains-mono';
import { setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { type ErrorBoundaryProps, Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useSyncExternalStore } from 'react';
import { useColorScheme, View } from 'react-native';

import { clearToken, onUnauthorized } from '../auth';
import { reportError, wrapRoot } from '../crash';
import { DevicesProvider } from '../ble/devices';
import { ToastHost } from '../components/Toast';
import { Button, T } from '../components/ui';
import { CuesProvider } from '../hooks/useCues';
import { configureNotifications } from '../notifications';
import { applyScheme, colors, resolveScheme, space, subscribeTheme, themePreference } from '../theme';

SplashScreen.preventAutoHideAsync();
configureNotifications();

export default wrapRoot(RootLayout);

/** A screen that crashes while rendering shows this instead of a blank app, and the crash is reported. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => reportError(error), [error]);
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: space.lg, gap: space.md, backgroundColor: colors.bg }}>
      <T variant="title" accessibilityRole="header">Algo deu errado nesta tela</T>
      <T variant="hint">Seus treinos estão salvos no aparelho. Tente de novo; se continuar, feche e abra o app.</T>
      <Button label="Tentar de novo" onPress={retry} />
    </View>
  );
}

function RootLayout() {
  const router = useRouter();
  // The palette follows the phone (or the choice in Perfil). A change swaps the live palette and
  // remounts the screens under a new key, so every style is rebuilt in the new colors.
  const system = useColorScheme();
  const pref = useSyncExternalStore(subscribeTheme, themePreference);
  const scheme = resolveScheme(system);
  applyScheme(scheme);
  void pref; // read so a preference change re-renders the root
  const [loaded, error] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, JetBrainsMono_400Regular, JetBrainsMono_700Bold,
  });

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

  // Tapping the wake alarm opens Early Bird; a routine reminder the routine; a training reminder Hoje.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const route = r.notification.request.content.data?.route;
      if (route === '/early-bird' || route === '/routine' || route === '/today' || route === '/progress') {
        router.push(route);
      }
    });
    return () => sub.remove();
  }, [router]);

  if (!loaded && !error) return null;

  return (
    <CuesProvider>
      <DevicesProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <View key={scheme} style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="scan" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="history" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="credits" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="session/[day]" options={{ animation: 'slide_from_right' }} />
        </Stack>
        <ToastHost />
        </View>
      </DevicesProvider>
    </CuesProvider>
  );
}
