/**
 * The per-tile generation loop: all of the output-affecting arithmetic in one
 * place, inside the whitelisted zone.
 *
 * Inputs and outputs are plain numbers and typed arrays rather than the
 * `PhysicalWorldSpec` object from the ruleset layer. That is deliberate: the
 * kernel may not import from outside itself, and keeping the boundary at
 * primitive values means the ruleset interpreter can evolve freely without ever
 * touching hashed code — which is exactly what let WP9 add crater parameters to
 * the spec without moving a single hash.
 *
 * ## Three passes, and why they are three
 *
 * 1. Directions and the base fBm field, over the **apron** grid, tracking the
 *    tile's 3D bounding box.
 * 2. Crater relief, over the same grid, out of a lattice cache built from that
 *    bounding box.
 * 3. The interior copy: elevation, water mask and material classification.
 *
 * Pass 1 has to finish before the crater lattice can be built, because the
 * cache is sized from the box. Pass 2 recomputes each direction rather than
 * storing 3·(n+3)² doubles from pass 1 — `faceUvToDirection` is two tangent
 * warps and a square root, which is a rounding error next to the crater work it
 * feeds.
 */
import { faceUvToDirection } from './cubesphere.js';
import {
  type BasinField,
  CraterCandidates,
  CraterCells,
  LAYER_CRATER_BANDS,
  bandsForDepth,
  buildBasins,
  collectBasins,
  collectFromLattice,
  compositeCraters,
  craterLayerSeed,
  craterParams,
} from './craters.js';
import { type FbmParams, fbm3, fbmNormalisation } from './fbm.js';
import { MAX_DEPTH } from './tileid.js';

/** Phase 0 material classes. Airless rocky worlds only; water is Phase 2. */
export const Material = {
  Lowland: 0,
  Midland: 1,
  Highland: 2,
  Peak: 3,
  Water: 4,
} as const;

/**
 * Rings of elevation generated beyond the tile on every side.
 *
 * One ring, giving an `(n+3)²` grid (plan §7). WP12 derives smooth per-vertex
 * normals from the elevation grid, and a normal at a tile's edge vertex needs
 * the elevation *outside* the tile — without it every tile boundary gets a
 * normal discontinuity, which reads as a wireframe grid drawn over the whole
 * planet. It costs about 6% more samples at 65² and removes an entire artefact
 * class.
 *
 * It is generated here rather than bolted on in WP12 because it is a change to
 * the shape of this loop, not an addition to it.
 *
 * **Across a cube-face boundary the ring is an extrapolation**, not the
 * neighbouring face's surface: `u` steps outside `[0, 1]`, which the tangent
 * warp continues smoothly but which is not where the adjacent face's
 * parameterisation puts that point. Within a face the ring is exact — it is the
 * neighbour's own interior elevation, bit-for-bit, which `craters.test.ts`
 * asserts. Twelve cube edges are affected, the same twelve the skirts already
 * name as a known limitation.
 */
export const APRON_RING = 1;

/** Row stride of the apron grid for resolution `n`. */
export function apronStride(n: number): number {
  return n + 1 + 2 * APRON_RING;
}

/** Apron-grid index of grid vertex `(i, j)`, where `i` and `j` may be `−1` or `n+1`. */
export function apronIndex(n: number, i: number, j: number): number {
  return (j + APRON_RING) * apronStride(n) + (i + APRON_RING);
}

/**
 * Everything the kernel needed before Phase 1's crater fields.
 *
 * Named separately because it is exactly what the **archived** WASM twin
 * implements: `crates/kernel-wasm` is not maintained against the crater pass, so
 * its binding takes this narrower shape rather than a {@link TileGenInput} it
 * would silently ignore half of.
 */
