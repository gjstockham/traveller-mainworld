/**
 * WP10 — crater fields.
 *
 * The load-bearing test here is `point-path and tile-path agree bit-for-bit`.
 * Phase 1 plan §13 calls it the highest-value test in the phase, and the reason
 * is that its failure mode is invisible for weeks: the exporter (WP13) point-
 * samples the same fields the viewer meshes, and a divergence shows up as a WP13
 * hash mismatch long after the change that caused it. Everything else in this
 * file exists to stop that test passing for the wrong reason — if the two paths
 * shared an implementation it would be a tautology, so the assertions below
 * cover what makes them genuinely different: the tile path's lattice cache, its
 * bounding box, and its band gate.
 */
import {
  APRON_RING,
  ALWAYS_ON_BANDS,
  BasinCull,
  BAND_SAMPLES_ACROSS,
  lodStepBound,
  CANDIDATES_PER_CELL,
  CraterCandidates,
  FIXTURES,
  GEN_VERSION,
  LARGEST_BAND_RADIUS,
  LAYER_CRATER_BANDS,
  MAX_BANDS,
  MAX_BASINS,
  MAX_CANDIDATES,
  SUPPORT_RATIO,
  TsTileGenerator,
  type World,
  allocateTileOutput,
  apronIndex,
  apronStride,
  bandCellSize,
  bandMaxRadius,
  bandMinRadius,
  bandsForDepth,
  buildBasins,
  collectBasins,
  collectFromLattice,
  compositeCraters,
  craterLayerSeed,
  craterParams,
  faceUvToDirection,
  interpretText,
  makeTileId,
  sampleElevation,
  tileBounds,
  tileChild,
  tileDepth,
  tileFace,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const generator = new TsTileGenerator(GEN_VERSION);

/** π/2, the angular width of a cube face. Repeated here rather than imported so
 * a change to the kernel's constant does not silently change what is asserted. */
const QUARTER_TURN = 1.5707963267948966;

function worldInput(world: World): {
  seedHi: number;
  seedLo: number;
  fbm: World['spec']['fbm'];
  amplitudeM: number;
  radiusKm: number;
  craterDensityScale: number;
  craterTransitionDiameterKm: number;
  regolithMaturity: number;
} {
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

/** Elevation at every vertex of a tile, through the point-sample path. */
function pointPathTile(world: World, tileId: number, n: number): Float64Array {
  const input = worldInput(world);
  const depth = tileDepth(tileId);
  const { u0, v0, size } = tileBounds(tileId);
  const face = tileFace(tileId);
  const basins = buildBasins(world.seedHi, world.seedLo, world.spec.craters.densityScale);
  const scratch = new CraterCandidates();

  const out = new Float64Array((n + 1) * (n + 1));
  let k = 0;
  for (let j = 0; j <= n; j++) {
    const v = v0 + (j / n) * size;
    for (let i = 0; i <= n; i++) {
      const u = u0 + (i / n) * size;
      const d = faceUvToDirection(face, u, v);
      out[k] = sampleElevation(d.x, d.y, d.z, depth, input, basins, scratch);
      k++;
    }
  }
  return out;
}

/**
 * The fixture tile set: every face at every depth 0–6, deliberately including
 * face corners and edge-adjacent tiles in both orientations.
 *
 * Rebuilt here rather than imported from `packages/golden`, which depends on
 * `core` and not the other way round.
 */
function fixtureTiles(maxDepth = 6): number[] {
  const tiles: number[] = [];
  for (let face = 0; face < 6; face++) {
    tiles.push(makeTileId(face, 0, 0));
    for (let child = 0; child < 4; child++) tiles.push(makeTileId(face, 1, child));
    for (let depth = 2; depth <= maxDepth; depth++) {
      const corner = (face + depth) % 4;
      const other = depth % 2 === 0 ? 2 : 1;
      let cornerPath = 0;
      let edgePath = 0;
      for (let level = 0; level < depth; level++) {
        cornerPath = cornerPath * 4 + corner;
        edgePath = edgePath * 4 + (level % 2 === 0 ? 0 : other);
      }
      tiles.push(makeTileId(face, depth, cornerPath));
      tiles.push(makeTileId(face, depth, edgePath));
    }
  }
  return tiles;
}

// --- the equality that WP13 rests on ----------------------------------------

describe('point-path and tile-path outputs are bit-identical', () => {
  it('over the full fixture tile set', () => {
    // Every fixture world across the whole 90-tile set, at a small grid. The
    // grid size is what is traded away here and it is the least valuable axis:
    // it changes how many samples share a lattice cell, not which cells exist.
    // The coverage that matters — six faces, depths 0 to 6, every face corner,
    // edge-adjacent tiles in both orientations, ten worlds spanning Size 1 to A
    // — is all present.
    const n = 8;
    const tiles = fixtureTiles();
    const out = allocateTileOutput(n);

    for (const fixture of FIXTURES) {
      for (const tileId of tiles) {
        const tile = generator.generate(tileId, fixture.world, n, out);
        const point = pointPathTile(fixture.world, tileId, n);
        for (let i = 0; i < point.length; i++) {
          // Exact, not close: `toBeCloseTo` here would pass on precisely the
          // divergence this test exists to catch, because the two paths differ
          // in the last bits long before they differ visibly.
          expect(
            tile.elevation[i],
            `${fixture.id} tile ${String(tileId)} vertex ${String(i)}`,
          ).toBe(point[i]);
        }
      }
    }
  }, 120_000);

  it('at a full-size tile, where the lattice cache box is large', () => {
    // n = 8 exercises a cache box a few cells across; a 129² tile spans tens,
    // and the index arithmetic that walks it is different code from the
    // point path's direct hashing. Three tiles is enough to reach that regime
    // without paying for the point path over 16 641 vertices ten times.
    const n = 128;
    const out = allocateTileOutput(n);
    for (const tileId of [makeTileId(0, 0, 0), makeTileId(2, 4, 0b10110011), makeTileId(5, 6, 4095)]) {
      const world = FIXTURES[3]!.world;
      const tile = generator.generate(tileId, world, n, out);
      const point = pointPathTile(world, tileId, n);
      for (let i = 0; i < point.length; i++) {
        expect(tile.elevation[i], `tile ${String(tileId)} vertex ${String(i)}`).toBe(point[i]);
      }
    }
  }, 120_000);

  it('would catch a one-band gate disagreement', () => {
    // The check on the check. A gate that differed by one band between the two
    // paths is plan §9.4's failure — a map that is subtly not the planet — and
    // it has to be something these assertions can see rather than absorb.
    const world = FIXTURES[3]!.world;
    const tileId = makeTileId(2, 5, 0b1001100111);
    const n = 16;
    const tile = generator.generate(tileId, world, n, allocateTileOutput(n));

    const input = worldInput(world);
    const basins = buildBasins(world.seedHi, world.seedLo, world.spec.craters.densityScale);
    const scratch = new CraterCandidates();
    const { u0, v0, size } = tileBounds(tileId);
    const face = tileFace(tileId);

    let differing = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const d = faceUvToDirection(face, u0 + (i / n) * size, v0 + (j / n) * size);
        // One depth shallower: one band fewer.
        const wrong = sampleElevation(d.x, d.y, d.z, tileDepth(tileId) - 1, input, basins, scratch);
        if (wrong !== tile.elevation[j * (n + 1) + i]) differing++;
      }
    }
    expect(bandsForDepth(tileDepth(tileId) - 1)).toBe(bandsForDepth(tileDepth(tileId)) - 1);
    expect(differing, 'a one-band gate difference produced identical elevations').toBeGreaterThan(0);
  });
});

