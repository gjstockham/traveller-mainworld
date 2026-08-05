/**
 * WP6: does the kernel seam actually swap?
 *
 * ADR-0001 selects the TypeScript kernel and claims the choice stays revisable
 * at the `TileGenerator` boundary — that the other kernel can be dropped in
 * without touching the worker. That claim is the whole reason the interface
 * exists, and an ADR that asserts it without testing it is worse than one that
 * says nothing: it would be believed.
 *
 * So this file swaps the generator twice. Once for a stand-in that no real
 * kernel could be mistaken for, which proves `runTileJob` consults the
 * generator it is handed rather than one it built itself; and once for the real
 * WASM twin, which proves an actual second implementation satisfies the seam
 * and produces identical renderer-ready bytes. Neither test touches
 * `tileWorker.ts`, which is the point.
 *
 * The two are load-bearing together and weak apart, so do not delete either.
 * Making `runTileJob` ignore its argument leaves the WASM comparison green —
 * it would be comparing the TypeScript kernel against itself — and it is the
 * stand-in test that catches that. Conversely a stand-in is not evidence that
 * any real kernel fits the seam.
 *
 * What this file does **not** prove: that the two kernels agree bit-for-bit.
 * It compares Float32 positions, so a sub-Float32-ulp difference in Float64
 * elevation is absorbed and invisible here. `pnpm golden:parity` is the check
 * that compares the Float64 output over the full battery, and it is the one
 * ADR-0001 cites.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_FBM,
  type TileData,
  type TileGenOutput,
  type TileGenerator,
  type World,
  allocateTileOutput,
  instantiateWasmKernel,
  interpretText,
  makeTileId,
} from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { SELECTED_KERNEL, createTileGenerator } from '../src/kernel/choice.js';
import type { GenerateMessage } from '../src/stream/protocol.js';
import { runTileJob } from '../src/workers/tileJob.js';

const GEN = '0.1.0';

const WORLD: World = {
  spec: { ...interpretText('X200000-0'), radiusKm: 1737, terrainAmplitudeM: 6000, fbm: DEFAULT_FBM },
  seedHi: 0x1234abcd,
  seedLo: 0x89ef0176,
};

const N = 8;

const REQUEST: GenerateMessage = {
  type: 'generate',
  tileId: makeTileId(3, 4, 0b10011011),
  n: N,
  radius: 100,
  elevationScale: 0.002,
  skirtDepth: 0.5,
  requestId: 7,
};

describe('kernel choice (ADR-0001)', () => {
  it('runs the kernel the ADR selected', () => {
    expect(SELECTED_KERNEL).toBe('typescript');
    expect(createTileGenerator(GEN).kind).toBe('typescript');
    expect(createTileGenerator(GEN).genVersion).toBe(GEN);
  });

  it('refuses the wasm choice without a twin, and says how to get one', () => {
    // The failure a future revisit will hit first. It has to name the build
    // command, because the crate is archived and the artefact is gitignored —
    // "cannot read property of undefined" would send someone hunting.
    expect(() => createTileGenerator(GEN, 'wasm')).toThrow(/pnpm wasm:build/);
    expect(() => createTileGenerator(GEN, 'wasm')).toThrow(/ADR-0001/);
  });
});

/**
 * A generator that is unmistakably not the real kernel.
 *
 * Elevation is `vertexIndex * 1000` metres — monotonic, far outside the ±6 km
 * the world spec allows, and nothing fBm could produce. If `runTileJob` ignored
 * its argument and built a `TsTileGenerator` internally, every assertion below
 * would fail rather than quietly pass on plausible-looking numbers.
 */
class StandInGenerator implements TileGenerator {
  readonly kind = 'wasm' as const;

  constructor(readonly genVersion: string) {}

  generate(tileId: number, _world: World, n: number, out?: TileGenOutput): TileData {
    const buffers = out ?? allocateTileOutput(n);
    const count = (n + 1) * (n + 1);
    for (let i = 0; i < count; i++) {
      buffers.elevation[i] = i * 1000;
      buffers.materials[i] = 2;
      // Straight up the +Y axis, so a position is `radius + elevation*scale`
      // exactly and can be checked by hand.
      buffers.directions[i * 3] = 0;
      buffers.directions[i * 3 + 1] = 1;
      buffers.directions[i * 3 + 2] = 0;
    }
    return { ...buffers, tileId, genVersion: this.genVersion, n };
  }
}

