/**
 * Which tile depth an export samples at (plan §8), from a stated formula.
 *
 * ## The formula
 *
 * The crater band gate `bandsForDepth(depth)` asks whether a tile at that depth
 * can *resolve* a band, and it answers against a stated reference grid rather
 * than against whatever grid the caller happens to use: `referenceSpacing(d)` is
 * `(π/2) / (2ᵈ · BAND_GATE_N)` radians of arc. So the export's question has an
 * exact counterpart —
 *
 * > **the detail depth is the smallest `d` whose reference spacing is no coarser
 * > than the export's finest texel.**
 *
 * Coarser than that and the map asks for detail the chosen depth does not carry,
 * which aliases; finer and every texel pays for crater bands smaller than a
 * pixel, which is invisible and not free.
 *
 * At 4096×2048 equirectangular the finest texel is `2π/4096 = π/2048` radians,
 * and `referenceSpacing(4)` is `(π/2)/(16·64) = π/2048` — the same double, so
 * `d = 4`. At 2048×1024 it is `d = 3`. Those are the two values plan §8 names,
 * arrived at rather than assumed.
 *
 * ## Why it is written against `BAND_GATE_N` and not against 64 or 65
 *
 * Plan §8 states the formula with a `65²` in it, and **Phase 1 open question 1
 * — 65² for the viewer against 129² for the golden fixtures — is still open.**
 * Baking either number in would make this file quietly wrong on the day WP15
 * closes that question, and it would be wrong in the direction nobody checks:
 * the map would still render, at a depth that no longer matched anything.
 *
 * `referenceSpacing` is imported instead, so the reference the gate is
 * calibrated against and the reference the export matches it to are **the same
 * expression**. If WP15 moves `BAND_GATE_N`, this moves with it, and the day it
 * does is the day the change protocol is looking at anyway. This file does not
 * close open question 1 and must not be read as having an opinion about it.
 *
 * Note also which grid the number describes. `BAND_GATE_N` is 64 — a count of
 * *cells* across a tile, where "65²" counts the *vertices* bounding them. The
 * plan's `6·4ᵈ·65²` is a vertex count and the ratio argument it makes is a cell
 * argument; they differ by the 3% that 65²/64² is, which is why the two
 * derivations land on the same depth and why writing this in terms of the gate's
 * own function avoids having to notice.
 */
import { ALWAYS_ON_BANDS, MAX_DEPTH, bandsForDepth, referenceSpacing } from '@traveller-mainworld/core';

import type { Projection } from './projection/projection.js';
import type { ImageSize } from './size.js';

/**
 * The tile depth whose sample spacing matches this export's texel spacing.
 *
 * Clamped to `[0, MAX_DEPTH]`. The upper clamp is reachable — a 16384-wide map
 * wants depth 6, nowhere near it — but it is what keeps the loop terminating on
 * a projection that reports an absurd spacing, and a depth outside the tile
 * addressing range is not a thing the band gate is defined for.
 */
export function detailDepthFor(projection: Projection, size: ImageSize): number {
  const texel = projection.finestSpacingRad(size);
  if (!(texel > 0)) {
    throw new RangeError(
      `projection '${projection.id}' reports a texel spacing of ${String(texel)} radians at ` +
        `${String(size.width)}x${String(size.height)}; it must be positive and finite`,
    );
  }

  let depth = 0;
  while (depth < MAX_DEPTH && referenceSpacing(depth) > texel) {
    depth++;
  }
  return depth;
}

/**
 * The depth the **surface** actually has to be sampled at — and it is not
 * {@link detailDepthFor}'s answer.
 *
 * ## The finding
 *
 * WP11 made the albedo field **depth-invariant on purpose**. `regolith.ts`'s
 * composite skips every candidate whose scale bucket is at or beyond
 * `ALWAYS_ON_BANDS` — the line is commented "the depth-independence filter" —
 * so the surface at a position is the same at every depth, and `sampleSurface`'s
 * own doc comment says it takes `depth` "for symmetry, **not because the answer
 * depends on it**". The reason is a good one: a colour that changed with depth
 * would put a visible line along every LOD boundary in the viewer.
 *
 * The consequence for the export is that **plan §8's detail depth changes
 * nothing in the picture.** Measured on `X400000-0` at 256×128, depths 0, 2, 4,
 * 6 and 8 produce byte-identical images — and cost 632, 664, 801, 1179 and
 * 1578 ms to do it, because the extra bands are collected and then discarded.
 * At the plan's depth 4 that is **27% of the render spent on candidates nothing
 * reads**.
 *
 * ## What is done about it
 *
 * The full depth is still computed, still printed, still overridable: it is the
 * correct number for the map's resolution and it becomes load-bearing the moment
 * anything derived from *elevation* is exported — hillshading, contours, a
 * relief layer. It is not thrown away.
 *
 * But the surface is sampled at this depth instead, and **the equality is
 * asserted rather than assumed** (`render.test.ts`), which is the same shape as
 * `BasinCull`'s superset argument: an optimisation is only allowed here if a
 * test says the unoptimised path gives the identical bytes. On the day the
 * export renders relief, that test is what names what changed.
 *
 * Derived rather than written as `0`, so that raising `ALWAYS_ON_BANDS` or
 * removing the gate's floor moves this with it.
 */
export function surfaceSampleDepth(depth: number): number {
  let cheapest = 0;
  while (cheapest < depth && bandsForDepth(cheapest) < ALWAYS_ON_BANDS) {
    cheapest++;
  }
  return Math.min(depth, cheapest);
}

/**
 * One line for the title block, saying which depth — and, because the number
 * alone would be read as shaping the picture when it does not, what it governs.
 *
 * "relief is not exported" is the headline a reader comparing this map to the 3D
 * view most needs: the viewer's craters are mostly *shadow*, and there is none
 * here. See the WP13 evidence file for the hillshading decision.
 *
 * **ASCII only**, like everything the 5×7 font has to draw. `assertPrintable`
 * catches a lapse rather than rendering it as a question mark, and it caught two
 * on the first render this package ever did.
 */
export function detailDepthLine(depth: number, chosen: boolean): string {
  return (
    `${String(depth)}${chosen ? '' : ' (overridden)'} - ` +
    'albedo is depth-invariant; relief is not exported'
  );
}

/**
 * Refuse a detail depth outside the range the tile addressing defines.
 *
 * A user override is a supported thing to do — plan §8 asks for it — and an
 * override of 40 is a typo rather than a request.
 */
export function requireDepth(depth: number): number {
  if (!Number.isInteger(depth) || depth < 0 || depth > MAX_DEPTH) {
    throw new RangeError(
      `detail depth ${String(depth)} is not an integer in 0..${String(MAX_DEPTH)}`,
    );
  }
  return depth;
}
