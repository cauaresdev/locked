import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';

import { getToken } from '../../auth';
import { useDeviceControls } from '../../ble/devices';
import { Icon, type IconName } from '../../components/Icon';
import { colors } from '../../theme';

const icon = (name: IconName) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={22} color={color} />;
  };

export default function TabLayout() {
  // Connection state only: a live BPM in the tab title re-rendered the whole navigator every second.
  const strap = !!useDeviceControls().connected.hr;
  if (!getToken()) return <Redirect href="/login" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Hidden tabs stay mounted; frozen, they skip the renders that live BLE readings would cause.
        freezeOnBlur: true,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.bg, borderTopWidth: 0, elevation: 0 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen name="today" options={{ title: 'Hoje', tabBarIcon: icon('home') }} />
      <Tabs.Screen
        name="routine"
        // Not frozen: it opens Early Bird, and the heart icon shows a connected strap.
        options={{ title: 'Rotina', tabBarIcon: icon(strap ? 'heart' : 'moon'), freezeOnBlur: false }}
      />
      <Tabs.Screen name="nutrition" options={{ title: 'Nutrição', tabBarIcon: icon('apple') }} />
      <Tabs.Screen name="progress" options={{ title: 'Progresso', tabBarIcon: icon('chart') }} />
      <Tabs.Screen name="settings" options={{ title: 'Perfil', tabBarIcon: icon('user') }} />
      <Tabs.Screen
        name="early-bird"
        // Opened from Rotina, not from the tab bar. Not frozen: its zone voice cues are driven by
        // live HR renders and must keep speaking during the 30-min window on any other tab.
        options={{ href: null, title: 'Early Bird', freezeOnBlur: false }}
      />
    </Tabs>
  );
}
