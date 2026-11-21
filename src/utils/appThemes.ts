import { TAILWIND_PALETTE } from './palette';

export type ThemeMode = 'dark' | 'light';
export type Shade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export const SHADES: readonly Shade[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
/** Hex colours ('#rrggbb', lower-case) per shade. */
export type ColorScale = Record<Shade, string>;

export type AccentId = 'blue' | 'cyan' | 'emerald' | 'violet' | 'rose' | 'amber' | 'orange';

export interface Accent {
  id: AccentId;
  label: string;
  scale: ColorScale;
}

export interface AppTheme {
  id: string;
  label: string;
  mode: ThemeMode;
  /**
   * Neutral scale in role order: 950 = app background, 900 = surface, 800/700 = borders
   * and hover, 600/500/400 = muted text, 300-50 = primary text. Light themes therefore
   * hold light colours at 950 and dark colours at 50.
   */
  neutral: ColorScale;
  defaultAccent: AccentId;
  /** Id of the paired terminal preset. */
  terminalTheme: string;
}

export const DEFAULT_APP_THEME_ID = 'wayterm-dark';
export const DEFAULT_ACCENT_ID: AccentId = 'blue';

export const ACCENTS: readonly Accent[] = [
  { id: 'blue', label: 'Blau', scale: TAILWIND_PALETTE.blue },
  { id: 'cyan', label: 'Cyan', scale: TAILWIND_PALETTE.cyan },
  { id: 'emerald', label: 'Smaragd', scale: TAILWIND_PALETTE.emerald },
  { id: 'violet', label: 'Violett', scale: TAILWIND_PALETTE.violet },
  { id: 'rose', label: 'Rosé', scale: TAILWIND_PALETTE.rose },
  { id: 'amber', label: 'Bernstein', scale: TAILWIND_PALETTE.amber },
  { id: 'orange', label: 'Orange', scale: TAILWIND_PALETTE.orange },
];

export const APP_THEMES: readonly AppTheme[] = [
  {
    id: 'wayterm-dark',
    label: 'Wayterm Dunkel',
    mode: 'dark',
    neutral: TAILWIND_PALETTE.zinc,
    defaultAccent: 'blue',
    terminalTheme: 'wayterm-vivid',
  },
  {
    id: 'midnight',
    label: 'Mitternacht',
    mode: 'dark',
    neutral: {
      50: '#f7f9fd',
      100: '#edf1f9',
      200: '#dde4f2',
      300: '#c3cde3',
      400: '#98a6c4',
      500: '#6b7a99',
      600: '#485878',
      700: '#2f3d5c',
      800: '#1f2a44',
      900: '#141c32',
      950: '#0b1120',
    },
    defaultAccent: 'blue',
    terminalTheme: 'tokyo-night',
  },
  {
    id: 'nord',
    label: 'Nord',
    mode: 'dark',
    // Polar night (nord0, nord1, nord3) below, snow storm (nord4-nord6) above.
    neutral: {
      50: '#f8f9fb',
      100: '#eceff4',
      200: '#e5e9f0',
      300: '#d8dee9',
      400: '#a3aec2',
      500: '#7b88a1',
      600: '#616e88',
      700: '#4c566a',
      800: '#3b4252',
      900: '#2e3440',
      950: '#242933',
    },
    defaultAccent: 'cyan',
    terminalTheme: 'nord',
  },
  {
    id: 'dracula',
    label: 'Dracula',
    mode: 'dark',
    // Background #282a36, current line #44475a, comment #6272a4, foreground #f8f8f2.
    neutral: {
      50: '#fdfdfa',
      100: '#f8f8f2',
      200: '#e6e6e3',
      300: '#d2d3db',
      400: '#a4acce',
      500: '#7f8bb5',
      600: '#6272a4',
      700: '#44475a',
      800: '#343746',
      900: '#282a36',
      950: '#21222c',
    },
    defaultAccent: 'violet',
    terminalTheme: 'dracula',
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dunkel',
    mode: 'dark',
    // base03/base02 backgrounds, base01/base0/base1 content tones, base2/base3 emphasis.
    neutral: {
      50: '#fffbf0',
      100: '#fdf6e3',
      200: '#eee8d5',
      300: '#cecfc3',
      400: '#93a1a1',
      500: '#839496',
      600: '#586e75',
      700: '#1f5a69',
      800: '#0e4755',
      900: '#073642',
      950: '#002b36',
    },
    defaultAccent: 'cyan',
    terminalTheme: 'solarized-dark',
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox',
    mode: 'dark',
    // bg0_h, bg0, bg1, bg2, bg3, gray, fg4, fg2, fg1, fg0.
    neutral: {
      50: '#fdf6d9',
      100: '#fbf1c7',
      200: '#ebdbb2',
      300: '#d5c4a1',
      400: '#a89984',
      500: '#928374',
      600: '#665c54',
      700: '#504945',
      800: '#3c3836',
      900: '#282828',
      950: '#1d2021',
    },
    defaultAccent: 'orange',
    terminalTheme: 'gruvbox-dark',
  },
  {
    id: 'wayterm-light',
    label: 'Wayterm Hell',
    mode: 'light',
    neutral: {
      50: '#09090b',
      100: '#18181b',
      200: '#27272a',
      300: '#3f3f46',
      400: '#52525b',
      500: '#71717a',
      600: '#a1a1aa',
      700: '#d4d4d8',
      800: '#e4e4e7',
      900: '#f4f4f5',
      950: '#ffffff',
    },
    defaultAccent: 'blue',
    terminalTheme: 'github-light',
  },
  {
    id: 'solarized-light',
    label: 'Solarized Hell',
    mode: 'light',
    // base3/base2 backgrounds, base1/base00 muted tones, base02/base03 emphasis.
    neutral: {
      50: '#001f27',
      100: '#002b36',
      200: '#073642',
      300: '#254c57',
      400: '#4b6169',
      500: '#657b83',
      600: '#93a1a1',
      700: '#cbc4ae',
      800: '#ddd6c1',
      900: '#eee8d5',
      950: '#fdf6e3',
    },
    defaultAccent: 'blue',
    terminalTheme: 'solarized-light',
  },
];

/**
 * Light themes flip chromatic palettes so that classes written for dark surfaces
 * (`text-blue-300`, `bg-red-950`) stay legible; 500 and 600 keep their value so
 * solid buttons look the same in both modes.
 */
const MIRROR: Record<Shade, Shade> = {
  50: 950,
  100: 900,
  200: 800,
  300: 700,
  400: 600,
  500: 500,
  600: 600,
  700: 300,
  800: 200,
  900: 100,
  950: 50,
};

const CHROMATIC_PALETTES = ['amber', 'red', 'emerald', 'purple', 'sky', 'lime', 'violet'] as const;

export function getAppTheme(id: string): AppTheme {
  return APP_THEMES.find((theme) => theme.id === id) ?? APP_THEMES[0];
}

export function getAccent(id: string): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0];
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio (1..21) of two '#rrggbb' colours; argument order is irrelevant. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Maps every `--c-<palette>-<shade>` variable to its space-separated RGB channels. */
export function buildThemeVariables(theme: AppTheme, accent: Accent): Record<string, string> {
  const variables: Record<string, string> = {};
  const assign = (palette: string, scale: ColorScale, mirrored: boolean) => {
    for (const shade of SHADES) {
      variables[`--c-${palette}-${shade}`] = hexToRgb(scale[mirrored ? MIRROR[shade] : shade]).join(' ');
    }
  };
  const mirrored = theme.mode === 'light';

  assign('zinc', theme.neutral, false);
  assign('blue', accent.scale, mirrored);
  for (const palette of CHROMATIC_PALETTES) {
    assign(palette, TAILWIND_PALETTE[palette], mirrored);
  }
  return variables;
}

export function applyAppTheme(
  themeId: string,
  accentId: string,
  root: HTMLElement = document.documentElement,
): void {
  const theme = getAppTheme(themeId);
  const variables = buildThemeVariables(theme, getAccent(accentId));
  for (const name in variables) {
    root.style.setProperty(name, variables[name]);
  }
  root.style.colorScheme = theme.mode;
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.mode;
}
