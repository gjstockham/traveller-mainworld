/**
 * Adversarial input generation for the determinism battery.
 *
 * A uniform sweep over a friendly range proves very little. The values that
 * actually differ between engines — if any do — live at the edges: denormals,
 * signed zeros, the last representable bits either side of a boundary, and
 * magnitudes far from 1 where relative and absolute spacing diverge. The spike
 * plan calls for these explicitly, because "low risk" is not "no risk" when the
 * promise is bit-identical output forever.
 */

/** One ulp above `x`, by direct bit manipulation. */
export function nextAfter(x: number, up: boolean): number {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  // Treat the 64 bits as a pair and step the low word, carrying into the high.
  let nhi = hi;
  let nlo = lo;
  const increasing = up === x >= 0;
  if (increasing) {
    nlo = (lo + 1) >>> 0;
    if (nlo === 0) {
      nhi = (hi + 1) >>> 0;
    }
  } else {
    if (lo === 0) {
      nhi = (hi - 1) >>> 0;
      nlo = 0xffffffff;
    } else {
      nlo = (lo - 1) >>> 0;
    }
  }
  buf.setUint32(0, nhi);
  buf.setUint32(4, nlo);
  return buf.getFloat64(0);
}

/**
 * Values chosen to break things: signed zeros, denormals, the normal/denormal
 * boundary, exact powers of two and their neighbours, and magnitudes at both
 * extremes of the double range.
 */
export const EDGE_VALUES: readonly number[] = Object.freeze([
  0,
  -0,
  Number.MIN_VALUE, // smallest denormal
  -Number.MIN_VALUE,
  Number.MIN_VALUE * 2,
  5e-324,
  2.2250738585072009e-308, // largest denormal
  2.2250738585072014e-308, // smallest normal
  -2.2250738585072014e-308,
  Number.EPSILON,
  -Number.EPSILON,
  1 - Number.EPSILON / 2,
  1,
  -1,
  1 + Number.EPSILON,
  0.5,
  -0.5,
  0.25,
  1 / 3,
  2 / 3,
  0.1,
  0.7853981633974483, // π/4
  -0.7853981633974483,
  1.5707963267948966, // π/2
  2,
  -2,
  3,
  10,
  1e6,
  -1e6,
  1e15,
  1e16, // above the exactly-representable integer range
  Number.MAX_SAFE_INTEGER,
  1e300,
  -1e300,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
]);

/**
 * A deterministic, engine-independent sequence of test inputs.
 *
 * Deliberately not `Math.random`: the battery must sample exactly the same
 * points on every platform, or comparing hashes across platforms is
 * meaningless.
 *
 * The sequence interleaves the {@link EDGE_VALUES}, their immediate ulp
 * neighbours, values straddling integer boundaries (where `Math.floor` in the
 * noise lattice changes cell), and an irrational-strided sweep that never
 * repeats a lattice alignment.
 */
export function* adversarialInputs(count: number, spread = 1): Generator<number> {
  let emitted = 0;

  // Non-finite values are filtered out, deliberately and non-obviously.
  //
  // `nextAfter(Number.MAX_VALUE, true)` is Infinity, and feeding that to the
  // noise lattice gives `Infinity - Infinity = NaN`. NaN *bit patterns* are
  // unspecified in both JS and WASM, so a NaN reaching a hash makes that hash
  // unreproducible — two runs of this very battery on one machine produced
  // different hashes for `noise.gradient3` before this filter existed. Kernel
  // inputs are contractually finite; testing outside the contract would bake
  // an unhashable value into the manifest and destroy the comparison the
  // battery exists to make.
  const emit = function* (v: number): Generator<number> {
    if (Number.isFinite(v)) {
      yield v;
      emitted++;
    }
  };

  for (const v of EDGE_VALUES) {
    if (emitted >= count) return;
    yield* emit(v * spread);
    if (Number.isFinite(v) && v !== 0) {
      if (emitted >= count) return;
      yield* emit(nextAfter(v, true) * spread);
      if (emitted >= count) return;
      yield* emit(nextAfter(v, false) * spread);
    }
  }

  // Either side of integer boundaries: where the noise lattice cell changes,
  // and the most likely place for an off-by-one-ulp difference to show up as a
  // visible discontinuity.
  for (let n = -40; n <= 40; n++) {
    for (const d of [nextAfter(n, false), n, nextAfter(n, true)]) {
      if (emitted >= count) return;
      yield* emit(d * spread);
    }
  }

  // Irrational stride, so successive samples never align with the lattice or
  // with each other.
  const STRIDE = 0.6180339887498949; // 1/φ
  let acc = 0;
  while (emitted < count) {
    acc += STRIDE;
    // Fold into a wide range rather than growing without bound.
    const t = acc % 977;
    yield* emit((t - 488.5) * spread);
  }
}

/** Collect `count` adversarial inputs into an array. */
export function adversarialArray(count: number, spread = 1): Float64Array {
  const out = new Float64Array(count);
  let i = 0;
  for (const v of adversarialInputs(count, spread)) {
    out[i++] = v;
  }
  return out;
}
