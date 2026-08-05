import { interpretText } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { buildExportJob } from '../src/exportMap.js';
import { DEG } from '../src/geography.js';
import type { ExportJob } from '../src/job.js';
import { drawText, fillBox } from '../src/overlay/draw.js';
import {
  GLYPH_HEIGHT,
  GLYPH_TABLE_BYTES,
  GLYPH_WIDTH,
  glyphColumns,
  glyphPixel,
  glyphTableBytes,
  textWidth,
  unprintable,
} from '../src/overlay/font.js';
import {
  MAJOR_STEP_DEG,
  MINOR_STEP_DEG,
  drawGraticule,
} from '../src/overlay/graticule.js';
import { drawTitleBlock, titleLines, titleMetadata } from '../src/overlay/titleBlock.js';
import { equirectangular, mercator } from '../src/projection/index.js';
import { CHANNELS, allocateRaster } from '../src/raster.js';

// --- the font ----------------------------------------------------------------

/** Render one glyph back into the '#'/'.' picture the table encodes. */
function picture(ch: string): string[] {
  const offset = glyphColumns(ch.charCodeAt(0));
  const rows: string[] = [];
  for (let row = 0; row < GLYPH_HEIGHT; row++) {
    let line = '';
    for (let col = 0; col < GLYPH_WIDTH; col++) {
      line += glyphPixel(offset, col, row) ? '#' : '.';
    }
    rows.push(line);
  }
  return rows;
}

describe('the 5x7 font', () => {
  it('covers every printable ASCII code point and nothing else', () => {
    expect(glyphTableBytes()).toBe(GLYPH_TABLE_BYTES);
  });

  // A table of magic hex earns no trust until something decodes it back into a
  // shape. These four are the ones a transcription error would most plausibly
  // land on, and each is asserted as a picture rather than as a byte.
  it('decodes back into the right shapes', () => {
    expect(picture('A')).toEqual([
      '.###.',
      '#...#',
      '#...#',
      '#...#',
      '#####',
      '#...#',
      '#...#',
    ]);
    // The zero's diagonal, which is what distinguishes it from an O.
    expect(picture('0')).toEqual([
      '.###.',
      '#...#',
      '#..##',
      '#.#.#',
      '##..#',
      '#...#',
      '.###.',
    ]);
    expect(picture('O')).toEqual([
      '.###.',
      '#...#',
      '#...#',
      '#...#',
      '#...#',
      '#...#',
      '.###.',
    ]);
    expect(picture('-')).toEqual([
      '.....',
      '.....',
      '.....',
      '#####',
      '.....',
      '.....',
      '.....',
    ]);
    expect(picture(' ')).toEqual(Array(GLYPH_HEIGHT).fill('.....'));
  });

  it('gives every printable character a distinct shape', () => {
    // A transcription error that duplicated a row would make two characters
    // render alike, and `I` against `l` against `1` against `|` is exactly where
    // nobody would notice — a seed of `l1` rendering as `11` on a map is a seed
    // somebody cannot type back in. All 94 are distinct in this table.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (let code = 0x21; code <= 0x7e; code++) {
      const ch = String.fromCharCode(code);
      const key = picture(ch).join('');
      const previous = seen.get(key);
      if (previous !== undefined) {
        clashes.push(`${previous}${ch}`);
      }
      seen.set(key, ch);
    }
    expect(clashes).toEqual([]);
    expect(seen.size).toBe(0x7e - 0x21 + 1);
  });

  it('substitutes a question mark rather than a blank for a character it cannot draw', () => {
    // A blank reads as intentional spacing and hides the fact that a string was
    // not what its author thought.
    expect(picture('°')).toEqual(picture('?'));
    expect(unprintable('deg C +/- 1')).toEqual([]);
    expect(unprintable('85.05° — plate carrée')).toEqual(['°', '—', 'é']);
  });

  it('measures text the way it draws it', () => {
    const raster = allocateRaster({ width: 200, height: 20 });
    const end = drawText(raster.data, 200, 20, 3, 3, 'Hi', [255, 255, 255], 1);
    expect(end - 3).toBe(textWidth('Hi', 1) + 1);
    expect(textWidth('', 2)).toBe(0);
  });
});

