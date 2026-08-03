//! Twin of `packages/core/src/kernel/cubesphere.ts`.
//!
//! **The seam property.** All generation is a function of the 3D position on
//! the sphere, so tiles are seam-free provided adjacent faces compute
//! *bit-identical* positions along their shared edges. That holds because face
//! edges sit at warped coordinate ±1 and `tan_warp(±1)` is exactly ±1 — see
//! [`crate::approx::TAN_AT_ONE`]. It is not approximately true, and the tests
//! assert exact equality.

use crate::approx::{atan_warp_inverse, tan_warp};

/// Number of cube faces.
pub const FACE_COUNT: i32 = 6;

/// A face coordinate: which face, and where on it in `[0, 1]²`.
pub struct FaceUv {
    pub face: i32,
    pub u: f64,
    pub v: f64,
}

/// Map a warped cube coordinate pair onto the unit cube, per face.
///
/// Standard cubemap axis convention, so face 0 is +X. The handedness matters
/// only in that it must be consistent; the edge-agreement tests pin it down.
#[inline]
fn face_vector(face: i32, s: f64, t: f64) -> [f64; 3] {
    match face {
        0 => [1.0, -t, -s],  // +X
        1 => [-1.0, -t, s],  // -X
        2 => [s, 1.0, t],    // +Y
        3 => [s, -1.0, -t],  // -Y
        4 => [s, -t, 1.0],   // +Z
        5 => [-s, -t, -1.0], // -Z
        // The TypeScript throws here. Trapping is the closest WASM equivalent
        // and, unlike returning NaN, cannot be mistaken for a result.
        _ => panic!("face outside [0, 6)"),
    }
}

/// Face UV in `[0, 1]²` to a unit direction on the sphere.
///
/// The `2u − 1` step is exact for the dyadic rationals that tile bounds
/// produce, so no precision is lost turning a tile coordinate into a position.
#[inline]
pub fn face_uv_to_direction(face: i32, u: f64, v: f64) -> [f64; 3] {
    let s = tan_warp(2.0 * u - 1.0);
    let t = tan_warp(2.0 * v - 1.0);
    let c = face_vector(face, s, t);
    let inv_len = 1.0 / (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt();
    [c[0] * inv_len, c[1] * inv_len, c[2] * inv_len]
}

/// Inverse of [`face_uv_to_direction`]: which face a direction falls on, and where.
///
/// The dominant-axis test decides the face; ties on face boundaries resolve
/// consistently by the comparison order, so a direction exactly on an edge
/// always yields the same face.
pub fn direction_to_face_uv(dx: f64, dy: f64, dz: f64) -> FaceUv {
    let ax = dx.abs();
    let ay = dy.abs();
    let az = dz.abs();

    let face: i32;
    let sc: f64;
    let tc: f64;
    let ma: f64;

    if ax >= ay && ax >= az {
        ma = ax;
        if dx > 0.0 {
            face = 0;
            sc = -dz;
            tc = -dy;
        } else {
            face = 1;
            sc = dz;
            tc = -dy;
        }
    } else if ay >= az {
        ma = ay;
        if dy > 0.0 {
            face = 2;
            sc = dx;
            tc = dz;
        } else {
            face = 3;
            sc = dx;
            tc = -dz;
        }
    } else {
        ma = az;
        if dz > 0.0 {
            face = 4;
            sc = dx;
            tc = -dy;
        } else {
            face = 5;
            sc = -dx;
            tc = -dy;
        }
    }

    let s = sc / ma;
    let t = tc / ma;
    FaceUv {
        face,
        u: (atan_warp_inverse(s) + 1.0) / 2.0,
        v: (atan_warp_inverse(t) + 1.0) / 2.0,
    }
}

/// Write the directions for a `(n+1)²` vertex grid covering a tile into `out`,
/// as interleaved xyz triples.
///
/// Grid coordinates are computed as `u0 + (i/n) * size` with `n` a power of
/// two, keeping every vertex on a dyadic rational — so a vertex shared with a
/// neighbouring tile, at the same or an adjacent LOD, gets bit-identical
/// coordinates and therefore bit-identical terrain.
pub fn tile_vertex_directions(face: i32, u0: f64, v0: f64, size: f64, n: i32, out: &mut [f64]) {
    let needed = 3 * ((n + 1) as usize) * ((n + 1) as usize);
    assert!(out.len() >= needed, "out buffer too small for the vertex grid");
    let nf = n as f64;
    let mut k = 0usize;
    for j in 0..=n {
        let v = v0 + ((j as f64) / nf) * size;
        for i in 0..=n {
            let u = u0 + ((i as f64) / nf) * size;
            let d = face_uv_to_direction(face, u, v);
            out[k] = d[0];
            out[k + 1] = d[1];
            out[k + 2] = d[2];
            k += 3;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adjacent_faces_agree_exactly_along_shared_edges() {
        // Exact, not approximate. One ulp of disagreement here is a visible
        // tear in the terrain along a cube edge, and it would also break the
        // viewer's skirt suppression, which assumes shared edge vertices.
        for i in 0..=64 {
            let t = (i as f64) / 64.0;
            // +X face at u = 1 meets +Z face at u = 0: both are the edge
            // x = z = 1/√2 in cube space.
            let a = face_uv_to_direction(0, 0.0, t); // +X, s = −1  →  z = +1 side
            let b = face_uv_to_direction(4, 1.0, t); // +Z, s = +1
            assert_eq!(a, b, "edge mismatch at t = {t}");
        }
    }

    #[test]
    fn directions_are_unit_length() {
        for face in 0..FACE_COUNT {
            for i in 0..=16 {
                for j in 0..=16 {
                    let d = face_uv_to_direction(face, (i as f64) / 16.0, (j as f64) / 16.0);
                    let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
                    assert!((len - 1.0).abs() < 1e-15, "face {face} length {len}");
                }
            }
        }
    }

    #[test]
    fn face_uv_round_trips_through_a_direction() {
        for face in 0..FACE_COUNT {
            for i in 1..16 {
                for j in 1..16 {
                    let (u, v) = ((i as f64) / 16.0, (j as f64) / 16.0);
                    let d = face_uv_to_direction(face, u, v);
                    let r = direction_to_face_uv(d[0], d[1], d[2]);
                    assert_eq!(r.face, face);
                    assert!((r.u - u).abs() < 1e-14 && (r.v - v).abs() < 1e-14);
                }
            }
        }
    }
}
