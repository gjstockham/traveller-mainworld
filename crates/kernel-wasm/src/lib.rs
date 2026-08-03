//! Rust→wasm32 twin of `packages/core/src/kernel`.
//!
//! # Why this crate exists
//!
//! Spike A asks whether a pure-TypeScript kernel can promise bit-identical
//! output on every engine forever. Building the kernel a second time, in a
//! different language, answers a sharper question than running the first one
//! twice: the two implementations must hash identically **to each other**, not
//! merely be self-consistent. A shared bug survives repetition; it rarely
//! survives translation. That mutual check is the deliverable.
//!
//! # The exported surface
//!
//! Raw `#[no_mangle] pub extern "C"` functions over linear memory — no
//! wasm-bindgen, no wasm-pack. Those tools would generate glue that sits
//! between this source and the float operations it is being judged on, and
//! `--target web` in particular rewrites the module in ways nobody reviews.
//! The binding on the JavaScript side is a hundred lines of `DataView` work
//! instead, which is a price worth paying to keep codegen out of the loop.
//!
//! Scalar functions take and return values directly. Anything producing more
//! than one number writes through a pointer into linear memory that the caller
//! obtained from [`tm_alloc`].
//!
//! # Rules that silently destroy the guarantee
//!
//! * **Never enable `relaxed-simd`.** It is nondeterministic *by design* — the
//!   spec permits an implementation to choose between FMA and separate
//!   multiply-add per instruction. Fixed-width `simd128` is fine.
//!   `scripts/check-wasm-flags.mjs` asserts on the effective build flags.
//! * **Never call Rust's libm** (`f64::sin`, `powf`, `mul_add`, …). Those are
//!   deterministic *within* WASM, which is exactly what makes them tempting and
//!   exactly why they are wrong: this crate has to match the *TypeScript*
//!   kernel, which evaluates polynomial approximations. `f64::sqrt` and
//!   `f64::abs`/`floor`/`trunc` are permitted — they compile to spec-exact WASM
//!   instructions. `scripts/check-kernel-whitelist.mjs` enforces the ban.
//! * **Never recompute `OCTAVE_ROTATIONS`.** It is a committed generated
//!   artefact; `scripts/gen-wasm-rotations.mjs` transcribes it.

pub mod approx;
pub mod cubesphere;
pub mod fbm;
pub mod hash;
pub mod jsnum;
pub mod noise;
pub mod ops;
pub mod rng;
pub mod rotations;
pub mod tilegen;
pub mod tileid;

use core::slice;

use fbm::FbmParams;
use rng::Sfc32;
use tilegen::{TileGenInput, TileGenOutput};

// --- linear memory ------------------------------------------------------------

/// Allocate `size` bytes, 8-aligned so `f64` views are valid at the returned
/// address. Returns 0 on failure.
///
/// # Safety
/// The caller owns the block until it passes the same pointer and size to
/// [`tm_free`].
#[no_mangle]
pub extern "C" fn tm_alloc(size: usize) -> *mut u8 {
    if size == 0 {
        return core::ptr::null_mut();
    }
    match core::alloc::Layout::from_size_align(size, 8) {
        Ok(layout) => unsafe { std::alloc::alloc(layout) },
        Err(_) => core::ptr::null_mut(),
    }
}

/// Release a block obtained from [`tm_alloc`].
///
/// # Safety
/// `ptr` and `size` must be exactly those of a live [`tm_alloc`] block.
#[no_mangle]
pub unsafe extern "C" fn tm_free(ptr: *mut u8, size: usize) {
    if ptr.is_null() || size == 0 {
        return;
    }
    if let Ok(layout) = core::alloc::Layout::from_size_align(size, 8) {
        std::alloc::dealloc(ptr, layout);
    }
}

/// ABI version of this module.
///
/// The JavaScript binding checks it at instantiation. A stale `.wasm` left in a
/// build directory would otherwise be loaded happily and produce a parity
/// failure that reads like a determinism bug rather than a build problem.
#[no_mangle]
pub extern "C" fn tm_abi_version() -> u32 {
    1
}

// --- ops ----------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn tm_pow2(x: f64) -> f64 {
    ops::pow2(x)
}

#[no_mangle]
pub extern "C" fn tm_pow3(x: f64) -> f64 {
    ops::pow3(x)
}

#[no_mangle]
pub extern "C" fn tm_powi(x: f64, n: i32) -> f64 {
    ops::powi(x, n)
}

#[no_mangle]
pub extern "C" fn tm_clamp(x: f64, lo: f64, hi: f64) -> f64 {
    ops::clamp(x, lo, hi)
}

