//! Twin of `packages/core/src/kernel/tilegen.ts`.
//!
//! The per-tile generation loop: all of the output-affecting arithmetic in one
//! place. Inputs are primitives rather than a world-spec struct, matching the
//! TypeScript's boundary, so the Phase 1 ruleset interpreter can evolve without
//! touching hashed code in either kernel.

use crate::cubesphere::face_uv_to_direction;
use crate::fbm::{fbm3, fbm_normalisation, FbmParams};

/// Phase 0 material classes. Airless rocky worlds only; water is Phase 2.
pub const MATERIAL_LOWLAND: u8 = 0;
pub const MATERIAL_MIDLAND: u8 = 1;
pub const MATERIAL_HIGHLAND: u8 = 2;
pub const MATERIAL_PEAK: u8 = 3;

/// Everything the kernel needs to generate one tile.
pub struct TileGenInput {
    /// Cube face, 0-5.
    pub face: i32,
    /// Tile extent in face UV space.
    pub u0: f64,
    pub v0: f64,
    pub size: f64,
    /// Grid resolution; the vertex grid is `(n+1)²`.
    pub n: i32,
    /// World seed, as two 32-bit lanes.
    pub seed_hi: u32,
    pub seed_lo: u32,
    /// Terrain field parameters.
    pub fbm: FbmParams,
    /// Peak-to-trough terrain relief, in metres.
    pub amplitude_m: f64,
}

/// Buffers the generator writes into. Caller-owned so they can be pooled.
pub struct TileGenOutput<'a> {
    /// `(n+1)²` elevations in metres relative to the datum.
    pub elevation: &'a mut [f64],
    /// `(n+1)²` flags; always 0 in Phase 0 (airless worlds).
    pub water_mask: &'a mut [u8],
    /// `(n+1)²` material values.
    pub materials: &'a mut [u8],
    /// `3(n+1)²` interleaved unit direction vectors, for the renderer.
    pub directions: &'a mut [f64],
}

/// Generate one tile.
///
/// Every value written is a pure function of 3D position on the sphere and the
/// world seed — nothing depends on which other tiles have been generated, or in
/// what order.
pub fn generate_tile(input: &TileGenInput, out: &mut TileGenOutput<'_>) {
    let n = input.n;
    let count = ((n + 1) as usize) * ((n + 1) as usize);

    assert!(
        out.elevation.len() >= count && out.materials.len() >= count,
        "output buffers hold too few elements for n"
    );

    // The terrain field is seeded from the world seed alone, NOT the tile ID:
    // it must be one continuous field sampled by every tile, not a per-tile
    // field that would discontinue at every boundary.
    let terrain_seed = input.seed_lo ^ input.seed_hi.wrapping_mul(0x9e37_79b1);

    // Normalise so amplitude_m means peak-to-trough relief regardless of octave
    // count, rather than drifting as octaves are added with depth.
    let norm = fbm_normalisation(&input.fbm);
    let scale = if norm == 0.0 { 0.0 } else { input.amplitude_m / norm };

    let nf = n as f64;
    let mut k = 0usize;
    for j in 0..=n {
        let v = input.v0 + ((j as f64) / nf) * input.size;
        for i in 0..=n {
            let u = input.u0 + ((i as f64) / nf) * input.size;
            let d = face_uv_to_direction(input.face, u, v);

            out.directions[k * 3] = d[0];
            out.directions[k * 3 + 1] = d[1];
            out.directions[k * 3 + 2] = d[2];

            let h = fbm3(d[0], d[1], d[2], terrain_seed, &input.fbm) * scale;
            out.elevation[k] = h;

            // Water pass. Trivially empty for airless worlds, but kept in the
            // loop so Phase 2 does not change the shape of the hot path.
            out.water_mask[k] = 0;

            out.materials[k] = classify(h, input.amplitude_m);
            k += 1;
        }
    }
}

/// Elevation-band material classification.
///
/// Bands are fractions of the tile's relief rather than absolute metres, so the
/// classification means the same thing on a Size-1 rockball and a Size-A world.
fn classify(elevation_m: f64, amplitude_m: f64) -> u8 {
    if amplitude_m <= 0.0 {
        return MATERIAL_LOWLAND;
    }
    let t = elevation_m / amplitude_m;
    if t < -0.15 {
        MATERIAL_LOWLAND
    } else if t < 0.1 {
        MATERIAL_MIDLAND
    } else if t < 0.3 {
        MATERIAL_HIGHLAND
    } else {
        MATERIAL_PEAK
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fbm::DEFAULT_FBM;
    use crate::tileid::{make_tile_id, tile_bounds, tile_child, tile_face};

    fn gen(id: f64, n: i32) -> (Vec<f64>, Vec<u8>) {
        let b = tile_bounds(id);
        let count = ((n + 1) * (n + 1)) as usize;
        let mut elevation = vec![0.0f64; count];
        let mut water_mask = vec![0u8; count];
        let mut materials = vec![0u8; count];
        let mut directions = vec![0.0f64; count * 3];
        let input = TileGenInput {
            face: tile_face(id),
            u0: b.u0,
            v0: b.v0,
            size: b.size,
            n,
            seed_hi: 0xdead_beef,
            seed_lo: 0x1234_5678,
            fbm: DEFAULT_FBM,
            amplitude_m: 8000.0,
        };
        let mut out = TileGenOutput {
            elevation: &mut elevation,
            water_mask: &mut water_mask,
            materials: &mut materials,
            directions: &mut directions,
        };
        generate_tile(&input, &mut out);
        (elevation, materials)
    }

    #[test]
    fn a_child_agrees_with_its_parent_at_shared_vertices() {
        // Every second vertex of child 0 coincides with a vertex of the parent.
        // Agreement must be exact: this is the LOD-transition guarantee, and an
        // approximate version of it is a popping artefact.
        let parent = make_tile_id(1, 2, 5.0);
        let child = tile_child(parent, 0);
        let n = 16;
        let (pe, _) = gen(parent, n);
        let (ce, _) = gen(child, n);
        let stride = (n + 1) as usize;
        for j in 0..=(n as usize / 2) {
            for i in 0..=(n as usize / 2) {
                let p = pe[j * stride + i];
                let c = ce[(j * 2) * stride + i * 2];
                assert_eq!(p, c, "parent/child mismatch at ({i}, {j})");
            }
        }
    }

    #[test]
    fn output_is_finite_everywhere() {
        // NaN bit patterns are unspecified in JS and WASM alike, so a single
        // NaN would make the hash unreproducible rather than merely wrong.
        for face in 0..6 {
            let (e, _) = gen(make_tile_id(face, 0, 0.0), 32);
            assert!(e.iter().all(|v| v.is_finite()), "face {face} produced a non-finite elevation");
        }
    }

    #[test]
    fn relief_respects_the_requested_amplitude() {
        let (e, _) = gen(make_tile_id(0, 0, 0.0), 64);
        let mut peak = 0.0f64;
        for v in &e {
            if v.abs() > peak {
                peak = v.abs();
            }
        }
        assert!(peak <= 8000.0, "relief {peak} exceeded the amplitude");
        assert!(peak > 500.0, "relief {peak} is implausibly flat");
    }
}