export interface BaseTileGenInput {
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

/**
 * The world, with no tile in it — everything {@link sampleElevation} needs.
 *
 * Separate from the geometry fields because the export path has no tile: it has
 * a direction and a detail depth. Sharing the type with {@link TileGenInput}
 * rather than restating it is what stops the two paths being handed subtly
 * different worlds.
 */
export interface PointSampleInput {
  /** World seed, as two 32-bit lanes. */
  readonly seedHi: number;
  readonly seedLo: number;
  /** Terrain field parameters. */
  readonly fbm: FbmParams;
  /** Peak-to-trough terrain relief, in metres. */
  readonly amplitudeM: number;
  /** Planetary radius in kilometres. Sets the scale of every crater. */
  readonly radiusKm: number;
  /** `PhysicalWorldSpec.craters.densityScale`. */
  readonly craterDensityScale: number;
  /** `PhysicalWorldSpec.craters.transitionDiameterKm`. */
  readonly craterTransitionDiameterKm: number;
  /** `PhysicalWorldSpec.craters.regolithMaturity`. */
  readonly regolithMaturity: number;
}

/** Everything the kernel needs to generate one tile. */
export interface TileGenInput extends BaseTileGenInput, PointSampleInput {}

/** Buffers the generator writes into. Caller-owned so they can be pooled and transferred. */
export interface TileGenOutput {
  /** `(n+1)²` elevations in metres relative to the datum. */
  readonly elevation: Float64Array;
  /** `(n+1)²` flags; always 0 in Phase 1 (airless worlds). */
  readonly waterMask: Uint8Array;
  /** `(n+1)²` {@link Material} values. */
  readonly materials: Uint8Array;
  /** `3(n+1)²` interleaved unit direction vectors, for the renderer. */
  readonly directions: Float64Array;
  /**
   * `(n+3)²` elevations covering the tile plus one ring on every side.
   *
   * The interior is {@link TileGenOutput.elevation} element for element; the
   * ring is what WP12 needs for seamless normals. See {@link APRON_RING}.
   *
   * **Not hashed.** It carries no information the interior does not — the same
   * field at neighbouring positions — so hashing it would double the fixture
   * cost to discriminate nothing. What is asserted instead is the relationship:
   * that the interior matches, and that a ring value equals the neighbouring
   * tile's own interior value exactly.
   *
   * The archived WASM twin does not write this buffer.
   */
  readonly apronElevation: Float64Array;
}

/** Allocate a matching output set for grid resolution `n`. */
export function allocateTileOutput(n: number): TileGenOutput {
  const count = (n + 1) * (n + 1);
  const apron = apronStride(n) * apronStride(n);
  return {
    elevation: new Float64Array(count),
    waterMask: new Uint8Array(count),
    materials: new Uint8Array(count),
    directions: new Float64Array(count * 3),
    apronElevation: new Float64Array(apron),
  };
}

/**
 * Layer identifier for the base terrain stream. Crater bands and later
 * subsystems take their own IDs, so adding one never perturbs the others.
 */
export const LAYER_TERRAIN = 0;

/**
 * Per-worker scratch for the crater pass.
 *
 * Module-level because a worker generates one tile at a time and the
 * alternative is allocating a megabyte of lattice cache per tile. The
 * consequence is that {@link generateTile} is **not reentrant** — it must not be
 * called from inside itself, which nothing does and nothing should.
 *
 * It cannot reach a hash: both are rebuilt from the tile's own inputs on every
 * call, and `craters.test.ts` asserts that generating tile A, then B, then A
 * again reproduces A exactly.
 */
const CELLS = new CraterCells();
const CANDIDATES = new CraterCandidates();

/**
 * Quadtree depth from a tile's extent.
 *
 * Derived rather than passed, so the band gate cannot disagree with the bounds
 * it is gating. `tileBounds` produces `size = 2⁻ᵈᵉᵖᵗʰ` exactly — every bound is
 * a dyadic rational — so the doubling below lands on exactly 1.
 */
function depthForSize(size: number): number {
  let depth = 0;
  let s = size;
  while (s < 1 && depth < MAX_DEPTH) {
    s = s * 2;
    depth++;
  }
  return depth;
}

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
  const stride = apronStride(n);
  const apronCount = stride * stride;

