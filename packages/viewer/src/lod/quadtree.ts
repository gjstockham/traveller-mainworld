/**
 * LOD selection over the cube-sphere quadtree.
 *
 * Each frame the six face roots are traversed and a cut through the tree is
 * chosen: the set of tiles to draw, refined where the surface is close enough
 * that a coarse tile's error would be visible.
 *
 * **Hysteresis.** Split and merge use *separate* thresholds. With a single
 * threshold, a tile sitting exactly at the boundary splits, and its children —
 * being smaller — immediately want to merge, and the surface flickers every
 * frame at that distance. Separating the thresholds gives a dead band where
 * neither happens, so a tile that has split stays split until the camera has
 * moved meaningfully back. This is the difference between "works" and "works
 * while the camera is moving".
 */
import {
  MAX_DEPTH,
  faceUvToDirection,
  rootTiles,
  tileBounds,
  tileChild,
  tileDepth,
  tileFace,
} from '@traveller-mainworld/core';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface LodParams {
  /** Planet radius in scene units. */
  readonly radius: number;
  /** Viewport height in pixels. */
  readonly viewportHeight: number;
  /** Vertical field of view in radians. */
  readonly fovY: number;
  /**
   * Screen-space error, in pixels, above which a tile splits.
   * Larger = coarser terrain and fewer tiles.
   */
  readonly splitPixels: number;
  /**
   * Screen-space error below which a tile merges. Must be strictly less than
   * `splitPixels` — that gap is the hysteresis dead band.
   */
  readonly mergePixels: number;
  /** Hard cap on tree depth, independent of {@link MAX_DEPTH}. */
  readonly maxDepth: number;
  /** Maximum tiles in one cut, a backstop against pathological camera positions. */
  readonly maxTiles: number;
}

export const DEFAULT_LOD: LodParams = {
  radius: 1,
  viewportHeight: 1080,
  fovY: (50 * Math.PI) / 180,
  // 2:1 dead band. Tighter than ~1.5:1 and flicker returns during fast zooms.
  splitPixels: 24,
  mergePixels: 12,
  maxDepth: 12,
  maxTiles: 2048,
};

/** Centre direction and angular radius of a tile, used for error and culling. */
export interface TileExtent {
  readonly centre: Vec3;
  /** Angular radius of the bounding cap, in radians. */
  readonly angularRadius: number;
}

/**
 * Bounding cap for a tile.
 *
 * The cap is built from the tile's four corners and centre rather than assumed
 * from its depth: the tangent warp makes tiles near face corners noticeably
 * larger in angle than tiles at face centres, and a uniform estimate would
 * over-refine some regions and under-refine others.
 */
export function tileExtent(tileId: number): TileExtent {
  const { u0, v0, size } = tileBounds(tileId);
  const face = tileFace(tileId);

  const centre = faceUvToDirection(face, u0 + size / 2, v0 + size / 2);

  let minDot = 1;
  for (const [du, dv] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const c = faceUvToDirection(face, u0 + du! * size, v0 + dv! * size);
    const dot = c.x * centre.x + c.y * centre.y + c.z * centre.z;
    minDot = Math.min(minDot, dot);
  }

  return { centre, angularRadius: Math.acos(Math.max(-1, Math.min(1, minDot))) };
}

/**
 * Screen-space error of a tile, in pixels.
 *
 * The geometric error is the sagitta of the tile's chord against the sphere —
 * how far a flat rendering of this tile departs from the true surface. That is
 * projected to the screen by the usual perspective relation. Distance is to the
 * nearest point of the tile's bounding cap, not its centre, so a tile the
 * camera is sitting on top of does not under-report.
 */
