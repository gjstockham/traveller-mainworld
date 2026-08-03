import { resolve } from 'node:path';

import { defineConfig } from 'vite';

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
 * The bundle is minified, and the matrix drives this build rather than a dev
 * server, so every browser cell is also evidence that esbuild's transforms
 * leave the arithmetic alone — a down payment on WP7's build-invariance cell.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'verify.html'),
    },
  },
});