describe('runTileJob', () => {
  it('uses the generator it is given, not one of its own', () => {
    const { response } = runTileJob(
      new StandInGenerator(GEN),
      WORLD,
      REQUEST,
      allocateTileOutput(N),
    );

    const gridVerts = (N + 1) * (N + 1);
    expect(response.minElevation).toBe(0);
    expect(response.maxElevation).toBe((gridVerts - 1) * 1000);

    // Vertex 5 of the stand-in sits at (0, radius + 5000*scale, 0). A real
    // kernel would put it somewhere on the sphere with metre-scale relief, so
    // this value cannot be produced by accident.
    expect(response.positions[5 * 3]).toBe(0);
    expect(response.positions[5 * 3 + 1]).toBeCloseTo(
      REQUEST.radius + 5000 * REQUEST.elevationScale,
      4,
    );
    expect(response.positions[5 * 3 + 2]).toBe(0);
  });

  it('echoes the request identity so a late reply can be matched', () => {
    const { response, transfer } = runTileJob(
      createTileGenerator(GEN),
      WORLD,
      REQUEST,
      allocateTileOutput(N),
    );
    expect(response.tileId).toBe(REQUEST.tileId);
    expect(response.requestId).toBe(REQUEST.requestId);
    expect(response.n).toBe(N);
    expect(transfer).toEqual([response.positions.buffer, response.colours.buffer]);
  });

  it('produces elevations inside the world spec, unlike the stand-in', () => {
    // Guards the test above from the opposite failure: if the real kernel
    // happened to produce stand-in-like numbers, "uses the generator it is
    // given" would prove nothing.
    const { response } = runTileJob(
      createTileGenerator(GEN),
      WORLD,
      REQUEST,
      allocateTileOutput(N),
    );
    const limit = WORLD.spec.terrainAmplitudeM;
    expect(response.minElevation).toBeGreaterThan(-limit);
    expect(response.maxElevation).toBeLessThan(limit);
    expect(response.maxElevation).toBeGreaterThan(response.minElevation);
  });
});

/**
 * Where `scripts/build-wasm.mjs` stages the artefact. Gitignored.
 *
 * Read here rather than through `@traveller-mainworld/golden/node`, which has
 * the same path in `wasmLoader.ts`: that package's exports point at its build
 * output, so importing it would make `pnpm test` on a fresh clone fail to
 * resolve instead of skipping. Duplicating one path is the cheaper of the two.
 */
const WASM_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../crates/kernel-wasm/pkg/kernel_wasm.wasm',
);

function wasmBytes(): Uint8Array | undefined {
  try {
    return readFileSync(WASM_PATH);
  } catch {
    return undefined;
  }
}

const HAVE_WASM = wasmBytes() !== undefined;

if (!HAVE_WASM) {
  process.stderr.write(
    '\n*** SKIPPING THE ADR-0001 KERNEL SWAP TEST ***\n' +
      `No WASM twin at ${WASM_PATH}. Build it with:  pnpm wasm:build\n` +
      'The `wasm-parity` workflow (workflow_dispatch) runs it with Rust present.\n\n',
  );
}

/**
 * A world with no craters at all.
 *
 * WP10 put a crater pass in the TypeScript kernel and not in the archived twin,
 * so the two no longer agree on a Phase 1 world — and a comparison that simply
 * dropped to "both produce plausible buffers" would stop being evidence of
 * anything. Setting `densityScale` to zero removes every basin and every band
 * candidate, so the TypeScript kernel's elevation is its base fBm field exactly,
 * which is what the twin computes.
 *
 * The comparison therefore stays byte-exact over the arithmetic the twin still
 * implements, and it is honest about which arithmetic that is. What is *not*
 * covered any more is the crater pass, and nothing here should be read as
 * saying otherwise — `pnpm check:parity` is the check ADR-0001 cites and it has
 * the same gap, recorded in `CHANGELOG.md`.
 */
const CRATERLESS_WORLD: World = {
  ...WORLD,
  spec: { ...WORLD.spec, craters: { ...WORLD.spec.craters, densityScale: 0 } },
};

describe.skipIf(!HAVE_WASM)('the seam swaps for the real WASM twin', () => {
  it('produces byte-identical renderer buffers through the same job path', async () => {
    const kernel = await instantiateWasmKernel(wasmBytes()!);

    const tsGen = createTileGenerator(GEN);
    const wasmGen = createTileGenerator(GEN, 'wasm', { wasm: kernel });

    // Without this the test would still pass if `createTileGenerator` quietly
    // handed back a TypeScript generator for both — comparing a kernel against
    // itself and calling it a swap.
    expect(tsGen.kind).toBe('typescript');
    expect(wasmGen.kind).toBe('wasm');

    const ts = runTileJob(tsGen, CRATERLESS_WORLD, REQUEST, allocateTileOutput(N));
    const wasm = runTileJob(wasmGen, CRATERLESS_WORLD, REQUEST, allocateTileOutput(N));

    expect(wasm.response.minElevation).toBe(ts.response.minElevation);
    expect(wasm.response.maxElevation).toBe(ts.response.maxElevation);

    // Exact, element-wise. `toEqual` on two Float32Arrays would also pass, but
    // a failure would print sixty thousand numbers instead of one index.
    expect(wasm.response.positions.length).toBe(ts.response.positions.length);
    for (let i = 0; i < ts.response.positions.length; i++) {
      expect(wasm.response.positions[i], `position[${i}]`).toBe(ts.response.positions[i]);
    }
    for (let i = 0; i < ts.response.colours.length; i++) {
      expect(wasm.response.colours[i], `colour[${i}]`).toBe(ts.response.colours[i]);
    }
  });

  it('diverges from the TypeScript kernel once craters are on, as the ADR expects', () => {
    // The check on the check. If the crater-free world above ever stopped being
    // crater-free — a density clamp, a default, a basin that ignored the scale —
    // the comparison would still pass and would silently be testing nothing.
    // This asserts the gap it is written around is real.
    const withCraters = runTileJob(
      createTileGenerator(GEN),
      WORLD,
      REQUEST,
      allocateTileOutput(N),
    );
    const without = runTileJob(
      createTileGenerator(GEN),
      CRATERLESS_WORLD,
      REQUEST,
      allocateTileOutput(N),
    );
    expect(withCraters.response.minElevation).not.toBe(without.response.minElevation);
  });
});
