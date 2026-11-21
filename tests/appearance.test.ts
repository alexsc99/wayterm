import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  resolveTerminalColors,
  sanitizeAppearance,
  type AppearanceSettings,
} from '../src/utils/appearance';
import { APP_THEMES, contrastRatio, getAppTheme } from '../src/utils/appThemes';
import {
  TERMINAL_COLOR_KEYS,
  TERMINAL_COLOR_LABELS,
  TERMINAL_THEME_PRESETS,
  getTerminalPreset,
  toXtermTheme,
} from '../src/utils/terminalThemes';

const HEX = /^#[0-9a-f]{6}$/;
const VIVID = getTerminalPreset('wayterm-vivid').colors;

describe('terminal theme presets', () => {
  it('have unique ids', () => {
    const ids = TERMINAL_THEME_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'wayterm-vivid',
      'zinc',
      'dracula',
      'nord',
      'solarized-dark',
      'solarized-light',
      'gruvbox-dark',
      'one-dark',
      'tokyo-night',
      'catppuccin-mocha',
      'monokai',
      'github-light',
    ]);
  });

  for (const preset of TERMINAL_THEME_PRESETS) {
    it(`${preset.id} defines exactly the 20 colour keys as #rrggbb`, () => {
      expect(Object.keys(preset.colors).sort()).toEqual([...TERMINAL_COLOR_KEYS].sort());
      for (const key of TERMINAL_COLOR_KEYS) {
        expect(preset.colors[key], `${preset.id}.${key}`).toMatch(HEX);
      }
    });

    it(`${preset.id} keeps text readable on its background`, () => {
      expect(contrastRatio(preset.colors.foreground, preset.colors.background)).toBeGreaterThanOrEqual(4);
    });
  }

  it('labels every colour key', () => {
    expect(Object.keys(TERMINAL_COLOR_LABELS).sort()).toEqual([...TERMINAL_COLOR_KEYS].sort());
  });

  it('falls back to the vivid preset for unknown ids', () => {
    expect(getTerminalPreset('does-not-exist').id).toBe('wayterm-vivid');
    expect(getTerminalPreset('nord').id).toBe('nord');
  });

  it('keeps the colours shipped before themes existed', () => {
    expect(toXtermTheme(VIVID)).toMatchObject({
      background: '#0c0e14',
      foreground: '#e6e8ee',
      cursor: '#a6e22e',
      cursorAccent: '#0c0e14',
      red: '#ff5555',
      brightBlue: '#66d9ef',
      brightWhite: '#ffffff',
    });
    expect(getTerminalPreset('zinc').colors).toMatchObject({
      background: '#09090b',
      foreground: '#f4f4f5',
      cursor: '#38bdf8',
      selectionBackground: '#38bdf8',
    });
  });
});

describe('app theme pairing', () => {
  for (const theme of APP_THEMES) {
    it(`${theme.id} is paired with an existing terminal preset of the same mode`, () => {
      const preset = TERMINAL_THEME_PRESETS.find((candidate) => candidate.id === theme.terminalTheme);
      expect(preset, theme.terminalTheme).toBeDefined();
      expect(preset?.mode).toBe(theme.mode);
    });
  }
});

