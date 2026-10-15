import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Text, type ColorValue } from 'react-native';

import { getToken } from '../../auth';
import { useDevices, fresh } from '../../ble/devices';
import { colors, fonts } from '../../theme';

// Monospace glyphs instead of an icon font: fits the industrial look and adds no dependency.
const glyph = (g: string) =>
  function Icon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontFamily: fonts.monoBold, fontSize: 16 }}>{g}</Text>;
  };

export default function TabLayout() {
  const { hr } = useDevices();
  if (!getToken()) return <Redirect href="/login" />;
  const bpm = fresh(hr);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.bone,
        tabBarInactiveTintColor: colors.concrete,
        tabBarStyle: { backgroundColor: colors.void, borderTopColor: colors.seam },
        tabBarLabelStyle: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
      }}
    >
      <Tabs.Screen name="today" options={{ title: 'Hoje', tabBarIcon: glyph('▣') }} />
      <Tabs.Screen name="nutrition" options={{ title: 'Nutrição', tabBarIcon: glyph('◧') }} />
      <Tabs.Screen
        name="early-bird"
        options={{ title: bpm ? `${bpm} bpm` : 'Early Bird', tabBarIcon: glyph(bpm ? '♥' : '◔') }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes', tabBarIcon: glyph('≡') }} />
    </Tabs>
  );
}