#[no_mangle]
pub extern "C" fn tm_lerp(a: f64, b: f64, t: f64) -> f64 {
    ops::lerp(a, b, t)
}

#[no_mangle]
pub extern "C" fn tm_smoothstep(t: f64) -> f64 {
    ops::smoothstep(t)
}

#[no_mangle]
pub extern "C" fn tm_smootherstep(t: f64) -> f64 {
    ops::smootherstep(t)
}

// --- hash ---------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn tm_mix32(x: u32) -> u32 {
    hash::mix32(x)
}

#[no_mangle]
pub extern "C" fn tm_hash1(x: u32, seed: u32) -> u32 {
    hash::hash1(x, seed)
}

#[no_mangle]
pub extern "C" fn tm_hash2(x: u32, y: u32, seed: u32) -> u32 {
    hash::hash2(x, y, seed)
}

#[no_mangle]
pub extern "C" fn tm_hash3(x: u32, y: u32, z: u32, seed: u32) -> u32 {
    hash::hash3(x, y, z, seed)
}

#[no_mangle]
pub extern "C" fn tm_hash_to_unit(h: u32) -> f64 {
    hash::hash_to_unit(h)
}

#[no_mangle]
pub extern "C" fn tm_hash_to_signed(h: u32) -> f64 {
    hash::hash_to_signed(h)
}

// --- approx -------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn tm_tan_core(x: f64) -> f64 {
    approx::tan_core(x)
}

#[no_mangle]
pub extern "C" fn tm_atan_core(x: f64) -> f64 {
    approx::atan_core(x)
}

#[no_mangle]
pub extern "C" fn tm_tan_warp(u: f64) -> f64 {
    approx::tan_warp(u)
}

#[no_mangle]
pub extern "C" fn tm_atan_warp_inverse(t: f64) -> f64 {
    approx::atan_warp_inverse(t)
}

#[no_mangle]
pub extern "C" fn tm_rational_bump(r2: f64, k: f64) -> f64 {
    approx::rational_bump(r2, k)
}

#[no_mangle]
pub extern "C" fn tm_compact_falloff(r: f64) -> f64 {
    approx::compact_falloff(r)
}

/// `tan(π/4)` as this kernel computes it — the divisor that makes `tan_warp(±1)`
/// exactly ±1. Exported so the parity harness can compare it bit-for-bit with
/// the TypeScript's, rather than inferring agreement from downstream hashes.
#[no_mangle]
pub extern "C" fn tm_tan_at_one() -> f64 {
    approx::TAN_AT_ONE
}

// --- noise and fBm ------------------------------------------------------------

#[no_mangle]
pub extern "C" fn tm_gradient_noise3(x: f64, y: f64, z: f64, seed: u32) -> f64 {
    noise::gradient_noise3(x, y, z, seed)
}

#[no_mangle]
pub extern "C" fn tm_billow_noise3(x: f64, y: f64, z: f64, seed: u32) -> f64 {
    noise::billow_noise3(x, y, z, seed)
}

#[no_mangle]
pub extern "C" fn tm_ridged_noise3(x: f64, y: f64, z: f64, seed: u32) -> f64 {
    noise::ridged_noise3(x, y, z, seed)
}

#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "C" fn tm_fbm3(
    x: f64,
    y: f64,
    z: f64,
    seed: u32,
    octaves: f64,
    frequency: f64,
    amplitude: f64,
    lacunarity: f64,
    gain: f64,
) -> f64 {
    fbm::fbm3(
        x,
        y,
        z,
        seed,
        &FbmParams {
            octaves,
            frequency,
            amplitude,
            lacunarity,
            gain,
        },
    )
}

#[no_mangle]
pub extern "C" fn tm_fbm_normalisation(octaves: f64, amplitude: f64, gain: f64) -> f64 {
    fbm::fbm_normalisation(&FbmParams {
        octaves,
        frequency: 1.0,
        amplitude,
        lacunarity: 2.0,
        gain,
    })
}

/// Copy the rotation table into `out` (216 doubles).
///
/// Exported for the parity harness: comparing this table directly turns "the
/// fBm hashes agree" into "the fBm hashes agree *and* both kernels are reading
/// the same matrices", which localises a failure to one side or the other.
///
/// # Safety
/// `out` must point to at least `rotations::OCTAVE_ROTATIONS.len()` writable doubles.
#[no_mangle]
pub unsafe extern "C" fn tm_octave_rotations(out: *mut f64) -> u32 {
    let table = &rotations::OCTAVE_ROTATIONS;
    slice::from_raw_parts_mut(out, table.len()).copy_from_slice(table);
    table.len() as u32
}

