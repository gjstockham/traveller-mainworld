/**
 * WP11 — regolith and materials.
 *
 * Three things here are load-bearing, and the rest exists to stop them passing
 * for the wrong reason.
 *
 * 1. **The point path and the tile path produce the same bytes.** Same argument
 *    as WP10's elevation equality, and the same consequence if it breaks: WP13's
 *    exported map would be subtly not the planet, and it would show up as a hash
 *    mismatch weeks after the change that caused it.
 * 2. **The albedo buffer is not a constant.** `fixtures.json` hashes it, and a
 *    hash of a constant is a hash that will keep matching while the thing it
 *    covers is broken — which is exactly what the water mask's `allZero` flag
 *    exists to say out loud about *that* buffer.
 * 3. **Albedo does not depend on LOD depth.** That is what makes it seam-free by
 *    construction rather than by a skirt, and it is a claim about a filter that
 *    is one comparison wide and would be very easy to drop.
 */
import {
  ALWAYS_ON_BANDS,
  CraterCandidates,
  FIXTURES,
  GEN_VERSION,
  MAX_CANDIDATES,
  Material,
  MATERIAL_COUNT,
  TsTileGenerator,
  type World,
  allocateTileOutput,
  buildBasins,
  craterParams,
  faceUvToDirection,
  hashToUnit,
  interpretText,
  makeTileId,
  mix32,
  provinceAt,
  quantiseAlbedo,
  regolithParams,
  sampleSurface,
  surfaceAlbedo,
  surfaceAt,
  surfaceMaterial,
  tileBounds,
  tileDepth,
  tileFace,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const generator = new TsTileGenerator(GEN_VERSION);

function worldInput(world: World): Parameters<typeof sampleSurface>[4] {
  return {
    seedHi: world.seedHi,
    seedLo: world.seedLo,
    fbm: world.spec.fbm,
    amplitudeM: world.spec.terrainAmplitudeM,
    radiusKm: world.spec.radiusKm,
    craterDensityScale: world.spec.craters.densityScale,
    craterTransitionDiameterKm: world.spec.craters.transitionDiameterKm,
    regolithMaturity: world.spec.craters.regolithMaturity,
  };
}

/** A representative spread of tiles: a face root, a mid tile and a deep one. */
const PROBE_TILES = [
  makeTileId(0, 0, 0),
  makeTileId(3, 2, 0b1011),
  makeTileId(5, 6, 4095),
];

// --- the equality WP13 rests on ---------------------------------------------

describe('point-path and tile-path surfaces are bit-identical', () => {
  it('over every fixture world, at face roots, mid depths and the deepest tile', () => {
    const n = 8;
    const out = allocateTileOutput(n);

    for (const fixture of FIXTURES) {
      const input = worldInput(fixture.world);
      const basins = buildBasins(
        fixture.world.seedHi,
        fixture.world.seedLo,
        fixture.world.spec.craters.densityScale,
      );
      const scratch = new CraterCandidates();

      for (const tileId of PROBE_TILES) {
        const tile = generator.generate(tileId, fixture.world, n, out);
        const { u0, v0, size } = tileBounds(tileId);
        const face = tileFace(tileId);
        const depth = tileDepth(tileId);

        // Collected, not asserted per vertex: `interpret.test.ts` learnt that
        // an expect() per sample is a real cost and starts timing out under
        // load while passing on an idle machine.
        const differing: string[] = [];
        for (let j = 0; j <= n; j++) {
          for (let i = 0; i <= n; i++) {
            const d = faceUvToDirection(face, u0 + (i / n) * size, v0 + (j / n) * size);
            const code = sampleSurface(d.x, d.y, d.z, depth, input, basins, scratch);
            const g = j * (n + 1) + i;
            if (surfaceAlbedo(code) !== tile.albedo[g] || surfaceMaterial(code) !== tile.materials[g]) {
              differing.push(`${fixture.id} tile ${String(tileId)} vertex ${String(g)}`);
            }
          }
        }
        expect(differing).toEqual([]);
      }
    }
  }, 120_000);

  it('at a full-size tile, where the lattice cache box is large', () => {
    // The tile path reads its craters out of a cache indexed by hand; the point
    // path hashes the lattice directly. At n = 128 that cache spans tens of
    // cells per band, which is the regime where its index arithmetic is
    // genuinely different code rather than nearly the same loop.
    const n = 128;
    const world = FIXTURES[3]!.world;
    const input = worldInput(world);
    const basins = buildBasins(world.seedHi, world.seedLo, world.spec.craters.densityScale);
    const scratch = new CraterCandidates();
    const out = allocateTileOutput(n);

    for (const tileId of [makeTileId(0, 0, 0), makeTileId(2, 4, 0b10110011)]) {
      const tile = generator.generate(tileId, world, n, out);
      const { u0, v0, size } = tileBounds(tileId);
      const face = tileFace(tileId);
      const depth = tileDepth(tileId);
      const differing: number[] = [];
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          const d = faceUvToDirection(face, u0 + (i / n) * size, v0 + (j / n) * size);
          const code = sampleSurface(d.x, d.y, d.z, depth, input, basins, scratch);
          const g = j * (n + 1) + i;
          if (surfaceAlbedo(code) !== tile.albedo[g] || surfaceMaterial(code) !== tile.materials[g]) {
            differing.push(g);
          }
        }
      }
      expect(differing).toEqual([]);
    }
  }, 120_000);
});

