/**
 * Tangent-adjusted cube-sphere mapping.
 *
 * A naive cube-to-sphere projection bunches vertices toward face centres and
 * stretches them at the corners — roughly a 1.4× variation in cell size. Warping
 * the face coordinates through {@link tanWarp} before projection evens that out,
 * at the cost of needing a deterministic `tan`.
 *
 * **The seam property.** All generation is a function of the 3D position on the
 * sphere (PRD §8.3), so tiles are seam-free provided adjacent faces compute
 * *bit-identical* positions along their shared edges. That holds because face
 * edges sit at warped coordinate ±1, and `tanWarp(±1)` is exactly ±1 — see the
 * note in `approx.ts`. It is not approximately true; `cubesphere.test.ts`
 * asserts exact equality.
 */
import { atanWarpInverse, tanWarp } from './approx.js';
import { FACE_COUNT } from './tileid.js';

/** A unit-length direction on the sphere. */
export interface Direction {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A face coordinate: which face, and where on it in `[0, 1]²`. */
export interface FaceUv {
  readonly face: number;
  readonly u: number;
  readonly v: number;
}

/**
 * Map a warped cube coordinate pair onto the unit cube, per face.
 *
 * Follows the standard cubemap axis convention, so face 0 is +X and so on.
 * The specific handedness matters only in that it must be consistent — the
 * edge-agreement tests are what pin it down.
 */
function faceVector(face: number, s: number, t: number): Direction {
  switch (face) {
    case 0:
      return { x: 1, y: -t, z: -s }; // +X
    case 1:
      return { x: -1, y: -t, z: s }; // -X
    case 2:
      return { x: s, y: 1, z: t }; // +Y
    case 3:
      return { x: s, y: -1, z: -t }; // -Y
    case 4:
      return { x: s, y: -t, z: 1 }; // +Z
    case 5:
      return { x: -s, y: -t, z: -1 }; // -Z
    default:
      throw new RangeError(`face ${face} outside [0, ${FACE_COUNT})`);
  }
}

/**
 * Face UV in `[0, 1]²` to a unit direction on the sphere.
 *
 * The `2u − 1` step is exact for the dyadic rationals that tile bounds produce,
 * so no precision is lost turning a tile coordinate into a position.
 */
export function faceUvToDirection(face: number, u: number, v: number): Direction {
  const s = tanWarp(2 * u - 1);
  const t = tanWarp(2 * v - 1);
  const c = faceVector(face, s, t);
  const invLen = 1 / Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
  return { x: c.x * invLen, y: c.y * invLen, z: c.z * invLen };
}

/**
 * Inverse of {@link faceUvToDirection}: which face a direction falls on, and
 * where.
 *
 * Used for picking, camera-relative tile selection, and (from Phase 3) sampling
 * the global pass from inside a tile. The dominant-axis test decides the face;
 * ties on face boundaries resolve consistently by the comparison order, so a
 * direction exactly on an edge always yields the same face.
 */
export function directionToFaceUv(d: Direction): FaceUv {
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);

  let face: number;
  let sc: number;
  let tc: number;
  let ma: number;

  if (ax >= ay && ax >= az) {
    ma = ax;
    if (d.x > 0) {
      face = 0;
      sc = -d.z;
      tc = -d.y;
    } else {
      face = 1;
      sc = d.z;
      tc = -d.y;
    }
  } else if (ay >= az) {
    ma = ay;
    if (d.y > 0) {
      face = 2;
      sc = d.x;
      tc = d.z;
    } else {
      face = 3;
      sc = d.x;
      tc = -d.z;
    }
  } else {
    ma = az;
    if (d.z > 0) {
      face = 4;
      sc = d.x;
      tc = -d.y;
    } else {
      face = 5;
      sc = -d.x;
      tc = -d.y;
    }
  }

  const s = sc / ma;
  const t = tc / ma;
  return {
    face,
    u: (atanWarpInverse(s) + 1) / 2,
    v: (atanWarpInverse(t) + 1) / 2,
  };
}

/**
 * Write the direction for a `(n+1)²` vertex grid covering a tile into `out`,
 * as interleaved xyz triples.
 *
 * Grid coordinates are computed as `u0 + (i/n) * size` with `n` a power of two,
 * keeping every vertex on a dyadic rational — so a vertex shared with a
 * neighbouring tile, at either the same or an adjacent LOD, gets bit-identical
 * coordinates and therefore bit-identical terrain.
 *
 * @param out Length must be at least `3 * (n+1)²`.
 */
export function tileVertexDirections(
  face: number,
  u0: number,
  v0: number,
  size: number,
  n: number,
  out: Float64Array,
): void {
  const needed = 3 * (n + 1) * (n + 1);
  if (out.length < needed) {
    throw new RangeError(`out buffer holds ${out.length}, needs ${needed}`);
  }
  let k = 0;
  for (let j = 0; j <= n; j++) {
    const v = v0 + (j / n) * size;
    for (let i = 0; i <= n; i++) {
      const u = u0 + (i / n) * size;
      const d = faceUvToDirection(face, u, v);
      out[k] = d.x;
      out[k + 1] = d.y;
      out[k + 2] = d.z;
      k += 3;
    }
  }
}
