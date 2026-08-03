//! Twin of `packages/core/src/kernel/ops.ts`.
//!
//! Same expressions, same association order. Where the TypeScript relies on a
//! JavaScript coercion, the equivalent from [`crate::jsnum`] is used rather
//! than a Rust cast — see that module for why the distinction is not academic.

use crate::jsnum::{js_max, js_min, to_int32};

/// `x * x`. Exact: a single IEEE-754 multiply.
#[inline]
pub fn pow2(x: f64) -> f64 {
    x * x
}

/// `x * x * x`, evaluated left-to-right so the rounding sequence is fixed.
#[inline]
pub fn pow3(x: f64) -> f64 {
    x * x * x
}

/// Integer power by binary exponentiation.
///
/// Deliberately *not* `f64::powi`: that is an LLVM intrinsic free to choose its
/// own multiply order, which would diverge from the TypeScript in the last bits
/// for exponents above 2. The whole crate exists to not do that.
///
/// A negative exponent returns 1, matching the TypeScript — the loop guard
/// `e > 0` fails immediately there.
#[inline]
pub fn powi(x: f64, n: i32) -> f64 {
    let mut result = 1.0f64;
    let mut base = x;
    let mut e = n;
    while e > 0 {
        if (e & 1) == 1 {
            result *= base;
        }
        base *= base;
        // `e >>> 1` in the TypeScript: a logical shift. `e` is positive here,
        // so the distinction from an arithmetic shift is moot, but the cast
        // keeps the correspondence obvious.
        e = ((e as u32) >> 1) as i32;
    }
    result
}

/// Constrain `x` to `[lo, hi]`, with `Math.min`/`Math.max` semantics.
#[inline]
pub fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    js_min(js_max(x, lo), hi)
}

/// Linear interpolation. Written as `a + t*(b-a)` so `t == 0` returns `a` exactly.
#[inline]
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + t * (b - a)
}

/// Hermite `3t² − 2t³` smoothstep on a pre-normalised `t ∈ [0, 1]`.
#[inline]
pub fn smoothstep(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

/// Ken Perlin's quintic `6t⁵ − 15t⁴ + 10t³`.
#[inline]
pub fn smootherstep(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// `Math.min(a | 0, b)` over integers, as the octave clamps use it.
#[inline]
pub fn min_int(a: f64, b: i32) -> i32 {
    let a = to_int32(a);
    if a < b {
        a
    } else {
        b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powi_follows_the_binary_exponentiation_order() {
        // Not merely "close to" 0.1³ — the same rounding sequence the TS uses:
        // result = x, base = x², result = x·x², i.e. x * (x*x).
        let x = 0.1f64;
        assert_eq!(powi(x, 3), x * (x * x));
        // x⁷ = x · x² · x⁴ in that order.
        assert_eq!(powi(x, 7), ((x * (x * x)) * ((x * x) * (x * x))));
        assert_eq!(powi(x, 0), 1.0);
        assert_eq!(powi(x, -3), 1.0);
    }

    #[test]
    fn powi_differs_from_the_llvm_intrinsic() {
        // The reason this function exists. If these ever agree for every input
        // the guard is still worth keeping — the intrinsic makes no promise.
        let mut disagreements = 0;
        for i in 1..2000 {
            let x = 1.0 + (i as f64) * 1e-3;
            if powi(x, 7) != x.powi(7) {
                disagreements += 1;
            }
        }
        assert!(
            disagreements > 0,
            "expected f64::powi to differ somewhere in the sweep; if it no longer \
             does, powi() is still required — the intrinsic guarantees nothing"
        );
    }
}
