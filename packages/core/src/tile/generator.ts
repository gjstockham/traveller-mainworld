/**
 * The `TileGenerator` seam.
 *
 * The Phase 0 kernel decision (TS vs Rust→WASM) is still open — it is settled
 * in WP6 on the evidence of the cross-platform hash matrix and the Spike B
 * benchmarks. Everything downstream talks to this interface so that the choice
 * stays revisable, and so that the two kernels can be run side by side and
 * compared during WP3.
 */
import { assertClean } from '../digest/bytes.js';
import type { World } from '../spec.js';
import { type TileGenOutput, allocateTileOutput, generateTile } from '../kernel/tilegen.js';
import { tileBounds, tileFace } from '../kernel/tileid.js';

export { Material, allocateTileOutput } from '../kernel/tilegen.js';
export type { TileGenOutput } from '../kernel/tilegen.js';

/** A generated tile, immutable and keyed by `(tileId, genVersion)`. */
export interface TileData extends TileGenOutput {
  readonly tileId: number;
  /** Generator version that produced it; part of the cache identity. */
  readonly genVersion: string;
  /** Grid resolution; buffers hold `(n+1)²` elements. */
  readonly n: number;
}

export interface TileGenerator {
  /** Semver, embedded in share URLs, exports and golden hashes (PRD R14). */
  readonly genVersion: string;
  /** Which implementation this is — for benchmark and parity reporting. */
  readonly kind: 'typescript' | 'wasm';

  /**
   * Generate one tile.
   *
   * @param out Optional caller-owned buffers to fill, so a worker can reuse a
   *            pool instead of allocating per tile. Must match `n`.
   */
  generate(tileId: number, world: World, n: number, out?: TileGenOutput): TileData;
}

/** Pure-TypeScript tile generator. */
export class TsTileGenerator implements TileGenerator {
  readonly kind = 'typescript' as const;

  constructor(readonly genVersion: string) {}

  generate(tileId: number, world: World, n: number, out?: TileGenOutput): TileData {
    if (n < 1 || (n & (n - 1)) !== 0) {
      // Power-of-two grids keep every vertex coordinate dyadic, which is what
      // makes neighbouring tiles agree exactly on shared edges.
      throw new RangeError(`grid resolution ${n} must be a power of two`);
    }

    const bounds = tileBounds(tileId);
    const buffers = out ?? allocateTileOutput(n);

    generateTile(
      {
        face: tileFace(tileId),
        u0: bounds.u0,
        v0: bounds.v0,
        size: bounds.size,
        n,
        seedHi: world.seedHi,
        seedLo: world.seedLo,
        tileId,
        fbm: world.spec.fbm,
        amplitudeM: world.spec.terrainAmplitudeM,
        radiusKm: world.spec.radiusKm,
        craterDensityScale: world.spec.craters.densityScale,
        craterTransitionDiameterKm: world.spec.craters.transitionDiameterKm,
        regolithMaturity: world.spec.craters.regolithMaturity,
      },
      buffers,
    );

    // Cheap relative to generation, and the only thing standing between a NaN
    // and an unreproducible golden hash — NaN bit patterns are not portable.
    //
    // The apron is checked too even though it is not hashed: it feeds WP12's
    // normals, and a NaN there would propagate into geometry rather than into a
    // manifest, which is the harder of the two to trace back.
    assertClean(buffers.elevation, `tile ${tileId} elevation`);
    assertClean(buffers.apronElevation, `tile ${tileId} apron`);

    return { ...buffers, tileId, genVersion: this.genVersion, n };
  }
}
