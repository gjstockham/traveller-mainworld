/**
 * Fractional Brownian motion: layered gradient noise.
 *
 * Each octave doubles the frequency (by `lacunarity`) and shrinks the
 * amplitude (by `gain`). Between octaves the sampling coordinate is rotated by
 * a precomputed matrix, so successive lattices are not axis-aligned with each
 * other — without that, layered gradient noise shows obvious grid-aligned
 * ridging along the coordinate planes.
 *
 * Octave count is keyed to LOD depth by the caller: a shallow tile evaluates
 * the first few octaves, a deep tile evaluates more. Because every octave is a
 * pure function of position, a deep tile's coarse octaves are bit-identical to
 * the shallow tile's — that is what makes LOD transitions seamless rather than
 * merely close.
 */
import { gradientNoise3 } from './noise.js';
import { MAX_OCTAVES, OCTAVE_ROTATIONS } from './rotations.js';

export { MAX_OCTAVES };

/** Parameters of one fBm field. */
export interface FbmParams {
  /** Number of octaves to sum. Clamped to {@link MAX_OCTAVES}. */
  readonly octaves: number;
  /** Frequency of the first octave, in cycles per unit of input space. */
  readonly frequency: number;
  /** Amplitude of the first octave. */
  readonly amplitude: number;
  /** Frequency multiplier between octaves. 2.0 is the standard choice. */
  readonly lacunarity: number;
  /** Amplitude multiplier between octaves. Below 0.5 gives smooth terrain, above gives rough. */
  readonly gain: number;
}

/** Sensible starting point for Phase 0 terrain. */
export const DEFAULT_FBM: FbmParams = {
  octaves: 8,
  frequency: 1.6,
  amplitude: 1,
  lacunarity: 2.0,
  gain: 0.5,
};

/**
 * Sum `params.octaves` octaves of gradient noise at `(x, y, z)`.
 *
 * The return value is not normalised to any fixed range: with the default gain
 * of 0.5 the theoretical bound is `amplitude · 2`, but the practical range is
 * narrower because octaves rarely peak together. {@link fbmNormalisation}
 * gives the exact theoretical divisor if a bounded result is wanted.
 */
export function fbm3(x: number, y: number, z: number, seed: number, params: FbmParams): number {
  const octaves = Math.min(params.octaves | 0, MAX_OCTAVES);

  let sum = 0;
  let freq = params.frequency;
  let amp = params.amplitude;

  // Rotation accumulates across octaves: each octave's coordinate is the
  // previous octave's, rotated again. Applying rotation i afresh to the
  // original point would make octaves 1..n share an orientation.
  let px = x;
  let py = y;
  let pz = z;

  for (let o = 0; o < octaves; o++) {
    sum = sum + amp * gradientNoise3(px * freq, py * freq, pz * freq, (seed + o * 0x9e3779b1) | 0);

    freq = freq * params.lacunarity;
    amp = amp * params.gain;

    const m = o * 9;
    const rx = OCTAVE_ROTATIONS[m]! * px + OCTAVE_ROTATIONS[m + 1]! * py + OCTAVE_ROTATIONS[m + 2]! * pz;
    const ry = OCTAVE_ROTATIONS[m + 3]! * px + OCTAVE_ROTATIONS[m + 4]! * py + OCTAVE_ROTATIONS[m + 5]! * pz;
    const rz = OCTAVE_ROTATIONS[m + 6]! * px + OCTAVE_ROTATIONS[m + 7]! * py + OCTAVE_ROTATIONS[m + 8]! * pz;
    px = rx;
    py = ry;
    pz = rz;
  }

  return sum;
}

/**
 * Theoretical maximum absolute value of {@link fbm3} for the given parameters —
 * the sum of the octave amplitudes. Divide by this for a result bounded to
 * `[-1, 1]`, at the cost of never approaching the extremes in practice.
 */
export function fbmNormalisation(params: FbmParams): number {
  const octaves = Math.min(params.octaves | 0, MAX_OCTAVES);
  let total = 0;
  let amp = params.amplitude;
  for (let o = 0; o < octaves; o++) {
    total = total + amp;
    amp = amp * params.gain;
  }
  return total;
}
