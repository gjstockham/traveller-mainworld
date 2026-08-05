/**
 * A PNG encoder, in about two hundred lines and with no dependency.
 *
 * ## Why write one
 *
 * R26 puts the export client-side, so there is no `sharp` and no Node `zlib` on
 * the shipping path; R24 wants the file rendered from generation data, so there
 * is no canvas to `toBlob`. What is left is either `OffscreenCanvas` — browser
 * only, therefore untestable under this repo's standing note that browser
 * measurements do not happen under WSL2 — or this.
 *
 * The one thing an encoder cannot do by hand is deflate, and it does not have
 * to: **`CompressionStream('deflate')` emits exactly the zlib-wrapped stream
 * (RFC 1950) that a PNG `IDAT` chunk holds**, and it is a platform global in
 * Node ≥ 18 and in every target browser. `'deflate-raw'` would be RFC 1951 and
 * wrong here by two header bytes and a checksum; the distinction is the only
 * subtle thing in this file.
 *
 * ## Filtering
 *
 * PNG lets each scanline choose one of five filters, and the choice is worth
 * making: a 4096×2048 RGB map is 24 MB unfiltered, and a planetary surface is
 * smooth at the pixel level, so `Sub`/`Up`/`Paeth` predict it well. The
 * heuristic below is the one the PNG specification itself suggests — pick the
 * filter minimising the sum of absolute *signed* byte values — which is cheap,
 * needs no trial compression, and gets most of the win.
 *
 * ## What is not here
 *
 * No interlacing (a map is not progressively useful), no palette (a planetary
 * surface has far more than 256 colours), no alpha (a map has nothing to see
 * through), and no 16-bit depth (the source is an 8-bit sRGB byte by the time it
 * arrives — see `raster.ts` for where that crossing happens and why).
 */
import type { Raster } from './raster.js';
import { CHANNELS } from './raster.js';

/** PNG's eight-byte signature. */
const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Colour type 2: truecolour RGB, no alpha. */
const COLOUR_TYPE_RGB = 2;

/** CRC-32 table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** PNG's CRC-32, over a byte range. */
export function crc32(bytes: Uint8Array, from = 0, to = bytes.length): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Assemble one PNG chunk: length, type, data, CRC over type+data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** The Paeth predictor, verbatim from the PNG specification. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Apply filter `type` to one scanline, writing `1 + rowBytes` bytes into `out`.
 *
 * `prev` is the *unfiltered* previous scanline, as the specification requires —
 * filtering against the already-filtered bytes is the classic way to produce a
 * file that decodes to noise.
 */
function filterRow(
  row: Uint8Array,
  prev: Uint8Array | undefined,
  type: number,
  out: Uint8Array,
): void {
  const n = row.length;
  out[0] = type;
  for (let i = 0; i < n; i++) {
    const a = i >= CHANNELS ? row[i - CHANNELS]! : 0;
    const b = prev === undefined ? 0 : prev[i]!;
    const c = prev === undefined || i < CHANNELS ? 0 : prev[i - CHANNELS]!;
    let value: number;
    switch (type) {
      case 0: value = row[i]!; break;
      case 1: value = row[i]! - a; break;
      case 2: value = row[i]! - b; break;
      case 3: value = row[i]! - ((a + b) >> 1); break;
      default: value = row[i]! - paeth(a, b, c); break;
    }
    out[1 + i] = value & 0xff;
  }
}

/**
 * The specification's filter heuristic: the smallest sum of absolute values,
 * reading each filtered byte as **signed**.
 *
 * Signed matters. A byte of 0xFF is a difference of −1 and predicts well; read
 * unsigned it would score 255 and the heuristic would reject exactly the rows
 * the filter helps most.
 */
function filterCost(filtered: Uint8Array): number {
  let sum = 0;
  for (let i = 1; i < filtered.length; i++) {
    const v = filtered[i]!;
    sum += v < 128 ? v : 256 - v;
  }
  return sum;
}

