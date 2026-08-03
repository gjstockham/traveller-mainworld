/**
 * Deterministic replacements for the transcendental functions the generator
 * actually needs.
 *
 * `Math.tan` and `Math.atan` have implementation-defined precision and
 * demonstrably differ in the last bits between V8, SpiderMonkey and
 * JavaScriptCore. Evaluating a rational approximation over `+ − × ÷` instead
 * gives bit-identical results everywhere, because those operations are
 * required by IEEE-754 and the ECMAScript spec to be correctly rounded.
 *
 * The rational forms are the classic Cephes kernels (Moshier, public domain),
 * chosen because they reach near-machine precision in few operations. Note the
 * goal is *cross-platform identity*, not accuracy: identity comes free from
 * using only whitelisted operations, and accuracy merely has to be good enough
 * that the approximation never shows in the terrain.
 *
 * The coefficients are written as the exact doubles the machine uses, not in
 * Cephes' original 21-significant-digit form. Those literals were rounded to
 * the same values on load — string-to-double conversion is correctly rounded,
 * so nothing changed numerically — but a literal that cannot be represented is
 * a literal that does not say what the code does, which is the wrong property
 * for a file whose entire purpose is bit-level predictability.
 */

/** π/4 to double precision. Used as a scale factor, never as an angle for a library call. */
const PI_OVER_4 = 0.7853981633974483;
/** π/2 to double precision. */
const PI_OVER_2 = 1.5707963267948966;
/** The bits of π/4 that do not fit in a double, for the atan range-reduction correction. */
const MOREBITS = 6.123233995736766e-17;

// --- tan, for |x| <= π/4 -----------------------------------------------------

const TAN_P0 = -13093.693918138379;
const TAN_P1 = 1153516.6483858742;
const TAN_P2 = -17956525.197648488;
const TAN_Q0 = 13681.296347069296;
const TAN_Q1 = -1320892.3444021097;
const TAN_Q2 = 25008380.18233579;
const TAN_Q3 = -53869575.592945464;

/**
 * `tan(x)` for `|x| <= π/4`, as `x + x·z·P(z)/Q(z)` with `z = x²`.
 *
 * Outside that interval the approximation degrades and then diverges — the
 * cube-sphere warp never leaves it, so no range reduction is implemented.
 */
export function tanCore(x: number): number {
  const z = x * x;
  if (z < 1e-14) {
    // Below this the correction term is smaller than the last bit of x, and
    // the rational form would be evaluating noise.
    return x;
  }
  const num = (TAN_P0 * z + TAN_P1) * z + TAN_P2;
  const den = (((z + TAN_Q0) * z + TAN_Q1) * z + TAN_Q2) * z + TAN_Q3;
  return x + x * ((z * num) / den);
}

// --- atan --------------------------------------------------------------------

const ATAN_P0 = -0.8750608600031904;
const ATAN_P1 = -16.157537187333652;
const ATAN_P2 = -75.00855792314705;
const ATAN_P3 = -122.88666844901361;
const ATAN_P4 = -64.85021904942025;
const ATAN_Q0 = 24.858464901423062;
const ATAN_Q1 = 165.02700983169885;
const ATAN_Q2 = 432.88106049129027;
const ATAN_Q3 = 485.3903996359137;
const ATAN_Q4 = 194.5506571482614;

/** tan(3π/8) — the range-reduction threshold above which atan folds through 1/x. */
const TAN_3PI_8 = 2.414213562373095;
/** tan(π/8) — the threshold above which atan folds through (x−1)/(x+1). */
const TAN_PI_8 = 0.414213562373095;

/**
 * `atan(x)` over the whole real line.
 *
 * Range reduction folds the argument into `[0, tan(π/8)]`, where the rational
 * approximation is accurate, then adds back the corresponding multiple of π/4.
 * The branches are plain comparisons, so each piece stays deterministic.
 */
