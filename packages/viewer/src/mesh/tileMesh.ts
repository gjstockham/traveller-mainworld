/**
 * Tile mesh construction: turning a generated tile into renderable buffers.
 *
 * **Skirts, not stitching.** Where two tiles at different LOD levels meet, the
 * coarser tile's edge is a straight line between vertices the finer tile
 * subdivides, so a thin crack opens between them. Rather than stitching edges
 * (which needs neighbour awareness, and therefore ordering between tiles that
 * are generated independently and out of order), every tile carries a skirt: a
 * ring of duplicated edge vertices pushed inward along the radius, forming a
 * short wall that fills the gap from behind. It costs a few percent more
 * vertices and is entirely local to one tile.
 *
 * The trade-off is that a skirt can catch the light at grazing sun angles.
 * Acceptable for Phase 0/1 flat shading; revisit when Phase 2 adds water edges
 * and scattering.
 */
import { lodStepBound } from '@traveller-mainworld/core';

/**
 * Vertices in a tile mesh: the `(n+1)²` grid, plus **two** skirt rings per edge.
 *
 * Two rings, not one. The obvious construction hangs the wall directly from the
 * grid's own edge vertices, but those are exactly the vertices the neighbouring
 * tile shares — so the wall's top edge is coincident with the neighbour's
 * surface, and depth precision decides per pixel which one is drawn. The result
 * is a thin dark line tracing every tile boundary across the whole globe, since
 * the wall is near-radial and therefore barely lit.
 *
 * Giving the wall its own top ring, dropped just below the surface, means the
 * wall is strictly beneath the terrain wherever the neighbour matches (so it is
 * invisible) and still fills the gap wherever the neighbour is genuinely
 * coarser (so it does its job).
 */
export function vertexCount(n: number): number {
  return (n + 1) * (n + 1) + 8 * (n + 1);
}

/** Triangles: two per grid cell, plus two per skirt cell on each of the four edges. */
export function triangleCount(n: number): number {
  return 2 * n * n + 4 * (2 * n);
}

/** Top-of-wall ring for edge `e` (0=bottom, 1=top, 2=left, 3=right), position `k`. */
function skirtTopIndex(n: number, e: number, k: number): number {
  return (n + 1) * (n + 1) + e * (n + 1) + k;
}

/** Bottom-of-wall ring. */
function skirtIndex(n: number, e: number, k: number): number {
  return (n + 1) * (n + 1) + 4 * (n + 1) + e * (n + 1) + k;
}

/**
 * How far below the surface the wall's top ring sits, as a fraction of the
 * skirt depth.
 *
 * Large enough to clear depth-buffer quantisation at the ranges the camera
 * works over, small enough to stay far below any crack worth hiding.
 */
const TOP_RING_SINK = 0.02;

/** Grid vertex index at column `i`, row `j`. */
function gridIndex(n: number, i: number, j: number): number {
  return j * (n + 1) + i;
}

/**
 * Build the triangle index buffer for grid resolution `n`.
 *
 * Depends only on `n` and which edges carry skirts — the indices describe
 * topology, and only positions differ between tiles — so the sixteen variants
 * are built once and their attributes shared across every tile in the scene.
 *
 * **Winding.** The cube-sphere face convention has uniform handedness: on all
 * six faces `∂P/∂s × ∂P/∂t` points *inward*. Triangles are therefore wound
 * clockwise in `(i, j)` order so their geometric normal faces outward, which is
 * what Three.js front-face culling expects. `tileMesh.test.ts` asserts this
 * directly against the outward direction on every face rather than trusting the
 * derivation.
 *
 * @param skirtMask Bitmask of edges to skirt: bit 0 = `v0`, 1 = `v1`, 2 = `u0`,
 *                  3 = `u1`. Omitting an edge omits its wall entirely — see
 *                  {@link skirtMaskFor} for why that matters.
 */
export function buildTileIndices(n: number, skirtMask = 0b1111): Uint32Array {
  const skirtEdges = [0, 1, 2, 3].filter((e) => (skirtMask & (1 << e)) !== 0);
  const indices = new Uint32Array((2 * n * n + skirtEdges.length * 2 * n) * 3);
  let k = 0;

  const tri = (a: number, b: number, c: number): void => {
    indices[k] = a;
    indices[k + 1] = b;
    indices[k + 2] = c;
    k += 3;
  };

  // Interior grid.
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = gridIndex(n, i, j);
      const b = gridIndex(n, i + 1, j);
      const c = gridIndex(n, i, j + 1);
      const d = gridIndex(n, i + 1, j + 1);
      tri(a, d, b);
      tri(a, c, d);
    }
  }

  // Skirt walls, each spanning its own top ring down to its bottom ring. The
  // winding is mirrored on opposite edges so every wall faces outward.
  for (const e of skirtEdges) {
    for (let k = 0; k < n; k++) {
      const t0 = skirtTopIndex(n, e, k);
      const t1 = skirtTopIndex(n, e, k + 1);
      const s0 = skirtIndex(n, e, k);
      const s1 = skirtIndex(n, e, k + 1);
      // Edges 0 (j=0) and 3 (i=n) run one way round the tile, 1 and 2 the other.
      if (e === 0 || e === 3) {
        tri(t0, t1, s1);
        tri(t0, s1, s0);
      } else {
        tri(t0, s1, t1);
        tri(t0, s0, s1);
      }
    }
  }

  return indices;
}

