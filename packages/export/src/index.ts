/**
 * @traveller-mainworld/export — projected 2D maps, rendered from generation data.
 *
 * PRD R23–R26. For each output pixel: projection → lat/lon → 3D direction →
 * `sampleSurface` at a chosen detail depth → palette → RGB. Not a screenshot, so
 * the result is seam-free and independent of the viewport.
 *
 * ## The whitelist does not govern this package
 *
 * `packages/core/src/kernel` may use only bit-identical operations because
 * everything it produces reaches a golden hash. Nothing here does. A projection
 * decides *which* directions to sample; the sampling goes through the kernel and
 * comes back identical whichever route asked for it. So `Math.log`, `Math.sin`
 * and `Math.pow` are unremarkable in this package, exactly as they are in
 * `core/palette` — and **an approximation must not be added to `kernel/approx.ts`
 * on this package's account.** See `geography.ts` and `projection/mercator.ts`
 * for the argument, and the README for the general form of it.
 *
 * ## Where the agreement with the viewer comes from
 *
 * Not from this package. `sampleSurface` is asserted byte-identical to
 * `generateTile`'s buffers over every fixture world (WP11), `bandsForDepth` is
 * the one shared band gate, and `worldPalette` → `writeSurfaceColour` is the one
 * shared colour map. What is new here is the projection maths and the
 * application of the palette, and those are what this package's tests aim at.
 */
export * from './detailDepth.js';
export * from './exportMap.js';
export * from './geography.js';
export * from './job.js';
export * from './overlay/draw.js';
export * from './overlay/font.js';
export * from './overlay/graticule.js';
export * from './overlay/titleBlock.js';
export * from './png.js';
export * from './pool/local.js';
export * from './pool/pool.js';
export * from './pool/protocol.js';
export * from './pool/serve.js';
export * from './projection/index.js';
export * from './raster.js';
export * from './render.js';
export * from './size.js';
