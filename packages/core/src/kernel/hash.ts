/**
 * Integer hashing for gradient selection and deterministic feature placement.
 *
 * All 32-bit integer arithmetic: `Math.imul`, shifts and xor are exactly
 * specified by the language, so these functions are bit-identical across
 * engines by construction — no float involved anywhere.
 */

/**
 * SplitMix32 finaliser: a bijective avalanche over a 32-bit word.
 *
 * Every input bit affects roughly half the output bits, which is what stops
 * gradient selection showing visible lattice structure in the noise.
 */
export function mix32(x: number): number {
  let z = x | 0;
  z = z ^ (z >>> 16);
  z = Math.imul(z, 0x21f0aaad);
  z = z ^ (z >>> 15);
  z = Math.imul(z, 0x735a2d97);
  z = z ^ (z >>> 15);
  return z >>> 0;
}

// Distinct odd multipliers, one per coordinate axis. Multiplying each
// coordinate before mixing is not decoration — see the note on seed
// independence below.
const MUL_X = 0x27d4eb2d;
const MUL_Y = 0x85ebca6b;
const MUL_Z = 0xc2b2ae35;

/**
 * Pre-mix the seed so it does not share an algebraic structure with the
 * coordinates.
 *
 * An earlier version folded the seed in as `mix32(seed ^ x)`. Because XOR is
 * symmetric, that made the seed and the x-coordinate interchangeable:
 * `hash3(117, y, z, 2)` and `hash3(118, y, z, 1)` were equal, since
 * `2^117 === 1^118`. Re-rolling the seed therefore did not produce an
 * independent world — it produced the same field with the x-lattice
 * relabelled, which would have made PRD U4 ("re-roll to audition variants")
 * quietly worthless. Pre-mixing the seed and multiplying each coordinate by a
 * distinct odd constant breaks that symmetry.
 */
function seedBase(seed: number): number {
  return mix32(seed | 0) | 0;
}

/** Hash one word under a seed. */
export function hash1(x: number, seed: number): number {
  return mix32(seedBase(seed) ^ Math.imul(x | 0, MUL_X));
}

/** Hash two words under a seed. */
export function hash2(x: number, y: number, seed: number): number {
  let h = seedBase(seed);
  h = mix32(h ^ Math.imul(x | 0, MUL_X));
  h = mix32(h ^ Math.imul(y | 0, MUL_Y));
  return h >>> 0;
}

/**
 * Hash a 3D integer lattice point under a seed.
 *
 * The per-step `mix32` means the result does not degrade along axes (a plain
 * `x*p1 ^ y*p2 ^ z*p3` does, producing visible planar artefacts).
 */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seedBase(seed);
  h = mix32(h ^ Math.imul(x | 0, MUL_X));
  h = mix32(h ^ Math.imul(y | 0, MUL_Y));
  h = mix32(h ^ Math.imul(z | 0, MUL_Z));
  return h >>> 0;
}

/**
 * Map a hash to `[0, 1)` as a double.
 *
 * Division by 2³² is exact (a power of two), so this introduces no rounding of
 * its own — the result is exactly `h / 4294967296`.
 */
export function hashToUnit(h: number): number {
  return (h >>> 0) / 4294967296;
}

/** Map a hash to `[-1, 1)`. */
export function hashToSigned(h: number): number {
  return (h >>> 0) / 2147483648 - 1;
}
