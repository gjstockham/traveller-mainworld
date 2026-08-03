/**
 * The per-tile generation loop: all of the output-affecting arithmetic in one
 * place, inside the whitelisted zone.
 *
 * Inputs and outputs are plain numbers and typed arrays rather than the
 * `PhysicalWorldSpec` object from the ruleset layer. That is deliberate: the
 * kernel may not import from outside itself, and keeping the boundary at
 * primitive values means the ruleset interpreter (Phase 1) can evolve freely
 * without ever touching hashed code.
 */
import { faceUvToDirection } from './cubesphere.js';
import { type FbmParams, fbm3, fbmNormalisation } from './fbm.js';

/** Phase 0 material classes. Airless rocky worlds only; water is Phase 2. */
export const Material = {
  Lowland: 0,
  Midland: 1,
  Highland: 2,
  Peak: 3,
  Water: 4,
} as const;

/** Everything the kernel needs to generate one tile. */
export interface TileGenInput {
  /** Cube face, 0-5. */
  readonly face: number;
  /** Tile extent in face UV space. */
  readonly u0: number;
  readonly v0: number;
  readonly size: number;
  /** Grid resolution; the vertex grid is `(n+1)²`. */
  readonly n: number;
  /** World seed, as two 32-bit lanes. */
  readonly seedHi: number;
  readonly seedLo: number;
  /** Packed tile key, mixed into the RNG stream. */
  readonly tileId: number;
  /** Terrain field parameters. */
  readonly fbm: FbmParams;
  /** Peak-to-trough terrain relief, in metres. */
  readonly amplitudeM: number;
}

/** Buffers the generator writes into. Caller-owned so they can be pooled and transferred. */
export interface TileGenOutput {
  /** `(n+1)²` elevations in metres relative to the datum. */
  readonly elevation: Float64Array;
  /** `(n+1)²` flags; always 0 in Phase 0 (airless worlds). */
  readonly waterMask: Uint8Array;
  /** `(n+1)²` {@link Material} values. */
  readonly materials: Uint8Array;
  /** `3(n+1)²` interleaved unit direction vectors, for the renderer. */
  readonly directions: Float64Array;
}

/** Allocate a matching output set for grid resolution `n`. */
export function allocateTileOutput(n: number): TileGenOutput {
  const count = (n + 1) * (n + 1);
  return {
    elevation: new Float64Array(count),
    waterMask: new Uint8Array(count),
    materials: new Uint8Array(count),
    directions: new Float64Array(count * 3),
  };
}

/**
 * Layer identifier for the base terrain stream. Crater bands and later
 * subsystems take their own IDs, so adding one never perturbs the others.
 */
export const LAYER_TERRAIN = 0;

/**
 * Generate one tile.
 *
 * Every value written is a pure function of 3D position on the sphere and the
 * world seed (PRD §8.1 bucket (a)) — nothing depends on which other tiles have
 * been generated, or in what order. That is what lets tiles stream in on
 * demand across a worker pool and still compose into one coherent world.
 */
export function generateTile(input: TileGenInput, out: TileGenOutput): void {
  const { face, u0, v0, size, n, fbm, amplitudeM } = input;
  const count = (n + 1) * (n + 1);

  if (out.elevation.length < count || out.materials.length < count) {
    throw new RangeError(`output buffers hold too few elements for n=${n}`);
  }

  // The terrain field is seeded from the world seed alone, NOT the tile ID:
  // it must be one continuous field sampled by every tile, not a per-tile
  // field that would discontinue at every boundary. Tile-local streams (crater
  // placement and the like) will key on tileId; this one must not.
  const terrainSeed = (input.seedLo ^ Math.imul(input.seedHi, 0x9e3779b1)) | 0;

  // Normalise so amplitudeM means peak-to-trough relief regardless of octave
  // count, rather than drifting as octaves are added with depth.
  const norm = fbmNormalisation(fbm);
  const scale = norm === 0 ? 0 : amplitudeM / norm;

  let k = 0;
  for (let j = 0; j <= n; j++) {
    const v = v0 + (j / n) * size;
    for (let i = 0; i <= n; i++) {
      const u = u0 + (i / n) * size;
      const d = faceUvToDirection(face, u, v);

      out.directions[k * 3] = d.x;
      out.directions[k * 3 + 1] = d.y;
      out.directions[k * 3 + 2] = d.z;

      const h = fbm3(d.x, d.y, d.z, terrainSeed, fbm) * scale;
      out.elevation[k] = h;

      // Water pass. Trivially empty for airless worlds, but kept in the loop
      // so Phase 2 does not change the shape of the hot path — and so Spike B
      // measures the loop that will actually ship.
      out.waterMask[k] = 0;

      out.materials[k] = classify(h, amplitudeM);
      k++;
    }
  }
}

/**
 * Elevation-band material classification.
 *
 * Bands are fractions of the tile's relief rather than absolute metres, so the
 * classification means the same thing on a Size-1 rockball and a Size-A world.
 * Phase 4 replaces this with the climate-field classifier.
 */
function classify(elevationM: number, amplitudeM: number): number {
  if (amplitudeM <= 0) {
    return Material.Lowland;
  }
  const t = elevationM / amplitudeM;
  if (t < -0.15) {
    return Material.Lowland;
  }
  if (t < 0.1) {
    return Material.Midland;
  }
  if (t < 0.3) {
    return Material.Highland;
  }
  return Material.Peak;
}
