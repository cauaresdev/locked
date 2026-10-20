import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Text, type ColorValue } from 'react-native';

import { getToken } from '../../auth';
import { useDeviceControls } from '../../ble/devices';
import { colors, fonts } from '../../theme';

// Monospace glyphs instead of an icon font: fits the industrial look and adds no dependency.
const glyph = (g: string) =>
  function Icon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontFamily: fonts.monoBold, fontSize: 16 }}>{g}</Text>;
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
        tabBarActiveTintColor: colors.bone,
        tabBarInactiveTintColor: colors.concrete,
        tabBarStyle: { backgroundColor: colors.void, borderTopColor: colors.seam },
        tabBarLabelStyle: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
      }}
    >
      <Tabs.Screen name="today" options={{ title: 'Hoje', tabBarIcon: glyph('▣') }} />
      <Tabs.Screen name="progress" options={{ title: 'Progresso', tabBarIcon: glyph('▲') }} />
      <Tabs.Screen name="nutrition" options={{ title: 'Nutrição', tabBarIcon: glyph('◧') }} />
      <Tabs.Screen
        name="early-bird"
        // Not frozen: its zone voice cues are driven by live HR renders and must keep
        // speaking during the 30-min window even when another tab is showing.
        options={{ title: 'Early Bird', tabBarIcon: glyph(strap ? '♥' : '◔'), freezeOnBlur: false }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes', tabBarIcon: glyph('≡') }} />
    </Tabs>
  );
}