describe('drawing', () => {
  it('drops pixels off the edge rather than wrapping them to the other side', () => {
    // An unchecked offset would put the tail of an overlong title on the left of
    // the map, silently, and only on the one export whose title was long.
    //
    // **Probed on the row below the text, not on column 0** — the first version
    // of this test checked column 0 and the wrapping mutation walked straight
    // past it, because an overrun of `k` columns lands at column `k`, not at
    // column 0. A glyph is seven rows tall, so text drawn at y = 0 must leave
    // row 7 untouched; anything there arrived by wrapping.
    const raster = allocateRaster({ width: 16, height: 8 });
    drawText(raster.data, 16, 8, 13, 0, 'WWWW', [255, 255, 255], 1);
    for (let px = 0; px < 16; px++) {
      expect(raster.data[(7 * 16 + px) * CHANNELS]!).toBe(0);
    }
    // And the part that is on the map really was drawn, so this is not passing
    // by drawing nothing at all.
    let ink = 0;
    for (let i = 0; i < raster.data.length; i += CHANNELS) {
      if (raster.data[i]! > 0) {
        ink++;
      }
    }
    expect(ink).toBeGreaterThan(5);
  });

  it('blends rather than replacing at partial opacity', () => {
    const raster = allocateRaster({ width: 4, height: 1 });
    raster.data.fill(100);
    fillBox(raster.data, 4, 1, 0, 0, 4, 1, [200, 200, 200], 0.5);
    expect(raster.data[0]!).toBe(150);
    fillBox(raster.data, 4, 1, 0, 0, 4, 1, [0, 0, 0], 1);
    expect(raster.data[0]!).toBe(0);
  });
});

// --- the graticule -----------------------------------------------------------

describe('the graticule', () => {
  /** Count pixels in row `py` that were changed from a flat background. */
  function markedInRow(data: Uint8Array, width: number, py: number, background: number): number {
    let count = 0;
    for (let px = 0; px < width; px++) {
      if (data[(py * width + px) * CHANNELS]! !== background) {
        count++;
      }
    }
    return count;
  }

  function markedInColumn(
    data: Uint8Array,
    width: number,
    height: number,
    px: number,
    background: number,
  ): number {
    let count = 0;
    for (let py = 0; py < height; py++) {
      if (data[(py * width + px) * CHANNELS]! !== background) {
        count++;
      }
    }
    return count;
  }

  it('draws 23 meridians on an equirectangular map, not 24', () => {
    // 360/15 is 24 lines, and the one at the antimeridian falls on the map's own
    // left edge where column 0 has no left neighbour to be compared against —
    // and where a line would be invisible anyway. Asserted at the real count so
    // that a future off-by-one is a failure rather than a shrug.
    const raster = allocateRaster({ width: 720, height: 360 });
    raster.data.fill(64);
    drawGraticule(raster, equirectangular());

    let meridians = 0;
    for (let px = 0; px < raster.width; px++) {
      // A meridian marks (almost) every row; a parallel marks only one pixel of
      // this column, so the threshold separates them cleanly.
      if (markedInColumn(raster.data, raster.width, raster.height, px, 64) > raster.height / 2) {
        meridians++;
      }
    }
    expect(meridians).toBe(360 / MINOR_STEP_DEG - 1);
  });

  it('draws 11 parallels, the equator among them, and not the poles', () => {
    const raster = allocateRaster({ width: 720, height: 360 });
    raster.data.fill(64);
    drawGraticule(raster, equirectangular());

    const parallelRows: number[] = [];
    for (let py = 0; py < raster.height; py++) {
      if (markedInRow(raster.data, raster.width, py, 64) > raster.width / 2) {
        parallelRows.push(py);
      }
    }
    // 180/15 is 12 boundaries, two of which are the poles themselves and lie on
    // the map's outer edges with no row above them.
    expect(parallelRows).toHaveLength(180 / MINOR_STEP_DEG - 1);
    // The equator is the middle row of an even-height map's lower half.
    expect(parallelRows).toContain(raster.height / 2);
  });

  it('draws 30 degree lines more strongly than 15 degree lines', () => {
    const raster = allocateRaster({ width: 720, height: 360 });
    raster.data.fill(64);
    drawGraticule(raster, equirectangular());

    const at = (lonDeg: number): number => {
      const px = Math.round(((lonDeg + 180) / 360) * raster.width);
      return raster.data[(100 * raster.width + px) * CHANNELS]!;
    };
    // 30 and -30 are major; 15 and -15 are minor. A brighter ink means a higher
    // byte over a dark background.
    expect(at(-MAJOR_STEP_DEG)).toBeGreaterThan(at(-MINOR_STEP_DEG));
    expect(at(-MINOR_STEP_DEG)).toBeGreaterThan(64);
  });

  it('draws a graticule on Mercator too, with the same code and no line-drawing', () => {
    const raster = allocateRaster({ width: 256, height: 256 });
    raster.data.fill(64);
    drawGraticule(raster, mercator());
    let marked = 0;
    for (let i = 0; i < raster.data.length; i += CHANNELS) {
      if (raster.data[i]! !== 64) {
        marked++;
      }
    }
    expect(marked).toBeGreaterThan(1000);
  });

  it('spaces Mercator parallels unevenly, which is the projection showing through', () => {
    // If the graticule were drawn from a table of pixel rows rather than from
    // the inverse projection, Mercator's parallels would come out evenly spaced
    // — and would be wrong in a way that looks tidy.
    const raster = allocateRaster({ width: 64, height: 512 });
    raster.data.fill(64);
    drawGraticule(raster, mercator());

    const rows: number[] = [];
    for (let py = 0; py < raster.height; py++) {
      if (markedInRow(raster.data, raster.width, py, 64) > raster.width / 2) {
        rows.push(py);
      }
    }
    expect(rows.length).toBeGreaterThan(4);
    const gaps = rows.slice(1).map((row, i) => row - rows[i]!);
    // The gap at the equator is the smallest; the gap nearest the clip is the
    // largest, and by a wide margin.
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) * 2);
  });

  it('uses floor rather than round, so a line lands on its own latitude', () => {
    // With `round` the cell would change half an interval away from the line, so
    // the graticule would be drawn at 7.5, 22.5, 37.5 degrees — an off-by-one
    // that looks like a projection bug and is not.
    const raster = allocateRaster({ width: 720, height: 360 });
    raster.data.fill(64);
    drawGraticule(raster, equirectangular());
    // 15 degrees north is row 150 of 360 in a 180-degree map; the boundary pixel
    // is the first row whose centre is south of it.
    const expected = Math.ceil(((90 - MINOR_STEP_DEG) / 180) * raster.height);
    expect(markedInRow(raster.data, raster.width, expected, 64)).toBeGreaterThan(
      raster.width / 2,
    );
  });
});

