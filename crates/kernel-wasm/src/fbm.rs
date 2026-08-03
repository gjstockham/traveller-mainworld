//! Twin of `packages/core/src/kernel/fbm.ts`.

use crate::noise::gradient_noise3;
use crate::ops::min_int;
use crate::rotations::{MAX_OCTAVES, OCTAVE_ROTATIONS};

/// Parameters of one fBm field.
#[derive(Clone, Copy)]
pub struct FbmParams {
    /// Number of octaves to sum. Clamped to [`MAX_OCTAVES`].
    pub octaves: f64,
    /// Frequency of the first octave, in cycles per unit of input space.
    pub frequency: f64,
    /// Amplitude of the first octave.
    pub amplitude: f64,
    /// Frequency multiplier between octaves.
    pub lacunarity: f64,
    /// Amplitude multiplier between octaves.
    pub gain: f64,
}

/// Sensible starting point for Phase 0 terrain. Mirrors `DEFAULT_FBM`.
pub const DEFAULT_FBM: FbmParams = FbmParams {
    octaves: 8.0,
    frequency: 1.6,
    amplitude: 1.0,
    lacunarity: 2.0,
    gain: 0.5,
};

/// Sum `params.octaves` octaves of gradient noise at `(x, y, z)`.
///
/// The rotation accumulates across octaves — each octave's coordinate is the
/// previous one rotated again, not the original point rotated by matrix `i`.
/// The latter would give octaves 1..n a shared orientation and reintroduce the
/// grid-aligned ridging the rotations exist to break up.
pub fn fbm3(x: f64, y: f64, z: f64, seed: u32, params: &FbmParams) -> f64 {
    let octaves = min_int(params.octaves, MAX_OCTAVES);

    let mut sum = 0.0f64;
    let mut freq = params.frequency;
    let mut amp = params.amplitude;

    let mut px = x;
    let mut py = y;
    let mut pz = z;

    let mut o = 0i32;
    while o < octaves {
        // `(seed + o * 0x9e3779b1) | 0` in the TypeScript. The product is
        // exact as a double (o ≤ 23), so wrapping the whole thing modulo 2³²
        // in integers gives the same bits ToInt32 would.
        let octave_seed = seed.wrapping_add((o as u32).wrapping_mul(0x9e37_79b1));
        sum += amp * gradient_noise3(px * freq, py * freq, pz * freq, octave_seed);

        freq *= params.lacunarity;
        amp *= params.gain;

        let m = (o as usize) * 9;
        let rx = OCTAVE_ROTATIONS[m] * px + OCTAVE_ROTATIONS[m + 1] * py + OCTAVE_ROTATIONS[m + 2] * pz;
        let ry = OCTAVE_ROTATIONS[m + 3] * px + OCTAVE_ROTATIONS[m + 4] * py + OCTAVE_ROTATIONS[m + 5] * pz;
        let rz = OCTAVE_ROTATIONS[m + 6] * px + OCTAVE_ROTATIONS[m + 7] * py + OCTAVE_ROTATIONS[m + 8] * pz;
        px = rx;
        py = ry;
        pz = rz;

        o += 1;
    }

    sum
}

/// Theoretical maximum absolute value of [`fbm3`] — the sum of octave amplitudes.
pub fn fbm_normalisation(params: &FbmParams) -> f64 {
    let octaves = min_int(params.octaves, MAX_OCTAVES);
    let mut total = 0.0f64;
    let mut amp = params.amplitude;
    let mut o = 0i32;
    while o < octaves {
        total += amp;
        amp *= params.gain;
        o += 1;
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn octave_count_is_clamped_not_wrapped() {
        let mut p = DEFAULT_FBM;
        p.octaves = 1000.0;
        let a = fbm3(0.3, -1.7, 2.1, 5, &p);
        p.octaves = MAX_OCTAVES as f64;
        let b = fbm3(0.3, -1.7, 2.1, 5, &p);
        assert_eq!(a, b);
    }

    #[test]
    fn a_deeper_field_extends_a_shallower_one() {
        // The seam-free-by-construction property: adding octaves must not
        // disturb the ones already there, or a tile at depth d+1 would
        // disagree with its parent everywhere rather than only in detail.
        let mut shallow = DEFAULT_FBM;
        shallow.octaves = 4.0;
        let mut deep = DEFAULT_FBM;
        deep.octaves = 6.0;

        let s = fbm3(0.31, -1.77, 2.13, 5, &shallow);
        let d = fbm3(0.31, -1.77, 2.13, 5, &deep);
        // Octaves 4 and 5 carry amplitude 1/16 + 1/32 at gain 0.5.
        assert!((d - s).abs() <= 0.09375, "difference {} exceeds the tail amplitude", (d - s).abs());
        assert_ne!(s, d, "extra octaves added nothing at all");
    }

    #[test]
    fn stays_within_its_normalisation_bound() {
        let n = fbm_normalisation(&DEFAULT_FBM);
        let mut acc = 0.0f64;
        for _ in 0..20_000 {
            acc += 0.6180339887498949;
            let t = acc % 13.0;
            let v = fbm3(t, t * 0.41 - 2.5, t * -0.83 + 1.25, 999, &DEFAULT_FBM);
            assert!(v.abs() <= n, "fbm {v} exceeded normalisation {n}");
        }
    }
}