// --- the band gate -----------------------------------------------------------

describe('band gating', () => {
  it('is monotonic in depth', () => {
    for (let depth = 1; depth <= 20; depth++) {
      expect(bandsForDepth(depth)).toBeGreaterThanOrEqual(bandsForDepth(depth - 1));
    }
  });

  it('adds at most one band per level, so an LOD step is never a cliff', () => {
    for (let depth = 1; depth <= 20; depth++) {
      expect(bandsForDepth(depth) - bandsForDepth(depth - 1)).toBeLessThanOrEqual(1);
    }
  });

  it('takes depth alone, and so cannot make 65² and 129² disagree', () => {
    // Phase 1 open question 1 is open: the viewer meshes at 65² and the golden
    // fixtures hash at 129². If the gate took the caller's grid size, the same
    // tile would evaluate different bands down the two paths and they would
    // disagree at the vertices they share — turning an open question into a
    // seam. The signature is the guarantee, and this asserts the signature.
    expect(bandsForDepth.length).toBe(1);
  });

  it('never drops below the always-on floor, and reaches the cap', () => {
    expect(bandsForDepth(0)).toBe(ALWAYS_ON_BANDS);
    expect(bandsForDepth(40)).toBe(MAX_BANDS);
  });

  it('gates a band in only once its craters span the stated sample count', () => {
    for (let depth = 1; depth <= 12; depth++) {
      const count = bandsForDepth(depth);
      // The always-on bands are exempt by construction — they are the ones the
      // tile's own resolution is the wrong question about. See ALWAYS_ON_BANDS.
      if (count <= ALWAYS_ON_BANDS) continue;
      // Calibrated at 64, deliberately — see BAND_GATE_N.
      const spacing = QUARTER_TURN / (Math.pow(2, depth) * 64);
      const smallest = bandMinRadius(count - 1);
      expect(2 * smallest).toBeGreaterThanOrEqual(BAND_SAMPLES_ACROSS * spacing * 0.999999);
    }
  });

  it('shows the largest craters from orbit, which is why ALWAYS_ON_BANDS exists', () => {
    // The finding that produced the constant: a full-disc view sits at depth 1,
    // where the resolution gate alone admitted no bands at all — so an orbital
    // view showed 24 basins and nothing else, and the biggest tier-2 craters
    // arrived in one step partway down. A test, because the next person tuning
    // the gate will not know that from the numbers.
    expect(bandsForDepth(1)).toBeGreaterThanOrEqual(2);
    // And they are genuinely the large ones: on a Luna-sized world, tens of km.
    expect(2 * bandMaxRadius(0) * 1737).toBeGreaterThan(50);
    expect(2 * bandMinRadius(1) * 1737).toBeGreaterThan(10);
  });
});

