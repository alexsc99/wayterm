import { ACCENTS, APP_THEMES, DEFAULT_ACCENT_ID, DEFAULT_APP_THEME_ID, getAppTheme, type AccentId } from './appThemes';
import {
  TERMINAL_COLOR_KEYS,
  TERMINAL_THEME_PRESETS,
  getTerminalPreset,
  type TerminalColors,
} from './terminalThemes';

const APPEARANCE_STORAGE_KEY = 'putty_plus_appearance'; // legacy prefix, kept so existing installs keep their settings
// Former vivid/zinc toggle. Only read here to migrate; never written or removed.
const LEGACY_COLORS_STORAGE_KEY = 'putty_plus_mobaxterm_colors';

export interface AppearanceSettings {
  /** AppTheme id */
  appTheme: string;
  accent: AccentId;
  /** Preset id, 'auto' (preset paired with the app theme) or 'custom' */
  terminalTheme: string;
  customTerminalColors: TerminalColors;
}

const DEFAULT_CUSTOM_TERMINAL_COLORS: TerminalColors = getTerminalPreset('wayterm-vivid').colors;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  appTheme: DEFAULT_APP_THEME_ID,
  accent: DEFAULT_ACCENT_ID,
  terminalTheme: 'auto',
  customTerminalColors: { ...DEFAULT_CUSTOM_TERMINAL_COLORS },
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function sanitizeTerminalColors(raw: unknown): TerminalColors {
  const source = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const colors = { ...DEFAULT_CUSTOM_TERMINAL_COLORS };
  for (const key of TERMINAL_COLOR_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && HEX_COLOR.test(value)) colors[key] = value.toLowerCase();
  }
  return colors;
}

/**
 * Validates stored appearance settings field by field.
 * `legacySyntaxFlag` is the raw value of the former vivid-colours toggle; it only matters while
 * no appearance has been stored yet: users who had switched it off keep their zinc terminal.
 */
export function sanitizeAppearance(raw: unknown, legacySyntaxFlag?: string | null): AppearanceSettings {
  if (raw === null || raw === undefined) {
    return {
      ...DEFAULT_APPEARANCE,
      terminalTheme: legacySyntaxFlag === 'false' ? 'zinc' : 'auto',
      customTerminalColors: { ...DEFAULT_CUSTOM_TERMINAL_COLORS },
    };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_APPEARANCE, customTerminalColors: { ...DEFAULT_CUSTOM_TERMINAL_COLORS } };
  }

  const parsed = raw as Record<string, unknown>;
  const storedTheme = parsed.appTheme;
  const appTheme =
    typeof storedTheme === 'string' && APP_THEMES.some((theme) => theme.id === storedTheme)
      ? storedTheme
      : DEFAULT_APP_THEME_ID;
  const accent = ACCENTS.find((candidate) => candidate.id === parsed.accent)?.id ?? getAppTheme(appTheme).defaultAccent;
  const storedTerminalTheme = parsed.terminalTheme;
  const terminalTheme =
    typeof storedTerminalTheme === 'string' &&
    (storedTerminalTheme === 'auto' ||
      storedTerminalTheme === 'custom' ||
      TERMINAL_THEME_PRESETS.some((preset) => preset.id === storedTerminalTheme))
      ? storedTerminalTheme
      : 'auto';

  return {
    appTheme,
    accent,
    terminalTheme,
    customTerminalColors: sanitizeTerminalColors(parsed.customTerminalColors),
  };
}

export function loadAppearance(): AppearanceSettings {
  let stored: unknown = null;
  let legacySyntaxFlag: string | null = null;
  try {
    legacySyntaxFlag = localStorage.getItem(LEGACY_COLORS_STORAGE_KEY);
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (raw !== null) stored = JSON.parse(raw);
  } catch {
    // Unavailable storage or unreadable JSON: continue as if nothing was stored
  }
  return sanitizeAppearance(stored, legacySyntaxFlag);
}

export function saveAppearance(settings: AppearanceSettings): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

/** Colours the terminal actually renders with for the given settings. */
export function resolveTerminalColors(
  settings: Pick<AppearanceSettings, 'appTheme' | 'terminalTheme' | 'customTerminalColors'>,
): TerminalColors {
  if (settings.terminalTheme === 'custom') return settings.customTerminalColors;
  if (settings.terminalTheme === 'auto') return getTerminalPreset(getAppTheme(settings.appTheme).terminalTheme).colors;
  return getTerminalPreset(settings.terminalTheme).colors;
}
