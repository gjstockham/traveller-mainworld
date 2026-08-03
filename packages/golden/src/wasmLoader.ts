/**
 * Node-side loading of the compiled WASM kernel.
 *
 * Kept in `golden` rather than in `core` on purpose: `core` must stay free of
 * `node:fs` so it can be bundled for the browser without a shim, and reading
 * bytes off a disk is not part of a determinism kernel's job. The browser
 * verification page (WP4) will `fetch` the same bytes and call
 * `instantiateWasmKernel` directly.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type WasmKernel, instantiateWasmKernel } from '@traveller-mainworld/core';

/** Where `scripts/build-wasm.mjs` stages the artefact. Gitignored. */
export const WASM_ARTEFACT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../crates/kernel-wasm/pkg/kernel_wasm.wasm',
);

/** What to tell someone who does not have the artefact yet. */
export const WASM_BUILD_HINT =
  `No WASM kernel at ${WASM_ARTEFACT_PATH}.\n` +
  'Build it with:  pnpm wasm:build\n' +
  'That needs Rust and the wasm32-unknown-unknown target:\n' +
  '  rustup target add wasm32-unknown-unknown';

/** True if the artefact has been built. */
export function wasmArtefactExists(): boolean {
  try {
    readFileSync(WASM_ARTEFACT_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load and instantiate the WASM kernel.
 *
 * Throws with the build command if the artefact is missing. Callers that want
 * to degrade gracefully should ask {@link wasmArtefactExists} first — and should
 * say loudly that they are skipping, because a parity check that quietly does
 * nothing is worse than no parity check at all.
 */
export async function loadWasmKernel(): Promise<WasmKernel> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(WASM_ARTEFACT_PATH);
  } catch {
    throw new Error(WASM_BUILD_HINT);
  }
  return instantiateWasmKernel(bytes);
}
