import { resolve } from 'node:path';

import { defineConfig } from 'vite';

import { BUILD_PROFILES } from './build-profiles.mjs';

/**
 * Builds `verify.html` into a self-contained static page.
 *
 * The page bundles the battery from this package's own `src/`, and `core` from
 * its build output — the same code the Node runner executes, put through a
 * different toolchain, which is itself something the matrix is checking.
 * Bundling it at all only works because the package's `.` entry is
 * platform-neutral by design: the one Node-dependent module lives behind the
 * `./node` subpath, and `scripts/check-browser-battery.mjs` fails the lint if
 * anything on this page's import graph reaches it.
 *
 * `base: './'` so the output can be served from any subdirectory — a scratch
 * static host, a phone on the LAN, or a USB stick handed to whoever owns the
 * only Safari in the building.
 *
 * The matrix drives this build rather than a dev server, so every browser cell
 * is also evidence that esbuild's transforms leave the arithmetic alone. WP7
 * makes that a check rather than a side effect: `GOLDEN_BUILD_PROFILE` selects
 * one of the configurations in `build-profiles.mjs`, `build-web.mjs` builds all
 * of them into one servable tree, and `e2e-invariance/` asserts they agree.
 */
const profileName = process.env['GOLDEN_BUILD_PROFILE'] ?? 'matrix';
const profile = BUILD_PROFILES[profileName];
if (profile === undefined) {
  throw new Error(
    `unknown GOLDEN_BUILD_PROFILE '${profileName}'; known: ${Object.keys(BUILD_PROFILES).join(', ')}`,
  );
}

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  publicDir: false,
  build: {
    outDir: profile.outDir,
    // Only ever empties its own directory, so the nested profiles survive —
    // provided `matrix` is built first, which `build-web.mjs` guarantees.
    emptyOutDir: true,
    ...(profile.target === undefined ? {} : { target: profile.target }),
    ...(profile.minify === undefined ? {} : { minify: profile.minify }),
    rollupOptions: {
      input: resolve(import.meta.dirname, 'verify.html'),
    },
  },
});
