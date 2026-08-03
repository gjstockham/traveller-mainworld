//! Twin of `packages/core/src/kernel/approx.ts`.
//!
//! **These must not become `f64::tan` / `f64::atan`.** A Rust→wasm32 build
//! bundles its own libm, so those calls would be perfectly deterministic
//! *within* WASM — which is exactly the trap. This crate's job is not to be
//! internally consistent; it is to agree bit-for-bit with the TypeScript
//! kernel, and the TypeScript kernel evaluates the Cephes rational forms below.
//! Any libm call here would diverge in the last bits and the parity battery
//! would (correctly) fail.
//!
//! Coefficients are the same literals as `approx.ts`. Decimal-to-double
//! conversion is correctly rounded in both languages, so the same string
//! produces the same bits.

/// π/4 to double precision. A scale factor, never an angle handed to a library.
pub const PI_OVER_4: f64 = 0.7853981633974483;
/// π/2 to double precision.
pub const PI_OVER_2: f64 = 1.5707963267948966;
/// The bits of π/4 that do not fit in a double, for the atan range-reduction correction.
const MOREBITS: f64 = 6.123233995736766e-17;

// --- tan, for |x| <= π/4 -----------------------------------------------------

const TAN_P0: f64 = -13093.693918138379;
const TAN_P1: f64 = 1153516.6483858742;
const TAN_P2: f64 = -17956525.197648488;
const TAN_Q0: f64 = 13681.296347069296;
const TAN_Q1: f64 = -1320892.3444021097;
const TAN_Q2: f64 = 25008380.18233579;
const TAN_Q3: f64 = -53869575.592945464;

/// `tan(x)` for `|x| <= π/4`, as `x + x·z·P(z)/Q(z)` with `z = x²`.
///
/// `const fn` so that [`TAN_AT_ONE`] can be evaluated at compile time from this
/// very function rather than pasted in as a literal — the same reason the
/// TypeScript evaluates it at module load. Rust's const float arithmetic is
/// IEEE-754 and matches runtime evaluation exactly.
#[inline]
pub const fn tan_core(x: f64) -> f64 {
    let z = x * x;
    if z < 1e-14 {
        // Below this the correction term is smaller than the last bit of x.
        return x;
    }
    let num = (TAN_P0 * z + TAN_P1) * z + TAN_P2;
    let den = (((z + TAN_Q0) * z + TAN_Q1) * z + TAN_Q2) * z + TAN_Q3;
    x + x * ((z * num) / den)
}

// --- atan --------------------------------------------------------------------

const ATAN_P0: f64 = -0.8750608600031904;
const ATAN_P1: f64 = -16.157537187333652;
const ATAN_P2: f64 = -75.00855792314705;
const ATAN_P3: f64 = -122.88666844901361;
const ATAN_P4: f64 = -64.85021904942025;
const ATAN_Q0: f64 = 24.858464901423062;
const ATAN_Q1: f64 = 165.02700983169885;
const ATAN_Q2: f64 = 432.88106049129027;
const ATAN_Q3: f64 = 485.3903996359137;
const ATAN_Q4: f64 = 194.5506571482614;

/// tan(3π/8) — the range-reduction threshold above which atan folds through 1/x.
const TAN_3PI_8: f64 = 2.414213562373095;
/// tan(π/8) — the threshold above which atan folds through (x−1)/(x+1).
const TAN_PI_8: f64 = 0.414213562373095;

/// `atan(x)` over the whole real line.
///
/// The sign is carried as a multiplier and the fold written as `sign < 0 ? -x : x`,
/// mirroring the TypeScript rather than reaching for `f64::abs`. The two differ
/// on `x = -0`, where `x < 0` is false and this path leaves the negative zero in
/// place; signed zeros survive into the hashed bytes, so the branch structure has
/// to match, not merely the mathematics.
#[inline]
pub fn atan_core(x: f64) -> f64 {
    let sign = if x < 0.0 { -1.0f64 } else { 1.0f64 };
    let mut a = if sign < 0.0 { -x } else { x };

    let y: f64;
    if a > TAN_3PI_8 {
        y = PI_OVER_2;
        a = -(1.0 / a);
    } else if a > TAN_PI_8 {
        y = PI_OVER_4;
        a = (a - 1.0) / (a + 1.0);
    } else {
        y = 0.0;
    }

    let z = a * a;
    let num = (((ATAN_P0 * z + ATAN_P1) * z + ATAN_P2) * z + ATAN_P3) * z + ATAN_P4;
    let den = ((((z + ATAN_Q0) * z + ATAN_Q1) * z + ATAN_Q2) * z + ATAN_Q3) * z + ATAN_Q4;
    let mut w = ((z * num) / den) * a + a;

    // Restore the low bits of π/4 and π/2 that the constants above cannot hold.
    if y == PI_OVER_2 {
        w += MOREBITS;
    } else if y == PI_OVER_4 {
        w += 0.5 * MOREBITS;
    }

    sign * (y + w)
}