export function atanCore(x: number): number {
  const sign = x < 0 ? -1 : 1;
  let a = sign < 0 ? -x : x;

  let y: number;
  if (a > TAN_3PI_8) {
    y = PI_OVER_2;
    a = -(1 / a);
  } else if (a > TAN_PI_8) {
    y = PI_OVER_4;
    a = (a - 1) / (a + 1);
  } else {
    y = 0;
  }

  const z = a * a;
  const num = (((ATAN_P0 * z + ATAN_P1) * z + ATAN_P2) * z + ATAN_P3) * z + ATAN_P4;
  const den = ((((z + ATAN_Q0) * z + ATAN_Q1) * z + ATAN_Q2) * z + ATAN_Q3) * z + ATAN_Q4;
  let w = ((z * num) / den) * a + a;

  // Restore the low bits of π/4 and π/2 that the constants above cannot hold.
  if (y === PI_OVER_2) {
    w = w + MOREBITS;
  } else if (y === PI_OVER_4) {
    w = w + 0.5 * MOREBITS;
  }

  return sign * (y + w);
}

// --- cube-sphere tangent warp ------------------------------------------------

/**
 * `tan(π/4)` as this module computes it.
 *
 * Exported so the WP3 parity harness can compare it against the WASM twin's
 * value bit-for-bit, rather than inferring agreement from downstream hashes: if
 * the two divisors differ, every warped coordinate on the sphere differs, and
 * saying so directly beats reporting that eleven battery cases disagree.
 *
 * Deliberately evaluated rather than hard-coded, so that {@link tanWarp} at
 * `u = ±1` divides a value by *itself* and yields exactly ±1. That exactness
 * is what makes adjacent cube faces meet: face edges are at `u = ±1`, and if
 * the warp returned 1−1ulp there, the two faces would compute different 3D
 * positions for the same edge and the noise field would tear along every seam.
 */
export const TAN_AT_ONE = tanCore(PI_OVER_4);

/**
 * Tangent-adjusted cube-sphere warp: maps face coordinate `u ∈ [−1, 1]` onto
 * `[−1, 1]`, evening out the area distortion of a naive cube-to-sphere
 * projection.
 *
 * Exact at `u = 0, ±1` (see {@link TAN_AT_ONE}).
 */
export function tanWarp(u: number): number {
  return tanCore(u * PI_OVER_4) / TAN_AT_ONE;
}

/**
 * Inverse of {@link tanWarp}: recovers face coordinate `u` from a warped
 * coordinate.
 *
 * Needed to map a 3D position back to face + face-UV — for picking, for
 * camera-relative tile selection, and (from Phase 3) for sampling the global
 * pass from inside a tile. Built here, under the whitelist, so that it can
 * never arrive later as a casual `Math.atan` call in output-affecting code.
 */
export function atanWarpInverse(t: number): number {
  return atanCore(t * TAN_AT_ONE) / PI_OVER_4;
}

// --- falloff profiles --------------------------------------------------------

/**
 * Rational bump on `r² ∈ [0, ∞)`: `1/(1 + k·r²)`, peaking at 1.
 *
 * Preferred over a Gaussian for crater and stamp profiles precisely because it
 * needs no `exp` — see the spike plan's guidance to pick profile shapes that
 * sidestep transcendentals rather than approximate them.
 */
export function rationalBump(r2: number, k: number): number {
  return 1 / (1 + k * r2);
}

/**
 * Compact-support falloff on `r ∈ [0, 1]`, reaching exactly 0 at `r = 1` with
 * zero first derivative at both ends.
 *
 * Compact support matters for tile-local generation: a profile that never
 * quite reaches zero would make every feature technically influence every
 * tile, and the per-tile candidate search could not be bounded.
 */
export function compactFalloff(r: number): number {
  if (r >= 1) {
    return 0;
  }
  if (r <= 0) {
    return 1;
  }
  const s = 1 - r * r;
  return s * s * s;
}