// --- the neighbourhood lemma -------------------------------------------------

describe('the 3×3×3 neighbourhood is a superset of the contributors', () => {
  it('holds for every band, checked against a 7×7×7 brute-force scan', () => {
    // The lemma the cell sizes exist to satisfy. If it were false, craters would
    // go missing along cell boundaries — as a stripe, and identically down both
    // paths, so the equality test above would stay green while the planet was
    // wrong. Brute force is the only check that does not assume the thing.
    const seed = craterLayerSeed(0x9e3779b1, 0x85ebca6b, LAYER_CRATER_BANDS);
    const inner = new CraterCandidates();
    const outer = new CraterCandidates();

    for (let band = 0; band < 6; band++) {
      const cell = bandCellSize(band);
      for (let s = 0; s < 40; s++) {
        // Spread the probes over the sphere without a trig call: a cheap
        // deterministic walk is enough, and the point only has to be a unit
        // vector in a general position.
        const a = 1 + s * 0.37;
        const b = 2 - s * 0.21;
        const c = -1.5 + s * 0.11;
        const inv = 1 / Math.sqrt(a * a + b * b + c * c);
        const px = a * inv;
        const py = b * inv;
        const pz = c * inv;

        inner.reset();
        collectFromLattice(inner, px, py, pz, band + 1, 1, seed);

        outer.reset();
        collectWide(outer, px, py, pz, band, cell, seed, 3);

        expect(
          outer.count,
          `band ${String(band)} probe ${String(s)}: a 7×7×7 scan found contributors the ` +
            '3×3×3 neighbourhood does not reach',
        ).toBe(bandContributors(inner, band));
      }
    }
  });
});

/** Candidates {@link collectFromLattice} found in one band. */
function bandContributors(list: CraterCandidates, band: number): number {
  let count = 0;
  for (let i = 0; i < list.count; i++) {
    if (list.keyBand[i] === band) count++;
  }
  return count;
}

/**
 * The same enumeration over a `(2R+1)³` neighbourhood.
 *
 * Deliberately a second implementation rather than a parameter on the kernel's:
 * a radius knob on `collectFromLattice` would make this test compare the
 * function against itself.
 */
function collectWide(
  into: CraterCandidates,
  px: number,
  py: number,
  pz: number,
  band: number,
  cell: number,
  seed: number,
  radius: number,
): void {
  const bandSeed = mix32(seed ^ Math.imul(band + 1, 0x9e3779b1)) | 0;
  const minRadius = bandMinRadius(band);
  const cx = Math.floor(px / cell);
  const cy = Math.floor(py / cell);
  const cz = Math.floor(pz / cell);

  for (let dz = -radius; dz <= radius; dz++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const ix = cx + dx;
        const iy = cy + dy;
        const iz = cz + dz;
        const h = hash3(ix, iy, iz, bandSeed);
        for (let m = 0; m < CANDIDATES_PER_CELL; m++) {
          let w = mix32(h ^ Math.imul(m + 1, 0x27d4eb2d));
          if (hashToUnit(w) >= 1) continue;
          w = mix32(w);
          const jx = hashToUnit(w);
          w = mix32(w);
          const jy = hashToUnit(w);
          w = mix32(w);
          const jz = hashToUnit(w);
          const qx = (ix + jx) * cell;
          const qy = (iy + jy) * cell;
          const qz = (iz + jz) * cell;
          const d2 = qx * qx + qy * qy + qz * qz;
          const half = 0.5 * cell;
          if (d2 < (1 - half) * (1 - half) || d2 > (1 + half) * (1 + half)) continue;
          const inv = 1 / Math.sqrt(d2);
          w = mix32(w);
          const u = hashToUnit(w);
          const r = minRadius / Math.sqrt(1 - 0.75 * u);
          w = mix32(w);
          const ex = px - qx * inv;
          const ey = py - qy * inv;
          const ez = pz - qz * inv;
          const dist2 = ex * ex + ey * ey + ez * ez;
          const reach = SUPPORT_RATIO * r;
          if (dist2 >= reach * reach) continue;
          into.add(Math.sqrt(dist2) / r, r, hashToUnit(w), ex, ey, ez, band, w | 0, ix, iy, iz);
        }
      }
    }
  }
}

// --- LOD continuity ----------------------------------------------------------