// --- the buffer is not a constant --------------------------------------------

describe('the albedo field actually varies', () => {
  it('spans a wide range within a single tile, on every fixture', () => {
    // The trap this whole work package walks into. An albedo buffer that came
    // out constant would hash perfectly, match on every platform, and prove
    // nothing — the water mask's hash is exactly that today and the manifest
    // says so in a flag. A palette offset that never reached the buffer, a
    // province frequency too low to vary inside a tile, or a quantisation that
    // flattened the range would all land here.
    const n = 32;
    const out = allocateTileOutput(n);
    for (const fixture of FIXTURES) {
      const tile = generator.generate(makeTileId(1, 2, 0b0110), fixture.world, n, out);
      const distinct = new Set(tile.albedo.subarray(0, (n + 1) * (n + 1)));
      expect(distinct.size, `fixture '${fixture.id}' albedo barely varies`).toBeGreaterThan(40);
    }
  });

  it('MAKES SIZE 1 TO A DISTINCT AT ONE SEED', () => {
    // Plan §6's acceptance, and the assertion this file exists for most.
    //
    // The first version of the model failed it outright and did so silently:
    // `X100000-0` through `XA00000-0` at one seed produced **bit-identical**
    // surfaces. WP10's crater field is scale-invariant — every radius in it is a
    // fraction of the planetary radius, placed on the unit sphere — so nothing
    // about body size was reaching the colour at all.
    //
    // Holding the seed fixed is the whole point. Vary it too and ten different
    // worlds look different for a reason that says nothing about Size, which is
    // exactly how the fixture set hides this.
    const n = 32;
    const per = (n + 1) * (n + 1);
    const out = allocateTileOutput(n);
    const tileId = makeTileId(1, 2, 0b0110);
    const seedHi = 0x0bad_f00d;
    const seedLo = 0xcafe_babe;

    const fields: string[] = [];
    const means: number[] = [];
    for (const upp of ['X100000-0', 'X300000-0', 'X500000-0', 'X800000-0', 'XA00000-0']) {
      const tile = generator.generate(tileId, { spec: interpretText(upp), seedHi, seedLo }, n, out);
      const slice = tile.albedo.subarray(0, per);
      fields.push([...slice].join(','));
      let sum = 0;
      for (const a of slice) sum += a;
      means.push(sum / per);
    }

    expect(new Set(fields).size, 'two sizes produced the identical surface').toBe(fields.length);
    // Not merely different — different in a direction. Bigger bodies flood more
    // basins and throw shorter rays, so they come out darker, monotonically.
    for (let i = 1; i < means.length; i++) {
      expect(means[i], `Size step ${String(i)} is not darker than the one below`).toBeLessThan(
        means[i - 1]!,
      );
    }
    expect(means[0]! - means.at(-1)!, 'the size range barely changes the surface').toBeGreaterThan(
      15,
    );
  });

  it('gives ten worlds ten different fields, not one field ten times', () => {
    const n = 16;
    const out = allocateTileOutput(n);
    const per = (n + 1) * (n + 1);
    const fields = FIXTURES.map((f) => {
      const tile = generator.generate(makeTileId(0, 1, 2), f.world, n, out);
      return [...tile.albedo.subarray(0, per)].join(',');
    });
    expect(new Set(fields).size).toBe(FIXTURES.length);
  });

  it('re-rolling the seed changes the world without changing its character', () => {
    // PRD U4. Both halves matter: a re-roll that changed nothing would make the
    // button pointless, and one that changed the *statistics* would mean the
    // seed was picking the kind of world rather than which world.
    const base = FIXTURES[3]!.world;
    const n = 32;
    const per = (n + 1) * (n + 1);
    const out = allocateTileOutput(n);
    const tileId = makeTileId(2, 2, 0b0110);

    const means: number[] = [];
    const fields: string[] = [];
    for (const seedLo of [base.seedLo, 0x1111_2222, 0x9999_aaaa, 0x0f0f_0f0f]) {
      const tile = generator.generate(tileId, { ...base, seedLo }, n, out);
      const slice = tile.albedo.subarray(0, per);
      fields.push([...slice].join(','));
      let sum = 0;
      for (const a of slice) sum += a;
      means.push(sum / per);
    }

    expect(new Set(fields).size, 're-rolling produced the same field').toBe(fields.length);
    // Same character: every re-roll lands in the same broad brightness regime
    // rather than one coming out black and the next white.
    for (const mean of means) {
      expect(mean).toBeGreaterThan(30);
      expect(mean).toBeLessThan(200);
    }
  });

  it('uses the whole byte range across the fixture set, without clipping it flat', () => {
    // Two failures at once: a range squeezed into a few values in the middle
    // (no contrast) and a range that saturates (flat white and flat black
    // patches with their structure erased). The first version of the model did
    // the second — every fixture bottomed out at byte 0 over a third of its
    // surface, because overlapping mare fills were subtracted rather than
    // replacing one another.
    const n = 32;
    const per = (n + 1) * (n + 1);
    const out = allocateTileOutput(n);
    for (const fixture of FIXTURES) {
      let min = 255;
      let max = 0;
      let atFloor = 0;
      let atCeiling = 0;
      for (const tileId of PROBE_TILES) {
        const tile = generator.generate(tileId, fixture.world, n, out);
        for (let i = 0; i < per; i++) {
          const a = tile.albedo[i]!;
          if (a < min) min = a;
          if (a > max) max = a;
          if (a === 0) atFloor++;
          if (a === 255) atCeiling++;
        }
      }
      const total = per * PROBE_TILES.length;
      expect(max - min, `fixture '${fixture.id}' has almost no contrast`).toBeGreaterThan(120);
      expect(atFloor / total, `fixture '${fixture.id}' clips to black`).toBeLessThan(0.01);
      expect(atCeiling / total, `fixture '${fixture.id}' clips to white`).toBeLessThan(0.01);
    }
  });

  it('produces every material class except water somewhere in the set', () => {
    const n = 32;
    const out = allocateTileOutput(n);
    const seen = new Set<number>();
    for (const fixture of FIXTURES) {
      for (const tileId of PROBE_TILES) {
        const tile = generator.generate(tileId, fixture.world, n, out);
        for (const m of tile.materials.subarray(0, (n + 1) * (n + 1))) seen.add(m);
      }
    }
    expect(seen.has(Material.Mare)).toBe(true);
    expect(seen.has(Material.Regolith)).toBe(true);
    expect(seen.has(Material.Highland)).toBe(true);
    expect(seen.has(Material.Ejecta)).toBe(true);
    // Phase 2 writes this one. Until then it must not appear, or the manifest
    // would be pinning a water pass nobody has written.
    expect(seen.has(Material.Water)).toBe(false);
  });

  it('is not simply a restatement of elevation', () => {
    // The failure the Phase 0 classifier had: a "material" that was a
    // low-resolution picture of height. If albedo and elevation agreed on their
    // ordering everywhere, the second buffer would carry nothing the first does
    // not, and the fixture set would be paying to hash a copy.
    const n = 32;
    const per = (n + 1) * (n + 1);
    const tile = generator.generate(makeTileId(4, 3, 0b101101), FIXTURES[1]!.world, n);

    let concordant = 0;
    for (let i = 1; i < per; i++) {
      const dh = tile.elevation[i]! - tile.elevation[i - 1]!;
      const da = tile.albedo[i]! - tile.albedo[i - 1]!;
      if (dh === 0 || da === 0 || dh > 0 === da > 0) concordant++;
    }
    expect(concordant / (per - 1)).toBeLessThan(0.8);
  });
});

