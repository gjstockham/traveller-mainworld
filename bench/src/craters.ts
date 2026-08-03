/**
 * Crater compositing — a **cost model**, not shipping code.
 *
 * The spike plan's representative workload (§B.1) is a Phase-1 tile: 129²
 * elevation grid, 10 fBm octaves, **two crater size-bands**, water mask,
 * material classification. Phase 0's kernel has no craters — they are Phase 1 —
 * so measuring only what exists today would understate the budget the Phase-1
 * tile has to fit inside, which is the budget R13 actually constrains.
 *
 * This module therefore does the work a crater pass does, at a realistic
 * density, using only kernel primitives. It deliberately lives in `bench/`:
 *
 * * it is **not** in `packages/core`, so it cannot affect a golden hash;
 * * it is **not** a proposal for the Phase-1 algorithm, and its constants are
 *   chosen to produce a representative amount of work, not attractive terrain;
 * * it exists to answer "how much headroom does the fBm pass leave?", and its
 *   output is a timing, never a world.
 *
 * The *structure* is nonetheless the one Phase 1 needs, because a cost model
 * with the wrong shape measures the wrong cost. Craters are placed by hashing
 * cells of a **fixed subdivision of the face**, not by drawing from a per-tile
 * RNG stream: two adjacent tiles overlap the same cells and therefore see the
 * same craters, which is what makes the pass seam-free. A per-tile stream would
 * be cheaper to write, faster to run, and would put a visible discontinuity
 * along every tile edge.
 */
import { type TileGenOutput, compactFalloff, hash2, hashToUnit } from '@traveller-mainworld/core';

/** One crater size-band. */
export interface CraterBand {
  /**
   * Subdivision level of the face that cells are drawn from: the face is cut
   * into `2^level` cells per axis. Fixed, not derived from tile depth, so a
   * cell denotes the same patch of world for every tile that overlaps it.
   */
  readonly level: number;
  /** Probability a cell contains a crater at all. */
  readonly density: number;
  /** Maximum crater radius, in cells. Above 1 a crater reaches beyond its own cell. */
  readonly maxRadiusCells: number;
  /** Peak depth of the crater floor, as a fraction of terrain amplitude. */
  readonly depthFraction: number;
  /** Distinguishes this band's hash stream from the others'. */
  readonly bandId: number;
}

/**
 * Three bands spanning basin, crater and pit scales.
 *
 * The spike plan asks for two size-bands; three is what it takes for every LOD
 * to have *something* to composite, because a band is only applied where it can
 * actually be resolved (see {@link bandIsResolvable}). With two bands, a
 * depth-0 tile — one vertex per ~500 km on a Size-8 world — has no feature
 * large enough to show and would measure as free, which is the wrong answer to
 * report against a per-tile budget.
 *
 * Densities are tuned so a tile is touched a few times over, which is what a
 * heavily cratered airless surface costs. They are chosen for representative
 * *work*, not for realism of appearance, and deliberately err on the expensive
 * side: this model feeds a budget verdict, and an optimistic cost model is a
 * budget verdict that is wrong in the direction nobody catches.
 */
export const DEFAULT_CRATER_BANDS: readonly CraterBand[] = Object.freeze([
  { level: 5, density: 0.5, maxRadiusCells: 1.5, depthFraction: 0.35, bandId: 0 },
  { level: 8, density: 0.25, maxRadiusCells: 1.5, depthFraction: 0.25, bandId: 1 },
  { level: 11, density: 0.45, maxRadiusCells: 1.2, depthFraction: 0.06, bandId: 2 },
]);

/**
 * Whether a band's craters are big enough to appear on this tile's grid.
 *
 * A crater narrower than the vertex spacing cannot be represented no matter how
 * much arithmetic is spent on it, and iterating its cells is pure waste. This
 * is the same principle that keys fBm octave count to LOD depth, and skipping
 * the check is expensive in a way that is easy to miss: a depth-0 tile spans a
 * whole face, so the finest band's cell grid over it is 2048² — four million
 * hash lookups to composite features a thousand times smaller than a pixel.
 *
 * Getting this wrong does not produce a wrong picture, only a slow one, which
 * is why a benchmark is where it shows up.
 */
export function bandIsResolvable(band: CraterBand, tileSize: number, n: number): boolean {
  const vertexSpacing = tileSize / n;
  const radius = (1 / (1 << band.level)) * band.maxRadiusCells;
  return radius >= vertexSpacing;
}

export interface CraterStats {
  /** Cells examined across all bands. */
  readonly cellsVisited: number;
  /** Cells that turned out to hold a crater. */
  readonly cratersPlaced: number;
  /** Vertex-crater interactions evaluated — the term that dominates at large radii. */
  readonly vertexUpdates: number;
}

/**
 * Composite both bands onto an already-generated tile.
 *
 * Applied after `generateTile`, in place, exactly as a Phase-1 pipeline would
 * stack passes. The `out.materials` array is deliberately left alone: material
 * reclassification after cratering is a Phase-4 concern and adding it here
 * would inflate the model with work nobody has specified.
 */