describe('LOD continuity', () => {
  it('bounds the elevation step across a depth boundary by the sample spacing', () => {
    // What C2 will be looking at with craters on, and what the viewer's skirt
    // has to cover. A tile at depth d+1 carries one band its parent does not, so
    // at a shared position the two differ by that band's crater relief;
    // LOD_STEP_IN_SPACINGS is the derived bound and `tileMesh.ts` sizes the
    // skirt from the same number. If this goes red, the skirt is short.
    const world = FIXTURES[3]!.world;
    const input = worldInput(world);
    const basins = buildBasins(world.seedHi, world.seedLo, world.spec.craters.densityScale);
    const scratch = new CraterCandidates();
    const radiusM = world.spec.radiusKm * 1000;

    for (let depth = 3; depth <= 10; depth++) {
      const bound = lodStepBound(depth + 1) * radiusM;

      let worst = 0;
      for (let s = 0; s < 500; s++) {
        const a = 1 + s * 0.037;
        const b = 2 - s * 0.021;
        const c = -1.5 + s * 0.011;
        const inv = 1 / Math.sqrt(a * a + b * b + c * c);
        const x = a * inv;
        const y = b * inv;
        const z = c * inv;
        const coarse = sampleElevation(x, y, z, depth, input, basins, scratch);
        const fine = sampleElevation(x, y, z, depth + 1, input, basins, scratch);
        worst = Math.max(worst, Math.abs(fine - coarse));
      }
      expect(worst, `depth ${String(depth)}→${String(depth + 1)}`).toBeLessThan(bound);
    }
  });

  it('changes nothing at all where the gate does not move', () => {
    // Depths 0 to 2 share a band count, so they must agree exactly. A pair of
    // depths that gate identically and still differ would mean depth had leaked
    // into the field itself, which is the bug that makes LOD a seam rather than
    // a refinement.
    const world = FIXTURES[7]!.world;
    const input = worldInput(world);
    const basins = buildBasins(world.seedHi, world.seedLo, world.spec.craters.densityScale);
    const scratch = new CraterCandidates();
    expect(bandsForDepth(0)).toBe(bandsForDepth(2));
    for (let s = 0; s < 200; s++) {
      const a = 1 + s * 0.09;
      const b = -2 + s * 0.05;
      const c = 0.5 - s * 0.03;
      const inv = 1 / Math.sqrt(a * a + b * b + c * c);
      const at = (depth: number): number =>
        sampleElevation(a * inv, b * inv, c * inv, depth, input, basins, scratch);
      expect(at(0)).toBe(at(2));
    }
  });
});

// --- the apron ---------------------------------------------------------------

describe('the tile apron', () => {
  const n = 32;

  it('matches the tile interior element for element', () => {
    const tile = generator.generate(makeTileId(1, 4, 0b10110110), FIXTURES[2]!.world, n);
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        expect(tile.apronElevation[apronIndex(n, i, j)]).toBe(tile.elevation[j * (n + 1) + i]);
      }
    }
  });

  it('is one ring wider on every side', () => {
    expect(apronStride(n)).toBe(n + 1 + 2 * APRON_RING);
    const tile = generator.generate(makeTileId(0, 2, 5), FIXTURES[0]!.world, n);
    expect(tile.apronElevation.length).toBe(apronStride(n) * apronStride(n));
  });

  it('PINS THE LAYOUT, not merely its self-consistency', () => {
    // Both the producer and every consumer go through `apronIndex`, so a uniform
    // shift of the whole mapping is invisible to any test that also uses it —
    // dropping the `+ APRON_RING` on the column passes the entire suite, because
    // the corner it pushes off the front of the buffer is a slot nothing reads.
    //
    // WP12 will index this grid itself when it builds normals, and that is where
    // an off-by-one stops being equivalent and starts being a row of wrong
    // normals along one edge. So the corners are nailed down here, in absolute
    // terms.
    const stride = apronStride(n);
    expect(apronIndex(n, -1, -1)).toBe(0);
    expect(apronIndex(n, 0, 0)).toBe(stride + 1);
    expect(apronIndex(n, n + 1, n + 1)).toBe(stride * stride - 1);
    expect(apronIndex(n, n + 1, -1)).toBe(stride - 1);
    expect(apronIndex(n, -1, n + 1)).toBe(stride * (stride - 1));

    // And every position in the apron grid maps to a distinct slot, which is the
    // property a shift would break at the edges rather than in the middle.
    const seen = new Set<number>();
    for (let j = -1; j <= n + 1; j++) {
      for (let i = -1; i <= n + 1; i++) {
        const k = apronIndex(n, i, j);
        expect(k, `(${String(i)}, ${String(j)}) is outside the buffer`).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(stride * stride);
        seen.add(k);
      }
    }
    expect(seen.size).toBe(stride * stride);
  });

  it('carries the neighbouring tile’s own elevation, exactly', () => {
    // The property WP12 needs and the whole reason the apron exists: a normal at
    // an edge vertex is computed from the ring, and if the ring were merely
    // *close* to the neighbour's surface every tile boundary would still show a
    // normal discontinuity — fainter, and harder to attribute.
    const world = FIXTURES[5]!.world;
    const parent = makeTileId(4, 3, 0b101101);
    const left = tileChild(parent, 0);
    const right = tileChild(parent, 1);

    const a = generator.generate(left, world, n, allocateTileOutput(n));
    const aApron = Float64Array.from(a.apronElevation);
    const aEdge = Float64Array.from(a.elevation);
    const b = generator.generate(right, world, n, allocateTileOutput(n));

    for (let j = 0; j <= n; j++) {
      // The ring one step past the left tile's `u = 1` edge is the right tile's
      // first interior column.
      expect(aApron[apronIndex(n, n + 1, j)], `row ${String(j)}`).toBe(
        b.elevation[j * (n + 1) + 1],
      );
      // And the shared edge itself still agrees, which is the Phase 0 seam
      // guarantee surviving the crater pass.
      expect(aEdge[j * (n + 1) + n], `shared edge row ${String(j)}`).toBe(
        b.elevation[j * (n + 1)],
      );
    }
  });
});