/** Inputs to position construction. */
export interface MeshParams {
  /** Grid resolution; the vertex grid is `(n+1)²`. */
  readonly n: number;
  /** Planet radius in scene units. */
  readonly radius: number;
  /**
   * Scene units per metre of elevation. Usually exaggerated: real relief on an
   * Earth-sized world is ~0.1% of the radius and invisible at true scale.
   */
  readonly elevationScale: number;
  /** How far to push skirt vertices inward, in scene units. */
  readonly skirtDepth: number;
}

/**
 * Depth of the skirt wall, in scene units.
 *
 * A skirt must exceed the worst crack it hides, and no more. Oversized skirts
 * are not free: the wall becomes visible at the limb and at grazing sun angles,
 * which is exactly the artefact skirts are supposed to prevent.
 *
 * The crack at an LOD boundary is the gap between a coarse tile's straight
 * edge and the finer surface beside it. Three terms, and the third is the one
 * WP10 added:
 *
 *  - *geometric*: the sagitta of the coarser neighbour's cell chord against the
 *    sphere.
 *  - *terrain*: fBm relief across that cell. With `gain = 0.5, lacunarity = 2`
 *    the field is statistically self-similar with H ≈ 1, so relief scales
 *    roughly linearly with arc length — a cell spanning 1/k of the sphere shows
 *    about 1/k of the total relief.
 *  - *craters*: the elevation step between the two LOD levels themselves. A
 *    tile at depth `d` carries at most one crater band its parent does not, and
 *    the two therefore disagree at a shared vertex by up to `lodStepBound(d)` —
 *    which is zero wherever the band gate does not move, and `craters.test.ts`
 *    asserts against the real field rather than leaving it as an argument.
 *
 * **That third term dominates the other two by about two orders of magnitude**,
 * and it is not a refinement of the second: fBm relief across a cell shrinks
 * with the cell, but a crater band's relief is set by the crater's own depth,
 * which is a fixed multiple of the sample spacing rather than a fraction of the
 * world's total relief. Before WP10 there were no craters and the estimate was
 * right; with them the skirt was around a hundred times too short, and the
 * cracks it stopped hiding would have been read as a seam.
 *
 * An earlier version used `amplitudeM · 0.5` flat, which does not shrink with
 * depth at all: at depth 8 that gave a skirt ten times longer than the tile was
 * wide, and it showed as dark seams across the globe. The crater term shrinks
 * with depth like the others, so that failure does not return.
 *
 * @param n Grid resolution, so the cell size is known rather than assumed.
 * @param radiusKm The world's real radius. Needed because the crater step is a
 *        fraction of the planetary radius rather than of the world's relief, and
 *        recovering it from `elevationScale` would be wrong whenever the
 *        `?exaggeration=` override is in use.
 */
export function skirtDepthFor(
  depth: number,
  radius: number,
  amplitudeM: number,
  elevationScale: number,
  n: number,
  radiusKm: number,
): number {
  // Angular size of a tile edge: a quarter-turn at depth 0, halving each level.
  const tileArc = (Math.PI / 2) / Math.pow(2, depth);
  // A neighbour one LOD coarser has cells twice as wide; that is the gap to hide.
  const cellArc = (2 * tileArc) / n;

  const sagitta = radius * (1 - Math.cos(cellArc / 2));
  // Safety factor of 4 over the statistical estimate, since fBm relief across
  // any particular cell can exceed its expectation.
  const terrain = amplitudeM * elevationScale * (cellArc / Math.PI) * 4;

  // The crater step is already a worst case rather than an expectation, so it
  // takes no safety factor of its own. It is expressed in metres of elevation,
  // like `amplitudeM`, so it goes through the same scale.
  const craterStepM = lodStepBound(depth) * radiusKm * 1000;
  const craters = craterStepM * elevationScale;

  // Floor keeps the wall from degenerating to zero at extreme depth, where
  // float precision in the position buffer starts to matter.
  return sagitta + terrain + craters + radius * 1e-6;
}

/**
 * Write vertex positions for a tile.
 *
 * @param directions Unit direction per grid vertex, interleaved xyz — as
 *                   produced by the generator, so the renderer never recomputes
 *                   the cube-sphere mapping and cannot drift from it.
 * @param elevation  Metres per grid vertex.
 * @param out        `3 * vertexCount(n)` floats.
 */
