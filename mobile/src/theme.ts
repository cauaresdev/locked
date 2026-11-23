import Storage from 'expo-sqlite/kv-store';
import { Appearance, type TextStyle } from 'react-native';

// The BatStudy look ("Minimal", sand beige): neutral grays carry the screen and the cards, and sand
// beige is the second color. Surfaces separate by fill, not borders. In the dark scheme one beige does
// everything (primary button, progress, selection, secondary text); in the light one the primary
// button stays beige and a bronze takes progress and selection, which need contrast on white.
// Warnings are orange so they never read as beige; success / warning / danger carry state only.
type Palette = {
  bg: string; // screen background
  surface: string; // cards
  surfaceHigh: string; // inputs, secondary buttons, pressed rows, tracks
  border: string; // dividers; use sparingly
  text: string; // primary text
  textMuted: string; // secondary text (≥ 4.5:1 on surface)
  textFaint: string; // non-essential text only
  accent: string; // progress, selection, current-day marker, links, accent text (≥ 4.5:1 on surface)
  onAccent: string; // text on accent
  primary: string; // the screen's main button
  onPrimary: string; // text on primary
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
    bg: '#F4F4F5',
    surface: '#FFFFFF',
    surfaceHigh: '#EBEBED',
    border: '#E4E4E7',
    text: '#18181B',
    textMuted: '#5E5547', // beige-gray, 7.3:1
    textFaint: '#63636B',
    accent: '#7A5A2E', // bronze, 6.3:1
    onAccent: '#FFFFFF',
    primary: '#DCC8A6', // sand; dark text 10.8:1
    onPrimary: '#18181B',
    success: '#067A40',
    warning: '#B4470E',
    danger: '#C62828',
    dangerFill: '#FBEAEA',
    warningFill: '#FBEFE8',
    shadow: '#101014',
    scrim: '#0F0F11',
  },
  dark: {
    bg: '#0F0F11',
    surface: '#19191C',
    surfaceHigh: '#222226',
    border: '#2A2A2F',
    text: '#EDEDEF',
    textMuted: '#B9AE9C', // beige-gray, 8.0:1
    textFaint: '#8E8E97',
    accent: '#E2D3B8', // sand, 11.9:1
    onAccent: '#0F0F11',
    primary: '#E2D3B8',
    onPrimary: '#0F0F11',
    success: '#3EE68B',
    warning: '#FB8C3C',
    danger: '#F87171',
    dangerFill: '#2A1718',
    warningFill: '#2A1D13',
    shadow: '#000000',
    scrim: '#0F0F11',
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

// All text is Inter (as in BatStudy), with tabular figures for numbers. The monospace face stays for
// timers and plate math only.
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

const INTER_BY_WEIGHT: Record<string, string> = {
  '100': fonts.regular, '200': fonts.regular, '300': fonts.regular, '400': fonts.regular, normal: fonts.regular,
  '500': fonts.medium,
  '600': fonts.semibold,
  '700': fonts.bold, '800': fonts.bold, '900': fonts.bold, bold: fonts.bold,
};

/**
 * Turns a text style's fontWeight into the matching Inter file. Each weight is its own font family,
 * and a fontWeight left on a custom family makes Android fall back to a synthesized face, so the
 * weight is dropped once the family is set. A style that names its own family (mono) is left alone.
 */
export function withInter(style: TextStyle | undefined): TextStyle {
  if (style?.fontFamily) return style;
  const { fontWeight, ...rest } = style ?? {};
  return { ...rest, fontFamily: INTER_BY_WEIGHT[String(fontWeight ?? '400')] ?? fonts.regular };
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 24, pill: 999 } as const;

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