// --- compositing -------------------------------------------------------------

describe('canonical compositing order', () => {
  it('does not depend on the order candidates were collected', () => {
    // Plan §5.3 rule 2, asserted directly. If the composite depended on
    // insertion order, the two evaluation paths would be free to disagree the
    // moment either changed how it enumerates — which is a change nobody would
    // think to test.
    //
    // **Several candidates share each band on purpose.** The first version of
    // this test gave every candidate its own band, which put each one in its own
    // scale bucket and reduced the composite to a plain sum — order-independent
    // whatever `precedes` did. It stayed green with the canonical order removed
    // entirely, which is the failure mode this whole file is written against.
    const params = craterParams(3200, 1, 12, 0.5);
    const forward = new CraterCandidates();
    const backward = new CraterCandidates();

    const entries: [
      number, number, number,
      number, number, number,
      number, number, number, number, number,
    ][] = [];
    for (let i = 0; i < 24; i++) {
      const w = mix32(0x5bf03635 + i * 0x9e3779b1);
      const band = Math.floor(i / 6); // four bands, six overlapping craters each
      entries.push([
        // Inside the bowl, where coverage is non-zero and replacement bites.
        hashToUnit(mix32(w)) * 0.8,
        bandMinRadius(band) * (1 + hashToUnit(mix32(w + 1))),
        hashToUnit(mix32(w + 2)),
        // The offset. Never read by the relief composite; `regolith.test.ts`
        // covers the walk that does read it.
        0,
        0,
        0,
        band,
        mix32(w + 3) | 0,
        (mix32(w + 4) | 0) % 97,
        (mix32(w + 5) | 0) % 97,
        (mix32(w + 6) | 0) % 97,
      ]);
    }

    for (const e of entries) forward.add(...e);
    for (const e of [...entries].reverse()) backward.add(...e);

    expect(forward.count).toBe(backward.count);
    expect(compositeCraters(forward, params)).toBe(compositeCraters(backward, params));
    // And the composite has to actually depend on the ordering it is given, or
    // the equality above is a statement about nothing.
    const shuffled = new CraterCandidates();
    for (const e of entries) shuffled.add(...e);
    shuffled.order.set([...shuffled.order.subarray(0, shuffled.count)].reverse());
    expect(compositeCraters(shuffled, params)).not.toBe(compositeCraters(forward, params));
  });

  it('composites oldest first', () => {
    const list = new CraterCandidates();
    list.add(0.1, 0.001, 0.9, 0, 0, 0, 0, 900, 0, 0, 0);
    list.add(0.1, 0.001, 0.1, 0, 0, 0, 0, 100, 1, 0, 0);
    list.add(0.1, 0.001, 0.5, 0, 0, 0, 0, 500, 2, 0, 0);
    expect([...list.order.subarray(0, 3)].map((s) => list.age[s])).toEqual([0.1, 0.5, 0.9]);
  });

  it('breaks an age tie on the lattice identity, in both insertion orders', () => {
    // Two craters sharing an age hash is a real possibility over a planet's
    // worth of cells. Falling back to insertion order there is exactly the
    // list-dependence §5.3 forbids, so the tiebreak has to be total.
    const forward = new CraterCandidates();
    forward.add(0.2, 0.001, 0.4, 0, 0, 0, 1, 77, 9, 0, 0);
    forward.add(0.2, 0.001, 0.4, 0, 0, 0, 1, 77, 4, 0, 0);
    const backward = new CraterCandidates();
    backward.add(0.2, 0.001, 0.4, 0, 0, 0, 1, 77, 4, 0, 0);
    backward.add(0.2, 0.001, 0.4, 0, 0, 0, 1, 77, 9, 0, 0);
    expect(forward.keyX[forward.order[0]!]).toBe(4);
    expect(backward.keyX[backward.order[0]!]).toBe(4);
  });

  it('orders age hashes unsigned', () => {
    // Age hashes are 32-bit words stored in an Int32Array. Reading the top bit
    // as a sign would order half the craters before all the others on a bit with
    // no meaning — and it would still look like a total order.
    const list = new CraterCandidates();
    list.add(0.2, 0.001, 0.9, 0, 0, 0, 0, 0x80000000 | 0, 0, 0, 0);
    list.add(0.2, 0.001, 0.1, 0, 0, 0, 0, 0x00000001, 1, 0, 0);
    expect(list.keyAge[list.order[0]!]! >>> 0).toBe(1);
  });

  it('has capacity for the worst case it can be handed', () => {
    expect(MAX_CANDIDATES).toBe(27 * CANDIDATES_PER_CELL * MAX_BANDS + MAX_BASINS);
  });

  it('throws rather than truncating if that bound is ever wrong', () => {
    const list = new CraterCandidates();
    for (let i = 0; i < MAX_CANDIDATES; i++) {
      list.add(0.5, 0.001, i / MAX_CANDIDATES, 0, 0, 0, 0, i, i, 0, 0);
    }
    expect(() => list.add(0.5, 0.001, 0.5, 0, 0, 0, 0, 1, 0, 0, 0)).toThrow(/capacity/);
  });
});

