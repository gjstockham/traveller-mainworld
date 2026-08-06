/**
 * Tests for the results emitter.
 *
 * The report is where a measurement turns into a claim, and the claims it makes
 * are the ones a kernel decision gets taken on. Phase 0's went wrong exactly
 * here: the tile figure was correct, the crater figure was correct, and the
 * summary added them together — a sentence, not a benchmark, and it survived
 * four work packages because no verdict moved.
 *
 * So the arithmetic that turns rows into verdicts is tested against synthetic
 * rows with known answers, rather than trusted because the numbers underneath it
 * came from a real run.
 */
import { describe, expect, it } from 'vitest';

import { BUDGET, type ReportInput, renderReport } from '../src/report.js';
import type { DensityBenchRow, DepthBenchRow, TileBenchRow } from '../src/tile.js';

function timing(msPerOp: number): TileBenchRow['timing'] {
  return {
    name: 'synthetic',
    minMs: msPerOp,
    medianMs: msPerOp,
    p95Ms: msPerOp,
    iterations: 1,
    opsPerIteration: 1,
    msPerOp,
    opsPerSecond: 1000 / msPerOp,
  };
}

function tileRow(n: number, msPerOp: number, kernel = 'typescript'): TileBenchRow {
  const vertices = (n + 1) * (n + 1);
  return { kernel, n, vertices, timing: timing(msPerOp), nsPerVertex: (msPerOp * 1e6) / vertices };
}

function depthRow(n: number, depth: number, bands: number, msPerOp: number): DepthBenchRow {
  return { n, depth, bands, timing: timing(msPerOp), checksum: depth * 1000 + n };
}

function densityRow(n: number, densityScale: number, msPerOp: number): DensityBenchRow {
  return { n, densityScale, timing: timing(msPerOp), checksum: densityScale * 1000 + n };
}

/** A report whose every number is chosen, so every claim in it has a known right answer. */
function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    phase: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    quick: false,
    wasmAvailable: false,
    gcExposed: true,
    tiles: [tileRow(64, 20), tileRow(128, 80)],
    // Deliberately U-shaped, with the dearest tile at the *shallow* end: the
    // shape the real measurement turned out to have, and the one a "deepest
    // tile is the worst tile" assumption gets wrong.
    depths: [
      depthRow(128, 0, 2, 150),
      depthRow(128, 3, 2, 60),
      depthRow(128, 6, 5, 90),
      depthRow(64, 0, 2, 40),
      depthRow(64, 3, 2, 15),
      depthRow(64, 6, 5, 25),
    ],
    densities: [
      densityRow(128, 1, 100),
      densityRow(128, 0.5, 80),
      densityRow(128, 0, 60),
      densityRow(64, 1, 25),
      densityRow(64, 0.5, 20),
      densityRow(64, 0, 15),
    ],
    basins: { timing: timing(0.2), count: 1234 },
    pool: [
      { workers: 1, n: 64, timing: timing(20), tilesPerSecond: 50, scalingEfficiency: 1 },
      { workers: 4, n: 64, timing: timing(5), tilesPerSecond: 192, scalingEfficiency: 0.96 },
      { workers: 1, n: 128, timing: timing(80), tilesPerSecond: 12.5, scalingEfficiency: 1 },
      { workers: 4, n: 128, timing: timing(20), tilesPerSecond: 48, scalingEfficiency: 0.96 },
    ],
    transfer: [],
    footprints: [],
    steadyState: [],
    sink: 1,
    ...overrides,
  };
}

describe('budget verdicts', () => {
  it('takes the per-depth verdict on the dearest tile, not the deepest', () => {
    // 150 ms at depth 0, 90 at depth 6. A report that reached for the deepest
    // row would call this a pass with 10 ms to spare.
    const text = renderReport(input());
    expect(text).toMatch(/129² \(depth 0, 150 ms\)/);
    expect(text).not.toMatch(/129² \(depth 6/);
  });

  it('calls a miss a miss, and sizes it against the 2× escalation rule', () => {
    const text = renderReport(input());
    // 150 against 100 is 1.5×: a miss, and below the factor that selects WASM.
    expect(text).toMatch(/\*\*MISS\*\* by 1\.50×.*optimise rather than switch kernels/);
    expect(text).not.toContain('which is the WASM trigger');
  });

  it('escalates at 2× or worse', () => {
    const text = renderReport(
      input({ depths: [depthRow(128, 0, 2, 250), depthRow(64, 0, 2, 40)] }),
    );
    expect(text).toMatch(/\*\*MISS\*\* by 2\.50×.*which is the WASM trigger/);
  });

  it('says a root-tile miss is inside the startup shell', () => {
    expect(renderReport(input())).toContain('root tile');
    // …and does not say so when the miss is out at the end of a zoom.
    const deepMiss = renderReport(
      input({ depths: [depthRow(128, 6, 5, 150), depthRow(64, 6, 5, 40)] }),
    );
    expect(deepMiss).toMatch(/\*\*MISS\*\* by 1\.50×/);
    expect(deepMiss).not.toContain('root tile');
  });

  it('checks R13 against the shell rather than only the per-tile proxy', () => {
    // 96 tiles at 192 tiles/s is 0.50 s; at 48 tiles/s it is 2.00 s.
    const text = renderReport(input());
    expect(text).toContain('| 65² | 192.0 | 0.50 s |');
    expect(text).toContain('| 129² | 48.0 | 2.00 s |');
  });
});

describe('the crater share', () => {
  it('reports the difference between the density arms, not the whole tile', () => {
    // 100 ms saturated, 60 ms with no craters accepted: 40 ms, which is 40%.
    // Reporting the 1.00 row itself would say 100%.
    const text = renderReport(input());
    expect(text).toContain('40% at 129², saturated — 40.0 ms of 100');
  });

  it('never adds a separately-measured pass to a figure that already contains it', () => {
    // The Phase 0 failure, as an assertion. Craters are 40 ms of a 100 ms tile;
    // the single-tile row is 80. Nothing in the document may claim 120.
    const text = renderReport(input());
    expect(text).not.toMatch(/\b120\b/);
  });
});

describe('report framing', () => {
  it('titles and attributes by phase', () => {
    expect(renderReport(input())).toContain('# Phase 1 performance baseline');
    expect(renderReport(input())).toContain('phase1-implementation-plan.md) §10');
    expect(renderReport(input({ phase: 0 }))).toContain('phase0-spike-plan.md) §B');
  });

  it('marks a quick run as unquotable', () => {
    expect(renderReport(input({ quick: true }))).toContain('Do not quote these numbers');
    expect(renderReport(input())).not.toContain('Do not quote these numbers');
  });

  it('refuses to let the WASM rows stand as a like-for-like alternative', () => {
    const text = renderReport(
      input({ wasmAvailable: true, tiles: [tileRow(64, 20), tileRow(128, 80), tileRow(128, 20, 'wasm')] }),
    );
    // The twin implements the base field only; a bare "4× faster" is the claim
    // this paragraph exists to stop.
    expect(text).toContain('not like for like');
    expect(text).toContain('no crater pass');
  });

  it('holds the budgets it verdicts against', () => {
    // If R13's numbers are ever re-derived, they move here and the prose that
    // quotes them moves with them.
    expect(BUDGET.tileMs).toBe(100);
    expect(BUDGET.poolTilesPerSecond).toBe(25);
    expect(BUDGET.switchKernelFactor).toBe(2);
    expect(renderReport(input())).toContain(`${String(BUDGET.shellTiles)}-tile initial shell`);
  });
});
