import { defineConfig, devices } from '@playwright/test';

/**
 * Spike C smoke tests, and the harness WP4's cross-browser determinism matrix
 * will extend.
 *
 * Headless Chromium has no GPU, so WebGL falls back to SwiftShader — fine for
 * "does it run", useless for "is it fast". Frame-rate figures come from the
 * diagnostics overlay on real hardware (Spike B), never from here.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // Tile generation is CPU-heavy and each test spawns a worker pool; running
  // specs in parallel just makes them contend.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            // Force a software GL implementation; the default headless shell
            // has no GL at all and would fail WebGL context creation.
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'pnpm preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