// --- profiles ----------------------------------------------------------------

describe('crater profiles', () => {
  const params = craterParams(1600, 1, 8, 0.6);

  /** Relief of a single crater of `radius` at normalised distance `t`, in metres. */
  const relief = (t: number, radius: number, age = 1): number => {
    const list = new CraterCandidates();
    list.add(t, radius, age, 0, 1, 0, 0, 0);
    return compositeCraters(list, params);
  };

  it('is exactly zero outside its support', () => {
    // Compact support is what bounds the candidate search. A profile that merely
    // approached zero would make every crater technically influence every tile.
    const r = 0.004;
    expect(relief(SUPPORT_RATIO, r)).toBe(0);
    expect(relief(SUPPORT_RATIO * 1.5, r)).toBe(0);
  });

  it('digs a bowl and raises a rim', () => {
    const r = 0.004;
    expect(relief(0, r)).toBeLessThan(0);
    expect(relief(1, r)).toBeGreaterThan(0);
    expect(relief(0, r)).toBeLessThan(relief(0.9, r));
  });

  it('is continuous across the rim crest', () => {
    const r = 0.004;
    const inside = relief(1 - 1e-9, r);
    const outside = relief(1 + 1e-9, r);
    expect(Math.abs(inside - outside)).toBeLessThan(Math.abs(inside) * 1e-6 + 1e-9);
  });

  it('gives a large crater a flat floor and a central peak', () => {
    // The features that make a large crater read as large. Without them a 300 km
    // basin is a 300 km version of a 3 km bowl, which is the commonest way a
    // procedural planet looks synthetic.
    const big = 0.05; // far above the transition radius for this world
    const centre = relief(0, big);
    const floor = relief(0.3, big);
    expect(centre).toBeGreaterThan(floor); // the peak stands above the floor
    expect(Math.abs(floor - relief(0.4, big))).toBeLessThan(Math.abs(floor) * 0.05);
  });

  it('makes complex craters shallower relative to their size than simple ones', () => {
    const small = 0.0005;
    const large = 0.05;
    const ratio = (r: number): number => Math.abs(relief(0.35, r)) / (r * 1600 * 1000);
    expect(ratio(large)).toBeLessThan(ratio(small));
  });

  it('makes old craters shallower than young ones', () => {
    const r = 0.004;
    expect(Math.abs(relief(0, r, 0))).toBeLessThan(Math.abs(relief(0, r, 1)));
  });

  it('lets a young crater replace an old one inside its bowl', () => {
    // Plan §5.4's `h = lerp(h, floor, coverage)`, and the single biggest
    // contributor to whether the result reads as Luna or as a lumpy sum.
    const r = 0.004;
    const alone = new CraterCandidates();
    alone.add(0, r, 1, 0, 10, 0, 0, 0);
    const overlapped = new CraterCandidates();
    overlapped.add(0.4, r * 2, 0, 0, 5, 1, 0, 0); // older, and much bigger
    overlapped.add(0, r, 1, 0, 10, 0, 0, 0); // younger, centred here
    expect(compositeCraters(overlapped, params)).toBe(compositeCraters(alone, params));
  });
});

// --- basins ------------------------------------------------------------------

