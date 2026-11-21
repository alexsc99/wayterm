const THEMED_PALETTES = ['zinc', 'blue', 'amber', 'red', 'emerald', 'purple', 'sky', 'lime', 'violet'];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// The --c-<palette>-<shade> variables hold RGB channels and are written at runtime by
// applyAppTheme() (src/utils/appThemes.ts); <alpha-value> keeps opacity modifiers working.
const themedColors = Object.fromEntries(
  THEMED_PALETTES.map((palette) => [
    palette,
    Object.fromEntries(
      SHADES.map((shade) => [shade, `rgb(var(--c-${palette}-${shade}) / <alpha-value>)`]),
    ),
  ]),
);

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: themedColors,
    },
  },
  plugins: [],
}
