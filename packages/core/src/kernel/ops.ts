/**
 * Whitelisted arithmetic primitives for the generation kernel.
 *
 * Everything under `kernel/` may only use operations whose results are
 * bit-identical across conforming JS engines: `+ - * / %`, `Math.sqrt`,
 * `Math.floor/ceil/trunc/round/abs/min/max/sign`, `Math.fround`, `Math.imul`,
 * bitwise ops and comparisons. Transcendentals (`sin`, `cos`, `pow`, `exp`,
 * `log`, ...) are implementation-defined and therefore banned — see
 * docs/plans/phase0-implementation-plan.md §2.3 and the spike plan §A.1.
 *
 * The ban is enforced by ESLint (`eslint.config.js`) and independently by
 * `scripts/check-kernel-whitelist.mjs`, so a stray eslint-disable cannot open
 * a hole in it.
 */

/** `x * x`. Exact: a single IEEE-754 multiply. */
export function pow2(x: number): number {
  return x * x;
}

/** `x * x * x`, evaluated left-to-right so the rounding sequence is fixed. */
export function pow3(x: number): number {
  return x * x * x;
}

/**
 * Integer power by binary exponentiation — the whitelist-legal stand-in for
 * `Math.pow` / `**`, which are banned. The multiply order is fully determined
 * by `n`, so the result is reproducible across engines.
 *
 * @param n Non-negative integer exponent.
 */
export function powi(x: number, n: number): number {
  let result = 1;
  let base = x;
  let e = n | 0;
  while (e > 0) {
    if ((e & 1) === 1) {
      result = result * base;
    }
    base = base * base;
    e = e >>> 1;
  }
  return result;
}

/** Constrain `x` to `[lo, hi]`. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/** Linear interpolation. Written as `a + t*(b-a)` so `t === 0` returns `a` exactly. */
export function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/** Hermite `3t² − 2t³` smoothstep on a pre-normalised `t ∈ [0, 1]`. */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Ken Perlin's quintic `6t⁵ − 15t⁴ + 10t³`; zero 1st and 2nd derivatives at both ends. */
export function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