// --- depth independence ------------------------------------------------------

describe('the surface does not depend on LOD depth', () => {
  it('gives the same byte at depth 0 and at the deepest gated depth', () => {
    // What makes albedo seam-free without a skirt: a tile at depth d and its
    // parent at d−1 agree on colour exactly, so there is no coloured line along
    // a quadtree boundary. It rests on one comparison in `compositeRegolith`,
    // which is exactly the kind of line that gets deleted in a tidy-up.
    const world = FIXTURES[2]!.world;
    const input = worldInput(world);
    const basins = buildBasins(world.seedHi, world.seedLo, world.spec.craters.densityScale);
    const scratch = new CraterCandidates();

    const differing: string[] = [];
    for (let face = 0; face < 6; face++) {
      for (let k = 0; k <= 12; k++) {
        const d = faceUvToDirection(face, (k % 5) / 4, Math.floor(k / 5) / 4);
        const at0 = sampleSurface(d.x, d.y, d.z, 0, input, basins, scratch);
        for (const depth of [1, 4, 8, 14, 20]) {
          if (sampleSurface(d.x, d.y, d.z, depth, input, basins, scratch) !== at0) {
            differing.push(`face ${String(face)} probe ${String(k)} depth ${String(depth)}`);
          }
        }
      }
    }
    expect(differing).toEqual([]);
  });

  it('would notice if a deeper band were let through', () => {
    // The check on the check. Depth independence is only interesting if deeper
    // depths genuinely collect more craters — otherwise the assertion above is
    // true for a reason that has nothing to do with the filter.
    const world = FIXTURES[2]!.world;
    const craters = craterParams(
      world.spec.radiusKm,
      world.spec.craters.densityScale,
      world.spec.craters.transitionDiameterKm,
      world.spec.craters.regolithMaturity,
    );
    const params = regolithParams(world.seedHi, world.seedLo, craters);
    const list = new CraterCandidates();

    // One always-on crater and one from a band well past the filter, both with
    // a fresh age and sitting on the sample.
    list.add(1.2, 0.005, 0.98, 0.004, 0.002, 0, 0, 0x1234_5678, 1, 2, 3);
    const withoutDeep = surfaceAt(0.6, 0.5, 0.62, list, craters, params);
    list.add(1.2, 0.005, 0.98, 0.004, 0.002, 0, ALWAYS_ON_BANDS, 0x8765_4321, 4, 5, 6);
    expect(surfaceAt(0.6, 0.5, 0.62, list, craters, params)).toBe(withoutDeep);

    // …and that the same crater inside the filter does move it, so the equality
    // above is the filter working rather than the term being inert.
    list.add(1.2, 0.005, 0.98, 0.004, 0.002, 0, ALWAYS_ON_BANDS - 1, 0x8765_4321, 4, 5, 6);
    expect(surfaceAt(0.6, 0.5, 0.62, list, craters, params)).not.toBe(withoutDeep);
  });
});

