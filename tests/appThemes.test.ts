import { describe, expect, it } from 'vitest';
import tailwindColors from 'tailwindcss/colors';
import {
  ACCENTS,
  APP_THEMES,
  DEFAULT_ACCENT_ID,
  DEFAULT_APP_THEME_ID,
  SHADES,
  applyAppTheme,
  buildThemeVariables,
  contrastRatio,
  getAccent,
  getAppTheme,
} from '../src/utils/appThemes';
import { TAILWIND_PALETTE } from '../src/utils/palette';
import type { PaletteName } from '../src/utils/palette';

const channels = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 0xff} ${(value >> 8) & 0xff} ${value & 0xff}`;
};

describe('TAILWIND_PALETTE', () => {
  const reference = tailwindColors as unknown as Record<string, Record<string, string>>;

  it.each(Object.keys(TAILWIND_PALETTE) as PaletteName[])('%s matches tailwindcss/colors', (name) => {
    for (const shade of SHADES) {
      expect(TAILWIND_PALETTE[name][shade], `${name}-${shade}`).toBe(reference[name][shade].toLowerCase());
    }
    expect(Object.keys(TAILWIND_PALETTE[name])).toHaveLength(SHADES.length);
  });
});

describe('contrastRatio', () => {
  it('follows the WCAG definition', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

describe('APP_THEMES', () => {
  it('lists the contracted themes', () => {
    expect(APP_THEMES.map((theme) => [theme.id, theme.mode, theme.defaultAccent, theme.terminalTheme])).toEqual([
      ['wayterm-dark', 'dark', 'blue', 'wayterm-vivid'],
      ['midnight', 'dark', 'blue', 'tokyo-night'],
      ['nord', 'dark', 'cyan', 'nord'],
      ['dracula', 'dark', 'violet', 'dracula'],
      ['solarized-dark', 'dark', 'cyan', 'solarized-dark'],
      ['gruvbox-dark', 'dark', 'orange', 'gruvbox-dark'],
      ['wayterm-light', 'light', 'blue', 'github-light'],
      ['solarized-light', 'light', 'blue', 'solarized-light'],
    ]);
  });

  it('keeps the default theme identical to the Tailwind zinc scale', () => {
    expect(getAppTheme(DEFAULT_APP_THEME_ID).neutral).toEqual(TAILWIND_PALETTE.zinc);
  });

  describe.each(APP_THEMES.map((theme) => [theme.id, theme] as const))('%s', (_id, theme) => {
    const { neutral } = theme;

    it('uses lower-case #rrggbb colours', () => {
      for (const shade of SHADES) {
        expect(neutral[shade], `neutral-${shade}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('keeps primary and muted text readable on background and surface', () => {
      expect(contrastRatio(neutral[200], neutral[950])).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(neutral[200], neutral[900])).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(neutral[400], neutral[950])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(neutral[400], neutral[900])).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps borders distinct from background and surface', () => {
      expect(contrastRatio(neutral[800], neutral[900])).toBeGreaterThanOrEqual(1.1);
      expect(contrastRatio(neutral[800], neutral[950])).toBeGreaterThanOrEqual(1.2);
      expect(contrastRatio(neutral[700], neutral[900])).toBeGreaterThanOrEqual(1.3);
      expect(contrastRatio(neutral[700], neutral[950])).toBeGreaterThanOrEqual(1.3);
    });

    it('is monotonic in luminance', () => {
      // Contrast against black grows strictly with relative luminance. SHADES ascends from
      // 50 to 950: dark themes get darker along it, light themes lighter.
      for (let index = 1; index < SHADES.length; index += 1) {
        const previous = contrastRatio(neutral[SHADES[index - 1]], '#000000');
        const current = contrastRatio(neutral[SHADES[index]], '#000000');
        if (theme.mode === 'dark') {
          expect(current, `neutral-${SHADES[index]}`).toBeLessThan(previous);
        } else {
          expect(current, `neutral-${SHADES[index]}`).toBeGreaterThan(previous);
        }
      }
    });

    it('references a known default accent', () => {
      expect(ACCENTS.some((accent) => accent.id === theme.defaultAccent)).toBe(true);
    });
  });
});

