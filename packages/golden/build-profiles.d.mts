/**
 * Types for `build-profiles.mjs`, so the Vite config and the guard script both
 * see the same shape. Hand-written for the same reason as
 * `scripts/check-browser-battery.d.mts`: the module is plain ESM because `pnpm
 * lint` runs before anything is built.
 */
export interface BuildProfile {
  /** Output directory, relative to `packages/golden`. */
  readonly outDir: string;
  /** Explicit build target, or `undefined` to take Vite's default. */
  readonly target: string | undefined;
  /** Explicit minifier setting, or `undefined` to take Vite's default. */
  readonly minify: false | undefined;
  /** Where the built page is served from, relative to the preview root. */
  readonly url: string;
}

export declare const BUILD_PROFILES: Record<string, BuildProfile>;
export declare const BUILD_ORDER: string[];
export declare const INVARIANCE_PROFILES: string[];
export declare const VIEWER_BUILD_CONTRACT: {
  readonly packageDir: string;
  readonly buildScript: string;
  readonly forbiddenFiles: readonly string[];
};