// --- the canonical order, and the arithmetic that needs it -------------------

describe('the regolith walk', () => {
  const craters = craterParams(1700, 1, 30, 1);
  const params = regolithParams(0xdead_beef, 0x1234_5678, craters);

  type Entry = [
    number, number, number,
    number, number, number,
    number, number, number, number, number,
  ];

  /**
   * A handful of fresh ejecta contributors, drawn from `trial`.
   *
   * **Few and weak on purpose.** The first version of this test used twenty
   * strong ones, whose brightening summed well past `EJECTA_CEILING` — so every
   * ordering clamped to the same saturated value and the test passed with the
   * canonical order deleted. That is WP10's compositing-order trap arriving
   * again by a different route: not an order-free reduction this time, but an
   * order-*erasing* one. Five contributors out in the blanket stay under the
   * ceiling, where the sum's rounding is what the byte depends on.
   */
  function entries(trial: number): Entry[] {
    const list: Entry[] = [];
    for (let i = 0; i < 5; i++) {
      const w = mix32(trial * 7919 + i * 104729);
      const t = 1.02 + hashToUnit(w) * 1.1;
      const radius = 0.003 + hashToUnit(mix32(w + 1)) * 0.004;
      const dist = t * radius;
      const ang = hashToUnit(mix32(w + 2)) * 6.283185307179586;
      list.push([
        t,
        radius,
        0.9 + hashToUnit(mix32(w + 3)) * 0.09,
        dist * Math.cos(ang),
        dist * Math.sin(ang),
        dist * 0.1,
        i % 2,
        mix32(w + 4) | 0,
        i,
        0,
        0,
      ]);
    }
    return list;
  }

  it('does not depend on the order contributors were collected', () => {
    // Plan §5.3 rule 2 for the colour path. The brightening is a float sum, so
    // two enumerations of the same set can differ in the last bits — and the
    // last bit here is the difference between byte 137 and byte 138.
    for (let trial = 0; trial < 40; trial++) {
      const forward = new CraterCandidates();
      const backward = new CraterCandidates();
      for (const e of entries(trial)) forward.add(...e);
      for (const e of [...entries(trial)].reverse()) backward.add(...e);

      expect(forward.count).toBe(backward.count);
      expect(
        surfaceAt(0.5, 0.5, 0.7, forward, craters, params),
        `trial ${String(trial)}`,
      ).toBe(surfaceAt(0.5, 0.5, 0.7, backward, craters, params));
    }
  });

  it('IS INSENSITIVE TO ORDER AT BYTE RESOLUTION, which is why the above holds', () => {
    // Written after mutating the walk to ignore `order` entirely and finding
    // this file still green — the exact "test that passes without testing
    // anything" the repo keeps a list of. The mutation was not caught because
    // there is nothing to catch: reordering a float sum moves it by about 1e-16
    // and one albedo byte is 1/255, so no permutation of a realistic contributor
    // set can reach a different byte. The quantiser, not the compositing order,
    // is what makes the two evaluation paths agree here.
    //
    // That makes this an assertion about the *arithmetic being a sum*, and it is
    // worth having: reintroduce replacement semantics — a `lerp` toward a
    // brighter value, the shape `compositeCraters` uses — and ordering starts
    // moving whole bytes, at which point the canonical order stops being belt
    // and braces and starts being the only thing holding WP13 together. This
    // goes red the moment that happens.
    for (let trial = 0; trial < 200; trial++) {
      const list = new CraterCandidates();
      for (const e of entries(trial)) list.add(...e);
      const asCollected = surfaceAt(0.5, 0.5, 0.7, list, craters, params);
      list.order.set([...list.order.subarray(0, list.count)].reverse());
      expect(
        surfaceAt(0.5, 0.5, 0.7, list, craters, params),
        `trial ${String(trial)}: compositing became order-sensitive at byte resolution`,
      ).toBe(asCollected);
    }
  });

  it('reads the offset, so rays are a direction and not a distance', () => {
    // The offset vector is the only field the relief composite does not touch,
    // so nothing else in the suite would notice if it stopped being written.
    // Two samples at the same distance from the same crater, in different
    // directions, must be able to differ.
    const bright = new Set<number>();
    for (let k = 0; k < 24; k++) {
      const list = new CraterCandidates();
      const radius = 0.006;
      const t = 1.4;
      const dist = t * radius;
      const a = (k / 24) * 6.2831853;
      list.add(
        t,
        radius,
        0.99,
        dist * Math.cos(a),
        dist * Math.sin(a),
        0,
        0,
        0x51ed_270b,
        1,
        2,
        3,
      );
      bright.add(surfaceAlbedo(surfaceAt(0.4, 0.3, 0.86, list, craters, params)));
    }
    expect(bright.size, 'the ray field is the same in every direction').toBeGreaterThan(3);
  });

  it('brightens a fresh crater and leaves an old one alone', () => {
    const fresh = new CraterCandidates();
    fresh.add(1.1, 0.006, 0.99, 0.0066, 0, 0, 0, 0x11, 1, 0, 0);
    const old = new CraterCandidates();
    old.add(1.1, 0.006, 0.0, 0.0066, 0, 0, 0, 0x11, 1, 0, 0);
    const bare = new CraterCandidates();

    const at = (l: CraterCandidates): number =>
      surfaceAlbedo(surfaceAt(0.4, 0.3, 0.86, l, craters, params));
    expect(at(fresh)).toBeGreaterThan(at(bare));
    expect(at(old)).toBe(at(bare));
  });

  it('does not let overlapping mare stack into a black hole', () => {
    // What the first version got wrong. Three flooded basins over one sample
    // subtracted three fills and drove the albedo negative, so it clamped — and
    // a third of some fixtures came out as the same single byte.
    const one = new CraterCandidates();
    const many = new CraterCandidates();
    // Basin-scale radii, so the mare branch is reachable, and ages chosen by
    // trying until the flooded draw comes up — the draw is a hash, so this is
    // deterministic, just not predictable by reading it.
    let added = 0;
    for (let h = 1; h < 4000 && added < 6; h++) {
      const list = new CraterCandidates();
      list.add(0.2, 0.05, 0.1, 0.01, 0, 0, -1, h, 0, 0, 0);
      if (surfaceAlbedo(surfaceAt(0.4, 0.3, 0.86, list, craters, params)) < 60) {
        if (added === 0) one.add(0.2, 0.05, 0.1, 0.01, 0, 0, -1, h, 0, 0, 0);
        many.add(0.2, 0.05, 0.1, 0.01, 0, 0, -1, h, 0, 0, 0);
        added++;
      }
    }
    expect(added, 'no flooded basin was found to test with').toBe(6);

    const single = surfaceAlbedo(surfaceAt(0.4, 0.3, 0.86, one, craters, params));
    const stacked = surfaceAlbedo(surfaceAt(0.4, 0.3, 0.86, many, craters, params));
    expect(stacked).toBe(single);
    expect(stacked).toBeGreaterThan(0);
  });

  it('has capacity for the offsets it must carry', () => {
    const list = new CraterCandidates();
    expect(list.dx.length).toBe(MAX_CANDIDATES);
    expect(list.dy.length).toBe(MAX_CANDIDATES);
    expect(list.dz.length).toBe(MAX_CANDIDATES);
  });
});