// --- rng ----------------------------------------------------------------------

/// Create an sfc32 stream. The returned handle must be released with [`tm_sfc32_free`].
#[no_mangle]
pub extern "C" fn tm_sfc32_new(s0: u32, s1: u32, s2: u32, s3: u32) -> *mut Sfc32 {
    Box::into_raw(Box::new(Sfc32::new(s0, s1, s2, s3)))
}

/// Create the stream for one (world, tile, layer) triple.
#[no_mangle]
pub extern "C" fn tm_tile_rng(hi: u32, lo: u32, tile_id: f64, layer: u32) -> *mut Sfc32 {
    Box::into_raw(Box::new(rng::tile_rng(hi, lo, tile_id, layer)))
}

/// Release a stream handle.
///
/// # Safety
/// `h` must come from [`tm_sfc32_new`] or [`tm_tile_rng`] and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn tm_sfc32_free(h: *mut Sfc32) {
    if !h.is_null() {
        drop(Box::from_raw(h));
    }
}

/// # Safety
/// `h` must be a live stream handle.
#[no_mangle]
pub unsafe extern "C" fn tm_sfc32_next_u32(h: *mut Sfc32) -> u32 {
    (*h).next_u32()
}

/// # Safety
/// `h` must be a live stream handle.
#[no_mangle]
pub unsafe extern "C" fn tm_sfc32_next_unit(h: *mut Sfc32) -> f64 {
    (*h).next_unit()
}

/// # Safety
/// `h` must be a live stream handle.
#[no_mangle]
pub unsafe extern "C" fn tm_sfc32_next_range(h: *mut Sfc32, lo: f64, hi: f64) -> f64 {
    (*h).next_range(lo, hi)
}

/// # Safety
/// `h` must be a live stream handle.
#[no_mangle]
pub unsafe extern "C" fn tm_sfc32_next_below(h: *mut Sfc32, bound: u32) -> u32 {
    (*h).next_below(bound)
}

/// Write the 4-lane seed for one (world, tile, layer) triple into `out`.
///
/// # Safety
/// `out` must point to 4 writable `u32`s.
#[no_mangle]
pub unsafe extern "C" fn tm_stream_seed(hi: u32, lo: u32, tile_id: f64, layer: u32, out: *mut u32) {
    let seed = rng::stream_seed(hi, lo, tile_id, layer);
    slice::from_raw_parts_mut(out, 4).copy_from_slice(&seed);
}

/// Hash a seed string given as UTF-16 code units; writes `[hi, lo]` into `out`.
///
/// Code units, not bytes: the TypeScript walks `charCodeAt`, so the caller must
/// pass what `charCodeAt` would yield, surrogates included.
///
/// # Safety
/// `ptr` must point to `len` readable `u16`s and `out` to 2 writable `u32`s.
#[no_mangle]
pub unsafe extern "C" fn tm_hash_seed_string(ptr: *const u16, len: usize, out: *mut u32) {
    let units = slice::from_raw_parts(ptr, len);
    let h = rng::hash_seed_string(units);
    slice::from_raw_parts_mut(out, 2).copy_from_slice(&h);
}

// --- geometry -----------------------------------------------------------------

/// Write the unit direction for a face UV into `out` as `[x, y, z]`.
///
/// # Safety
/// `out` must point to 3 writable doubles.
#[no_mangle]
pub unsafe extern "C" fn tm_face_uv_to_direction(face: i32, u: f64, v: f64, out: *mut f64) {
    let d = cubesphere::face_uv_to_direction(face, u, v);
    slice::from_raw_parts_mut(out, 3).copy_from_slice(&d);
}

/// Write `[face, u, v]` for a direction into `out`. `face` is written as a double.
///
/// # Safety
/// `out` must point to 3 writable doubles.
#[no_mangle]
pub unsafe extern "C" fn tm_direction_to_face_uv(x: f64, y: f64, z: f64, out: *mut f64) {
    let r = cubesphere::direction_to_face_uv(x, y, z);
    let vals = [r.face as f64, r.u, r.v];
    slice::from_raw_parts_mut(out, 3).copy_from_slice(&vals);
}

/// Fill a `(n+1)²` grid of interleaved xyz directions.
///
/// # Safety
/// `out` must point to at least `3 * (n+1)²` writable doubles.
#[no_mangle]
pub unsafe extern "C" fn tm_tile_vertex_directions(
    face: i32,
    u0: f64,
    v0: f64,
    size: f64,
    n: i32,
    out: *mut f64,
) {
    let count = 3 * ((n + 1) as usize) * ((n + 1) as usize);
    cubesphere::tile_vertex_directions(face, u0, v0, size, n, slice::from_raw_parts_mut(out, count));
}