// --- cube-sphere tangent warp ------------------------------------------------

/// `tan(π/4)` as this module computes it.
///
/// Evaluated from [`tan_core`], never hard-coded, so that [`tan_warp`] at
/// `u = ±1` divides a value by *itself* and yields exactly ±1. Cube faces meet
/// along `u = ±1`; if the warp returned 1−1ulp there, two faces would compute
/// different 3D positions for the same edge point and the noise field would
/// tear along every seam. The viewer's skirt suppression rests on the same
/// exactness, since it assumes same-depth neighbours share edge vertices
/// bit-for-bit.
pub const TAN_AT_ONE: f64 = tan_core(PI_OVER_4);

/// Tangent-adjusted cube-sphere warp: `u ∈ [−1, 1]` onto `[−1, 1]`.
///
/// Exact at `u = 0, ±1`.
#[inline]
pub fn tan_warp(u: f64) -> f64 {
    tan_core(u * PI_OVER_4) / TAN_AT_ONE
}

/// Inverse of [`tan_warp`]: recovers face coordinate `u` from a warped coordinate.
#[inline]
pub fn atan_warp_inverse(t: f64) -> f64 {
    atan_core(t * TAN_AT_ONE) / PI_OVER_4
}

// --- falloff profiles --------------------------------------------------------

/// Rational bump on `r² ∈ [0, ∞)`: `1/(1 + k·r²)`, peaking at 1. Needs no `exp`.
#[inline]
pub fn rational_bump(r2: f64, k: f64) -> f64 {
    1.0 / (1.0 + k * r2)
}

/// Compact-support falloff on `r ∈ [0, 1]`, reaching exactly 0 at `r = 1`.
#[inline]
pub fn compact_falloff(r: f64) -> f64 {
    if r >= 1.0 {
        return 0.0;
    }
    if r <= 0.0 {
        return 1.0;
    }
    let s = 1.0 - r * r;
    s * s * s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tan_warp_is_exactly_one_at_the_face_edge() {
        // The seam guarantee. Asserted exactly, never approximately: an error
        // of one ulp here tears the noise field along all twelve cube edges.
        assert_eq!(tan_warp(1.0), 1.0);
        assert_eq!(tan_warp(-1.0), -1.0);
        assert_eq!(tan_warp(0.0), 0.0);
    }

    #[test]
    fn tan_at_one_is_evaluated_not_pasted() {
        // If someone replaces the const with a literal, this catches a drift of
        // even one ulp — which would silently break the assertion above.
        assert_eq!(TAN_AT_ONE.to_bits(), tan_core(PI_OVER_4).to_bits());
    }

    #[test]
    fn atan_warp_inverse_round_trips() {
        let mut worst = 0.0f64;
        for i in -1000..=1000 {
            let u = (i as f64) / 1000.0;
            let d = (atan_warp_inverse(tan_warp(u)) - u).abs();
            if d > worst {
                worst = d;
            }
        }
        assert!(worst < 1e-15, "round-trip error {worst} too large");
    }

    #[test]
    fn tan_core_tracks_the_library_tangent_closely() {
        // Accuracy is not the contract — cross-kernel identity is — but a
        // mistyped coefficient would show here long before the parity battery
        // ran, and with a far more legible failure.
        for i in -1000..=1000 {
            let x = (i as f64) / 1000.0 * PI_OVER_4;
            let rel = (tan_core(x) - x.tan()).abs() / (x.tan().abs() + 1e-30);
            assert!(rel < 1e-12, "tan_core({x}) relative error {rel}");
        }
    }

    #[test]
    fn atan_core_tracks_the_library_arctangent_closely() {
        for i in -2000..=2000 {
            let x = (i as f64) / 100.0;
            let rel = (atan_core(x) - x.atan()).abs() / (x.atan().abs() + 1e-30);
            assert!(rel < 1e-14, "atan_core({x}) relative error {rel}");
        }
    }
}
