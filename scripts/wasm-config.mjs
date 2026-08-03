/**
 * Build configuration shared by `build-wasm.mjs` and `check-wasm-flags.mjs`.
 *
 * Separate module rather than an export from the build script, so the checker
 * can read the settings without running a build.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The only WASM target this crate is built for. */
export const WASM_TARGET = 'wasm32-unknown-unknown';

/**
 * `-C target-feature` for the kernel build.
 *
 * `-relaxed-simd` is the load-bearing entry: relaxed-SIMD is nondeterministic
 * by specification, so it must never be enabled. It is off by default, and
 * naming it here means turning it on requires flipping a sign in a file that
 * `check-wasm-flags.mjs` reads — a reviewable edit rather than a silent
 * toolchain default change.
 */
export const TARGET_FEATURES = '-relaxed-simd';

/** Where the built artefact is staged. Gitignored: a committed binary is an unreviewable hash. */
export const WASM_ARTEFACT = join(ROOT, 'crates/kernel-wasm/pkg/kernel_wasm.wasm');

/** What to tell someone whose artefact is missing. */
export const BUILD_HINT =
  'Build it with: pnpm wasm:build  (needs Rust and the wasm32-unknown-unknown target)';
