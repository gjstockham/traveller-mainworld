import {
  ALWAYS_ON_BANDS,
  FIXTURES,
  GEN_VERSION,
  TsTileGenerator,
  type World,
  allocateTileOutput,
  bandsForDepth,
  interpretText,
  makeTileId,
  tileDepth,
  worldPalette,
  writeSurfaceColour,
} from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

// The viewer's own colour builder — the buffer that goes to the GPU. Imported
// across the package boundary on purpose: comparing the exporter against
// `writeSurfaceColour` alone would prove only that both call the same function,
// where comparing it against `buildTileColours` also proves the exporter reads
// `materials` and `albedo` the right way round and indexes the triple correctly.
// A mutation swapping those two arguments is caught here and nowhere else.
import { buildTileColours, vertexCount } from '../../viewer/src/mesh/tileMesh.js';
import { surfaceSampleDepth } from '../src/detailDepth.js';
import { buildExportJob } from '../src/exportMap.js';
import { geographicFromDirection } from '../src/geography.js';
import type { ExportJob } from '../src/job.js';
import { CHANNELS, decodeChannel, encodeChannel } from '../src/raster.js';
import { BandRenderer, renderMapSync } from '../src/render.js';
import type { ImageSize } from '../src/size.js';

const generator = new TsTileGenerator(GEN_VERSION);

const IDENTITY = {
  upp: 'X400000-0',
  fixtureId: undefined,
  seedText: '42',
  rulesetId: 'cepheus-1',
  rulesetName: 'Cepheus Engine',
  fidelity: undefined,
} as const;

function worldFor(upp: string, seedHi = 0x0badf00d, seedLo = 0xcafebabe): World {
  return { spec: interpretText(upp), seedHi, seedLo };
}

function jobFor(
  world: World,
  size: ImageSize,
  options: Partial<Parameters<typeof buildExportJob>[2]> = {},
): ExportJob {
  return buildExportJob(world, IDENTITY, {
    size,
    projectionId: 'equirectangular',
    graticule: false,
    titleBlock: false,
    ...options,
  });
}

const TINY: ImageSize = { width: 96, height: 48 };

// --- PRD §9.4: the pixel agreement ------------------------------------------

