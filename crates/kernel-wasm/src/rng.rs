//! Twin of `packages/core/src/kernel/rng.ts`.
//!
//! The load-bearing property is addressability, not randomness quality: any
//! tile's stream must be derivable from its ID alone, independent of generation
//! order. Tiles arrive on demand across a worker pool, so a generator whose
//! state depends on call history cannot be used.

use crate::hash::mix32;
use crate::jsnum::to_uint32;

/// Number of outputs discarded after seeding, to wash out weak initial states.
const WARMUP_ROUNDS: u32 = 12;

/// sfc32 — "small fast counter". Four 32-bit lanes, no multiplies in the hot path.
pub struct Sfc32 {
    a: u32,
    b: u32,
    c: u32,
    d: u32,
}

impl Sfc32 {
    pub fn new(s0: u32, s1: u32, s2: u32, s3: u32) -> Self {
        let mut r = Sfc32 {
            a: s0,
            b: s1,
            c: s2,
            d: s3,
        };
        // An all-zero state is a fixed point of sfc32; perturb it rather than
        // emitting an endless run of zeros.
        if (r.a | r.b | r.c | r.d) == 0 {
            r.d = 1;
        }
        for _ in 0..WARMUP_ROUNDS {
            r.next_u32();
        }
        r
    }

    /// Construct from a 4-lane seed, as produced by [`stream_seed`].
    pub fn from_seed(seed: [u32; 4]) -> Self {
        Sfc32::new(seed[0], seed[1], seed[2], seed[3])
    }

    /// Next 32-bit output.
    ///
    /// `t` is computed from the *old* `a`, `b` and `d`; each subsequent
    /// assignment then reads the pre-update value of the lane it depends on.
    /// The order is the whole algorithm — reordering two of these lines gives a
    /// generator that still looks random and hashes differently.
    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let t = self.a.wrapping_add(self.b).wrapping_add(self.d);
        self.d = self.d.wrapping_add(1);
        self.a = self.b ^ (self.b >> 9);
        self.b = self.c.wrapping_add(self.c << 3);
        // `(c << 21) | (c >>> 11)` in the TypeScript: a 32-bit rotate.
        self.c = self.c.rotate_left(21);
        self.c = self.c.wrapping_add(t);
        t
    }

    /// Next double in `[0, 1)`. One exact division by a power of two.
    #[inline]
    pub fn next_unit(&mut self) -> f64 {
        (self.next_u32() as f64) / 4294967296.0
    }

    /// Next double in `[lo, hi)`.
    #[inline]
    pub fn next_range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + self.next_unit() * (hi - lo)
    }

    /// Uniform integer in `[0, bound)` by rejection sampling, so no modulo bias.
    ///
    /// The rejection loop is driven by the deterministic stream, so it takes the
    /// same number of iterations on every platform — the branch does not make
    /// the output order-dependent.
    #[inline]
    pub fn next_below(&mut self, bound: u32) -> u32 {
        if bound == 0 {
            return 0;
        }
        let b = bound as u64;
        let limit = (4294967296u64 - (4294967296u64 % b)) as u32;
        let mut v = self.next_u32();
        while v >= limit {
            v = self.next_u32();
        }
        v % bound
    }
}

/// Derive a 4-lane RNG seed for one (world, tile, layer) triple.
///
/// `tile_id` arrives as an `f64` because that is what it is on the JavaScript
/// side: a packed 48-bit key held in a `number`. Splitting it into halves here,
/// rather than accepting a `u64`, keeps the arithmetic identical to the
/// TypeScript instead of merely equivalent.
pub fn stream_seed(world_seed_hi: u32, world_seed_lo: u32, tile_id: f64, layer_id: u32) -> [u32; 4] {
    // Exact for tile_id < 2⁵³: the divisor is a power of two, and `to_uint32`
    // is ECMAScript ToUint32, i.e. truncate then reduce modulo 2³².
    let tile_hi = to_uint32((tile_id / 4294967296.0).floor());
    let tile_lo = to_uint32(tile_id);

    let mut acc: u32 = 0x9e37_79b9;
    acc = mix32(acc ^ world_seed_hi);
    acc = mix32(acc ^ world_seed_lo);
    acc = mix32(acc ^ tile_hi);
    acc = mix32(acc ^ tile_lo);
    acc = mix32(acc ^ layer_id);

    let mut out = [0u32; 4];
    let mut s = acc;
    for slot in out.iter_mut() {
        s = s.wrapping_add(0x9e37_79b9);
        *slot = mix32(s);
    }
    out
}

/// The stream for one (world, tile, layer) triple, ready to draw from.
pub fn tile_rng(world_seed_hi: u32, world_seed_lo: u32, tile_id: f64, layer_id: u32) -> Sfc32 {
    Sfc32::from_seed(stream_seed(world_seed_hi, world_seed_lo, tile_id, layer_id))
}

/// Hash a seed string to a 64-bit value, returned as `[hi, lo]`.
///
/// Input is UTF-16 **code units**, not bytes and not `char`s: the TypeScript
/// iterates `charCodeAt`, so a surrogate pair contributes its two halves
/// separately. Decoding to Unicode scalar values here would hash astral
/// characters differently and the twin would diverge on exactly the seeds a
/// user is most likely to paste in from somewhere else.
pub fn hash_seed_string(code_units: &[u16]) -> [u32; 2] {
    let mut h1: u32 = 0x811c_9dc5;
    let mut h2: u32 = 0x0100_0193;
    for (i, &c) in code_units.iter().enumerate() {
        let c = c as u32;
        h1 = (h1 ^ c).wrapping_mul(0x0100_0193);
        h2 = (h2 ^ c.wrapping_add(i as u32)).wrapping_mul(0x85eb_ca6b);
    }
    [mix32(h1), mix32(h2)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_all_zero_seed_does_not_stick() {
        let mut r = Sfc32::new(0, 0, 0, 0);
        let mut nonzero = 0;
        for _ in 0..64 {
            if r.next_u32() != 0 {
                nonzero += 1;
            }
        }
        assert!(nonzero > 60, "all-zero state degenerated: {nonzero}/64 nonzero");
    }

    #[test]
    fn streams_are_addressable_not_sequential() {
        // Deriving the same tile's stream twice, with unrelated work in
        // between, must give the same values — the property that lets tiles
        // generate out of order across a worker pool.
        let first: Vec<u32> = (0..8).map(|_| tile_rng(1, 2, 12345.0, 0).next_u32()).collect();
        let _noise: Vec<u32> = (0..100).map(|i| tile_rng(1, 2, i as f64, 3).next_u32()).collect();
        let again: Vec<u32> = (0..8).map(|_| tile_rng(1, 2, 12345.0, 0).next_u32()).collect();
        assert_eq!(first, again);
    }

    #[test]
    fn layers_are_independent() {
        assert_ne!(stream_seed(1, 2, 99.0, 0), stream_seed(1, 2, 99.0, 1));
    }

    #[test]
    fn tile_ids_above_2_32_use_their_high_bits() {
        // 2⁴⁰ and 0 differ only above bit 32; if the split dropped the high
        // half, every face would share a stream.
        assert_ne!(stream_seed(1, 2, 1099511627776.0, 0), stream_seed(1, 2, 0.0, 0));
    }
}
