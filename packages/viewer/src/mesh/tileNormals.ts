/**
 * Smooth per-vertex normals, from the tile apron.
 *
 * Flat shading was right for Phase 0 and is wrong for craters: a 65² tile
 * flat-shades a crater rim into facets, and a rim is the one feature on an
 * airless world whose whole character is a curve. Phase 1 plan §7 asks for
 * smooth per-vertex normals; WP10 generated the `(n+3)²` apron for exactly this
 * and nothing has read it until now.
 *
 * ## Why the apron is the whole point
 *
 * A normal at a vertex is a property of the *surface around* it, so a normal at
 * a tile's edge vertex needs elevation from outside the tile. Without it the
 * only options are a one-sided difference (a different estimator at the edge
 * from the one used in the interior) or a fallback to the sphere normal — both
 * of which make the normal at a shared vertex depend on *which tile computed
 * it*. That is a discontinuity in shading along every tile boundary, which
 * reads as a wireframe grid drawn over the whole planet. It is the artefact
 * class the apron exists to remove.
 *
 * ## The seam guarantee, and where it stops
 *
 * Within a cube face, two same-depth neighbours produce **bit-identical**
 * normals at every vertex they share. Three things make that true and all three
 * are load-bearing:
 *
 *  1. The apron ring is the neighbouring tile's own interior elevation,
 *     bit-for-bit (`craters.test.ts` asserts it against the real field).
 *  2. Face UV coordinates here are computed exactly as `tilegen.ts` computes
 *     them — `u0 + (i / n) * size` — and every operand is a dyadic rational, so
 *     tile A's ring column `i = n+1` and tile B's interior column `i = 1` land
 *     on the same double rather than merely the same real number.
 *  3. The estimator is the same central difference at every vertex, edge
 *     included, over operands in the same order. No special case at the border
 *     means nothing to disagree about.
 *
 * `tileNormals.test.ts` asserts the equality exactly rather than approximately,
 * per the repo's standing rule about seam guarantees.
 *
 * **Across a cube-face boundary it is an extrapolation, and that is accepted.**
 * There the ring continues face A's own parameterisation past `u = 1` rather
 * than crossing onto face B, so the two tiles take their difference over
 * slightly different steps and their normals differ slightly. This is the same
 * residual, on the same twelve cube edges, that the skirts already name as a
 * known limitation — the viewer carries no cross-face rotation table, and
 * building one to serve normals alone would be a work package rather than a
 * function. The alternative considered was flattening the normal toward the
 * geometric one near a face boundary, which trades a small shading step for a
 * visible band of wrong shading along all twelve edges: strictly worse, because
 * the step is bounded by one sample of gradient and the band is not.
 *
 * ## This is presentation, and it is outside every hash
 *
 * Normals never enter a golden manifest and never travel in a share URL. They
 * are computed from `elevationScale`, which the `?exaggeration=` override moves,
 * so they *must* be presentation — a hashed value that changed with a display
 * setting would be a contradiction. The whitelist does not reach this file for
 * the same reason it does not reach `core/palette`: no value here can move a
 * hash.
 */
import { apronIndex, apronStride, faceUvToDirection, tileBounds, tileFace } from '@traveller-mainworld/core';

import { vertexCount } from './tileMesh.js';

/** Grid vertex index at column `i`, row `j`. Matches `tileMesh.ts`. */
function gridIndex(n: number, i: number, j: number): number {
  return j * (n + 1) + i;
}

/** Top-of-wall ring for edge `e`, position `k`. Matches `tileMesh.ts`. */
function skirtTopIndex(n: number, e: number, k: number): number {
  return (n + 1) * (n + 1) + e * (n + 1) + k;
}

/** Bottom-of-wall ring. Matches `tileMesh.ts`. */
function skirtIndex(n: number, e: number, k: number): number {
  return (n + 1) * (n + 1) + 4 * (n + 1) + e * (n + 1) + k;
}

/**
 * Scratch for the apron's displaced positions: `3 · (n+3)²` doubles.
 *
 * Pooled by the caller rather than allocated per tile. At 65² it is 107 KB, and
 * a worker turning over 25 tiles a second would otherwise make it the
 * generator's largest single source of garbage — the same reasoning the crater
 * lattice cache is pooled under.
 *
 * Doubles, not floats, and that is the load-bearing part: the ring positions
 * have no Float32 counterpart in the position buffer, so computing the
 * difference in Float64 throughout is what keeps the interior and the edge on
 * one estimator. Only the finished normal is narrowed to Float32.
 */
export function allocateNormalScratch(n: number): Float64Array {
  return new Float64Array(apronStride(n) * apronStride(n) * 3);
}

export interface NormalParams {
  /** Grid resolution; the vertex grid is `(n+1)²`. */
  readonly n: number;
  /** Planet radius in scene units. */
  readonly radius: number;
  /** Scene units per metre of elevation — the same value the positions used. */
  readonly elevationScale: number;
}

/**
 * Write per-vertex normals for a tile.
 *
 * @param tileId    The tile, for its face and UV extent. Taken rather than
 *                  passed as four numbers so this cannot be handed an extent
 *                  that disagrees with the one the tile was generated over.
 * @param apron     `(n+3)²` elevations in metres, from `TileGenOutput`.
 * @param scratch   From {@link allocateNormalScratch}, sized for the same `n`.
 * @param out       `3 · vertexCount(n)` floats, interleaved xyz.
 */
