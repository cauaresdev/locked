import Storage from 'expo-sqlite/kv-store';
import { Appearance } from 'react-native';

// Minimal palette in two schemes: white + blue (light) and dark gray + blue (dark). Surfaces separate
// by fill, not borders. One accent (blue) marks the primary action; success / warning / danger carry
// state only.
type Palette = {
  bg: string; // screen background
  surface: string; // cards
  surfaceHigh: string; // inputs, secondary buttons, pressed rows, tracks
  border: string; // dividers; use sparingly
  text: string; // primary text
  textMuted: string; // secondary text (≥ 4.5:1 on surface)
  textFaint: string; // non-essential text only
  accent: string; // primary action fill, current-day marker, links
  onAccent: string; // text on accent
  success: string; // completed / improving
  warning: string; // alerts, locks, offline
  danger: string; // errors, readiness red, destructive actions (text and fills)
  dangerFill: string; // banner background behind danger text
  warningFill: string; // banner background behind warning text
  shadow: string; // card shadow (light scheme only; dark separates by fill)
  scrim: string; // photo overlays: text on top of a picture
};

export type Scheme = 'light' | 'dark';
export type ThemePreference = 'system' | Scheme;

const palettes: Record<Scheme, Palette> = {
  light: {
    bg: '#F1F4F9',
    surface: '#FFFFFF',
    surfaceHigh: '#E9EDF4',
    border: '#DCE2EB',
    text: '#0F172A',
    textMuted: '#556072',
    textFaint: '#8892A3',
    accent: '#2563EB',
    onAccent: '#FFFFFF',
    success: '#15803D',
    warning: '#C2410C',
    danger: '#DC2626',
    dangerFill: '#FDECEC',
    warningFill: '#FFF1E7',
    shadow: '#1E293B',
    scrim: '#0B1220',
  },
  dark: {
    bg: '#0F1115',
    surface: '#181B21',
    surfaceHigh: '#23272F',
    border: '#2D323B',
    text: '#F3F5F8',
    textMuted: '#A4ACBA',
    textFaint: '#6F7787',
    accent: '#3B82F6',
    onAccent: '#FFFFFF',
    success: '#34D399',
    warning: '#FB923C',
    danger: '#F87171',
    dangerFill: '#2A1517',
    warningFill: '#2A1D12',
    shadow: '#000000',
    scrim: '#05070A',
  },
};

const PREF_KEY = 'knightfall_theme';

function readPreference(): ThemePreference {
  try {
    const v = Storage.getItemSync(PREF_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let preference: ThemePreference = readPreference();
let current: Scheme = resolve(preference, Appearance.getColorScheme());
const listeners = new Set<() => void>();

function resolve(pref: ThemePreference, system: string | null | undefined): Scheme {
  if (pref !== 'system') return pref;
  return system === 'light' ? 'light' : 'dark';
}

/**
 * The live palette. It is one object whose values switch with the scheme, so `colors.text` read in
 * a render is always the current color; the root remounts the screens when the scheme changes.
 */
export const colors: Palette = { ...palettes[current] };

export function scheme(): Scheme {
  return current;
}

/** Switches the live palette. Called by the root layout before it remounts the screens. */
export function applyScheme(s: Scheme) {
  if (s === current) return;
  current = s;
  Object.assign(colors, palettes[s]);
}

export function themePreference(): ThemePreference {
  return preference;
}

export function setThemePreference(p: ThemePreference) {
  preference = p;
  try {
    Storage.setItemSync(PREF_KEY, p);
  } catch {
    // Not persisted: it still applies until the app closes.
  }
  listeners.forEach((l) => l());
}

export function subscribeTheme(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function resolveScheme(system: string | null | undefined): Scheme {
  return resolve(preference, system);
}

/**
 * A module-level value built from the palette (a StyleSheet, a color map), rebuilt once per scheme.
 * Use it wherever a constant would otherwise freeze the colors of the scheme the app started in:
 * `const styles = themed(() => StyleSheet.create({ ... }))`.
 */
export function themed<T extends object>(factory: () => T): T {
  const cache: Partial<Record<Scheme, T>> = {};
  const get = () => (cache[current] ??= factory());
  return new Proxy({} as T, {
    get: (_, key) => {
      const v = get();
      const out = Reflect.get(v, key);
      return typeof out === 'function' ? out.bind(v) : out;
    },
    has: (_, key) => Reflect.has(get(), key),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_, key) => {
      const d = Reflect.getOwnPropertyDescriptor(get(), key);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

// Screen titles and big numbers use the system face, bold, with tabular figures for numbers. The
// monospace face stays for timers and plate math only.
export const fonts = {
  display: 'BarlowCondensed_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;

export const levelColor = themed(() => ({
  green: colors.success,
  amber: colors.warning,
  red: colors.danger,
}));

/** Readiness levels as text (scores, written levels). Same shades: all pass 4.5:1 on the surfaces. */
export const levelTextColor = levelColor;

/** Soft card shadow in the light scheme; nothing in the dark one. */
export const cardShadow = themed(() =>
  current === 'light'
    ? { shadowColor: colors.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 }
    : {},
);
