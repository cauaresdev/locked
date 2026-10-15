// Brutalist / industrial palette. Green is reserved for completed metrics only;
// amber is reserved for alerts. No other accent colors.
export const colors = {
  void: '#0A0A0B', // OLED black background
  gunmetal: '#1C1E21', // panels
  seam: '#2A2D31', // borders, dividers
  concrete: '#8C929B', // secondary text
  bone: '#D4D7DC', // primary text
  amber: '#D97706', // alerts / warnings / locks
  kryptonite: '#10B981', // completed only
  red: '#B91C1C', // readiness red
} as const;

export const fonts = {
  mono: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
  display: 'ShareTechMono_400Regular',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const levelColor = {
  green: colors.kryptonite,
  amber: colors.amber,
  red: colors.red,
} as const;
