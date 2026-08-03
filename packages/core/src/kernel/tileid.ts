/**
 * Tile addressing.
 *
 * A tile is identified by `(face, depth, quadtree path)`, packed into a single
 * number used interchangeably as map key, RNG stream input and cache key.
 *
 * Layout, from the high end: `depth` (5 bits) | `face` (3 bits) | `quadPath`
 * (2 bits per level, up to 40). That is 48 bits total, which is exactly
 * representable as a double — so the key can be a plain `number` and used as a
 * `Map` key with no string allocation on the hot path. Going deeper than
 * {@link MAX_DEPTH} would break that exactness silently, so it is asserted.
 *
 * Shifts are not used to assemble the key: bitwise operators coerce to int32
 * and would discard everything above bit 31. Multiplication and division by
 * powers of two are exact in binary floating point, which is what makes the
 * arithmetic form safe.
 */

/**
 * Maximum quadtree depth. At depth 20 the packed key is 48 bits, inside the
 * 53-bit exactly-representable integer range. Phase 0 needs 6.
 */
export const MAX_DEPTH = 20;

/** Number of cube faces. */
export const FACE_COUNT = 6;

const FACE_SCALE = 1099511627776; // 2^40
const DEPTH_SCALE = 8796093022208; // 2^43

/** Cube face indices. */
export const Face = {
  PosX: 0,
  NegX: 1,
  PosY: 2,
  NegY: 3,
  PosZ: 4,
  NegZ: 5,
} as const;

export type FaceId = (typeof Face)[keyof typeof Face];

/** Axis-aligned extent of a tile within its face, in `[0, 1]` face UV space. */
export interface TileBounds {
  readonly u0: number;
  readonly v0: number;
  /** Edge length, `2^-depth`. */
  readonly size: number;
}

/** Pack a tile address into a single number. */
export function makeTileId(face: number, depth: number, quadPath: number): number {
  if (depth < 0 || depth > MAX_DEPTH) {
    throw new RangeError(`tile depth ${depth} outside [0, ${MAX_DEPTH}]`);
  }
  if (face < 0 || face >= FACE_COUNT) {
    throw new RangeError(`face ${face} outside [0, ${FACE_COUNT})`);
  }
  const pathLimit = quadPathLimit(depth);
  if (quadPath < 0 || quadPath >= pathLimit) {
    throw new RangeError(`quadPath ${quadPath} outside [0, ${pathLimit}) for depth ${depth}`);
  }
  return depth * DEPTH_SCALE + face * FACE_SCALE + quadPath;
}

/** Number of distinct quadtree paths at a depth, i.e. `4^depth`. */
export function quadPathLimit(depth: number): number {
  let limit = 1;
  for (let i = 0; i < depth; i++) {
    limit = limit * 4;
  }
  return limit;
}

/** The six root tiles, one per face. */
export function rootTiles(): number[] {
  const roots: number[] = [];
  for (let f = 0; f < FACE_COUNT; f++) {
    roots.push(makeTileId(f, 0, 0));
  }
  return roots;
}

/** Depth component of a packed tile ID. */
export function tileDepth(id: number): number {
  return Math.floor(id / DEPTH_SCALE);
}

/** Face component of a packed tile ID. */
export function tileFace(id: number): number {
  return Math.floor(id / FACE_SCALE) % 8;
}

/** Quadtree path component of a packed tile ID. */
export function tileQuadPath(id: number): number {
  return id % FACE_SCALE;
}

/**
 * The parent tile.
 *
 * @throws if `id` is a root tile.
 */
export function tileParent(id: number): number {
  const depth = tileDepth(id);
  if (depth === 0) {
    throw new RangeError('root tiles have no parent');
  }
  return makeTileId(tileFace(id), depth - 1, Math.floor(tileQuadPath(id) / 4));
}

/**
 * One of the four children.
 *
 * @param childIndex Bit 0 selects the upper half in u, bit 1 the upper half in v.
 */
export function tileChild(id: number, childIndex: number): number {
  const depth = tileDepth(id);
  if (depth >= MAX_DEPTH) {
    throw new RangeError(`cannot descend below depth ${MAX_DEPTH}`);
  }
  if (childIndex < 0 || childIndex > 3) {
    throw new RangeError(`childIndex ${childIndex} outside [0, 4)`);
  }
  return makeTileId(tileFace(id), depth + 1, tileQuadPath(id) * 4 + childIndex);
}

/**
 * The tile's extent within its face.
 *
 * The path is walked coarsest-to-finest, halving the extent at each level, so
 * every bound is a dyadic rational and therefore exact — adjacent tiles agree
 * on their shared edge coordinate bit-for-bit, which is a precondition for
 * seamless generation.
 */
export function tileBounds(id: number): TileBounds {
  const depth = tileDepth(id);
  let path = tileQuadPath(id);

  // Extract child indices finest-first, since that is the direction division
  // gives them.
  const children = new Array<number>(depth);
  for (let i = 0; i < depth; i++) {
    children[i] = path % 4;
    path = Math.floor(path / 4);
  }

  let u0 = 0;
  let v0 = 0;
  let size = 1;
  for (let i = depth - 1; i >= 0; i--) {
    size = size / 2;
    const c = children[i]!;
    if ((c & 1) !== 0) {
      u0 = u0 + size;
    }
    if ((c & 2) !== 0) {
      v0 = v0 + size;
    }
  }

  return { u0, v0, size };
}

/** Human-readable form, e.g. `f4/d3/021`. Debugging and test failure messages only. */
export function tileToString(id: number): string {
  const depth = tileDepth(id);
  let path = tileQuadPath(id);
  let s = '';
  for (let i = 0; i < depth; i++) {
    s = String(path % 4) + s;
    path = Math.floor(path / 4);
  }
  return `f${tileFace(id)}/d${depth}/${s || '-'}`;
}