// --- the title block ---------------------------------------------------------

describe('the title block', () => {
  function jobFor(overrides: Record<string, unknown> = {}): ExportJob {
    return buildExportJob(
      { spec: interpretText('C867A69-8'), seedHi: 1, seedLo: 2 },
      {
        upp: 'C867A69-8',
        fixtureId: undefined,
        seedText: 'plateau',
        rulesetId: 'cepheus-1',
        rulesetName: 'Cepheus Engine',
        fidelity: 'Reduced fidelity - Atmosphere 6, Hydrographics 7',
        ...overrides,
      },
      { size: { width: 1024, height: 512 }, projectionId: 'equirectangular' },
    );
  }

  it('states everything R25 and plan §8 ask for', () => {
    const { lines } = titleLines(jobFor(), equirectangular());
    const text = lines.join('\n');
    expect(text).toContain('C867A69-8');
    expect(text).toContain('plateau');
    expect(text).toMatch(/generator\s+0\./);
    expect(text).toContain('cepheus-1');
    expect(text).toContain('Equirectangular');
    expect(text).toContain('1024x512');
    // 1024x512 equirectangular: the finest texel is 2pi/1024, and
    // referenceSpacing(2) is (pi/2)/(4*64) — the same double, so depth 2.
    expect(text).toMatch(/detail depth\s+2 /);
  });

  it('says on the map that a badged world is badged', () => {
    // Not in plan §8's list, and it belongs there: an exported map of a Hydro-7
    // world with no ocean and nothing to say why is a map whose missing ocean
    // gets filed as a bug against the exporter, by someone holding the PNG.
    const { lines, caveatLine } = titleLines(jobFor(), equirectangular());
    expect(caveatLine).toBeGreaterThan(0);
    expect(lines[caveatLine]!).toContain('Reduced fidelity');
    expect(lines[caveatLine]!).toContain('Atmosphere 6');
  });

  it('omits the caveat line entirely for a full-fidelity world', () => {
    const { lines, caveatLine } = titleLines(jobFor({ fidelity: undefined }), equirectangular());
    expect(caveatLine).toBe(-1);
    expect(lines.join('\n')).not.toContain('Reduced fidelity');
  });

  it('carries the projection parameters, so a Mercator map says where it clipped', () => {
    const job = buildExportJob(
      { spec: interpretText('X400000-0'), seedHi: 1, seedLo: 2 },
      {
        upp: 'X400000-0', fixtureId: undefined, seedText: '1',
        rulesetId: 'cepheus-1', rulesetName: 'Cepheus Engine', fidelity: undefined,
      },
      { size: { width: 512, height: 512 }, projectionId: 'mercator' },
    );
    const text = titleLines(job, mercator()).lines.join('\n');
    expect(text).toContain('poles are not on this map');
    expect(text).toContain('85.0511');
  });

  it('names a fixture rather than a UPP on the fixture route', () => {
    const text = titleLines(
      jobFor({ upp: undefined, fixtureId: 'size4-luna', rulesetId: undefined, rulesetName: undefined }),
      equirectangular(),
    ).lines.join('\n');
    expect(text).toContain('fixture size4-luna');
    expect(text).toContain('pinned rather than interpreted');
  });

  it('marks an overridden depth as overridden', () => {
    const job = buildExportJob(
      { spec: interpretText('X400000-0'), seedHi: 1, seedLo: 2 },
      {
        upp: 'X400000-0', fixtureId: undefined, seedText: '1',
        rulesetId: 'cepheus-1', rulesetName: 'Cepheus Engine', fidelity: undefined,
      },
      { size: { width: 512, height: 256 }, projectionId: 'equirectangular', depth: 9 },
    );
    expect(titleLines(job, equirectangular()).lines.join('\n')).toMatch(/9 \(overridden\)/);
  });

  it('says the depth governs nothing visible, because it does not', () => {
    // The number would otherwise be read as having shaped the picture. It has
    // not: the albedo field is depth-invariant by WP11's design, and relief is
    // not exported at all — which is the fact a reader comparing this map to the
    // 3D view most needs.
    const text = titleLines(jobFor(), equirectangular()).lines.join('\n');
    expect(text).toContain('albedo is depth-invariant');
    expect(text).toContain('relief is not exported');
  });

  it('refuses a line the font cannot draw rather than rendering a question mark', () => {
    expect(() => titleLines(jobFor({ seedText: 'café' }), equirectangular())).toThrow(
      /cannot draw/,
    );
  });

  it('draws into the bottom-left corner and leaves the rest of the map alone', () => {
    const raster = allocateRaster({ width: 1024, height: 512 });
    raster.data.fill(200);
    drawTitleBlock(raster, jobFor(), equirectangular());

    const changed = (px: number, py: number): boolean =>
      raster.data[(py * raster.width + px) * CHANNELS]! !== 200;
    expect(changed(20, raster.height - 20)).toBe(true);
    expect(changed(raster.width - 20, 20)).toBe(false);
    expect(changed(raster.width - 20, raster.height - 20)).toBe(false);
    expect(changed(20, 20)).toBe(false);
  });

  it('travels in the PNG metadata as well as on the map', () => {
    // A map pasted into a wiki gets cropped, and the title block is the first
    // thing to go. The generator version is the one identity R15 makes useless
    // if nobody can tell which build made the file.
    const metadata = titleMetadata(jobFor(), equirectangular());
    const keys = metadata.map(([k]) => k);
    expect(keys).toContain('Software');
    expect(keys).toContain('Description');
    expect(metadata.find(([k]) => k === 'Description')![1]).toContain('C867A69-8');
    expect(metadata.find(([k]) => k === 'Software')![1]).toMatch(/traveller-mainworld 0\./);
  });

  it('scales with the image, so a 4096-wide map is not annotated in 7px text', () => {
    const wide = allocateRaster({ width: 4096, height: 2048 });
    const narrow = allocateRaster({ width: 512, height: 256 });
    wide.data.fill(200);
    narrow.data.fill(200);
    drawTitleBlock(wide, jobFor(), equirectangular());
    drawTitleBlock(narrow, jobFor(), equirectangular());

    // Probed a fifth of the way up from the bottom, which is inside the panel
    // at either scale — the panel's own inset scales too, so a fixed offset from
    // the bottom edge falls outside it on the larger map.
    const panelWidth = (raster: typeof wide): number => {
      let widest = 0;
      const py = raster.height - Math.round(raster.height * 0.02) - 1;
      for (let px = 0; px < raster.width; px++) {
        if (raster.data[(py * raster.width + px) * CHANNELS]! !== 200) {
          widest = px;
        }
      }
      return widest;
    };
    expect(panelWidth(wide) / wide.width).toBeGreaterThan(panelWidth(narrow) / narrow.width / 2);
  });
});

it('DEG is a degree', () => {
  expect(180 * DEG).toBeCloseTo(Math.PI, 15);
});
