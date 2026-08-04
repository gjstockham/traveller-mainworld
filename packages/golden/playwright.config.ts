import { defineConfig } from '@playwright/test';

/**
 * The cross-browser half of Spike A's question: does the pure-TypeScript kernel
 * produce bit-identical Float64 output on every engine?
 *
 * Separate from the viewer's Playwright config on purpose. That one is a
 * rendering smoke test where a failure means the skeleton broke; this one is a
 * determinism check where a failure is a *finding* — it answers Spike A in the
 * negative and triggers the WASM kernel on correctness grounds (spike plan
 * §A.3). They share no timeouts, no server and no reasons to be flaky together.
 *
 * All three engines on all three CI OSes; the OS half of the matrix comes from
 * the workflow, not from here.
 */
// Bare engines, not `devices[…]` descriptors. A descriptor overrides the user
// agent — "Desktop Chrome" reports Windows from a Linux runner — and the user
// agent is the evidence each cell exists to produce. Nothing a descriptor
// otherwise sets (viewport, scale factor, touch) can reach arithmetic.
//
// Playwright's WebKit is not Safari either; real Safari, iOS and Android are
// hand-checked against the same page, per docs/evidence/wp4-manual-checks.md.
const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;

export default defineConfig({
  testDir: './e2e',
  // Explicit, and shared by both projects: the workflow uploads this one
  // directory from every cell, and the evidence blocks are what ADR-0001 cites.
  outputDir: './test-results',
  // The battery is ~15 s on Node, and measured 8–21 s across the three engines
  // on a developer machine. The timeout is nowhere near that because a shared
  // CI runner is not a developer machine, and because the cost of an overlong
  // timeout is a slow failure while the cost of a short one is a green matrix
  // turning red for reasons that have nothing to do with float determinism.
  timeout: 900_000,
  expect: { timeout: 600_000 },
  // One CPU-bound worker per cell would contend with itself for nothing.
  workers: 1,
  fullyParallel: false,
  // A hash mismatch is a finding, not a flake: never retry it away.
  retries: 0,
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
  },
  projects: [
    ...BROWSERS.map((browserName) => ({ name: browserName, use: { browserName } })),
    {
      // WP7 §7.3: the same page under two further bundler configurations, held
      // to the same committed manifests. Its own project and its own directory
      // so `--project=chromium` stays exactly nine engine cells and this stays
      // one bundler cell — a bundler is not an engine, and running it three
      // times would say nothing three times.
      name: 'invariance',
      testDir: './e2e-invariance',
      use: { browserName: 'chromium' as const },
    },
  ],
  webServer: {
    // Builds the page first, under every profile: the matrix must run the same
    // static artefact the manual spot-checks are served, not a dev-server
    // transform of it.
    command: 'pnpm build:web && pnpm preview:web',
    url: 'http://127.0.0.1:4174/verify.html',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
