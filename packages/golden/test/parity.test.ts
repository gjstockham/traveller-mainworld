/**
 * TypeScript kernel vs Rust/WASM twin — the WP3 acceptance check.
 *
 * **On the skip.** These tests need a compiled `.wasm`, which needs a Rust
 * toolchain. Rather than making `pnpm test` fail on a clone that has no Rust,
 * they skip — loudly, with the build command. A skipped test is not a passing
 * test, and this file must never be allowed to become one: CI runs
 * `pnpm golden:parity`, which treats a missing artefact as a hard failure and
 * compares the *full* battery, not the reduced sizes used here.
 *
 * The reduced sizes are what makes this runnable on every commit. Equality at
 * 20,000 samples per case is the same property as equality at a million; the
 * million-sample run is what goes in the manifest.
 */
import {
  type WasmKernel,
  makeTileId,
  tileBounds,
  tileChild,
  tileDepth,
  tileFace,
  tileParent,
  tileQuadPath,
} from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { QUICK_BATTERY } from '../src/battery.js';
import { type KernelApi, tsKernelApi, wasmKernelApi } from '../src/kernelApi.js';
import { compareKernels, formatParityReport } from '../src/parity.js';
import { WASM_BUILD_HINT, loadWasmKernel, wasmArtefactExists } from '../src/wasmLoader.js';

const HAVE_WASM = wasmArtefactExists();

if (!HAVE_WASM) {
  // Prominent, because a silent skip here would hollow out the entire work
  // package: the parity comparison *is* WP3's deliverable.
  process.stderr.write(
    `\n*** SKIPPING KERNEL PARITY TESTS ***\n${WASM_BUILD_HINT}\n` +
      'CI runs `pnpm golden:parity`, which fails rather than skips.\n\n',
  );
}

describe.skipIf(!HAVE_WASM)('TypeScript kernel vs WASM twin', () => {
  let ts: KernelApi;
  let wasm: KernelApi;
  let raw: WasmKernel;

  async function kernels(): Promise<[KernelApi, KernelApi]> {
    ts ??= tsKernelApi();
    raw ??= await loadWasmKernel();
    wasm ??= wasmKernelApi(raw);
    return [ts, wasm];
  }

  it('agrees on TAN_AT_ONE, which the seam guarantee rests on', async () => {
    const [a, b] = await kernels();
    // Exact, not close. `tanWarp(±1)` is exactly ±1 only because it divides a
    // value by itself; if the two kernels hold different divisors, adjacent
    // cube faces compute different positions for the same edge point.
    expect(b.tanAtOne()).toBe(a.tanAtOne());
    for (const u of [1, -1, 0]) {
      expect(a.tanWarp(u)).toBe(u);
      expect(b.tanWarp(u)).toBe(u);
    }
  });

  it('reads the same octave rotation table', async () => {
    const [a, b] = await kernels();
    const at = a.octaveRotations();
    const bt = b.octaveRotations();
    expect(bt.length).toBe(at.length);
    expect(at.length).toBe(24 * 9);
    // Element-wise, so a failure names the index rather than the whole table.
    for (let i = 0; i < at.length; i++) {
      expect(bt[i], `rotation ${i}`).toBe(at[i]);
    }
  });

  it('agrees on tile addressing, which every vertex position depends on', async () => {
    await kernels();
    // Bounds feed every vertex coordinate in a tile, so a disagreement here
    // would show up as a wholesale mismatch in `tile.composite` with no
    // indication that addressing rather than arithmetic was at fault.
    for (let face = 0; face < 6; face++) {
      for (let depth = 0; depth <= 6; depth++) {
        let path = 0;
        for (let d = 0; d < depth; d++) path = path * 4 + ((face + d) % 4);
        const id = makeTileId(face, depth, path);
        const label = `f${face}/d${depth}`;

        expect(raw.makeTileId(face, depth, path), label).toBe(id);
        expect(raw.tileBounds(id), `bounds of ${label}`).toEqual(tileBounds(id));
        expect(raw.tileFace(id), label).toBe(tileFace(id));
        expect(raw.tileDepth(id), label).toBe(tileDepth(id));
        expect(raw.tileQuadPath(id), label).toBe(tileQuadPath(id));
        if (depth > 0) expect(raw.tileParent(id), label).toBe(tileParent(id));
        if (depth < 6) expect(raw.tileChild(id, 2), label).toBe(tileChild(id, 2));
      }
    }
  });

  it(
    'produces bit-identical hashes for every battery case',
    { timeout: 300_000 },
    async () => {
      const [a, b] = await kernels();
      const report = compareKernels(a, b, QUICK_BATTERY);

      // Every case must have actually run. A battery that silently produced
      // nothing would otherwise report perfect agreement.
      expect(report.cases.length).toBeGreaterThanOrEqual(17);
      for (const c of report.cases) {
        expect(c.samples, `${c.name} produced no values`).toBeGreaterThan(0);
      }

      expect(formatParityReport(report)).toMatch(/are bit-identical/);
      expect(report.mismatches).toEqual([]);
    },
  );

  it('reports the divergent index when the kernels do disagree', async () => {
    const [a, b] = await kernels();
    // Deliberately corrupt one kernel's view and confirm the comparison
    // notices. Without this, a broken comparator would report agreement
    // forever and the test above would pass without testing anything.
    const sabotaged: KernelApi = {
      ...b,
      // One ulp, on one function. This is the smallest failure the harness has
      // to catch, and the size of error a rounding-order mistake would produce.
      tanCore: (x: number) => {
        const v = b.tanCore(x);
        return x === 0.5 ? v * (1 + Number.EPSILON) : v;
      },
    };
    const report = compareKernels(a, sabotaged, QUICK_BATTERY);
    expect(report.mismatches.length).toBeGreaterThan(0);
    const text = formatParityReport(report);
    expect(text).toMatch(/approx\.tanCore/);
    expect(text).toMatch(/first divergence at index/);
  });
});