  if (out.elevation.length < count || out.materials.length < count) {
    throw new RangeError(`output buffers hold too few elements for n=${n}`);
  }
  if (out.apronElevation.length < apronCount) {
    throw new RangeError(`apron buffer holds too few elements for n=${n}`);
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

  const depth = depthForSize(size);
  const bandCount = bandsForDepth(depth);
  const craters = craterParams(
    input.radiusKm,
    input.craterDensityScale,
    input.craterTransitionDiameterKm,
    input.regolithMaturity,
  );
  // The bucket-(b) global pass. Rebuilt per tile rather than cached per world:
  // it is a few hundred integer hashes, and a cache here would be a second
  // place for the tile path and the export path to disagree.
  const basins: BasinField = buildBasins(input.seedHi, input.seedLo, craters.densityScale);
  const bandSeed = craterLayerSeed(input.seedHi, input.seedLo, LAYER_CRATER_BANDS);

  const lo = -APRON_RING;
  const hi = n + APRON_RING;

  // --- pass 1: directions, base terrain, bounding box ---
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let j = lo; j <= hi; j++) {
    const v = v0 + (j / n) * size;
    for (let i = lo; i <= hi; i++) {
      const u = u0 + (i / n) * size;
      const d = faceUvToDirection(face, u, v);

      if (d.x < minX) minX = d.x;
      if (d.y < minY) minY = d.y;
      if (d.z < minZ) minZ = d.z;
      if (d.x > maxX) maxX = d.x;
      if (d.y > maxY) maxY = d.y;
      if (d.z > maxZ) maxZ = d.z;

      out.apronElevation[apronIndex(n, i, j)] = fbm3(d.x, d.y, d.z, terrainSeed, fbm) * scale;

      if (i >= 0 && i <= n && j >= 0 && j <= n) {
        const g = j * (n + 1) + i;
        out.directions[g * 3] = d.x;
        out.directions[g * 3 + 1] = d.y;
        out.directions[g * 3 + 2] = d.z;
      }
    }
  }

  // --- pass 2: crater relief ---
  CELLS.build(bandCount, minX, minY, minZ, maxX, maxY, maxZ, craters.densityScale, bandSeed);

  for (let j = lo; j <= hi; j++) {
    const v = v0 + (j / n) * size;
    for (let i = lo; i <= hi; i++) {
      const u = u0 + (i / n) * size;
      const d = faceUvToDirection(face, u, v);

      CANDIDATES.reset();
      collectBasins(CANDIDATES, d.x, d.y, d.z, basins);
      CELLS.collect(CANDIDATES, d.x, d.y, d.z);

      const k = apronIndex(n, i, j);
      // Read back through the buffer rather than keeping a local: the point
      // path sums a base that has been through a Float64 store, and these two
      // have to agree to the bit.
      out.apronElevation[k] = out.apronElevation[k]! + compositeCraters(CANDIDATES, craters);
    }
  }

  // --- pass 3: the interior, and the classifications derived from it ---
  let g = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const h = out.apronElevation[apronIndex(n, i, j)]!;
      out.elevation[g] = h;

      // Water pass. Trivially empty for airless worlds, but kept in the loop
      // so Phase 2 does not change the shape of the hot path — and so Spike B
      // measures the loop that will actually ship.
      out.waterMask[g] = 0;

      out.materials[g] = classify(h, amplitudeM);
      g++;
    }
  }
}

/**
 * Elevation at one position on the sphere, in metres — the point-sample path.
 *
 * This is what WP13's exporter draws from: a projection gives it a direction, it
 * gives back the number {@link generateTile} would have written at that vertex.
 * The equality is bit-exact and asserted over the whole fixture tile set, which
 * is what makes "the exported map matches the 3D view" (PRD §9.4) a property
 * rather than a resemblance.
 *
 * `depth` selects the crater bands, through the same {@link bandsForDepth} the
 * tile path uses. A gate that differed by one band between the two would be that
 * failure exactly.
 *
 * Callers sampling more than a handful of points should hoist `basins` and
 * `scratch` — the basin field is a per-world constant and rebuilding it per
 * sample would dominate.
 */
export function sampleElevation(
  x: number,
  y: number,
  z: number,
  depth: number,
  input: PointSampleInput,
  basins: BasinField,
  scratch: CraterCandidates,
): number {
  const terrainSeed = (input.seedLo ^ Math.imul(input.seedHi, 0x9e3779b1)) | 0;
  const norm = fbmNormalisation(input.fbm);
  const scale = norm === 0 ? 0 : input.amplitudeM / norm;
  const base = fbm3(x, y, z, terrainSeed, input.fbm) * scale;

  const craters = craterParams(
    input.radiusKm,
    input.craterDensityScale,
    input.craterTransitionDiameterKm,
    input.regolithMaturity,
  );
  const bandSeed = craterLayerSeed(input.seedHi, input.seedLo, LAYER_CRATER_BANDS);

  scratch.reset();
  collectBasins(scratch, x, y, z, basins);
  collectFromLattice(scratch, x, y, z, bandsForDepth(depth), craters.densityScale, bandSeed);
  return base + compositeCraters(scratch, craters);
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
