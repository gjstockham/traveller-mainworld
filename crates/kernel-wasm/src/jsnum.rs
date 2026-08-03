//! ECMAScript numeric coercions, reproduced exactly.
//!
//! The TypeScript kernel leans on JavaScript's implicit conversions in places
//! where Rust's casts do something different, and "different" here means the
//! twin stops being a twin. Two cases matter:
//!
//! * **`x | 0` (ToInt32) and `x >>> 0` (ToUint32) wrap; Rust's `as i32`
//!   saturates.** For an in-domain coordinate the two agree, so the difference
//!   only shows up at the extremes — which is precisely where the determinism
//!   battery samples. `noise.rs` reduces lattice coordinates through
//!   [`to_int32`], so a coordinate past 2³¹ has to wrap the same way in both
//!   kernels even though neither claims a useful answer there.
//! * **`Math.min`/`Math.max` order signed zeros and propagate NaN; Rust's
//!   `f64::min`/`f64::max` do neither.** `f64::min(-0.0, 0.0)` may return
//!   either, and returns the non-NaN operand when one side is NaN. JavaScript
//!   is fully specified on both points.
//!
//! Everything here is built from comparisons, `trunc` and basic arithmetic, so
//! it is inside the kernel op whitelist.

/// ECMAScript `ToUint32` — i.e. what `x >>> 0` computes.
///
/// Truncates toward zero, then reduces modulo 2³². `fmod` is exact for every
/// finite double, so no rounding creeps in on the way. Non-finite input maps to
/// zero, matching the spec.
#[inline]
pub fn to_uint32(x: f64) -> u32 {
    if !x.is_finite() {
        return 0;
    }
    let t = x.trunc();
    let m = t % 4294967296.0;
    // `m` lands in (−2³², 2³²); shift the negative half up rather than relying
    // on a cast's sign behaviour.
    let m = if m < 0.0 { m + 4294967296.0 } else { m };
    // Exact: `m` is an integer in [0, 2³²), and −0.0 casts to 0.
    m as u32
}

/// ECMAScript `ToInt32` — i.e. what `x | 0` computes.
#[inline]
pub fn to_int32(x: f64) -> i32 {
    to_uint32(x) as i32
}

/// `Math.min` semantics: NaN-propagating, and `−0` sorts below `+0`.
#[inline]
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == b {
        // Equal but possibly differently signed zeros; `Math.min(-0, +0)` is −0.
        return if a.is_sign_negative() { a } else { b };
    }
    if a < b {
        a
    } else {
        b
    }
}

/// `Math.max` semantics: NaN-propagating, and `+0` sorts above `−0`.
#[inline]
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == b {
        // `Math.max(-0, +0)` is +0.
        return if a.is_sign_negative() { b } else { a };
    }
    if a > b {
        a
    } else {
        b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_int32_wraps_where_a_rust_cast_would_saturate() {
        // 2³¹ wraps to −2³¹; `2147483648.0 as i32` would give i32::MAX.
        assert_eq!(to_int32(2147483648.0), i32::MIN);
        assert_eq!(to_int32(4294967296.0), 0);
        assert_eq!(to_int32(4294967297.0), 1);
        assert_eq!(to_int32(-1.0), -1);
        assert_eq!(to_int32(-2147483649.0), i32::MAX);
        // Truncation is toward zero, not floor.
        assert_eq!(to_int32(-1.9), -1);
        assert_eq!(to_int32(1.9), 1);
        assert_eq!(to_int32(f64::INFINITY), 0);
        assert_eq!(to_int32(f64::NAN), 0);
        // Exact well past the 53-bit integer range.
        assert_eq!(to_int32(1e300), 0);
    }

    #[test]
    fn to_uint32_matches_the_unsigned_shift() {
        assert_eq!(to_uint32(-1.0), 0xffff_ffff);
        assert_eq!(to_uint32(-0.0), 0);
        assert_eq!(to_uint32(4294967295.0), 0xffff_ffff);
    }

    #[test]
    fn js_min_max_order_signed_zeros() {
        assert!(js_min(-0.0, 0.0).is_sign_negative());
        assert!(js_min(0.0, -0.0).is_sign_negative());
        assert!(js_max(-0.0, 0.0).is_sign_positive());
        assert!(js_max(0.0, -0.0).is_sign_positive());
        assert!(js_min(f64::NAN, 1.0).is_nan());
        assert!(js_max(f64::NAN, 1.0).is_nan());
    }
}