export function buildTileNormals(
  tileId: number,
  apron: Float64Array,
  params: NormalParams,
  scratch: Float64Array,
  out: Float32Array,
): void {
  const { n, radius, elevationScale } = params;
  const stride = apronStride(n);

  if (out.length < 3 * vertexCount(n)) {
    throw new RangeError(`normals buffer holds ${out.length}, needs ${3 * vertexCount(n)}`);
  }
  if (scratch.length < stride * stride * 3) {
    throw new RangeError(`normal scratch holds ${scratch.length}, needs ${stride * stride * 3}`);
  }
  if (apron.length < stride * stride) {
    throw new RangeError(`apron holds ${apron.length}, needs ${stride * stride}`);
  }

  const face = tileFace(tileId);
  const { u0, v0, size } = tileBounds(tileId);

  // Pass 1: the displaced position of every apron sample, ring included.
  //
  // Recomputed rather than read from the position buffer, which covers only the
  // interior and holds Float32. `faceUvToDirection` is two tangent warps and a
  // square root — a rounding error next to the crater work that produced the
  // elevations being read here.
  for (let j = -1; j <= n + 1; j++) {
    const v = v0 + (j / n) * size;
    for (let i = -1; i <= n + 1; i++) {
      const u = u0 + (i / n) * size;
      const d = faceUvToDirection(face, u, v);
      const k = apronIndex(n, i, j);
      const r = radius + apron[k]! * elevationScale;
      scratch[k * 3] = d.x * r;
      scratch[k * 3 + 1] = d.y * r;
      scratch[k * 3 + 2] = d.z * r;
    }
  }

  // Pass 2: a central difference at every grid vertex, edges included.
  //
  // The cross product's order is the face convention, not a guess: `tileMesh.ts`
  // records that ∂P/∂u × ∂P/∂v points *inward* on all six faces, uniformly, so
  // the outward normal is v × u. `tileNormals.test.ts` checks it against the
  // outward direction on every face rather than trusting the derivation, which
  // is the same thing `buildTileIndices` does about winding.
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const west = apronIndex(n, i - 1, j) * 3;
      const east = apronIndex(n, i + 1, j) * 3;
      const south = apronIndex(n, i, j - 1) * 3;
      const north = apronIndex(n, i, j + 1) * 3;

      const ux = scratch[east]! - scratch[west]!;
      const uy = scratch[east + 1]! - scratch[west + 1]!;
      const uz = scratch[east + 2]! - scratch[west + 2]!;

      const vx = scratch[north]! - scratch[south]!;
      const vy = scratch[north + 1]! - scratch[south + 1]!;
      const vz = scratch[north + 2]! - scratch[south + 2]!;

      let nx = vy * uz - vz * uy;
      let ny = vz * ux - vx * uz;
      let nz = vx * uy - vy * ux;

      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        nx = nx / len;
        ny = ny / len;
        nz = nz / len;
      } else {
        // Degenerate only if two opposite samples coincide, which the cube
        // sphere never does for n ≥ 1. Fall back to the radial direction rather
        // than emitting a zero vector, which Three would shade as black.
        const k = apronIndex(n, i, j) * 3;
        const r = Math.sqrt(
          scratch[k]! * scratch[k]! + scratch[k + 1]! * scratch[k + 1]! + scratch[k + 2]! * scratch[k + 2]!,
        );
        nx = r === 0 ? 0 : scratch[k]! / r;
        ny = r === 0 ? 1 : scratch[k + 1]! / r;
        nz = r === 0 ? 0 : scratch[k + 2]! / r;
      }

      const g = gridIndex(n, i, j) * 3;
      out[g] = nx;
      out[g + 1] = ny;
      out[g + 2] = nz;
    }
  }

  // Skirt vertices take their edge vertex's normal exactly, for the same reason
  // the colours do — and here it earns more than consistency.
  //
  // The wall is near-radial, so its *geometric* normal points sideways and the
  // wall renders almost black. That is why the README calls an unnecessary
  // skirt a dark hairline at every tile join, and why `lod/neighbours.ts` goes
  // to the trouble of not drawing one. Giving the wall the surface normal means
  // a sliver that does peek through shades like the terrain beside it rather
  // than like a shadow: the skirt gets quieter for free, in exactly the case it
  // was always most visible.
  const copySkirt = (e: number, k: number, gridV: number): void => {
    const g = gridV * 3;
    for (const s of [skirtTopIndex(n, e, k), skirtIndex(n, e, k)]) {
      out[s * 3] = out[g]!;
      out[s * 3 + 1] = out[g + 1]!;
      out[s * 3 + 2] = out[g + 2]!;
    }
  };

  for (let i = 0; i <= n; i++) {
    copySkirt(0, i, gridIndex(n, i, 0));
    copySkirt(1, i, gridIndex(n, i, n));
  }
  for (let j = 0; j <= n; j++) {
    copySkirt(2, j, gridIndex(n, 0, j));
    copySkirt(3, j, gridIndex(n, n, j));
  }
}
