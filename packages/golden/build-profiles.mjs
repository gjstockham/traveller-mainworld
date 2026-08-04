/**
 * The bundler configurations the verification page is built under (WP7, §7.3).
 *
 * PRD R11 says generation is deterministic. Nothing in that promise mentions a
 * bundler, and that is the gap: a minifier is free to rewrite expressions, and
 * an optimiser that re-associates `a + b + c` or contracts a multiply and an add
 * changes float results without changing what the source says. The
 * implementation plan lists it as a risk (§9) and asks for a **build-invariance
 * cell** (§7.3) that turns it from an assumption into a test.
 *
 * So the same page is built three ways and every build must produce the same
 * hashes as the committed manifests:
 *
 * - `matrix` — what the nine browser cells drive. `target: es2022` so nothing is
 *   downlevelled into arithmetic the source did not write, minified, because
 *   that is what ships.
 * - `unminified` — the control. Identical but for `minify: false`. Without it,
 *   the minified build agreeing with a Node run says only that *some* pipeline
 *   agrees; with it, the minifier is isolated as the variable.
 * - `viewer-profile` — Vite's defaults, with no `target` or `minify` override,
 *   because that is exactly what `packages/viewer` builds under. The viewer is
 *   the thing that ships generated output to a screen, and its bundle is
 *   configured differently from this package's. `scripts/check-build-invariance.mjs`
 *   fails the lint if the viewer's build stops being Vite defaults, so this
 *   profile cannot quietly stop mirroring it.
 *
 * Plain ESM rather than TypeScript because `scripts/check-build-invariance.mjs`
 * imports it too, and `pnpm lint` runs before anything is built.
 */

/**
 * Build profiles, keyed by name. `outDir` is relative to this package.
 *
 * The extra profiles nest inside `dist-web/` so one `vite preview` serves all
 * three, which is what lets a single cell compare them. `base: './'` in the
 * Vite config is what makes a nested copy work when served from a subdirectory.
 * Build order matters: `matrix` empties `dist-web/`, so it goes first.
 */
export const BUILD_PROFILES = {
  matrix: {
    outDir: 'dist-web',
    target: 'es2022',
    minify: undefined,
    url: '/verify.html',
  },
  unminified: {
    outDir: 'dist-web/unminified',
    target: 'es2022',
    minify: false,
    url: '/unminified/verify.html',
  },
  'viewer-profile': {
    outDir: 'dist-web/viewer-profile',
    target: undefined,
    minify: undefined,
    url: '/viewer-profile/verify.html',
  },
};

/** Profile names, in the order they must be built. */
export const BUILD_ORDER = ['matrix', 'unminified', 'viewer-profile'];

/** The profiles the build-invariance cell compares, beyond the one the matrix drives. */
export const INVARIANCE_PROFILES = ['unminified', 'viewer-profile'];

/**
 * What `packages/viewer` must look like for `viewer-profile` to mirror it.
 *
 * Checked by `scripts/check-build-invariance.mjs`. If the viewer acquires a
 * Vite config or a non-default build script, the profile above stops being a
 * mirror of it and this repository stops testing the bundle that actually
 * ships — the failure mode from WP6, where a check moved out of CI and took its
 * coverage with it silently.
 */
export const VIEWER_BUILD_CONTRACT = {
  packageDir: 'packages/viewer',
  buildScript: 'vite build',
  forbiddenFiles: [
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mjs',
    'vite.config.mts',
    'vite.config.cjs',
  ],
};