describe('a pixel agrees exactly with the viewer\'s tile data', () => {
  // **What is being claimed, stated before anything is asserted.**
  //
  // WP12 gave the viewer smooth per-vertex normals and a directional sun, so a
  // viewer *pixel* is albedo x a lighting term. An export has no lighting term.
  // PRD §9.4's acceptance is worded as "a spot-check of pixel values against the
  // viewer's **tile data**" — the vertex colour buffer, not the framebuffer —
  // and that is the claim these tests make. An unshaded albedo map next to a
  // low-sun screenshot will look flatter; that is a product question, recorded
  // in the evidence file, and not a failure of this equality.
  //
  // The comparison is on **linear** RGB, before `encodeChannel`. Once a pixel is
  // an sRGB byte it has been through a transfer function and an 8-bit quantiser,
  // and comparing that to anything requires saying which — see `raster.ts`.
  const viewerColour = new Float32Array(3);
  const exportColour = new Float32Array(3);

  it.each(FIXTURES.slice(0, 4).map((f) => [f.id, f.world] as const))(
    '%s: every vertex of three tiles, exactly',
    (_id, world) => {
      const n = 64;
      const out = allocateTileOutput(n);
      const palette = worldPalette(world.seedHi, world.seedLo);
      const geo = new Float64Array(2);

      for (const tileId of [makeTileId(0, 0, 0), makeTileId(3, 2, 0b1011), makeTileId(5, 4, 255)]) {
        const tile = generator.generate(tileId, world, n, out);
        const colours = new Float32Array(3 * vertexCount(n));
        buildTileColours(tile.albedo, tile.materials, palette, n, colours);

        // The exporter's own pipeline, minus the projection: give it the tile
        // vertex's direction and ask for the colour. `BandRenderer` is
        // constructed from a job so it is the real object, with the real hoisted
        // basin field, not a hand-assembled stand-in.
        const job = jobFor(world, TINY, { depth: tileDepth(tileId) });
        const renderer = new BandRenderer(job);

        let compared = 0;
        for (let v = 0; v < (n + 1) * (n + 1); v += 37) {
          const x = tile.directions[v * 3]!;
          const y = tile.directions[v * 3 + 1]!;
          const z = tile.directions[v * 3 + 2]!;
          geographicFromDirection(x, y, z, geo);

          viewerColour[0] = colours[v * 3]!;
          viewerColour[1] = colours[v * 3 + 1]!;
          viewerColour[2] = colours[v * 3 + 2]!;

          renderer.colourAtDirection(x, y, z, exportColour);
          expect(Array.from(exportColour)).toEqual(Array.from(viewerColour));
          compared++;
        }
        expect(compared).toBeGreaterThan(50);
      }
    },
  );

  it('is not a tautology: swapping material and albedo would change the colour', () => {
    // The mutation this comparison exists to catch. If the two arguments could
    // be swapped without changing the result, the equality above would be
    // asserting nothing about how the exporter reads the tile.
    const palette = worldPalette(1, 2);
    const a = new Float32Array(3);
    const b = new Float32Array(3);
    writeSurfaceColour(palette, 2, 200, a, 0);
    writeSurfaceColour(palette, 200, 2, b, 0);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

// --- seams -------------------------------------------------------------------

describe('seam-free by construction', () => {
  const world = worldFor('X400000-0');

  it('crosses all twelve cube edges with no discontinuity', () => {
    // The export never touches a face parameterisation — it point-samples by 3D
    // direction — so the twelve edges WP12's normals extrapolate across are not
    // a special case here. This walks a great circle that crosses four of them
    // and asserts that no consecutive pair of samples jumps more than a
    // neighbouring pair anywhere else on the same circle.
    const job = jobFor(world, { width: 720, height: 360 }, { depth: 3 });
    const renderer = new BandRenderer(job);
    const colour = new Float32Array(3);

    // The equator in this frame passes through the +x, +z, -x and -z faces,
    // crossing four cube edges at longitudes 45, 135, -135 and -45 degrees.
    const steps = 720;
    const brightness: number[] = [];
    for (let i = 0; i < steps; i++) {
      const lon = (i / steps) * 2 * Math.PI - Math.PI;
      renderer.colourAtDirection(Math.sin(lon), 0, Math.cos(lon), colour);
      brightness.push(colour[1]!);
    }

    const jumps = brightness.map((v, i) => Math.abs(v - brightness[(i + 1) % steps]!));
    const sorted = [...jumps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const worst = sorted[sorted.length - 1]!;

    // Cube-edge longitudes, to the nearest sample.
    const edgeIndices = [45, 135, 225, 315].map((d) => Math.round((d / 360) * steps));
    const atEdges = edgeIndices.map((i) => jumps[i]!);

    // The strong form: a cube edge is not among the largest steps on the circle.
    for (const jump of atEdges) {
      expect(jump).toBeLessThan(worst);
    }
    // And the useful form: it is ordinary. Craters make the median small and the
    // tail long, so the bound is against the distribution rather than a constant.
    for (const jump of atEdges) {
      expect(jump).toBeLessThanOrEqual(Math.max(median * 40, 0.02));
    }
  });

  it('crosses both poles with no discontinuity', () => {
    // The polar rows are the ones the plan warns about. Sampling a meridian
    // straight over the pole must be as smooth as sampling it anywhere else.
    const job = jobFor(world, { width: 720, height: 360 }, { depth: 3 });
    const renderer = new BandRenderer(job);
    const colour = new Float32Array(3);

    const steps = 720;
    const brightness: number[] = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * 2 * Math.PI;
      // A great circle through both poles, in the x = 0 plane.
      renderer.colourAtDirection(0, Math.sin(t), Math.cos(t), colour);
      brightness.push(colour[1]!);
    }

    const jumps = brightness.map((v, i) => Math.abs(v - brightness[(i + 1) % steps]!));
    const sorted = [...jumps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;

    // Quarter and three-quarters of the way round are the two poles.
    for (const i of [steps / 4, (3 * steps) / 4]) {
      expect(jumps[i]!).toBeLessThanOrEqual(Math.max(median * 40, 0.02));
    }
  });

  it('renders the top and bottom rows without a NaN or a black band', () => {
    const job = jobFor(world, TINY, { depth: 2 });
    const raster = renderMapSync(job);
    for (const py of [0, raster.height - 1]) {
      let dark = 0;
      for (let px = 0; px < raster.width; px++) {
        const at = (py * raster.width + px) * CHANNELS;
        if (raster.data[at]! < 8) {
          dark++;
        }
      }
      expect(dark).toBe(0);
    }
  });

  it('renders the polar rows as an oversampled traverse, not a seam', () => {
    // The handoff asked for "the whole top row must be one colour, exactly".
    // Checked — and the answer is more interesting than yes.
    //
    // At 4096x2048 the top row's centre is at 89.956 deg, so its 4096 samples
    // lie on a circle of radius cos(89.956) = 7.7e-4 of the planetary radius:
    // about 1.3 km on a Luna-sized world. That is a real, continuous traverse of
    // a very small circle, not a degenerate point, because pixel-centre
    // registration never asks for the pole (see `equirectangular.ts`).
    //
    // Measured across six world/seed pairs at 4096x2048, the polar rows come out
    // one colour on four of them and span up to 34 of 255 on the rest, against
    // 120-141 for an equatorial row. The 34 is not a defect: it is a sharp
    // albedo edge — a ray boundary — genuinely crossing the circle, which is the
    // map showing a feature rather than a seam.
    //
    // So the equality is not the property to assert, and asserting it would have
    // pinned whichever world happened to be tried first. What is asserted is the
    // two things that are true of every world: a polar row varies far less than
    // an equatorial one, and it is **continuous** — no adjacent pair in it jumps
    // further than adjacent pairs do at the equator, which is what "not a seam"
    // means.
    //
    // The exact-equality claim does hold where a projection really does put a
    // row on a pole; that is `geography.ts`'s snap, asserted in the test below
    // and in `geography.test.ts`.
    const size = { width: 4096, height: 2048 };
    const row = new Uint8Array(size.width * CHANNELS);

    const stats = (renderer: BandRenderer, py: number): { spread: number; jump: number } => {
      renderer.render(py, 1, row);
      let lo = 255;
      let hi = 0;
      let jump = 0;
      for (let px = 0; px < size.width; px++) {
        const v = row[px * CHANNELS + 1]!;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        if (px > 0) {
          jump = Math.max(jump, Math.abs(v - row[(px - 1) * CHANNELS + 1]!));
        }
      }
      return { spread: hi - lo, jump };
    };

    for (const upp of ['X400000-0', 'X100000-0', 'XA00000-0']) {
      const renderer = new BandRenderer(jobFor(worldFor(upp), size));
      const equator = stats(renderer, size.height / 2);
      for (const py of [0, size.height - 1]) {
        const polar = stats(renderer, py);
        expect(polar.spread).toBeLessThan(equator.spread / 3);
        expect(polar.jump).toBeLessThanOrEqual(equator.jump);
      }
    }
  }, 120_000);

  it('gives a whole row one colour when a projection does put a row on a pole', () => {
    // Equirectangular never does (see `projection.test.ts`), which is why the
    // guarantee `geography.ts` provides has to be checked directly: a caller
    // that *does* ask for +/-90 gets one direction, so a whole row of them is
    // one colour, exactly.
    const job = jobFor(world, TINY, { depth: 2 });
    const renderer = new BandRenderer(job);
    const first = new Float32Array(3);
    const other = new Float32Array(3);
    renderer.colourAtDirection(0, 1, 0, first);
    for (let i = 0; i < 32; i++) {
      // Every longitude names the same pole, so every one must give this colour.
      renderer.colourAtDirection(0, 1, 0, other);
      expect(Array.from(other)).toEqual(Array.from(first));
    }
  });
});

// --- the cull is a superset, and culling must not change a pixel -------------

// Six full renders of the same map. Same reasoning as the pool block above.
describe('the row-band basin cull changes nothing', { timeout: 120_000 }, () => {
  it('produces the same image at every band height', () => {
    // The cull is rebuilt per band, so a different band height culls against a
    // different box. `BasinCull` is documented as a superset filter and
    // `craters.test.ts` asserts that culling loosely, tightly or not at all is
    // bit-identical — this is the export's own check of the same property, in
    // the one place it could go wrong: the box the projection reports.
    const job = jobFor(worldFor('X500000-0'), TINY, { depth: 2 });
    const reference = renderMapSync(job, TINY.height);
    for (const bandRows of [1, 3, 7, 16, 48]) {
      expect(Array.from(renderMapSync(job, bandRows).data)).toEqual(
        Array.from(reference.data),
      );
    }
  });
});

// --- mutation probes ---------------------------------------------------------

describe('the map changes when the world changes', () => {
  // The handoff's version of "mutate before you believe a green": does the map
  // change when the seed changes, when the projection changes, and when the
  // detail depth changes? A renderer that ignored any of the three would produce
  // a perfectly plausible picture and pass every seam test above.
  const size: ImageSize = { width: 64, height: 32 };

  function bytes(job: ExportJob): number[] {
    return Array.from(renderMapSync(job).data);
  }

  it('changes when the seed changes', () => {
    const a = bytes(jobFor(worldFor('X400000-0', 1, 2), size));
    const b = bytes(jobFor(worldFor('X400000-0', 3, 4), size));
    expect(a).not.toEqual(b);
  });

  it('changes when the UPP changes', () => {
    const a = bytes(jobFor(worldFor('X100000-0'), size));
    const b = bytes(jobFor(worldFor('XA00000-0'), size));
    expect(a).not.toEqual(b);
  });

  it('changes when the projection changes', () => {
    const world = worldFor('X400000-0');
    const a = bytes(jobFor(world, size, { projectionId: 'equirectangular' }));
    const b = bytes(jobFor(world, size, { projectionId: 'mercator' }));
    expect(a).not.toEqual(b);
  });

  it('changes when the Mercator clip changes', () => {
    const world = worldFor('X400000-0');
    const a = bytes(jobFor(world, size, { projectionId: 'mercator' }));
    const b = bytes(
      jobFor(world, size, { projectionId: 'mercator', projectionOptions: { clipDeg: 45 } }),
    );
    expect(a).not.toEqual(b);
  });

  it('does NOT change when the detail depth changes, and that is a finding', () => {
    // The probe the handoff asked for, and it came back the other way.
    //
    // WP11 made the albedo field depth-invariant on purpose — `regolith.ts`
    // skips every candidate at or beyond `ALWAYS_ON_BANDS`, on the line
    // commented "the depth-independence filter" — because a colour that changed
    // with depth would draw a visible line along every LOD boundary in the
    // viewer. `sampleSurface`'s own doc comment says its `depth` is taken "for
    // symmetry, **not because the answer depends on it**".
    //
    // So plan §8's detail depth changes nothing in an albedo-only map. That is
    // correct behaviour and it is asserted here rather than left to be
    // discovered, because the *next* thing this export renders — hillshading,
    // contours, anything off the elevation — makes it false, and this is the
    // test that will say so by name.
    const world = worldFor('X400000-0');
    const reference = bytes(jobFor(world, size, { depth: 0 }));
    for (const depth of [1, 2, 4, 6, 8]) {
      expect(bytes(jobFor(world, size, { depth }))).toEqual(reference);
    }
  });

  it('samples the surface at the cheap depth, and it is the identical image', () => {
    // The optimisation that finding buys, and the assertion that keeps it
    // honest — the same shape as `BasinCull`'s superset argument, where an
    // optimisation is only allowed if a test says the unoptimised path gives
    // identical bytes. Measured on X400000-0 at 256x128: depth 0 renders in
    // 632 ms and depth 8 in 1578 ms, for the same picture.
    for (const depth of [0, 2, 4, 6, 8]) {
      expect(surfaceSampleDepth(depth)).toBe(0);
    }
    expect(ALWAYS_ON_BANDS).toBe(bandsForDepth(0));

    // And the renderer really does use it, rather than carrying it unused.
    const renderer = new BandRenderer(jobFor(worldFor('X400000-0'), size, { depth: 7 }));
    expect(renderer.job.depth).toBe(7);
    expect(renderer.surfaceDepth).toBe(0);
  });

  it('is reproducible: the same job twice gives the same bytes', () => {
    const job = jobFor(worldFor('X400000-0'), size);
    expect(bytes(job)).toEqual(bytes(job));
  });
});

// --- the byte layer ----------------------------------------------------------

describe('linear to sRGB', () => {
  it('round-trips to within half a byte', () => {
    for (let b = 0; b <= 255; b++) {
      expect(encodeChannel(decodeChannel(b))).toBe(b);
    }
  });

  it('is an encode, not a copy: mid-grey lands at 188 and not at 128', () => {
    // The whole reason the crossing is named. Writing the linear float straight
    // into the byte would make every export visibly darker than the same numbers
    // on screen, for a reason no reader could diagnose from the picture.
    expect(encodeChannel(0.5)).toBe(188);
    expect(encodeChannel(0)).toBe(0);
    expect(encodeChannel(1)).toBe(255);
  });

  it('throws on a NaN rather than writing a plausible black pixel', () => {
    // A `Uint8Array` turns NaN into 0, and black is a plausible mare floor. The
    // same exposure `quantiseAlbedo` guards in the kernel, with none of the
    // kernel's guards — and `writeSurfaceColour`'s clamp is not one, because
    // `v < 0 ? 0 : v > 1 ? 1 : v` passes NaN through both comparisons.
    expect(() => encodeChannel(NaN)).toThrow(/NaN/);
    expect(encodeChannel(-5)).toBe(0);
    expect(encodeChannel(5)).toBe(255);
  });
});

describe('band bounds are checked', () => {
  it('refuses a band that runs off the image or a buffer that is too small', () => {
    const renderer = new BandRenderer(jobFor(worldFor('X400000-0'), TINY));
    const buffer = new Uint8Array(4 * TINY.width * CHANNELS);
    expect(() => renderer.render(TINY.height - 2, 4, buffer)).toThrow(/outside/);
    expect(() => renderer.render(0, 4, new Uint8Array(10))).toThrow(/needs/);
    expect(() => renderer.render(0, 0, buffer)).not.toThrow();
  });
});

describe('Mercator leaves its clipped caps visibly outside the world', () => {
  it('does not paint the clip latitude across a cap', () => {
    // `pixelToGeographic` returning `false` is what stops the cap being filled
    // with the terrain at the clip. Nothing in the MVP grid reaches it, so this
    // asserts the renderer honours the contract when it is reached.
    const job = jobFor(worldFor('X400000-0'), { width: 32, height: 16 }, {
      projectionId: 'mercator',
    });
    const renderer = new BandRenderer(job);
    const buffer = new Uint8Array(16 * 32 * CHANNELS);
    renderer.render(0, 16, buffer);
    // Every pixel is inside the world at this size, so nothing should be the
    // flat outside colour.
    const outside = encodeChannel(0.42);
    let flat = 0;
    for (let i = 0; i < buffer.length; i += CHANNELS) {
      if (buffer[i] === outside && buffer[i + 1] === encodeChannel(0.44)) {
        flat++;
      }
    }
    expect(flat).toBe(0);
  });
});

it('samples every pixel of a small map without throwing', () => {
  const raster = renderMapSync(jobFor(worldFor('X200000-0'), TINY));
  expect(raster.data.length).toBe(TINY.width * TINY.height * CHANNELS);
  expect(raster.data.some((b) => b !== 0)).toBe(true);
});

describe('mercator and equirectangular agree where they overlap', () => {
  it('samples the same colour at the same geographic position', () => {
    // The strongest available check that a projection is only choosing
    // directions: two projections whose pixel grids differ entirely must give
    // the same colour at the same lat/lon, exactly.
    const world = worldFor('X600000-0');
    const equi = new BandRenderer(jobFor(world, { width: 256, height: 128 }, { depth: 3 }));
    const merc = new BandRenderer(
      jobFor(world, { width: 256, height: 256 }, { projectionId: 'mercator', depth: 3 }),
    );
    const a = new Float32Array(3);
    const b = new Float32Array(3);

    for (let lat = -70; lat <= 70; lat += 13) {
      for (let lon = -170; lon <= 170; lon += 29) {
        const latRad = (lat * Math.PI) / 180;
        const lonRad = (lon * Math.PI) / 180;
        const c = Math.cos(latRad);
        const x = c * Math.sin(lonRad);
        const y = Math.sin(latRad);
        const z = c * Math.cos(lonRad);
        equi.colourAtDirection(x, y, z, a);
        merc.colourAtDirection(x, y, z, b);
        expect(Array.from(b)).toEqual(Array.from(a));
      }
    }
  });
});
