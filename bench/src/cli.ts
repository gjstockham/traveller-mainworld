/**
 * Spike B runner.
 *
 *   pnpm bench           full run, writes bench/results/phase0.md
 *   pnpm bench:quick     reduced iterations, for checking the harness
 *
 * Run it on an idle machine. Median and p95 absorb a certain amount of
 * interference, but nothing absorbs a compile running on the other four cores.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GEN_VERSION, TsTileGenerator, WasmTileGenerator } from '@traveller-mainworld/core';
import { loadWasmKernel, wasmArtefactExists } from '@traveller-mainworld/golden/node';

import { sink } from './harness.js';
import { benchSteadyState, footprint, haveGc } from './memory.js';
import { benchPool, benchTransfer, defaultPoolSize } from './pool.js';
import { renderReport, type ReportInput } from './report.js';
import { benchCraters, benchGlobalPass, benchTileGeneration } from './tile.js';
import { GRID_SIZES } from './workloads.js';

const RESULTS_PATH = join(dirname(fileURLToPath(import.meta.url)), '../results/phase0.md');

async function main(): Promise<void> {
  const quick = process.argv.includes('--quick');
  const iterations = quick ? 3 : 15;
  const poolIterations = quick ? 2 : 6;
  const poolTiles = quick ? 24 : 96;
  const transferRounds = quick ? 50 : 200;
  const globalResolution = quick ? 128 : 512;

  const startedAt = new Date().toISOString();
  const log = (s: string): void => {
    process.stdout.write(`${s}\n`);
  };

  log(`Spike B benchmarks (generator ${GEN_VERSION}${quick ? ', quick' : ''})`);
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
    // TypeScript kernel. But WP6 needs both, so say so rather than omitting a
    // row and hoping someone notices.
    log('  wasm: no artefact — skipping (build it with `pnpm wasm:build`)');
  }

  // --- crater cost model ---
  const craters = [];
  for (const n of GRID_SIZES) {
    log(`  craters n=${n} …`);
    craters.push(benchCraters(n, iterations));
  }
  log(`  global crater pass ${globalResolution}²/face …`);
  const globalTiming = benchGlobalPass(globalResolution, Math.max(3, Math.floor(iterations / 3)));

  // --- pool ---
  const maxWorkers = defaultPoolSize();
  log(`  worker pool, 1..${maxWorkers} workers, n=128 …`);
  const pool = await benchPool(128, maxWorkers, poolTiles, poolIterations);

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
    startedAt,
    quick,
    wasmAvailable,
    gcExposed: haveGc(),
    tiles,
    craters,
    globalPass: { resolution: globalResolution, medianMs: globalTiming.medianMs },
    pool,
    transfer,
    footprints,
    steadyState,
    sink: sink.value,
  };

  writeFileSync(RESULTS_PATH, renderReport(input));
  log('');
  log(`Wrote ${RESULTS_PATH}`);

  // The headline numbers, so a run says something without opening the file.
  const ts128 = tiles.find((t) => t.kernel === 'typescript' && t.n === 128);
  const best = [...pool].sort((a, b) => b.tilesPerSecond - a.tilesPerSecond)[0];
  if (ts128) log(`  single tile, 129², typescript: ${ts128.timing.msPerOp.toFixed(2)} ms (budget 100)`);
  if (best) log(`  pool throughput: ${best.tilesPerSecond.toFixed(1)} tiles/s at ${best.workers} workers (budget 25)`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  },
);
