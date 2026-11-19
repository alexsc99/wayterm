import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so tests do not load the Electron/renderer plugins.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