export function screenSpaceError(
  extent: TileExtent,
  cameraPos: Vec3,
  params: LodParams,
): number {
  const { radius, viewportHeight, fovY } = params;

  // Geometric error: how far the tile's surface deviates from a flat approximation.
  const geometricError = radius * (1 - Math.cos(extent.angularRadius));

  const camLen = Math.sqrt(
    cameraPos.x * cameraPos.x + cameraPos.y * cameraPos.y + cameraPos.z * cameraPos.z,
  );
  if (camLen === 0) {
    return Infinity;
  }

  // Angle between the camera direction and the tile centre, minus the cap
  // radius, gives the angular gap to the nearest part of the tile.
  const cosAngle =
    (cameraPos.x * extent.centre.x + cameraPos.y * extent.centre.y + cameraPos.z * extent.centre.z) /
    camLen;
  const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  const nearestAngle = Math.max(0, angle - extent.angularRadius);

  // Distance from the camera to the nearest point of the cap, by the cosine rule.
  const distSq =
    camLen * camLen + radius * radius - 2 * camLen * radius * Math.cos(nearestAngle);
  const distance = Math.sqrt(Math.max(0, distSq));

  // Guard the singularity when the camera is on the surface.
  const safeDistance = Math.max(distance, radius * 1e-6);

  return (geometricError * viewportHeight) / (2 * safeDistance * Math.tan(fovY / 2));
}

/**
 * True if a tile is entirely on the far side of the planet.
 *
 * Horizon culling, not frustum culling: at orbital range roughly half the
 * quadtree is behind the planet, and skipping it early avoids both the
 * traversal and the tile requests.
 */
export function isBeyondHorizon(extent: TileExtent, cameraPos: Vec3, radius: number): boolean {
  const camLen = Math.sqrt(
    cameraPos.x * cameraPos.x + cameraPos.y * cameraPos.y + cameraPos.z * cameraPos.z,
  );
  if (camLen <= radius) {
    return false; // below the surface: cull nothing
  }
  // Angle from the camera's sub-point to the horizon.
  const horizonAngle = Math.acos(radius / camLen);
  const cosAngle =
    (cameraPos.x * extent.centre.x + cameraPos.y * extent.centre.y + cameraPos.z * extent.centre.z) /
    camLen;
  const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  return angle - extent.angularRadius > horizonAngle;
}

/**
 * The set of tiles that were *split* (drawn as their children) last frame.
 *
 * Deliberately the split set rather than the drawn set: hysteresis asks "was
 * this node already open?", which is exactly membership here — an O(1) lookup
 * on the node being considered. Tracking drawn leaves instead would force a
 * search through descendants at every node to answer the same question.
 */
export type LodState = ReadonlySet<number>;

export interface LodSelection {
  /** Tiles to draw this frame. */
  readonly tiles: number[];
  /** Screen-space error per selected tile, for prioritising generation. */
  readonly errors: Map<number, number>;
  /** Feed back as `previous` next frame to enable hysteresis. */
  readonly state: Set<number>;
}

/**
 * Choose the tile cut for one frame.
 *
 * @param previous Last frame's split set. A node that was already split holds
 *                 it until its error falls below `mergePixels`; a node that was
 *                 not must exceed `splitPixels` to earn one. Pass an empty set
 *                 for a cold start.
 */
export function selectTiles(
  cameraPos: Vec3,
  params: LodParams,
  previous: LodState = new Set(),
): LodSelection {
  const tiles: number[] = [];
  const errors = new Map<number, number>();
  const state = new Set<number>();

  const maxDepth = Math.min(params.maxDepth, MAX_DEPTH);
  const stack: number[] = rootTiles();

  while (stack.length > 0) {
    const id = stack.pop()!;
    const extent = tileExtent(id);

    if (isBeyondHorizon(extent, cameraPos, params.radius)) {
      continue;
    }

    const error = screenSpaceError(extent, cameraPos, params);

    // The bar to hold a split is lower than the bar to earn one. Between the
    // two thresholds nothing changes, which is what stops the flicker.
    const threshold = previous.has(id) ? params.mergePixels : params.splitPixels;
    const canSplit = tileDepth(id) < maxDepth && tiles.length + stack.length < params.maxTiles;

    if (error > threshold && canSplit) {
      state.add(id);
      for (let c = 0; c < 4; c++) {
        stack.push(tileChild(id, c));
      }
    } else {
      tiles.push(id);
      errors.set(id, error);
    }
  }

  return { tiles, errors, state };
}
