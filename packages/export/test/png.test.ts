import { describe, expect, it } from 'vitest';

import { crc32, encodePng, filterScanlines, pngChunks, readPngHeader } from '../src/png.js';
import { CHANNELS, type Raster, allocateRaster } from '../src/raster.js';

/** A raster with structure in it, so the filters and the deflate have something to do. */
function gradient(width: number, height: number): Raster {
  const raster = allocateRaster({ width, height });
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const at = (py * width + px) * CHANNELS;
      raster.data[at] = (px * 3) & 0xff;
      raster.data[at + 1] = (py * 5) & 0xff;
      raster.data[at + 2] = (px + py) & 0xff;
    }
  }
  return raster;
}

/**
 * Decode a PNG's pixels back, so a round trip is a real check and not a
 * structural one.
 *
 * Only the subset this encoder writes: 8-bit truecolour, no interlace, one
 * IDAT. Written here rather than pulled in as a dependency because a dependency
 * would decode a file we did not encode — the point is to read back exactly
 * what `encodePng` produced, filters included, and prove the two agree.
 */
async function decodePng(png: Uint8Array): Promise<Raster> {
  const header = readPngHeader(png);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  const idat: Uint8Array[] = [];
  let at = 8;
  for (;;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    if (type === 'IDAT') {
      idat.push(png.subarray(at + 8, at + 8 + length));
    }
    if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }

  const joined = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
  let cursor = 0;
  for (const part of idat) {
    joined.set(part, cursor);
    cursor += part.length;
  }

  const stream = new Blob([joined as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());

  const rowBytes = header.width * CHANNELS;
  const out = new Uint8Array(header.width * header.height * CHANNELS);
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };

  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (rowBytes + 1)]!;
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[y * (rowBytes + 1) + 1 + i]!;
      const a = i >= CHANNELS ? out[y * rowBytes + i - CHANNELS]! : 0;
      const b = y > 0 ? out[(y - 1) * rowBytes + i]! : 0;
      const c = y > 0 && i >= CHANNELS ? out[(y - 1) * rowBytes + i - CHANNELS]! : 0;
      let value: number;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        default: value = x + paeth(a, b, c); break;
      }
      out[y * rowBytes + i] = value & 0xff;
    }
  }
  return { width: header.width, height: header.height, data: out };
}

describe('the PNG encoder', () => {
  it('round-trips a raster byte for byte', async () => {
    // The check that matters. A structural test — signature present, CRCs right
    // — would pass on a file whose filters were applied against the *filtered*
    // previous row, which is the classic way to write a PNG that decodes to
    // noise. Only decoding it back catches that.
    for (const [w, h] of [[1, 1], [7, 3], [64, 64], [129, 17]] as const) {
      const source = gradient(w, h);
      const decoded = await decodePng(await encodePng(source));
      expect(decoded.width).toBe(w);
      expect(decoded.height).toBe(h);
      expect(Array.from(decoded.data)).toEqual(Array.from(source.data));
    }
  });

  it('writes a well-formed header', async () => {
    const header = readPngHeader(await encodePng(gradient(40, 20)));
    expect(header).toEqual({ width: 40, height: 20, bitDepth: 8, colourType: 2 });
  });

  it('gets every chunk CRC right', async () => {
    // The property a viewer rejects a file for, and the one a hand-written
    // encoder is most likely to get wrong: the CRC covers the type *and* the
    // data, and not the length.
    const chunks = await encodePng(gradient(32, 32), [['Software', 'test']]).then(pngChunks);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND']);
  });

  it('emits a zlib stream, not a raw deflate one', async () => {
    // `CompressionStream('deflate')` is RFC 1950 and `'deflate-raw'` is RFC 1951.
    // PNG's IDAT holds the former, and the difference is two header bytes and a
    // checksum — a file written with the wrong one looks fine until a decoder
    // reads it. The zlib header's first byte is 0x78 for a 32K window.
    const png = await encodePng(gradient(16, 16));
    const chunks = pngChunks(png);
    const idat = chunks.find((c) => c.type === 'IDAT')!;
    let at = 8;
    for (const chunk of chunks) {
      if (chunk === idat) break;
      at += 12 + chunk.length;
    }
    expect(png[at + 8]!).toBe(0x78);
  });

  it('compresses: a planetary map is smooth, so the filters have to earn their keep', async () => {
    // A gradient is the easy case and a flat fill is the trivial one; both would
    // pass with filter 0 everywhere. The assertion is that the file is a
    // fraction of the raw bytes, which is what makes a 4096x2048 map shareable.
    const raster = gradient(256, 256);
    const png = await encodePng(raster);
    expect(png.length).toBeLessThan(raster.data.length / 4);
  });

  it('chooses filters per row rather than using one everywhere', async () => {
    const raster = gradient(64, 64);
    const filtered = filterScanlines(raster);
    const rowBytes = raster.width * CHANNELS;
    const used = new Set<number>();
    for (let y = 0; y < raster.height; y++) {
      used.add(filtered[y * (rowBytes + 1)]!);
    }
    expect(used.size).toBeGreaterThan(1);
  });

  it('reads the signed byte value in the filter heuristic, not the unsigned one', () => {
    // 0xFF is a difference of -1 and predicts perfectly; read unsigned it scores
    // 255 and the heuristic rejects exactly the rows the filter helps most.
    //
    // **Asserted on the chosen filters, not on the file size** — and that is the
    // point of this comment. The first version of this test asserted the PNG was
    // under an eighth of the raw bytes, and the unsigned mutation *passed it*:
    // deflate mops up so much of the redundancy that the file is small either
    // way. A test that cannot tell the two apart is not testing the heuristic.
    //
    // On a field stepping down by one per pixel every Sub difference is 0xFF, so
    // the correct heuristic takes Sub on the first row and Up on the rest; the
    // unsigned one takes None throughout.
    const raster = allocateRaster({ width: 128, height: 128 });
    for (let py = 0; py < 128; py++) {
      for (let px = 0; px < 128; px++) {
        const at = (py * 128 + px) * CHANNELS;
        const v = 255 - ((px + py) & 0xff);
        raster.data[at] = v;
        raster.data[at + 1] = v;
        raster.data[at + 2] = v;
      }
    }

    const filtered = filterScanlines(raster);
    const rowBytes = 128 * CHANNELS;
    const chosen: number[] = [];
    for (let y = 0; y < 128; y++) {
      chosen.push(filtered[y * (rowBytes + 1)]!);
    }
    expect(chosen[0]).toBe(1);
    expect(chosen.slice(1).every((t) => t === 2)).toBe(true);
    expect(chosen).not.toContain(0);
  });

  it('carries tEXt metadata and strips what Latin-1 cannot hold', async () => {
    const png = await encodePng(gradient(8, 8), [['Description', 'Luna — café']]);
    const text = new TextDecoder('latin1').decode(png);
    expect(text).toContain('Description');
    expect(text).toContain('Luna ? caf?');
  });

  it('refuses a file that is not a PNG', () => {
    expect(() => readPngHeader(new Uint8Array(32))).toThrow(/signature/);
  });
});

describe('crc32', () => {
  it('matches the published check value', () => {
    // The standard CRC-32 of "123456789" is 0xCBF43926. A table built with the
    // wrong polynomial produces a self-consistent CRC that no decoder accepts.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('covers only the range it is given', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(crc32(bytes, 1, 4)).toBe(crc32(new Uint8Array([2, 3, 4])));
  });
});
