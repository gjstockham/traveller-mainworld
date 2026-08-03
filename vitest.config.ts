import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Node is the reference platform for determinism; browser runs come from
    // the Playwright matrix in WP4 rather than from this config.
    environment: 'node',
  },
});
