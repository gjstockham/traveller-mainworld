//! Twin of `packages/core/src/kernel/tileid.ts`.
//!
//! Keys are carried as `f64`, not `u64`, because that is what they are on the
//! JavaScript side: `depth (5 bits) | face (3) | quadPath (2 per level)`, 48
//! bits total, packed into a `number` so it can be a `Map` key with no string
//! allocation. Multiplication and division by powers of two are exact in binary
//! floating point, which is what makes the arithmetic form safe — and using the
//! same form here keeps the twin a twin rather than a reimplementation that
//! happens to agree.

/// Maximum quadtree depth. At depth 20 the packed key is 48 bits, inside the
/// 53-bit exactly-representable integer range. Phase 0 needs 6.
pub const MAX_DEPTH: i32 = 20;

/// Number of cube faces.
pub const FACE_COUNT: i32 = 6;

const FACE_SCALE: f64 = 1099511627776.0; // 2^40
const DEPTH_SCALE: f64 = 8796093022208.0; // 2^43

/// Axis-aligned extent of a tile within its face, in `[0, 1]` face UV space.
pub struct TileBounds {
    pub u0: f64,
    pub v0: f64,
    /// Edge length, `2^-depth`.
    pub size: f64,
}

/// Number of distinct quadtree paths at a depth, i.e. `4^depth`.
pub fn quad_path_limit(depth: i32) -> f64 {
    let mut limit = 1.0f64;
    for _ in 0..depth {
        limit *= 4.0;
    }
    limit
}

/// Pack a tile address into a single number.
///
/// Panics on an out-of-range component, where the TypeScript throws. Both are
/// loud; neither can be mistaken for a tile.
pub fn make_tile_id(face: i32, depth: i32, quad_path: f64) -> f64 {
    assert!(
        (0..=MAX_DEPTH).contains(&depth),
        "tile depth outside [0, MAX_DEPTH]"
    );
    assert!((0..FACE_COUNT).contains(&face), "face outside [0, FACE_COUNT)");
    let limit = quad_path_limit(depth);
    assert!(
        quad_path >= 0.0 && quad_path < limit,
        "quadPath outside its range for this depth"
    );
    (depth as f64) * DEPTH_SCALE + (face as f64) * FACE_SCALE + quad_path
}

/// Depth component of a packed tile ID.
#[inline]
pub fn tile_depth(id: f64) -> i32 {
    (id / DEPTH_SCALE).floor() as i32
}

/// Face component of a packed tile ID.
#[inline]
pub fn tile_face(id: f64) -> i32 {
    ((id / FACE_SCALE).floor() % 8.0) as i32
}

/// Quadtree path component of a packed tile ID.
#[inline]
pub fn tile_quad_path(id: f64) -> f64 {
    id % FACE_SCALE
}

/// The parent tile. Panics on a root tile, which has none.
pub fn tile_parent(id: f64) -> f64 {
    let depth = tile_depth(id);
    assert!(depth != 0, "root tiles have no parent");
    make_tile_id(tile_face(id), depth - 1, (tile_quad_path(id) / 4.0).floor())
}

/// One of the four children. Bit 0 selects the upper half in u, bit 1 in v.
pub fn tile_child(id: f64, child_index: i32) -> f64 {
    let depth = tile_depth(id);
    assert!(depth < MAX_DEPTH, "cannot descend below MAX_DEPTH");
    assert!((0..4).contains(&child_index), "childIndex outside [0, 4)");
    make_tile_id(
        tile_face(id),
        depth + 1,
        tile_quad_path(id) * 4.0 + (child_index as f64),
    )
}

/// The tile's extent within its face.
///
/// The path is walked coarsest-to-finest, halving the extent at each level, so
/// every bound is a dyadic rational and therefore exact — adjacent tiles agree
/// on their shared edge coordinate bit-for-bit, a precondition for seamless
/// generation.
pub fn tile_bounds(id: f64) -> TileBounds {
    let depth = tile_depth(id);
    let mut path = tile_quad_path(id);

    // Extract child indices finest-first, since that is the direction division
    // gives them.
    let mut children = [0i32; MAX_DEPTH as usize];
    for slot in children.iter_mut().take(depth as usize) {
        *slot = (path % 4.0) as i32;
        path = (path / 4.0).floor();
    }

    let mut u0 = 0.0f64;
    let mut v0 = 0.0f64;
    let mut size = 1.0f64;
    for i in (0..depth as usize).rev() {
        size /= 2.0;
        let c = children[i];
        if (c & 1) != 0 {
            u0 += size;
        }
        if (c & 2) != 0 {
            v0 += size;
        }
    }

    TileBounds { u0, v0, size }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packing_round_trips_at_the_deepest_supported_level() {
        let path = quad_path_limit(MAX_DEPTH) - 1.0;
        let id = make_tile_id(5, MAX_DEPTH, path);
        // Still an exact integer: the whole reason for the 48-bit budget.
        assert_eq!(id, id.floor());
        assert_eq!(tile_depth(id), MAX_DEPTH);
        assert_eq!(tile_face(id), 5);
        assert_eq!(tile_quad_path(id), path);
    }

    #[test]
    fn children_tile_their_parent_exactly() {
        let parent = make_tile_id(2, 3, 27.0);
        let pb = tile_bounds(parent);
        for c in 0..4 {
            let child = tile_child(parent, c);
            let cb = tile_bounds(child);
            assert_eq!(cb.size * 2.0, pb.size);
            assert!(cb.u0 >= pb.u0 && cb.u0 + cb.size <= pb.u0 + pb.size);
            assert_eq!(tile_parent(child), parent);
        }
        // The four children between them cover the parent with no gap: the
        // union of their u ranges is exactly the parent's.
        let lo = tile_bounds(tile_child(parent, 0));
        let hi = tile_bounds(tile_child(parent, 3));
        assert_eq!(lo.u0, pb.u0);
        assert_eq!(hi.u0 + hi.size, pb.u0 + pb.size);
    }
}
