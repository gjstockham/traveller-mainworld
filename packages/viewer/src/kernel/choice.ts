/**
 * Which generation kernel the viewer runs.
 *
 * This module is the single place the WP6 decision is written down in code.
 * ADR-0001 (`docs/adr/ADR-0001-generation-kernel.md`) selected the pure
 * TypeScript kernel — provisionally, on the evidence recorded there. Everything
 * downstream, the tile worker included, talks to the `TileGenerator` interface
 * and never names an implementation.
 *
 * **To act on the ADR's revisit trigger:** build the twin (`pnpm wasm:build`),
 * instantiate it, and call `createTileGenerator(v, 'wasm', { wasm })`. Nothing
 * in `workers/` changes — `test/tileJob.test.ts` proves that by running the
 * real twin through the same job path and comparing the renderer-ready buffers
 * byte for byte.
 */
import {
  type TileGenerator,
  TsTileGenerator,
  type WasmKernel,
  WasmTileGenerator,
} from '@traveller-mainworld/core';

/**
 * Derived from the interface rather than declared afresh, so a third kernel
 * cannot be added to `TileGenerator['kind']` without the switch below failing
 * to compile.
 */
export type KernelChoice = TileGenerator['kind'];

/** The kernel ADR-0001 selected. */
export const SELECTED_KERNEL: KernelChoice = 'typescript';

export interface KernelSources {
  /**
   * An instantiated WASM twin. Required only for `'wasm'`. The viewer does not
   * load one today: ADR-0001 chose TypeScript and archived the crate, so there
   * is no `.wasm` in the viewer's bundle to fetch.
   */
  readonly wasm?: WasmKernel;
}

/**
 * Build the tile generator for a given choice.
 *
 * @param choice Defaults to {@link SELECTED_KERNEL}. Passed explicitly by the
 *               tests that check the seam actually swaps.
 */
export function createTileGenerator(
  genVersion: string,
  choice: KernelChoice = SELECTED_KERNEL,
  sources: KernelSources = {},
): TileGenerator {
  switch (choice) {
    case 'typescript':
      return new TsTileGenerator(genVersion);
    case 'wasm': {
      const { wasm } = sources;
      if (wasm === undefined) {
        throw new Error(
          "kernel choice 'wasm' needs an instantiated WasmKernel, and none was supplied. " +
            'crates/kernel-wasm is archived under ADR-0001: build it with `pnpm wasm:build`, ' +
            'instantiate it with instantiateWasmKernel(), and pass it as sources.wasm.',
        );
      }
      return new WasmTileGenerator(genVersion, wasm);
    }
  }
}