// --- the pieces --------------------------------------------------------------

describe('the province field', () => {
  const params = regolithParams(0xabcd_1234, 0x5678_9abc, craterParams(1700, 1, 30, 1));

  it('stays inside [0, 1] over a dense sweep of the sphere', () => {
    let min = 1;
    let max = 0;
    for (let face = 0; face < 6; face++) {
      for (let j = 0; j <= 16; j++) {
        for (let i = 0; i <= 16; i++) {
          const d = faceUvToDirection(face, i / 16, j / 16);
          const p = provinceAt(d.x, d.y, d.z, params);
          expect(Number.isFinite(p)).toBe(true);
          if (p < min) min = p;
          if (p > max) max = p;
        }
      }
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    // And it reaches both ends: a field that never leaves the middle would give
    // a world of uniform mid-grey with the mare/highland contrast washed out.
    expect(min).toBeLessThan(0.1);
    expect(max).toBeGreaterThan(0.9);
  });

  it('gives different worlds different province balances', () => {
    // The per-world bias. Without it every seed would produce the same fraction
    // of dark plains and worlds would differ only in where the patches sat.
    const fractions = new Set<number>();
    for (let s = 0; s < 8; s++) {
      const p = regolithParams(s * 0x9e37_79b1, s, craterParams(1700, 1, 30, 1));
      let dark = 0;
      let total = 0;
      for (let face = 0; face < 6; face++) {
        for (let j = 0; j <= 8; j++) {
          for (let i = 0; i <= 8; i++) {
            const d = faceUvToDirection(face, i / 8, j / 8);
            if (provinceAt(d.x, d.y, d.z, p) < 0.5) dark++;
            total++;
          }
        }
      }
      fractions.add(Math.round((100 * dark) / total));
    }
    expect(fractions.size).toBeGreaterThan(4);
  });
});

describe('albedo quantisation', () => {
  it('maps the unit interval onto the whole byte range', () => {
    expect(quantiseAlbedo(0)).toBe(0);
    expect(quantiseAlbedo(1)).toBe(255);
    expect(quantiseAlbedo(0.5)).toBe(128);
  });

  it('clamps rather than wrapping', () => {
    expect(quantiseAlbedo(-3)).toBe(0);
    expect(quantiseAlbedo(4)).toBe(255);
  });

  it('THROWS ON NaN RATHER THAN STORING A PLAUSIBLE BYTE', () => {
    // A Uint8Array cannot hold a NaN — assigning one stores 0 — so a NaN that
    // reached the buffer would become a dark pixel and a perfectly reproducible
    // hash. That is the failure `assertClean` prevents on elevation and cannot
    // detect here, which is why the guard is before the cast.
    expect(() => quantiseAlbedo(Number.NaN)).toThrow(/NaN/);
    expect(new Uint8Array(1).fill(Number.NaN as unknown as number)[0]).toBe(0);
  });
});

describe('the material classes', () => {
  it('are contiguous from zero, so a palette can be an array', () => {
    const values = Object.values(Material) as number[];
    expect(values.length).toBe(MATERIAL_COUNT);
    expect([...values].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('pack and unpack without colliding', () => {
    for (const material of Object.values(Material) as number[]) {
      for (const albedo of [0, 1, 127, 254, 255]) {
        const code = material * 256 + albedo;
        expect(surfaceMaterial(code)).toBe(material);
        expect(surfaceAlbedo(code)).toBe(albedo);
      }
    }
  });
});

describe('the world spec reaches the surface', () => {
  it('changes the albedo when a crater parameter moves', () => {
    // `regolithMaturity` and `densityScale` are hashed by the fixture-spec hash
    // because generation reads them. This is the half of that claim that says
    // the *regolith* reads them, rather than only the relief.
    const base = interpretText('X400000-0');
    const world = (over: Partial<typeof base.craters>): World => ({
      spec: { ...base, craters: { ...base.craters, ...over } },
      seedHi: 0x1357_9bdf,
      seedLo: 0x2468_ace0,
    });
    const n = 16;
    const per = (n + 1) * (n + 1);
    const tileId = makeTileId(3, 3, 0b010110);
    const hash = (w: World): string =>
      [...generator.generate(tileId, w, n).albedo.subarray(0, per)].join(',');

    const reference = hash(world({}));
    expect(hash(world({ regolithMaturity: 0.2 }))).not.toBe(reference);
    expect(hash(world({ densityScale: 0.3 }))).not.toBe(reference);
  });
});