export function compositeCraters(
  out: TileGenOutput,
  face: number,
  u0: number,
  v0: number,
  size: number,
  n: number,
  amplitudeM: number,
  bands: readonly CraterBand[] = DEFAULT_CRATER_BANDS,
): CraterStats {
  let cellsVisited = 0;
  let cratersPlaced = 0;
  let vertexUpdates = 0;

  for (const band of bands) {
    if (!bandIsResolvable(band, size, n)) {
      continue;
    }
    const cells = 1 << band.level;
    const cellSize = 1 / cells;
    // Margin of one maximum radius, so craters centred outside the tile still
    // reach into it. Without it every tile edge grows a straight cliff where
    // overlapping craters were silently dropped.
    const margin = band.maxRadiusCells;
    const i0 = Math.floor(u0 * cells - margin);
    const i1 = Math.ceil((u0 + size) * cells + margin);
    const j0 = Math.floor(v0 * cells - margin);
    const j1 = Math.ceil((v0 + size) * cells + margin);

    for (let cj = j0; cj <= j1; cj++) {
      for (let ci = i0; ci <= i1; ci++) {
        cellsVisited++;

        // Cell identity includes the face, so the six faces do not share a
        // crater field, and the band, so adding a band does not move the others.
        const seed = (band.bandId * 0x9e3779b1 + face * 0x85ebca6b) | 0;
        const h = hash2(ci, cj, seed);
        if (hashToUnit(h) >= band.density) {
          continue;
        }
        cratersPlaced++;

        // Three more independent draws from the same cell: position within the
        // cell, and radius. Re-hashing with a perturbed seed is cheaper than a
        // stateful stream and keeps every crater independently addressable.
        const hx = hashToUnit(hash2(ci, cj, (seed ^ 0x51ed2701) | 0));
        const hy = hashToUnit(hash2(ci, cj, (seed ^ 0x2f6e2b3d) | 0));
        const hr = hashToUnit(hash2(ci, cj, (seed ^ 0x1b56c4e9) | 0));

        const cu = (ci + hx) * cellSize;
        const cv = (cj + hy) * cellSize;
        // Radius biased small: real crater populations are heavily
        // small-dominated, and a uniform draw would overstate the vertex cost.
        const radius = cellSize * band.maxRadiusCells * (0.25 + 0.75 * hr * hr);
        const depth = amplitudeM * band.depthFraction * (0.5 + 0.5 * hr);

        // Bounding box of the crater in tile grid coordinates. Compact support
        // is what makes this bounded at all: a profile that never quite reaches
        // zero would make every crater touch every vertex of every tile.
        const gi0 = Math.max(0, Math.ceil(((cu - radius - u0) / size) * n));
        const gi1 = Math.min(n, Math.floor(((cu + radius - u0) / size) * n));
        const gj0 = Math.max(0, Math.ceil(((cv - radius - v0) / size) * n));
        const gj1 = Math.min(n, Math.floor(((cv + radius - v0) / size) * n));
        if (gi1 < gi0 || gj1 < gj0) {
          continue;
        }

        const invRadius = 1 / radius;
        for (let gj = gj0; gj <= gj1; gj++) {
          const v = v0 + (gj / n) * size;
          const dv = (v - cv) * invRadius;
          const rowBase = gj * (n + 1);
          for (let gi = gi0; gi <= gi1; gi++) {
            const u = u0 + (gi / n) * size;
            const du = (u - cu) * invRadius;
            const r2 = du * du + dv * dv;
            if (r2 >= 1) {
              continue;
            }
            vertexUpdates++;
            // Bowl plus rim: the falloff carves the floor, and a positive lobe
            // near r = 1 raises the ejecta ring. Both are polynomial, so no
            // `exp` is needed — the whole reason the spike plan prefers
            // rational profiles for stamps.
            const r = Math.sqrt(r2);
            const bowl = compactFalloff(r);
            const rim = r * r * r * r * (1 - r) * 4;
            out.elevation[rowBase + gi]! += depth * (rim - bowl);
          }
        }
      }
    }
  }

  return { cellsVisited, cratersPlaced, vertexUpdates };
}

/**
 * The global pass: large-crater *placement* over a 512²-per-face base grid.
 *
 * Placement only — no compositing. This is the Phase-3 shape where basin-scale
 * features are decided once for the whole world and then sampled from within
 * tiles, and the spike plan lists it separately because its cost scales with
 * the planet rather than with the view.
 *
 * @returns the number of craters placed, which the caller consumes so the loop
 *          cannot be optimised away.
 */
export function globalCraterPass(resolution = 512, density = 0.02): number {
  let placed = 0;
  for (let face = 0; face < 6; face++) {
    const seed = (0x5bf03635 + face * 0x9e3779b1) | 0;
    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        const h = hash2(i, j, seed);
        if (hashToUnit(h) < density) {
          placed++;
        }
      }
    }
  }
  return placed;
}