describe('sanitizeAppearance', () => {
  it('returns the defaults for garbage input', () => {
    for (const garbage of ['nonsense', 42, true, [], ['nord'], {}]) {
      expect(sanitizeAppearance(garbage)).toEqual(DEFAULT_APPEARANCE);
    }
    expect(sanitizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(sanitizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(
      sanitizeAppearance({ appTheme: 7, accent: null, terminalTheme: {}, customTerminalColors: 'red' }),
    ).toEqual(DEFAULT_APPEARANCE);
  });

  it('defaults to the vivid colours on a fresh install', () => {
    expect(DEFAULT_APPEARANCE.terminalTheme).toBe('auto');
    expect(DEFAULT_APPEARANCE.customTerminalColors).toEqual(VIVID);
    expect(resolveTerminalColors(sanitizeAppearance(null, null))).toEqual(VIVID);
    expect(resolveTerminalColors(sanitizeAppearance(null, 'true'))).toEqual(VIVID);
  });

  it('does not hand out the shared default colour table', () => {
    const first = sanitizeAppearance(null);
    first.customTerminalColors.background = '#123456';
    expect(sanitizeAppearance(null).customTerminalColors.background).toBe(VIVID.background);
    expect(DEFAULT_APPEARANCE.customTerminalColors.background).toBe(VIVID.background);
    expect(getTerminalPreset('wayterm-vivid').colors.background).toBe('#0c0e14');
  });

  it('keeps valid stored values', () => {
    const stored: AppearanceSettings = {
      appTheme: 'nord',
      accent: 'rose',
      terminalTheme: 'monokai',
      customTerminalColors: getTerminalPreset('dracula').colors,
    };
    expect(sanitizeAppearance(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it('replaces an unknown app theme with the default theme', () => {
    const result = sanitizeAppearance({ appTheme: 'does-not-exist', accent: 'violet' });
    expect(result.appTheme).toBe(DEFAULT_APPEARANCE.appTheme);
    expect(result.accent).toBe('violet');
  });

  it("falls back to the chosen theme's default accent for an invalid accent", () => {
    for (const theme of APP_THEMES) {
      expect(sanitizeAppearance({ appTheme: theme.id, accent: 'neon' }).accent).toBe(theme.defaultAccent);
      expect(sanitizeAppearance({ appTheme: theme.id }).accent).toBe(theme.defaultAccent);
    }
  });

  it('accepts auto, custom and preset ids as terminal theme and nothing else', () => {
    expect(sanitizeAppearance({ terminalTheme: 'auto' }).terminalTheme).toBe('auto');
    expect(sanitizeAppearance({ terminalTheme: 'custom' }).terminalTheme).toBe('custom');
    expect(sanitizeAppearance({ terminalTheme: 'tokyo-night' }).terminalTheme).toBe('tokyo-night');
    expect(sanitizeAppearance({ terminalTheme: 'does-not-exist' }).terminalTheme).toBe('auto');
    expect(sanitizeAppearance({ terminalTheme: 3 }).terminalTheme).toBe('auto');
  });

  it('repairs invalid custom colours per key and keeps the valid ones', () => {
    const result = sanitizeAppearance({
      terminalTheme: 'custom',
      customTerminalColors: {
        background: '#ABCDEF',
        foreground: '#112233',
        cursor: 'red',
        selectionBackground: '#12345',
        black: '#1234567',
        red: 'rgb(255, 0, 0)',
        green: 123456,
        yellow: null,
        unknownKey: '#ffffff',
      },
    });
    expect(result.customTerminalColors).toEqual({
      ...VIVID,
      background: '#abcdef',
      foreground: '#112233',
    });
  });

  it('migrates a switched-off vivid mode to the zinc preset when nothing is stored', () => {
    expect(sanitizeAppearance(null, 'false').terminalTheme).toBe('zinc');
    expect(sanitizeAppearance(undefined, 'false').terminalTheme).toBe('zinc');
    expect(sanitizeAppearance(null, 'false')).toEqual({ ...DEFAULT_APPEARANCE, terminalTheme: 'zinc' });
    expect(resolveTerminalColors(sanitizeAppearance(null, 'false'))).toEqual(getTerminalPreset('zinc').colors);
    expect(sanitizeAppearance(null, 'true').terminalTheme).toBe('auto');
    expect(sanitizeAppearance(null, null).terminalTheme).toBe('auto');
  });

  it('lets a stored terminal theme win over the legacy flag', () => {
    expect(sanitizeAppearance({ terminalTheme: 'dracula' }, 'false').terminalTheme).toBe('dracula');
    expect(sanitizeAppearance({ terminalTheme: 'auto' }, 'false').terminalTheme).toBe('auto');
    expect(sanitizeAppearance({ appTheme: 'nord' }, 'false').terminalTheme).toBe('auto');
  });
});

describe('resolveTerminalColors', () => {
  it('follows the app theme pairing for auto', () => {
    for (const theme of APP_THEMES) {
      const colors = resolveTerminalColors({ ...DEFAULT_APPEARANCE, appTheme: theme.id, terminalTheme: 'auto' });
      expect(colors).toEqual(getTerminalPreset(getAppTheme(theme.id).terminalTheme).colors);
    }
    expect(resolveTerminalColors({ ...DEFAULT_APPEARANCE, appTheme: 'nord' })).toEqual(
      getTerminalPreset('nord').colors,
    );
  });

  it('returns the custom colours for custom', () => {
    const customTerminalColors = { ...VIVID, background: '#101010', red: '#fe0000' };
    const colors = resolveTerminalColors({
      ...DEFAULT_APPEARANCE,
      appTheme: 'nord',
      terminalTheme: 'custom',
      customTerminalColors,
    });
    expect(colors).toEqual(customTerminalColors);
  });

  it('returns the named preset regardless of the app theme', () => {
    const colors = resolveTerminalColors({ ...DEFAULT_APPEARANCE, appTheme: 'nord', terminalTheme: 'monokai' });
    expect(colors).toEqual(getTerminalPreset('monokai').colors);
  });
});

describe('toXtermTheme', () => {
  it('draws the selection translucent and the cursor text in the background colour', () => {
    for (const preset of TERMINAL_THEME_PRESETS) {
      const theme = toXtermTheme(preset.colors);
      expect(theme.selectionBackground).toBe(`${preset.colors.selectionBackground}52`);
      expect(theme.cursorAccent).toBe(preset.colors.background);
    }
  });

  it('maps every other colour unchanged', () => {
    const colors = getTerminalPreset('gruvbox-dark').colors;
    const theme = toXtermTheme(colors);
    for (const key of TERMINAL_COLOR_KEYS) {
      if (key === 'selectionBackground') continue;
      expect(theme[key], key).toBe(colors[key]);
    }
  });
});