/** Filter every scanline, choosing per row. Returns the IDAT payload before deflate. */
export function filterScanlines(raster: Raster): Uint8Array {
  const rowBytes = raster.width * CHANNELS;
  const out = new Uint8Array(raster.height * (rowBytes + 1));
  const candidate = new Uint8Array(rowBytes + 1);
  const best = new Uint8Array(rowBytes + 1);
  let prev: Uint8Array | undefined;

  for (let y = 0; y < raster.height; y++) {
    const row = raster.data.subarray(y * rowBytes, (y + 1) * rowBytes);
    let bestCost = Infinity;
    for (let type = 0; type <= 4; type++) {
      filterRow(row, prev, type, candidate);
      const cost = filterCost(candidate);
      if (cost < bestCost) {
        bestCost = cost;
        best.set(candidate);
      }
    }
    out.set(best, y * (rowBytes + 1));
    prev = row;
  }
  return out;
}

/** Deflate to a zlib stream — RFC 1950, which is what `IDAT` holds. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error(
      'CompressionStream is not available, so no PNG can be written. It is a platform ' +
        'global in Node >= 18 and in every target browser; a host without it is a host ' +
        'this package does not support.',
    );
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode a `tEXt` chunk. Keyword must be Latin-1, 1–79 characters. */
function textChunk(keyword: string, value: string): Uint8Array {
  const encoder = new TextEncoder();
  const k = encoder.encode(keyword);
  // `tEXt` is Latin-1, so anything above 0xFF has to go. Replacing rather than
  // throwing: metadata is a courtesy, and losing an accent from it is not worth
  // failing an export that took a minute to render.
  const v = encoder.encode(value.replace(/[^\x20-\x7e]/g, '?'));
  const data = new Uint8Array(k.length + 1 + v.length);
  data.set(k, 0);
  data[k.length] = 0;
  data.set(v, k.length + 1);
  return chunk('tEXt', data);
}

/**
 * Encode a raster as a PNG.
 *
 * @param metadata `tEXt` key/value pairs. See `titleBlock.ts` for why the title
 *                 block travels in the file as well as on it.
 */
export async function encodePng(
  raster: Raster,
  metadata: readonly (readonly [string, string])[] = [],
): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, raster.width);
  view.setUint32(4, raster.height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = COLOUR_TYPE_RGB;
  ihdr[10] = 0; // compression: deflate, the only value PNG defines
  ihdr[11] = 0; // filter method: the five per-scanline filters above
  ihdr[12] = 0; // interlace: none

  const idat = await deflate(filterScanlines(raster));

  const parts: Uint8Array[] = [SIGNATURE, chunk('IHDR', ihdr)];
  for (const [keyword, value] of metadata) {
    parts.push(textChunk(keyword, value));
  }
  parts.push(chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));

  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Read a PNG's `IHDR` back — width, height, bit depth, colour type.
 *
 * For tests. A round trip through a real decoder would be better evidence and
 * would be a dependency; what this checks is that the container is well formed,
 * which is where a hand-written encoder actually goes wrong.
 */
export function readPngHeader(png: Uint8Array): {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
} {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (png[i] !== SIGNATURE[i]) {
      throw new Error(`byte ${String(i)} is not the PNG signature`);
    }
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (String.fromCharCode(png[12]!, png[13]!, png[14]!, png[15]!) !== 'IHDR') {
    throw new Error('first chunk is not IHDR');
  }
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: png[24]!,
    colourType: png[25]!,
  };
}

/**
 * Walk a PNG's chunks, returning `[type, offset, length]` for each.
 *
 * For tests: it is what lets `png.test.ts` assert that every chunk's CRC is
 * right, which is the property a hand-written encoder is most likely to get
 * wrong and the one a viewer will reject the file for.
 */
export function pngChunks(png: Uint8Array): { type: string; length: number; crcOk: boolean }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; length: number; crcOk: boolean }[] = [];
  let at = SIGNATURE.length;
  while (at + 12 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    const stored = view.getUint32(at + 8 + length);
    out.push({ type, length, crcOk: crc32(png, at + 4, at + 8 + length) === stored });
    at += 12 + length;
    if (type === 'IEND') {
      break;
    }
  }
  return out;
}
