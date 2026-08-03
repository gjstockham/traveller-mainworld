/**
 * 3D gradient noise.
 *
 * Gradients come from an integer hash of the lattice point rather than a
 * permutation table, so the field is defined over the whole integer lattice
 * with no period and no table to keep in sync between the TS and WASM kernels.
 *
 * Everything the generator builds is a pure function of 3D position (PRD §8.1
 * bucket (a)), which is what makes tiles seam-free by construction: adjacent
 * tiles and successive LODs sample the same underlying field, so deeper tiles
 * simply add higher octaves rather than recomputing anything.
 *
 * **Domain limit:** lattice coordinates are reduced to int32 by the hash, so
 * |coordinate| must stay below 2³¹. At depth 20 with a base frequency of a few
 * cycles per radius the largest coordinate is of order 10⁷, comfortably inside
 * that. {@link noiseDomainOk} exposes the check for tests and asserts.
 */
import { hash3 } from './hash.js';
import { smootherstep } from './ops.js';

/** Largest lattice coordinate magnitude the integer hash addresses without wrapping. */
export const MAX_LATTICE_COORD = 2147483648;

/** True if a coordinate is inside the lattice domain. */
export function noiseDomainOk(x: number, y: number, z: number): boolean {
  return (
    Math.abs(x) < MAX_LATTICE_COORD &&
    Math.abs(y) < MAX_LATTICE_COORD &&
    Math.abs(z) < MAX_LATTICE_COORD
  );
}

/**
 * Dot product of the offset with one of the 12 cube-edge gradient vectors,
 * selected by the low bits of `h`.
 *
 * Perlin's improved gradient set: all components are 0 or ±1, so the dot
 * product is pure addition and negation — no multiplies, and no rounding
 * beyond the adds themselves.
 */
function grad(h: number, x: number, y: number, z: number): number {
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
  return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
}

/**
 * Gradient noise at `(x, y, z)` under `seed`, returning `[-1, 1]`.
 *
 * The range is a guarantee, not an aspiration: the result is clamped. Measured
 * peak over 7×10⁶ samples is 0.9982, so the clamp is effectively never reached —
 * it exists so that {@link ridgedNoise3} and {@link billowNoise3} can promise
 * `[0, 1]`, and so downstream stages (sea-level solve, material banding) can
 * rely on a bound rather than an assumption. An earlier revision scaled by
 * 2/√3 on the textbook claim that 3D Perlin peaks at √3/2; that is wrong for
 * this gradient set, and it pushed output to ±1.04.
 *
 * Value is exactly 0 at every integer lattice point — a property of gradient
 * noise, not a defect, but worth knowing when choosing frequencies.
 *
 * **On sampling alignment:** on the half-lattice (all offsets exactly 0 or 0.5)
 * the fade weights collapse to {0, ½, 1} and the output is drawn from a set of
 * only ~14 distinct values, versus one per cell at generic offsets. Tile vertex
 * grids are regular, so a power-of-two base frequency could land first-octave
 * samples there systematically and visibly band the terrain. Keep base
 * frequencies non-dyadic ({@link DEFAULT_FBM} uses 1.6); later octaves are
 * protected anyway by the inter-octave rotations.
 */
export function gradientNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);

  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;

  // Quintic fade: zero 1st and 2nd derivatives at the lattice points, so no
  // visible creasing along cell boundaries.
  const u = smootherstep(fx);
  const v = smootherstep(fy);
  const w = smootherstep(fz);

  const x0 = ix | 0;
  const y0 = iy | 0;
  const z0 = iz | 0;
  const x1 = (x0 + 1) | 0;
  const y1 = (y0 + 1) | 0;
  const z1 = (z0 + 1) | 0;

  const n000 = grad(hash3(x0, y0, z0, seed), fx, fy, fz);
  const n100 = grad(hash3(x1, y0, z0, seed), fx - 1, fy, fz);
  const n010 = grad(hash3(x0, y1, z0, seed), fx, fy - 1, fz);
  const n110 = grad(hash3(x1, y1, z0, seed), fx - 1, fy - 1, fz);
  const n001 = grad(hash3(x0, y0, z1, seed), fx, fy, fz - 1);
  const n101 = grad(hash3(x1, y0, z1, seed), fx - 1, fy, fz - 1);
  const n011 = grad(hash3(x0, y1, z1, seed), fx, fy - 1, fz - 1);
  const n111 = grad(hash3(x1, y1, z1, seed), fx - 1, fy - 1, fz - 1);

  const nx00 = n000 + u * (n100 - n000);
  const nx10 = n010 + u * (n110 - n010);
  const nx01 = n001 + u * (n101 - n001);
  const nx11 = n011 + u * (n111 - n011);

  const nxy0 = nx00 + v * (nx10 - nx00);
  const nxy1 = nx01 + v * (nx11 - nx01);

  const n = nxy0 + w * (nxy1 - nxy0);
  return n < -1 ? -1 : n > 1 ? 1 : n;
}

/**
 * Absolute-valued ("billowed") noise in `[0, 1]` — rounded, cloud-like lobes.
 * Useful for regolith mottling; the ridged variant is its complement.
 */
export function billowNoise3(x: number, y: number, z: number, seed: number): number {
  return Math.abs(gradientNoise3(x, y, z, seed));
}

/**
 * Ridged noise in `[0, 1]`, peaking along the zero set of the underlying field.
 * The sharp creases read as mountain ridges once layered.
 */
export function ridgedNoise3(x: number, y: number, z: number, seed: number): number {
  return 1 - Math.abs(gradientNoise3(x, y, z, seed));
}
