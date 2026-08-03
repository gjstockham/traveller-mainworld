export { sha256, sha256Hex, toHex } from './sha256.js';
export {
  assertClean,
  canonicalBytes,
  canonicalBytesU8,
  canonicalBytesU32,
} from './bytes.js';

import { canonicalBytes } from './bytes.js';
import { sha256Hex } from './sha256.js';

/** SHA-256 hex digest of a `Float64Array`, via its canonical little-endian bytes. */
export function hashFloat64(buf: Float64Array): string {
  return sha256Hex(canonicalBytes(buf));
}