// --- tile addressing ----------------------------------------------------------

#[no_mangle]
pub extern "C" fn tm_make_tile_id(face: i32, depth: i32, quad_path: f64) -> f64 {
    tileid::make_tile_id(face, depth, quad_path)
}

#[no_mangle]
pub extern "C" fn tm_tile_depth(id: f64) -> i32 {
    tileid::tile_depth(id)
}

#[no_mangle]
pub extern "C" fn tm_tile_face(id: f64) -> i32 {
    tileid::tile_face(id)
}

#[no_mangle]
pub extern "C" fn tm_tile_quad_path(id: f64) -> f64 {
    tileid::tile_quad_path(id)
}

#[no_mangle]
pub extern "C" fn tm_tile_parent(id: f64) -> f64 {
    tileid::tile_parent(id)
}

#[no_mangle]
pub extern "C" fn tm_tile_child(id: f64, child_index: i32) -> f64 {
    tileid::tile_child(id, child_index)
}

/// Write `[u0, v0, size]` for a tile into `out`.
///
/// # Safety
/// `out` must point to 3 writable doubles.
#[no_mangle]
pub unsafe extern "C" fn tm_tile_bounds(id: f64, out: *mut f64) {
    let b = tileid::tile_bounds(id);
    let vals = [b.u0, b.v0, b.size];
    slice::from_raw_parts_mut(out, 3).copy_from_slice(&vals);
}

// --- tile generation ----------------------------------------------------------

/// Number of doubles in the [`tm_generate_tile`] parameter block.
pub const TM_TILE_PARAM_COUNT: usize = 14;

/// Generate one tile.
///
/// Parameters arrive as a block of [`TM_TILE_PARAM_COUNT`] doubles rather than
/// as fourteen arguments, because every one of them is a `number` on the
/// JavaScript side anyway — including the counts and seeds, which are exactly
/// representable. A single typed-array write is both cheaper and easier to keep
/// in step with the binding than a fourteen-argument signature.
///
/// Layout:
///
/// | # | field | | # | field |
/// |---|-------|---|---|-------|
/// | 0 | face | | 7 | *(reserved: tile id)* |
/// | 1 | u0 | | 8 | fbm.octaves |
/// | 2 | v0 | | 9 | fbm.frequency |
/// | 3 | size | | 10 | fbm.amplitude |
/// | 4 | n | | 11 | fbm.lacunarity |
/// | 5 | seedHi | | 12 | fbm.gain |
/// | 6 | seedLo | | 13 | amplitudeM |
///
/// Slot 7 mirrors the TypeScript's `tileId` input, which the Phase 0 terrain
/// pass deliberately does not read: the field must be continuous across tile
/// boundaries, so it is seeded from the world seed alone. Crater bands (Phase 1)
/// will key on it. Keeping the slot occupied means adding them does not shift
/// every index in the binding.
///
/// # Safety
/// `params` must point to [`TM_TILE_PARAM_COUNT`] readable doubles; the four
/// output pointers to buffers of at least `(n+1)²` elements (`3(n+1)²` for
/// `directions`).
#[no_mangle]
pub unsafe extern "C" fn tm_generate_tile(
    params: *const f64,
    elevation: *mut f64,
    water_mask: *mut u8,
    materials: *mut u8,
    directions: *mut f64,
) {
    let p = slice::from_raw_parts(params, TM_TILE_PARAM_COUNT);
    let n = jsnum::to_int32(p[4]);
    let count = ((n + 1) as usize) * ((n + 1) as usize);

    let input = TileGenInput {
        face: jsnum::to_int32(p[0]),
        u0: p[1],
        v0: p[2],
        size: p[3],
        n,
        seed_hi: jsnum::to_uint32(p[5]),
        seed_lo: jsnum::to_uint32(p[6]),
        fbm: FbmParams {
            octaves: p[8],
            frequency: p[9],
            amplitude: p[10],
            lacunarity: p[11],
            gain: p[12],
        },
        amplitude_m: p[13],
    };

    let mut out = TileGenOutput {
        elevation: slice::from_raw_parts_mut(elevation, count),
        water_mask: slice::from_raw_parts_mut(water_mask, count),
        materials: slice::from_raw_parts_mut(materials, count),
        directions: slice::from_raw_parts_mut(directions, count * 3),
    };

    tilegen::generate_tile(&input, &mut out);
}