export function buildTilePositions(
  directions: Float64Array,
  elevation: Float64Array,
  params: MeshParams,
  out: Float32Array,
): void {
  const { n, radius, elevationScale, skirtDepth } = params;
  const gridVerts = (n + 1) * (n + 1);

  if (out.length < 3 * vertexCount(n)) {
    throw new RangeError(`positions buffer holds ${out.length}, needs ${3 * vertexCount(n)}`);
  }

  for (let v = 0; v < gridVerts; v++) {
    const r = radius + elevation[v]! * elevationScale;
    out[v * 3] = directions[v * 3]! * r;
    out[v * 3 + 1] = directions[v * 3 + 1]! * r;
    out[v * 3 + 2] = directions[v * 3 + 2]! * r;
  }

  // Skirt rings: same direction, shorter radius. The top ring sinks just below
  // the surface so the wall never ties with the neighbour's surface on depth.
  const writeSkirt = (e: number, k: number, gridV: number): void => {
    const surface = radius + elevation[gridV]! * elevationScale;
    const dx = directions[gridV * 3]!;
    const dy = directions[gridV * 3 + 1]!;
    const dz = directions[gridV * 3 + 2]!;

    const top = skirtTopIndex(n, e, k);
    const rTop = surface - skirtDepth * TOP_RING_SINK;
    out[top * 3] = dx * rTop;
    out[top * 3 + 1] = dy * rTop;
    out[top * 3 + 2] = dz * rTop;

    const bottom = skirtIndex(n, e, k);
    const rBottom = surface - skirtDepth;
    out[bottom * 3] = dx * rBottom;
    out[bottom * 3 + 1] = dy * rBottom;
    out[bottom * 3 + 2] = dz * rBottom;
  };

  for (let i = 0; i <= n; i++) {
    writeSkirt(0, i, gridIndex(n, i, 0));
    writeSkirt(1, i, gridIndex(n, i, n));
  }
  for (let j = 0; j <= n; j++) {
    writeSkirt(2, j, gridIndex(n, 0, j));
    writeSkirt(3, j, gridIndex(n, n, j));
  }
}

/** Regolith palette by material class. Phase 1 replaces this with seed-varied tints. */
const MATERIAL_COLOURS: readonly (readonly [number, number, number])[] = [
  [0.28, 0.26, 0.24], // Lowland — dark basin regolith
  [0.42, 0.39, 0.36], // Midland
  [0.56, 0.53, 0.49], // Highland
  [0.72, 0.7, 0.67], // Peak
  [0.15, 0.25, 0.45], // Water (unused in Phase 0)
];

/**
 * Write per-vertex colours, tinted by material class and shaded slightly by
 * elevation within the class so relief reads even on a uniform material.
 */
export function buildTileColours(
  elevation: Float64Array,
  materials: Uint8Array,
  amplitudeM: number,
  n: number,
  out: Float32Array,
): void {
  const gridVerts = (n + 1) * (n + 1);
  if (out.length < 3 * vertexCount(n)) {
    throw new RangeError(`colours buffer holds ${out.length}, needs ${3 * vertexCount(n)}`);
  }

  const shadeOf = (v: number): readonly [number, number, number] => {
    const base = MATERIAL_COLOURS[materials[v]!] ?? MATERIAL_COLOURS[0]!;
    // ±12% within the band, so slopes are legible without banding hard at the
    // class boundaries.
    const t = amplitudeM > 0 ? elevation[v]! / amplitudeM : 0;
    const shade = 1 + Math.max(-1, Math.min(1, t)) * 0.12;
    return [base[0] * shade, base[1] * shade, base[2] * shade];
  };

  for (let v = 0; v < gridVerts; v++) {
    const [r, g, b] = shadeOf(v);
    out[v * 3] = r;
    out[v * 3 + 1] = g;
    out[v * 3 + 2] = b;
  }

  // Skirts take their edge vertex's colour *exactly*.
  //
  // An earlier version darkened them to "read as shadow behind the crack".
  // That was backwards: a skirt is meant to be invisible when it is not needed,
  // and tinting it turned every sliver that peeked through a tile join into a
  // visible dark line tracing the whole quadtree. Matching the edge colour
  // means a sliver reads as terrain rather than as a seam.
  const writeSkirt = (e: number, k: number, gridV: number): void => {
    const [r, g, b] = shadeOf(gridV);
    for (const s of [skirtTopIndex(n, e, k), skirtIndex(n, e, k)]) {
      out[s * 3] = r;
      out[s * 3 + 1] = g;
      out[s * 3 + 2] = b;
    }
  };

  for (let i = 0; i <= n; i++) {
    writeSkirt(0, i, gridIndex(n, i, 0));
    writeSkirt(1, i, gridIndex(n, i, n));
  }
  for (let j = 0; j <= n; j++) {
    writeSkirt(2, j, gridIndex(n, 0, j));
    writeSkirt(3, j, gridIndex(n, n, j));
  }
}
