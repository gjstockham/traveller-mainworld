/**
 * `TileGenerator` implemented over the WASM kernel twin.
 *
 * Same interface as `TsTileGenerator`, so the viewer, the benchmarks and the
 * golden battery can swap one for the other without knowing which they have.
 * That seam is what makes the WP6 kernel decision revisable rather than a
 * rewrite.
 */
import { assertClean } from '../digest/bytes.js';
import type { World } from '../spec.js';
import { allocateTileOutput, type TileGenOutput } from '../kernel/tilegen.js';
import type { TileData, TileGenerator } from '../tile/generator.js';

import type { WasmKernel } from './kernel.js';

export class WasmTileGenerator implements TileGenerator {
  readonly kind = 'wasm' as const;

  constructor(
    readonly genVersion: string,
    private readonly kernel: WasmKernel,
  ) {}

  generate(tileId: number, world: World, n: number, out?: TileGenOutput): TileData {
    if (n < 1 || (n & (n - 1)) !== 0) {
      throw new RangeError(`grid resolution ${n} must be a power of two`);
    }

    // Addressing goes through the WASM side too, not the TypeScript one. Using
    // the TS `tileBounds` here would be more convenient and would quietly
    // exclude `tileid.rs` from the parity comparison — the bounds are inputs to
    // every vertex position, so a disagreement there is exactly the kind of bug
    // building the kernel twice is supposed to surface.
    const bounds = this.kernel.tileBounds(tileId);
    const buffers = out ?? allocateTileOutput(n);

    this.kernel.generateTile(
      {
        face: this.kernel.tileFace(tileId),
        u0: bounds.u0,
        v0: bounds.v0,
        size: bounds.size,
        n,
        seedHi: world.seedHi,
        seedLo: world.seedLo,
        tileId,
        fbm: world.spec.fbm,
        amplitudeM: world.spec.terrainAmplitudeM,
      },
      buffers,
    );

    assertClean(buffers.elevation, `tile ${tileId} elevation (wasm)`);

    return { ...buffers, tileId, genVersion: this.genVersion, n };
  }
}
