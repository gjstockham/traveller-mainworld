/**
 * Deciding which tile edges actually need a skirt.
 *
 * **Why this exists.** Skirts are not free. A skirt wall is near-radial, so
 * under a directional light it is barely lit and renders almost black. Where
 * the wall sits directly behind a tile join, multisampling blends the surface
 * against that dark wall and leaves a hairline — and since every tile has four
 * walls, the result is a dark grid tracing the entire quadtree across the
 * globe. It is clearly visible in a render and it fails the Spike C criterion
 * of no visible seams.
 *
 * **Why suppression is safe.** Adjacent tiles at the *same* depth share their
 * edge vertices bit-for-bit — that is the seam guarantee the kernel provides
 * and `cubesphere.test.ts` asserts exactly. Two surfaces meeting at identical
 * vertices leave no crack, so the wall between them has nothing to hide and can
 * simply be omitted. A skirt is only genuinely needed where the neighbour is at
 * a *different* depth, which during steady navigation is a small minority of
 * edges.
 */
import { makeTileId, tileBounds, tileDepth, tileFace } from '@traveller-mainworld/core';

/** Edge indices, matching the skirt ring layout in `tileMesh.ts`. */
export const Edge = {
  V0: 0,
  V1: 1,
  U0: 2,
  U1: 3,
} as const;

/** All four edges skirted — the conservative default. */
export const ALL_EDGES = 0b1111;

/**
 * Tile ID from an integer grid position within a face.
 *
 * Inverse of `tileBounds`: the quadtree path interleaves the bits of the
 * column and row, coarsest level first, with bit 0 of each child index
 * selecting the upper half in u and bit 1 the upper half in v.
 */
export function tileFromGrid(face: number, depth: number, col: number, row: number): number {
  let path = 0;
  for (let i = depth - 1; i >= 0; i--) {
    path = path * 4 + (((col >> i) & 1) | (((row >> i) & 1) << 1));
  }
  return makeTileId(face, depth, path);
}

/** Integer grid position of a tile within its face. */
export function gridPositionOf(tileId: number): { col: number; row: number; span: number } {
  const depth = tileDepth(tileId);
  const span = Math.pow(2, depth);
  const { u0, v0 } = tileBounds(tileId);
  return { col: Math.round(u0 * span), row: Math.round(v0 * span), span };
}

/**
 * Which edges of `tileId` need a skirt, given the set of tiles being drawn.
 *
 * An edge needs one unless the neighbour across it is present in `drawn` at the
 * same depth. Edges that leave the face are always skirted: cross-face
 * adjacency needs a rotation table this does not carry, and there are only
 * twelve cube edges, so the conservative answer costs almost nothing.
 */
export function skirtMaskFor(tileId: number, drawn: ReadonlySet<number>): number {
  const depth = tileDepth(tileId);
  if (depth === 0) {
    // Every depth-0 neighbour is across a face boundary.
    return ALL_EDGES;
  }

  const face = tileFace(tileId);
  const { col, row, span } = gridPositionOf(tileId);
  let mask = 0;

  const check = (edge: number, nCol: number, nRow: number): void => {
    if (nCol < 0 || nRow < 0 || nCol >= span || nRow >= span) {
      mask |= 1 << edge; // leaves the face
      return;
    }
    if (!drawn.has(tileFromGrid(face, depth, nCol, nRow))) {
      mask |= 1 << edge; // neighbour is at a different depth
    }
  };

  check(Edge.V0, col, row - 1);
  check(Edge.V1, col, row + 1);
  check(Edge.U0, col - 1, row);
  check(Edge.U1, col + 1, row);

  return mask;
}
