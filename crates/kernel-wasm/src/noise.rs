//! Twin of `packages/core/src/kernel/noise.ts`.

use crate::hash::hash3;
use crate::jsnum::to_int32;
use crate::ops::smootherstep;

/// Largest lattice coordinate magnitude the integer hash addresses without wrapping.
pub const MAX_LATTICE_COORD: f64 = 2147483648.0;

/// True if a coordinate is inside the lattice domain.
#[inline]
pub fn noise_domain_ok(x: f64, y: f64, z: f64) -> bool {
    x.abs() < MAX_LATTICE_COORD && y.abs() < MAX_LATTICE_COORD && z.abs() < MAX_LATTICE_COORD
}

/// Dot product of the offset with one of the 12 cube-edge gradient vectors.
///
/// Perlin's improved gradient set: components are 0 or ±1, so this is pure
/// addition and negation — no multiplies, and no rounding beyond the adds.
/// Negation is written out rather than folded into a multiply by ±1 so that a
/// zero offset keeps its sign, exactly as the TypeScript leaves it.
#[inline]
fn grad(h: u32, x: f64, y: f64, z: f64) -> f64 {
    let g = h & 15;
    let u = if g < 8 { x } else { y };
    let v = if g < 4 {
        y
    } else if g == 12 || g == 14 {
        x
    } else {
        z
    };
    (if (g & 1) == 0 { u } else { -u }) + (if (g & 2) == 0 { v } else { -v })
}

/// Gradient noise at `(x, y, z)` under `seed`, returning `[-1, 1]`.
///
/// The range is a guarantee, not an aspiration: the result is clamped. The
/// clamp is written as nested comparisons rather than `Math.min`/`Math.max`,
/// matching the TypeScript — the two differ on signed zeros.
pub fn gradient_noise3(x: f64, y: f64, z: f64, seed: u32) -> f64 {
    let ix = x.floor();
    let iy = y.floor();
    let iz = z.floor();

    let fx = x - ix;
    let fy = y - iy;
    let fz = z - iz;

    // Quintic fade: zero 1st and 2nd derivatives at the lattice points, so no
    // visible creasing along cell boundaries.
    let u = smootherstep(fx);
    let v = smootherstep(fy);
    let w = smootherstep(fz);

    // `ix | 0` in the TypeScript. ToInt32 wraps; a Rust `as i32` would saturate,
    // and the battery samples coordinates far enough out for that to show.
    let x0 = to_int32(ix);
    let y0 = to_int32(iy);
    let z0 = to_int32(iz);
    let x1 = x0.wrapping_add(1);
    let y1 = y0.wrapping_add(1);
    let z1 = z0.wrapping_add(1);

    let (x0, y0, z0) = (x0 as u32, y0 as u32, z0 as u32);
    let (x1, y1, z1) = (x1 as u32, y1 as u32, z1 as u32);

    let n000 = grad(hash3(x0, y0, z0, seed), fx, fy, fz);
    let n100 = grad(hash3(x1, y0, z0, seed), fx - 1.0, fy, fz);
    let n010 = grad(hash3(x0, y1, z0, seed), fx, fy - 1.0, fz);
    let n110 = grad(hash3(x1, y1, z0, seed), fx - 1.0, fy - 1.0, fz);
    let n001 = grad(hash3(x0, y0, z1, seed), fx, fy, fz - 1.0);
    let n101 = grad(hash3(x1, y0, z1, seed), fx - 1.0, fy, fz - 1.0);
    let n011 = grad(hash3(x0, y1, z1, seed), fx, fy - 1.0, fz - 1.0);
    let n111 = grad(hash3(x1, y1, z1, seed), fx - 1.0, fy - 1.0, fz - 1.0);

    let nx00 = n000 + u * (n100 - n000);
    let nx10 = n010 + u * (n110 - n010);
    let nx01 = n001 + u * (n101 - n001);
    let nx11 = n011 + u * (n111 - n011);

    let nxy0 = nx00 + v * (nx10 - nx00);
    let nxy1 = nx01 + v * (nx11 - nx01);

    let n = nxy0 + w * (nxy1 - nxy0);
    if n < -1.0 {
        -1.0
    } else if n > 1.0 {
        1.0
    } else {
        n
    }
}

/// Absolute-valued ("billowed") noise in `[0, 1]`.
#[inline]
pub fn billow_noise3(x: f64, y: f64, z: f64, seed: u32) -> f64 {
    gradient_noise3(x, y, z, seed).abs()
}

/// Ridged noise in `[0, 1]`, peaking along the zero set of the underlying field.
#[inline]
pub fn ridged_noise3(x: f64, y: f64, z: f64, seed: u32) -> f64 {
    1.0 - gradient_noise3(x, y, z, seed).abs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stays_in_range() {
        let mut peak = 0.0f64;
        let mut i = 0;
        while i < 200_000 {
            let t = (i as f64) * 0.0181;
            let n = gradient_noise3(t, t * 0.37 - 11.25, t * -0.61 + 3.5, 12345);
            assert!(n >= -1.0 && n <= 1.0, "out of range at {t}: {n}");
            if n.abs() > peak {
                peak = n.abs();
            }
            i += 1;
        }
        // The clamp should be doing nothing — if it starts saturating, the
        // gradient set or its normalisation has changed underneath us.
        assert!(peak < 0.999, "peak {peak} is suspiciously close to the clamp");
    }

    #[test]
    fn is_zero_on_the_integer_lattice() {
        // A property of gradient noise, not a defect — but worth pinning, since
        // it is what makes a dyadic base frequency band the terrain.
        for i in -5..5 {
            for j in -5..5 {
                assert_eq!(gradient_noise3(i as f64, j as f64, 3.0, 7), 0.0);
            }
        }
    }
}
