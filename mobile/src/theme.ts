// Dark minimal palette: surfaces separate by fill, not borders. One accent (bat-signal yellow)
// marks the primary action; success / warning / danger carry state only.
export const colors = {
  bg: '#0B0B0D', // screen background
  surface: '#151518', // cards
  surfaceHigh: '#1E1E22', // inputs, secondary buttons, pressed rows, tracks
  border: '#26262B', // dividers; use sparingly
  text: '#F4F4F5', // primary text
  textMuted: '#A1A1AA', // secondary text (≥ 7:1 on surface)
  textFaint: '#71717A', // non-essential text only: ~4:1, below the 4.5:1 minimum for content
  accent: '#FACC15', // primary action fill, current-day marker
  onAccent: '#0B0B0D', // text on accent
  success: '#34D399', // completed / improving
  warning: '#FB923C', // alerts, locks, offline
  danger: '#F87171', // errors, readiness red, destructive actions (text and fills)
  dangerFill: '#2A1416', // banner background behind danger text
  warningFill: '#2A1C10', // banner background behind warning text
} as const;

// Only big numbers (timers, metrics) use the monospace face, for tabular figures; all other
// text uses the system sans-serif.
export const fonts = {
  mono: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const levelColor = {
  green: colors.success,
  amber: colors.warning,
  red: colors.danger,
} as const;

/** Readiness levels as text (scores, written levels). Same shades now: all pass 4.5:1 on the surfaces. */
export const levelTextColor = levelColor;