describe('buildThemeVariables', () => {
  it('emits all 9 palettes with 11 shades as RGB channels', () => {
    for (const theme of APP_THEMES) {
      const variables = buildThemeVariables(theme, getAccent(theme.defaultAccent));
      expect(Object.keys(variables)).toHaveLength(99);
      for (const palette of ['zinc', 'blue', 'amber', 'red', 'emerald', 'purple', 'sky', 'lime', 'violet']) {
        for (const shade of SHADES) {
          expect(variables[`--c-${palette}-${shade}`], `${theme.id} ${palette}-${shade}`).toMatch(
            /^\d{1,3} \d{1,3} \d{1,3}$/,
          );
        }
      }
    }
  });

  it('reproduces the Tailwind defaults for the default theme', () => {
    const variables = buildThemeVariables(getAppTheme('wayterm-dark'), getAccent('blue'));
    expect(variables['--c-zinc-950']).toBe('9 9 11');
    for (const palette of ['zinc', 'blue', 'amber', 'red', 'emerald', 'purple', 'sky', 'lime', 'violet'] as const) {
      for (const shade of SHADES) {
        expect(variables[`--c-${palette}-${shade}`]).toBe(channels(TAILWIND_PALETTE[palette][shade]));
      }
    }
  });

  it('maps the accent onto the blue palette', () => {
    const variables = buildThemeVariables(getAppTheme('dracula'), getAccent('violet'));
    expect(variables['--c-blue-400']).toBe(channels(TAILWIND_PALETTE.violet[400]));
    expect(variables['--c-violet-400']).toBe(channels(TAILWIND_PALETTE.violet[400]));
  });

  it('mirrors accent and chromatic palettes for light themes, not the neutral scale', () => {
    const theme = getAppTheme('wayterm-light');
    const accent = getAccent('violet');
    const variables = buildThemeVariables(theme, accent);
    expect(variables['--c-amber-300']).toBe(channels(TAILWIND_PALETTE.amber[700]));
    expect(variables['--c-red-950']).toBe(channels(TAILWIND_PALETTE.red[50]));
    expect(variables['--c-emerald-400']).toBe(channels(TAILWIND_PALETTE.emerald[600]));
    expect(variables['--c-blue-600']).toBe(channels(accent.scale[600]));
    expect(variables['--c-blue-300']).toBe(channels(accent.scale[700]));
    expect(variables['--c-zinc-950']).toBe(channels(theme.neutral[950]));
    expect(variables['--c-zinc-950']).toBe('255 255 255');
  });
});

describe('lookups', () => {
  it('fall back to the defaults for unknown ids', () => {
    expect(getAppTheme('nope').id).toBe(DEFAULT_APP_THEME_ID);
    expect(getAccent('nope').id).toBe(DEFAULT_ACCENT_ID);
  });

  it('resolve every listed id and label', () => {
    for (const theme of APP_THEMES) expect(getAppTheme(theme.id)).toBe(theme);
    for (const accent of ACCENTS) expect(getAccent(accent.id)).toBe(accent);
    expect(ACCENTS.map((accent) => accent.label)).toEqual([
      'Blau',
      'Cyan',
      'Smaragd',
      'Violett',
      'Rosé',
      'Bernstein',
      'Orange',
    ]);
  });
});

describe('applyAppTheme', () => {
  it('writes variables, colour scheme and data attributes to the root element', () => {
    const properties = new Map<string, string>();
    const root = {
      style: {
        colorScheme: '',
        setProperty: (name: string, value: string) => {
          properties.set(name, value);
        },
      },
      dataset: {} as Record<string, string>,
    };

    applyAppTheme('solarized-light', 'cyan', root as unknown as HTMLElement);

    expect(Object.fromEntries(properties)).toEqual(
      buildThemeVariables(getAppTheme('solarized-light'), getAccent('cyan')),
    );
    expect(root.style.colorScheme).toBe('light');
    expect(root.dataset).toEqual({ theme: 'solarized-light', themeMode: 'light' });
  });
});
