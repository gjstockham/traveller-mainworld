/**
 * The performance-baseline runner.
 *
 *   pnpm bench           full run, writes bench/results/phase1.md
 *   pnpm bench:quick     reduced iterations, writes bench/results/phase1-quick.md
 *   … --phase=0          writes phase0.md — refused, see below
 *   … --out=name.md      writes bench/results/name.md
 *
 * Run it on an idle machine. Median and p95 absorb a certain amount of
 * interference, but nothing absorbs a compile running on the other four cores.
 *
 * **The two runs write to different files, since WP14.** They did not, and a
 * `pnpm bench:quick` on the wrong machine silently overwrote the committed
 * Phase 0 results with three-iteration numbers — recoverable only because
 * `git status` happened to be read afterwards. The report labels a quick run in
 * its own header, which is the right warning for someone reading the file and
 * no warning at all for the working tree. The quick path is gitignored.
 *
 * **The default phase is 1, since WP15**, and `--phase=0` is refused outright.
 * `bench/results/phase0.md` is WP5's record of a machine, a generator version
 * and a kernel that no longer exist — ADR-0001 §E2 cites it as the evidence the
 * kernel decision was made on, and there is no re-run that reproduces it: the
 * tile it measured had no crater pass in it. It is a historical document, and
 * the way to protect a historical document from a stray flag is to make the flag
 * not work.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GEN_VERSION, TsTileGenerator, WasmTileGenerator } from '@traveller-mainworld/core';
import { loadWasmKernel, wasmArtefactExists } from '@traveller-mainworld/golden/node';

import { sink } from './harness.js';
import { benchSteadyState, footprint, haveGc } from './memory.js';
import { resolveOutput } from './output.js';
import { benchPool, benchTransfer, defaultPoolSize } from './pool.js';
import { renderReport, type ReportInput } from './report.js';
import { benchBasins, benchByDepth, benchDensity, benchTileGeneration } from './tile.js';
import { GRID_SIZES } from './workloads.js';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../results');

/** Densities the differential sweeps. 1.0 is the benchmark UPP's own; 0 accepts no crater at all. */
const DENSITIES = Object.freeze([1, 0.5, 0]);

/** Deepest tile the per-depth breakdown covers. Matches the spread `benchTiles` averages over. */
const MAX_BENCH_DEPTH = 6;

async function main(): Promise<void> {
  const quick = process.argv.includes('--quick');
  const { path: resultsPath, phase } = resolveOutput(process.argv, RESULTS_DIR);
  const iterations = quick ? 3 : 15;
  const poolIterations = quick ? 2 : 6;
  const poolTiles = quick ? 24 : 96;
  const transferRounds = quick ? 50 : 200;

  const startedAt = new Date().toISOString();
  const log = (s: string): void => {
    process.stdout.write(`${s}\n`);
  };

  log(`Phase ${String(phase)} benchmarks (generator ${GEN_VERSION}${quick ? ', quick' : ''})`);
  log('');

  // --- single tile, both kernels ---
  const tiles = [];
  const ts = new TsTileGenerator(GEN_VERSION);
  for (const n of GRID_SIZES) {
    log(`  typescript n=${n} …`);
    tiles.push(benchTileGeneration(ts, n, iterations));
  }

  const wasmAvailable = wasmArtefactExists();
  if (wasmAvailable) {
    const wasm = new WasmTileGenerator(GEN_VERSION, await loadWasmKernel());
    for (const n of GRID_SIZES) {
      log(`  wasm n=${n} …`);
      tiles.push(benchTileGeneration(wasm, n, iterations));
    }
  } else {
    // Not fatal: the grid-size question and the budget verdict only need the
    // TypeScript kernel. But the R4 trigger's alternative is the twin, so say so
    // rather than omitting a row and hoping someone notices.
    log('  wasm: no artefact — skipping (build it with `pnpm wasm:build`)');
  }

  // --- where the tile cost goes ---
  const depths = [];
  for (const n of GRID_SIZES) {
    log(`  by depth n=${n} …`);
    depths.push(...benchByDepth(n, MAX_BENCH_DEPTH, iterations));
  }

  const densities = [];
  for (const n of GRID_SIZES) {
    for (const d of DENSITIES) {
      log(`  density ${String(d)} n=${n} …`);
      densities.push(benchDensity(n, d, iterations));
    }
  }

  log('  basin field …');
  const basins = benchBasins(Math.max(5, iterations * 2));

  // --- pool, at both grid sizes ---
  const maxWorkers = defaultPoolSize();
  const pool = [];
  for (const n of GRID_SIZES) {
    log(`  worker pool, 1..${maxWorkers} workers, n=${n} …`);
    pool.push(...(await benchPool(n, maxWorkers, poolTiles, poolIterations)));
  }

  // --- transfer ---
  const transfer = [];
  for (const n of GRID_SIZES) {
    log(`  transfer n=${n} …`);
    transfer.push(await benchTransfer(n, transferRounds));
  }

  // --- memory ---
  log('  memory …');
  const footprints = GRID_SIZES.map(footprint);
  const steadyState = GRID_SIZES.map((n) => benchSteadyState(n, n === 128 ? 128 : 512));

  const input: ReportInput = {
    phase,
    startedAt,
    quick,
    wasmAvailable,
    gcExposed: haveGc(),
    tiles,
    depths,
    densities,
    basins,
    pool,
    transfer,
    footprints,
    steadyState,
    sink: sink.value,
  };

  writeFileSync(resultsPath, renderReport(input));
  log('');
  log(`Wrote ${resultsPath}`);

  // The headline numbers, so a run says something without opening the file.
  for (const n of GRID_SIZES) {
    const row = tiles.find((t) => t.kernel === 'typescript' && t.n === n);
    const best = [...pool].filter((p) => p.n === n).sort((a, b) => b.tilesPerSecond - a.tilesPerSecond)[0];
    if (row) log(`  single tile, ${n + 1}², typescript: ${row.timing.msPerOp.toFixed(2)} ms (budget 100)`);
    if (best)
      log(
        `  pool throughput, ${n + 1}²: ${best.tilesPerSecond.toFixed(1)} tiles/s ` +
          `at ${best.workers} workers (budget 25)`,
      );
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  },
);