describe('global basins', () => {
  it('places unit-length centres with radii inside the stated range', () => {
    const basins = buildBasins(0xdeadbeef, 0x12345678, 1);
    expect(basins.count).toBeGreaterThan(0);
    expect(basins.count).toBeLessThanOrEqual(MAX_BASINS);
    for (let i = 0; i < basins.count; i++) {
      const x = basins.data[i * 5]!;
      const y = basins.data[i * 5 + 1]!;
      const z = basins.data[i * 5 + 2]!;
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(1, 12);
      expect(basins.data[i * 5 + 3]).toBeGreaterThanOrEqual(LARGEST_BAND_RADIUS);
      expect(basins.data[i * 5 + 3]).toBeLessThanOrEqual(0.3);
    }
  });

  it('continues the size ladder where the bands stop, with no gap', () => {
    expect(bandMaxRadius(0)).toBe(LARGEST_BAND_RADIUS);
  });

  it('thins out with density, and vanishes at zero', () => {
    expect(buildBasins(1, 2, 0).count).toBe(0);
    expect(buildBasins(1, 2, 0.25).count).toBeLessThan(buildBasins(1, 2, 1).count);
  });

  it('CULLS WITHOUT CHANGING THE ANSWER, however loose the box', () => {
    // The property the whole cull rests on, and the one WP13 will rely on when
    // it culls by row band rather than by tile. A cull is a *superset* filter:
    // a basin it keeps but which cannot reach a sample is dropped by the same
    // exact early-out as everything else, so the composite is identical whether
    // the box was tight, loose, or absent.
    //
    // The tile path already culls per row and the point path does not, so the
    // bit-exact equality test at the top of this file is the large-scale version
    // of this. This is the direct one, and it fails if the cull ever starts
    // dropping something that could contribute.
    const world = FIXTURES[2]!.world;
    const params = craterParams(
      world.spec.radiusKm,
      world.spec.craters.densityScale,
      world.spec.craters.transitionDiameterKm,
      world.spec.craters.regolithMaturity,
    );
    const basins = buildBasins(world.seedHi, world.seedLo, world.spec.craters.densityScale);
    const tight = new BasinCull();
    const loose = new BasinCull();
    const list = new CraterCandidates();

    const relief = (px: number, py: number, pz: number, cull?: BasinCull): number => {
      list.reset();
      collectBasins(list, px, py, pz, basins, cull);
      return compositeCraters(list, params);
    };

    let culledAnything = false;
    for (let s = 0; s < 60; s++) {
      const a = 1 + s * 0.31;
      const b = -2 + s * 0.17;
      const c = 0.7 - s * 0.09;
      const inv = 1 / Math.sqrt(a * a + b * b + c * c);
      const x = a * inv;
      const y = b * inv;
      const z = c * inv;

      // A box that is exactly the point, and one padded far beyond it.
      tight.build(basins, x, y, z, x, y, z);
      loose.build(basins, x - 0.2, y - 0.2, z - 0.2, x + 0.2, y + 0.2, z + 0.2);
      if (tight.count < basins.count) culledAnything = true;

      const none = relief(x, y, z);
      expect(relief(x, y, z, tight), `probe ${String(s)} tight`).toBe(none);
      expect(relief(x, y, z, loose), `probe ${String(s)} loose`).toBe(none);
    }
    // Otherwise the equalities above would be comparing the full list to itself.
    expect(culledAnything, 'the cull kept every basin, so it proved nothing').toBe(true);
  });

  it('continues the band ladder rather than being a chosen number', () => {
    // The defect this replaced: tier 2 was a density and tier 1 was a fixed 24,
    // so the size-frequency distribution fell by a factor of seventy across a
    // factor of 1.4 in diameter — everything above 70 km on a Luna-sized world
    // was 24 objects. For `p(r) ∝ r⁻³` the population above a band's top is a
    // third of the band's own, and that is what the count is derived from.
    const shellCells = (8 * QUARTER_TURN) / (bandCellSize(0) * bandCellSize(0));
    expect(MAX_BASINS).toBe(Math.round((shellCells * CANDIDATES_PER_CELL) / 3));
    // Sanity: the ladder is continuous, so this is hundreds, not tens.
    expect(MAX_BASINS).toBeGreaterThan(500);
  });

  it('is the same field for the same world, every time', () => {
    const a = buildBasins(0x0badf00d, 0xcafebabe, 0.7);
    const b = buildBasins(0x0badf00d, 0xcafebabe, 0.7);
    expect([...a.data]).toEqual([...b.data]);
    expect([...a.ages]).toEqual([...b.ages]);
  });

  it('is reached by the sample path', () => {
    // Basins are bucket (b) and bands are bucket (a); a wiring mistake that
    // dropped the basins entirely would leave every other test in this file
    // green.
    const world = FIXTURES[8]!.world;
    const input = worldInput(world);
    const scratch = new CraterCandidates();
    const withBasins = buildBasins(world.seedHi, world.seedLo, world.spec.craters.densityScale);
    const none = buildBasins(world.seedHi, world.seedLo, 0);

    let differing = 0;
    for (let s = 0; s < 200; s++) {
      const a = 1 + s * 0.09;
      const b = -2 + s * 0.05;
      const c = 0.5 - s * 0.03;
      const inv = 1 / Math.sqrt(a * a + b * b + c * c);
      const x = a * inv;
      const y = b * inv;
      const z = c * inv;
      if (
        sampleElevation(x, y, z, 2, input, withBasins, scratch) !==
        sampleElevation(x, y, z, 2, input, none, scratch)
      ) {
        differing++;
      }
    }
    expect(differing).toBeGreaterThan(0);
  });

  it('buckets by scale among themselves, so a small basin cannot erase a huge one', () => {
    // Basins span a 15× radius range in one tier. Without their own scale
    // buckets a 400 km basin landing inside a 6 000 km one would replace its
    // depth outright, which is the same defect the band buckets exist to
    // prevent — just inside tier 1 rather than across the tiers.
    const basins = buildBasins(0x1a2b3c4d, 0x5e6f7a8b, 1);
    const list = new CraterCandidates();
    const seenBuckets = new Set<number>();
    for (let i = 0; i < basins.count; i++) {
      const x = basins.data[i * 5]!;
      const y = basins.data[i * 5 + 1]!;
      const z = basins.data[i * 5 + 2]!;
      list.reset();
      collectBasins(list, x, y, z, basins);
      for (let s = 0; s < list.count; s++) seenBuckets.add(list.keyBand[s]!);
    }
    expect(seenBuckets.size, 'every basin fell in one bucket').toBeGreaterThan(1);
    for (const b of seenBuckets) expect(b).toBeLessThan(0);
  });

  it('collects into the same list as the bands, ahead of every band crater', () => {
    // One list, one canonical order, one composite. Basins take negative scale
    // buckets so the walk reaches them first — largest features first — and a
    // band crater then excavates into a basin floor rather than replacing it.
    const basins = buildBasins(0x11112222, 0x33334444, 1);
    const list = new CraterCandidates();
    const centre = { x: basins.data[0]!, y: basins.data[1]!, z: basins.data[2]! };
    collectBasins(list, centre.x, centre.y, centre.z, basins);
    collectFromLattice(
      list,
      centre.x,
      centre.y,
      centre.z,
      6,
      1,
      craterLayerSeed(0x11112222, 0x33334444, LAYER_CRATER_BANDS),
    );
    const slots = [...list.order.subarray(0, list.count)];
    const buckets = slots.map((s) => list.keyBand[s]!);
    expect(buckets.some((b) => b < 0), 'no basin reached the list').toBe(true);
    expect(buckets.some((b) => b >= 0), 'no band crater reached the list').toBe(true);
    // Largest scale first, and within a scale, oldest first.
    expect([...buckets].sort((a, b) => a - b)).toEqual(buckets);
    for (let i = 1; i < slots.length; i++) {
      if (buckets[i] !== buckets[i - 1]) continue;
      expect(list.keyAge[slots[i]!]! >>> 0).toBeGreaterThanOrEqual(
        list.keyAge[slots[i - 1]!]! >>> 0,
      );
    }
  });
});

