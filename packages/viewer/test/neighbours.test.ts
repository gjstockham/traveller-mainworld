import { makeTileId, rootTiles, tileChild, tileDepth, tileFace } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { ALL_EDGES, Edge, gridPositionOf, skirtMaskFor, tileFromGrid } from '../src/lod/neighbours.js';
import { DEFAULT_LOD, type LodParams, selectTiles } from '../src/lod/quadtree.js';

const PARAMS: LodParams = { ...DEFAULT_LOD, radius: 1, maxDepth: 10 };

describe('grid position round-trip', () => {
  it('inverts tileBounds for every tile at shallow depths', () => {
    for (let face = 0; face < 6; face++) {
      for (let depth = 0; depth <= 5; depth++) {
        const span = Math.pow(2, depth);
        for (let col = 0; col < span; col++) {
          for (let row = 0; row < span; row++) {
            const id = tileFromGrid(face, depth, col, row);
            const pos = gridPositionOf(id);
            expect(pos, `face ${face} d${depth} (${col},${row})`).toEqual({ col, row, span });
          }
        }
      }
    }
  });

  it('agrees with tileChild navigation', () => {
    // Child 0 is (u0, v0); child 3 is (u1, v1).
    const root = rootTiles()[2]!;
    expect(gridPositionOf(tileChild(root, 0))).toMatchObject({ col: 0, row: 0 });
    expect(gridPositionOf(tileChild(root, 1))).toMatchObject({ col: 1, row: 0 });
    expect(gridPositionOf(tileChild(root, 2))).toMatchObject({ col: 0, row: 1 });
    expect(gridPositionOf(tileChild(root, 3))).toMatchObject({ col: 1, row: 1 });
  });

  it('covers a face exactly once at each depth', () => {
    for (let depth = 1; depth <= 6; depth++) {
      const span = Math.pow(2, depth);
      const ids = new Set<number>();
      for (let col = 0; col < span; col++) {
        for (let row = 0; row < span; row++) {
          ids.add(tileFromGrid(0, depth, col, row));
        }
      }
      expect(ids.size).toBe(span * span);
    }
  });
});

describe('skirtMaskFor', () => {
  it('skirts nothing interior when a whole face is drawn at one depth', () => {
    // The common case during steady navigation, and the one that produced a
    // dark seam grid across the globe before suppression existed.
    const depth = 3;
    const span = Math.pow(2, depth);
    const drawn = new Set<number>();
    for (let col = 0; col < span; col++) {
      for (let row = 0; row < span; row++) {
        drawn.add(tileFromGrid(0, depth, col, row));
      }
    }

    let interiorSkirts = 0;
    for (let col = 1; col < span - 1; col++) {
      for (let row = 1; row < span - 1; row++) {
        interiorSkirts += skirtMaskFor(tileFromGrid(0, depth, col, row), drawn);
      }
    }
    expect(interiorSkirts).toBe(0);
  });

  it('skirts the outer ring, which leaves the face', () => {
    const depth = 2;
    const span = 4;
    const drawn = new Set<number>();
    for (let col = 0; col < span; col++) {
      for (let row = 0; row < span; row++) {
        drawn.add(tileFromGrid(0, depth, col, row));
      }
    }
    // Corner tile: two edges leave the face.
    expect(skirtMaskFor(tileFromGrid(0, depth, 0, 0), drawn)).toBe(
      (1 << Edge.V0) | (1 << Edge.U0),
    );
    // Opposite corner.
    expect(skirtMaskFor(tileFromGrid(0, depth, span - 1, span - 1), drawn)).toBe(
      (1 << Edge.V1) | (1 << Edge.U1),
    );
  });

  it('SKIRTS EXACTLY THE EDGES FACING A DIFFERENT LOD', () => {
    // The property that makes suppression safe: same-depth neighbours share
    // edge vertices bit-for-bit, so only a depth change can open a crack.
    const depth = 2;
    const drawn = new Set<number>();
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        if (col === 2 && row === 2) {
          continue; // this one is refined instead
        }
        drawn.add(tileFromGrid(0, depth, col, row));
      }
    }
    // The refined tile's children are drawn in its place.
    for (let c = 0; c < 4; c++) {
      drawn.add(tileChild(tileFromGrid(0, depth, 2, 2), c));
    }

    // Neighbours of the hole must skirt the edge facing it, and only that edge.
    expect(skirtMaskFor(tileFromGrid(0, depth, 1, 2), drawn)).toBe(1 << Edge.U1);
    expect(skirtMaskFor(tileFromGrid(0, depth, 2, 1), drawn)).toBe(1 << Edge.V1);
    // A tile not touching the hole and not on the face edge skirts nothing.
    expect(skirtMaskFor(tileFromGrid(0, depth, 1, 1), drawn)).toBe(0);
  });

  it('always skirts root tiles, whose neighbours are all cross-face', () => {
    const drawn = new Set(rootTiles());
    for (const root of rootTiles()) {
      expect(skirtMaskFor(root, drawn)).toBe(ALL_EDGES);
    }
  });

  it('skirts every edge when nothing else is drawn', () => {
    expect(skirtMaskFor(makeTileId(0, 4, 100), new Set())).toBe(ALL_EDGES);
  });

  it('suppresses most skirts on a realistic camera cut', () => {
    // Regression guard on the actual benefit: if this drops back toward 100%,
    // the seam grid is back.
    const selection = selectTiles({ x: 0, y: 0, z: 1.3 }, PARAMS);
    const drawn = new Set(selection.tiles);
    let edges = 0;
    let skirted = 0;
    for (const tileId of selection.tiles) {
      const mask = skirtMaskFor(tileId, drawn);
      for (let e = 0; e < 4; e++) {
        edges++;
        if ((mask & (1 << e)) !== 0) {
          skirted++;
        }
      }
    }
    expect(edges).toBeGreaterThan(40);
    expect(skirted / edges, `${skirted}/${edges} edges skirted`).toBeLessThan(0.6);
  });

  it('never suppresses a skirt at a genuine LOD boundary', () => {
    // Exhaustive over a real cut: every edge whose neighbour is absent from the
    // drawn set at the same depth must be skirted.
    const selection = selectTiles({ x: 0.3, y: 0.5, z: 1.1 }, PARAMS);
    const drawn = new Set(selection.tiles);
    for (const tileId of selection.tiles) {
      const depth = tileDepth(tileId);
      if (depth === 0) {
        continue;
      }
      const face = tileFace(tileId);
      const { col, row, span } = gridPositionOf(tileId);
      const mask = skirtMaskFor(tileId, drawn);
      const neighbours: [number, number, number][] = [
        [Edge.V0, col, row - 1],
        [Edge.V1, col, row + 1],
        [Edge.U0, col - 1, row],
        [Edge.U1, col + 1, row],
      ];
      for (const [edge, nCol, nRow] of neighbours) {
        const offFace = nCol < 0 || nRow < 0 || nCol >= span || nRow >= span;
        const sameDepthNeighbourDrawn =
          !offFace && drawn.has(tileFromGrid(face, depth, nCol, nRow));
        if (!offFace && !sameDepthNeighbourDrawn) {
          expect((mask & (1 << edge)) !== 0, `tile ${tileId} edge ${edge} unskirted`).toBe(true);
        }
      }
    }
  });
});
