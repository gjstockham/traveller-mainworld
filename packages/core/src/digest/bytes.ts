/**
 * Canonical byte encoding of generator output, so that hashes compare like
 * with like across platforms.
 */

/**
 * Encode a `Float64Array` as canonical little-endian bytes.
 *
 * Note this does *not* view `buf.buffer` directly: a typed-array view uses
 * host byte order, so on a big-endian host it would silently produce a
 * different hash for identical values. `DataView` with an explicit
 * `littleEndian` flag is byte-order-correct by construction, which is why
 * there is no endianness probe here.
 *
 * `-0` encodes differently from `+0`, deliberately. If the kernel starts
 * producing a signed zero where it previously produced an unsigned one, that
 * is a real change in behaviour and the golden hash should catch it.
 */
export function canonicalBytes(buf: Float64Array): Uint8Array {
  const out = new Uint8Array(buf.length * 8);
  const view = new DataView(out.buffer);
  for (let i = 0; i < buf.length; i++) {
    view.setFloat64(i * 8, buf[i]!, true);
  }
  return out;
}

/** Encode a `Uint8Array` output buffer. Identity — present for symmetry at call sites. */
export function canonicalBytesU8(buf: Uint8Array): Uint8Array {
  return buf;
}

/** Encode a `Uint32Array` as canonical little-endian bytes. */
export function canonicalBytesU32(buf: Uint32Array): Uint8Array {
  const out = new Uint8Array(buf.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < buf.length; i++) {
    view.setUint32(i * 4, buf[i]!, true);
  }
  return out;
}

/**
 * Assert a generator output buffer contains no NaN or infinity.
 *
 * NaN *bit patterns* are unspecified in both JS and WASM, so a NaN reaching a
 * hash would make that hash unreproducible across engines. Kernel output must
 * be NaN-free by construction; this is the check that proves it rather than
 * assuming it.
 *
 * @throws if any element is NaN or non-finite.
 */
export function assertClean(buf: Float64Array, label = 'buffer'): void {
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]!;
    if (!Number.isFinite(v)) {
      throw new Error(
        `${label}[${i}] is ${Number.isNaN(v) ? 'NaN' : String(v)}; ` +
          'kernel output must be finite (NaN bit patterns are not portable)',
      );
    }
  }
}