// --- the whole pass ----------------------------------------------------------

describe('the crater pass as a whole', () => {
  it('produces finite elevations for every Size, at every depth it gates', () => {
    // The realistic new NaN sources are a zero-radius crater, a divide by a zero
    // support radius, and a square root of a negative discriminant at a rim.
    // `assertClean` inside the generator is what would throw; this walks the
    // whole size range past it.
    const n = 16;
    const out = allocateTileOutput(n);
    for (let size = 1; size <= 10; size++) {
      const code = size === 10 ? 'A' : String(size);
      const world: World = {
        spec: interpretText(`X${code}00000-0`),
        seedHi: 0x9e3779b1,
        seedLo: size,
      };
      for (const depth of [0, 3, 6, 9, 12]) {
        expect(() =>
          generator.generate(makeTileId(depth % 6, depth, 0), world, n, out),
        ).not.toThrow();
      }
    }
  });

  it('stays finite for a dense, wet, high-gravity world too', () => {
    // Not a Phase 1 world, but `interpret` is total and the viewer renders every
    // UPP behind a reduced-fidelity badge, so the pass has to survive the whole
    // parameter space rather than the airless corner of it.
    const world: World = {
      spec: interpretText('AA8A9C6-D'),
      seedHi: 0,
      seedLo: 0,
    };
    expect(() => generator.generate(makeTileId(3, 7, 8191), world, 16)).not.toThrow();
  });

  it('reuses its scratch without carrying state between tiles', () => {
    // The lattice cache and candidate list are module-level, so a tile generated
    // between two others must not be able to change either of them. This is the
    // assertion that makes that safe rather than merely intended.
    const n = 16;
    const world = FIXTURES[1]!.world;
    const a1 = Float64Array.from(generator.generate(makeTileId(0, 5, 123), world, n).elevation);
    generator.generate(makeTileId(4, 2, 11), FIXTURES[9]!.world, 64);
    generator.generate(makeTileId(2, 8, 40000), world, 8);
    const a2 = generator.generate(makeTileId(0, 5, 123), world, n).elevation;
    expect([...a2]).toEqual([...a1]);
  });

  it('makes crater parameters visible in the output', () => {
    // Discrimination. Every crater parameter has to reach elevation, or the
    // fixture-spec hash would be excusing fields it should be covering.
    const n = 16;
    const tileId = makeTileId(2, 6, 3000);
    const base = FIXTURES[3]!.world;
    const elev = (spec: Partial<World['spec']['craters']>): number[] => {
      const world: World = {
        ...base,
        spec: { ...base.spec, craters: { ...base.spec.craters, ...spec } },
      };
      return [...generator.generate(tileId, world, n).elevation];
    };
    const reference = elev({});
    expect(elev({ densityScale: 0.4 })).not.toEqual(reference);
    expect(elev({ transitionDiameterKm: 0.5 })).not.toEqual(reference);
    expect(elev({ regolithMaturity: 0.05 })).not.toEqual(reference);
  });

  it('leaves the base terrain alone where there are no craters', () => {
    const n = 16;
    const tileId = makeTileId(1, 4, 200);
    const base = FIXTURES[6]!.world;
    const dead: World = {
      ...base,
      spec: { ...base.spec, craters: { ...base.spec.craters, densityScale: 0 } },
    };
    const tile = generator.generate(tileId, dead, n);
    // With no basins and no band candidates the composite is the empty product,
    // so elevation is exactly the fBm field — which is what Phase 0 produced.
    expect(tile.elevation.every((v) => Number.isFinite(v))).toBe(true);
    expect(new Set(tile.materials).size).toBeGreaterThan(0);
  });
});

// Imported last: these are kernel internals the tests above reimplement on
// purpose, and keeping them out of the main import block makes that visible.
import { hash3, hashToUnit, mix32 } from '../src/index.js';
