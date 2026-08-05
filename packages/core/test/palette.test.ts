/**
 * WP11 — the regolith palette.
 *
 * The palette sits outside the whitelisted zone and outside every hash, which
 * makes it the one part of the generation surface with no manifest behind it.
 * So the things worth asserting are the ones a manifest would otherwise have
 * caught: that it covers every material class the kernel can emit, that it is a
 * function of the seed rather than of anything ambient, and that the same inputs
 * give the same colour to a consumer that has never met the tile they came from
 * — which is the whole of PRD §9.4 restated in one package.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MATERIAL_COUNT,
  Material,
  NEUTRAL_PALETTE,
  surfaceColour,
  worldPalette,
  writeSurfaceColour,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, '../src/palette/index.ts'), 'utf8');

describe('the palette module boundary', () => {
  it('IMPORTS NOTHING FROM THE KERNEL', () => {
    // The property the module header claims, checked rather than trusted. It is
    // what makes "this file is free of the op whitelist" something a reader can
    // establish at a glance instead of by tracing every import — and the reason
    // the module keeps a private copy of a 32-bit mixer rather than borrowing
    // the kernel's.
    //
    // The reverse direction is enforced already, by
    // `scripts/check-kernel-whitelist.mjs`: the kernel may not import anything
    // outside `kernel/`, so nothing here can ever reach a hash.
    const imports = [...SOURCE.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    expect(imports.filter((s) => s.includes('kernel'))).toEqual([]);
  });

  it('covers every material class the kernel can emit', () => {
    // The coupling that an import would have carried and a comment would not.
    // A class added to `Material` without a tint here falls back silently, and a
    // silently-grey new surface type is exactly the kind of thing that survives
    // to a screenshot.
    const seen = new Set<string>();
    for (let m = 0; m < MATERIAL_COUNT; m++) {
      seen.add(surfaceColour(NEUTRAL_PALETTE, m, 200).join(','));
    }
    expect(seen.size, 'two material classes share a tint').toBe(MATERIAL_COUNT);
    // And the documented fallback really is Regolith, since the module writes
    // that index as a bare number to keep its no-kernel-imports property.
    expect(surfaceColour(NEUTRAL_PALETTE, 99, 200)).toEqual(
      surfaceColour(NEUTRAL_PALETTE, Material.Regolith, 200),
    );
  });
});

describe('a world palette', () => {
  it('is a pure function of the seed', () => {
    expect(worldPalette(0xdead_beef, 0x1234_5678)).toEqual(
      worldPalette(0xdead_beef, 0x1234_5678),
    );
  });

  it('differs between seeds, including the awkward lanes', () => {
    const seeds: readonly (readonly [number, number])[] = [
      [0, 0],
      [0, 1],
      [1, 0],
      [0xffff_ffff, 0xffff_ffff],
      [0x8000_0000, 0],
      [0x7fff_ffff, 0xffff_ffff],
    ];
    const distinct = new Set(seeds.map(([hi, lo]) => JSON.stringify(worldPalette(hi, lo))));
    expect(distinct.size).toBe(seeds.length);
  });

  it('does not treat the seed lanes as interchangeable', () => {
    // `hash.ts` records the bug this is written against: an earlier mixer folded
    // the seed in with a symmetric XOR, so re-rolling produced the same field
    // relabelled. A palette with the same flaw would give two different worlds
    // the same cast.
    expect(worldPalette(117, 2)).not.toEqual(worldPalette(118, 1));
  });

  it('stays near neutral, so a world reads as rock', () => {
    for (let s = 0; s < 200; s++) {
      const p = worldPalette(s * 0x9e37_79b1, s * 0x85eb_ca6b);
      for (const cast of [p.castR, p.castG, p.castB]) {
        expect(cast).toBeGreaterThan(0.9);
        expect(cast).toBeLessThan(1.1);
      }
      expect(p.contrast).toBeGreaterThan(0.8);
      expect(p.contrast).toBeLessThan(1.2);
    }
  });
});

describe('surface colours', () => {
  it('stay inside [0, 1] over every material, albedo and seed', () => {
    const out = new Float32Array(3);
    for (let s = 0; s < 40; s++) {
      const p = worldPalette(s * 0x27d4_eb2d, s);
      for (let m = 0; m < MATERIAL_COUNT; m++) {
        for (let a = 0; a <= 255; a += 5) {
          writeSurfaceColour(p, m, a, out, 0);
          for (const c of out) {
            expect(c, `material ${String(m)} albedo ${String(a)}`).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('are monotonic in albedo, so brighter regolith is a brighter pixel', () => {
    const p = worldPalette(0x1234, 0x5678);
    let previous = -1;
    for (let a = 0; a <= 255; a++) {
      const [r] = surfaceColour(p, Material.Regolith, a);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
  });

  it('never bottoms out at pure black', () => {
    // A vertex at albedo 0 is dark basalt in shadowless ambient, not a hole in
    // the mesh. Pure black also loses the surface entirely under the stark
    // vacuum lighting WP12 is bringing.
    for (let m = 0; m < MATERIAL_COUNT; m++) {
      for (const c of surfaceColour(NEUTRAL_PALETTE, m, 0)) {
        expect(c).toBeGreaterThan(0);
      }
    }
  });

  it('gives the two writers the same answer', () => {
    // `writeSurfaceColour` is what the viewer's mesh builder uses and
    // `surfaceColour` is what tools and tests use. If they could disagree, then
    // §9.4's "the exported map matches the 3D view" would depend on which of the
    // two an exporter happened to reach for.
    const p = worldPalette(0xabcd, 0xef01);
    const out = new Float32Array(6);
    writeSurfaceColour(p, Material.Mare, 91, out, 3);
    expect([out[3], out[4], out[5]]).toEqual([...surfaceColour(p, Material.Mare, 91)]);
  });

  it('writes at the offset it is given and nowhere else', () => {
    const out = new Float32Array(9).fill(-1);
    writeSurfaceColour(NEUTRAL_PALETTE, Material.Highland, 128, out, 3);
    expect([out[0], out[1], out[2]]).toEqual([-1, -1, -1]);
    expect([out[6], out[7], out[8]]).toEqual([-1, -1, -1]);
    expect(out[3]).toBeGreaterThan(0);
  });
});
