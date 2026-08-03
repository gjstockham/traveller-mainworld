//! Twin of `packages/core/src/kernel/hash.ts`.
//!
//! The TypeScript juggles int32 and uint32 views of the same bits because
//! JavaScript's operators force it to: `|` and `^` yield int32, `>>>` yields
//! uint32. XOR, shift and wrapping multiply are bit operations, so carrying
//! everything as `u32` here is exactly equivalent — the two kernels agree on
//! bits, and only JavaScript needs an opinion about the sign.

/// SplitMix32 finaliser: a bijective avalanche over a 32-bit word.
#[inline]
pub fn mix32(x: u32) -> u32 {
    let mut z = x;
    z ^= z >> 16;
    z = z.wrapping_mul(0x21f0_aaad);
    z ^= z >> 15;
    z = z.wrapping_mul(0x735a_2d97);
    z ^= z >> 15;
    z
}

// Distinct odd multipliers, one per coordinate axis — see the note on seed
// independence in `hash.ts`. Folding the seed in as `mix32(seed ^ x)` would
// make the seed and the x-coordinate interchangeable.
const MUL_X: u32 = 0x27d4_eb2d;
const MUL_Y: u32 = 0x85eb_ca6b;
const MUL_Z: u32 = 0xc2b2_ae35;

/// Pre-mix the seed so it shares no algebraic structure with the coordinates.
#[inline]
fn seed_base(seed: u32) -> u32 {
    mix32(seed)
}

/// Hash one word under a seed.
#[inline]
pub fn hash1(x: u32, seed: u32) -> u32 {
    mix32(seed_base(seed) ^ x.wrapping_mul(MUL_X))
}

/// Hash two words under a seed.
#[inline]
pub fn hash2(x: u32, y: u32, seed: u32) -> u32 {
    let mut h = seed_base(seed);
    h = mix32(h ^ x.wrapping_mul(MUL_X));
    h = mix32(h ^ y.wrapping_mul(MUL_Y));
    h
}

/// Hash a 3D integer lattice point under a seed.
#[inline]
pub fn hash3(x: u32, y: u32, z: u32, seed: u32) -> u32 {
    let mut h = seed_base(seed);
    h = mix32(h ^ x.wrapping_mul(MUL_X));
    h = mix32(h ^ y.wrapping_mul(MUL_Y));
    h = mix32(h ^ z.wrapping_mul(MUL_Z));
    h
}

/// Map a hash to `[0, 1)`. Division by 2³² is exact, so nothing is rounded.
#[inline]
pub fn hash_to_unit(h: u32) -> f64 {
    (h as f64) / 4294967296.0
}

/// Map a hash to `[-1, 1)`.
#[inline]
pub fn hash_to_signed(h: u32) -> f64 {
    (h as f64) / 2147483648.0 - 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mix32_is_a_bijection_on_a_sample() {
        // The finaliser is invertible by construction; a collision would mean
        // a mistyped constant.
        let mut seen = std::collections::HashSet::new();
        for i in 0..100_000u32 {
            assert!(seen.insert(mix32(i)), "collision at {i}");
        }
    }

    #[test]
    fn seed_and_x_are_not_interchangeable() {
        // The bug `seedBase` exists to prevent: with `mix32(seed ^ x)` these
        // two were equal, because 2^117 == 1^118.
        assert_ne!(hash3(117, 3, 4, 2), hash3(118, 3, 4, 1));
    }
}
