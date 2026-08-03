/**
 * Markdown emitter for `bench/results/phase0.md`.
 *
 * The deliverable is a document someone can disagree with: machine specs so the
 * numbers can be reproduced, methodology so they can be challenged, and the
 * budget verdicts stated as arithmetic against R13 rather than as an opinion.
 * A table of milliseconds with no context is not evidence for a decision.
 */
import { availableParallelism, cpus, release, totalmem, type } from 'node:os';

import { GEN_VERSION } from '@traveller-mainworld/core';

import { bytes, ms } from './harness.js';
import type { FootprintRow, SteadyStateRow } from './memory.js';
import type { PoolRow, TransferRow } from './pool.js';
import type { CraterBenchRow, TileBenchRow } from './tile.js';

/** Budgets from spike plan §B.3, derived from PRD R13. */
export const BUDGET = Object.freeze({
  /** Milliseconds per tile, single-threaded. */
  tileMs: 100,
  /** Sustained pool throughput, tiles per second. */
  poolTilesPerSecond: 25,
  /** Below this multiple of the budget, optimise rather than switch kernels. */
  switchKernelFactor: 2,
});

export interface ReportInput {
  readonly startedAt: string;
  readonly quick: boolean;
  readonly wasmAvailable: boolean;
  readonly gcExposed: boolean;
  readonly tiles: readonly TileBenchRow[];
  readonly craters: readonly CraterBenchRow[];
  readonly globalPass: { readonly resolution: number; readonly medianMs: number };
  readonly pool: readonly PoolRow[];
  readonly transfer: readonly TransferRow[];
  readonly footprints: readonly FootprintRow[];
  readonly steadyState: readonly SteadyStateRow[];
  readonly sink: number;
}

/** True on WSL, where `os.release()` carries the Microsoft kernel suffix. */
export function isWsl(): boolean {
  return process.platform === 'linux' && /microsoft/i.test(release());
}

function machineBlock(): string {
  const cpu = cpus()[0]?.model ?? 'unknown';
  return [
    `- **CPU:** ${cpu.trim()} — ${availableParallelism()} logical processors`,
    `- **RAM:** ${bytes(totalmem())}`,
    `- **OS:** ${type()} ${release()} (${process.arch})`,
    `- **Runtime:** Node ${process.version}, V8 ${process.versions.v8}`,
    `- **Generator:** ${GEN_VERSION}`,
  ].join('\n');
}

function verdict(actual: number, budget: number, lowerIsBetter: boolean): string {
  const ratio = lowerIsBetter ? actual / budget : budget / actual;
  if (ratio <= 1) {
    const headroom = lowerIsBetter ? budget / actual : actual / budget;
    return `**PASS** — ${headroom.toFixed(1)}× inside budget`;
  }
  if (ratio < BUDGET.switchKernelFactor) {
    return `**MISS** by ${ratio.toFixed(2)}× — under 2×, so optimise rather than switch kernels`;
  }
  return `**MISS** by ${ratio.toFixed(2)}× — 2× or worse, which is the WASM trigger`;
}

export function renderReport(r: ReportInput): string {
  const out: string[] = [];
  const p = (s = ''): void => void out.push(s);

  p('# Spike B — Phase 0 performance baseline');
  p();
  p(`**Generated:** ${r.startedAt}`);
  p('**Work package:** WP5 · **Parent:** [Phase 0 spike plan](../../docs/requirements/phase0-spike-plan.md) §B');
  if (r.quick) {
    p();
    p(
      '> **Quick run.** Reduced iteration counts, for checking the harness works. ' +
        'Do not quote these numbers — regenerate with `pnpm bench`.',
    );
  }
  p();

  // --- summary ---
  const sTs128 = r.tiles.find((t) => t.kernel === 'typescript' && t.n === 128);
  const sWasm128 = r.tiles.find((t) => t.kernel === 'wasm' && t.n === 128);
  const sBest = [...r.pool].sort((a, b) => b.tilesPerSecond - a.tilesPerSecond)[0];
  p('## Summary');
  p();
  p('| Question | Answer |');
  p('|---|---|');
  if (sTs128) {
    p(
      `| Does the TypeScript kernel meet the ${BUDGET.tileMs} ms/tile budget? | ` +
        `**${sTs128.timing.msPerOp <= BUDGET.tileMs ? 'Yes' : 'No'}** — ${ms(sTs128.timing.msPerOp)} ms at 129² |`,
    );
  }
  if (sBest) {
    p(
      `| Does pool throughput reach ${BUDGET.poolTilesPerSecond} tiles/s? | ` +
        `**${sBest.tilesPerSecond >= BUDGET.poolTilesPerSecond ? 'Yes' : 'No'}** — ` +
        `${sBest.tilesPerSecond.toFixed(0)} tiles/s at ${sBest.workers} workers |`,
    );
  }
  if (sTs128 && sWasm128) {
    p(
      `| How much faster is the WASM kernel? | ` +
        `${(sTs128.timing.msPerOp / sWasm128.timing.msPerOp).toFixed(2)}× — but see the note below |`,
    );
  }
  // Derived from the same figure the grid-size section argues from, so the two
  // cannot drift into contradicting each other on a future run.
  const s65 = r.tiles.find((t) => t.kernel === 'typescript' && t.n === 64);
  if (s65 && sTs128) {
    const pv = sTs128.nsPerVertex / s65.nsPerVertex;
    const lean =
      pv < 0.95
        ? `129², weakly — per-vertex cost falls ${((1 - pv) * 100).toFixed(0)}%`
        : pv > 1.05
          ? `65², weakly — per-vertex cost rises ${((pv - 1) * 100).toFixed(0)}% at 129²`
          : 'neither — per-vertex cost is flat';
    p(`| 65² or 129²? | ${lean}. Generation does not settle it; see §Grid size |`);
  }
  p();
  if (sTs128 && sWasm128 && sTs128.timing.msPerOp <= BUDGET.tileMs) {
    p(
      `> **On the WASM speed advantage.** The kernel decision (WP6) turns on the criteria in ` +
        `spike plan §A.3, and "faster" is not one of them. Those criteria ask whether the ` +
        `TypeScript kernel *meets* the budget, not whether anything beats it — and it does, ` +
        `with ${(BUDGET.tileMs / sTs128.timing.msPerOp).toFixed(1)}× to spare. A ` +
        `${(sTs128.timing.msPerOp / sWasm128.timing.msPerOp).toFixed(1)}× win on a budget already ` +
        'met buys headroom nobody has asked for, at the cost of a second toolchain in CI and a ' +
        'second implementation to keep in step forever. Recording the number here so WP6 can ' +
        'weigh it deliberately rather than discover it.',
    );
    p();
  }

  p('## Machine');
  p();
  p(machineBlock());
  p();
  p(
    'This is the integrated-GPU laptop the spike plan names as the minimum target, ' +
      'so these are the numbers that decide rather than an upper bound to be discounted.',
  );
  if (isWsl()) {
    p();
    p(
      '> Running under WSL2. CPU-bound work is close to native, but the browser legs of ' +
        'Spike B run on the Windows side and should be measured there separately.',
    );
  }
  p();

  // --- single tile ---
  p('## Single-tile generation');
  p();
  p(
    'A spread of 24 tiles across all six faces and depths 0-6, so the figure averages ' +
      'over cache behaviours rather than reporting one tile that happens to fit in L2. ' +
      `Terrain is ${'10 octaves'} of fBm — the representative Phase-1 tile from §B.1, not the ` +
      '8-octave default, because octave count is keyed to depth and the deepest tiles are ' +
      'the ones that have to fit the budget.',
  );
  p();
  p('| Kernel | Grid | Vertices | Median ms/tile | Min | p95 | ns/vertex |');
  p('|---|---|---:|---:|---:|---:|---:|');
  for (const t of r.tiles) {
    p(
      `| ${t.kernel} | ${t.n + 1}² | ${t.vertices.toLocaleString()} | ${ms(t.timing.msPerOp)} | ` +
        `${ms(t.timing.minMs / t.timing.opsPerIteration)} | ${ms(t.timing.p95Ms / t.timing.opsPerIteration)} | ` +
        `${t.nsPerVertex.toFixed(1)} |`,
    );
  }
  p();
  p(
    'The WASM rows include marshalling: `WasmTileGenerator` copies the finished buffers out of ' +
      'linear memory into the caller\'s arrays, because that is what using the kernel from ' +
      'JavaScript actually costs. Timing the Rust in isolation would flatter it with a number ' +
      'no caller can obtain.',
  );
  p();
  if (!r.wasmAvailable) {
    p(
      '> The WASM rows are missing: no compiled artefact was present. Build it with ' +
        '`pnpm wasm:build` and re-run, or the kernel comparison in WP6 has only half its evidence.',
    );
    p();
  }

  const ts128 = r.tiles.find((t) => t.kernel === 'typescript' && t.n === 128);
  if (ts128) {
    p(`**Budget (${BUDGET.tileMs} ms/tile, single-threaded, 129² grid):** ` +
      `${verdict(ts128.timing.msPerOp, BUDGET.tileMs, true)}`);
    p();
  }

  // --- grid size ---
  p('### Grid size: 65² or 129²? (open question 1)');
  p();
  const g65 = r.tiles.find((t) => t.kernel === 'typescript' && t.n === 64);
  const g129 = r.tiles.find((t) => t.kernel === 'typescript' && t.n === 128);
  if (g65 && g129) {
    const perTile = g129.timing.msPerOp / g65.timing.msPerOp;
    const perVertex = g129.nsPerVertex / g65.nsPerVertex;
    p(
      `A 129² tile has ${(g129.vertices / g65.vertices).toFixed(2)}× the vertices of a 65² one and ` +
        `costs ${perTile.toFixed(2)}× as much to generate. Per vertex that is ${perVertex.toFixed(2)}×.`,
    );
    p();
    p(
      'The comparison that matters is not per tile but **per unit of screen covered**: at a ' +
        'given screen-space error, one 129² tile replaces four 65² tiles. So if per-vertex cost ' +
        'is flat, the two are a wash on generation and the choice turns on the fixed costs — ' +
        'draw calls, worker messages, cache entries, and how much terrain gets generated ' +
        'beyond the frustum because the LOD granularity is coarse.',
    );
    p();
    if (perVertex < 0.95) {
      p(
        `Per-vertex cost **falls** by ${((1 - perVertex) * 100).toFixed(0)}% at 129², so the larger ` +
          'grid amortises per-tile overhead measurably. That favours 129².',
      );
    } else if (perVertex > 1.05) {
      p(
        `Per-vertex cost **rises** by ${((perVertex - 1) * 100).toFixed(0)}% at 129² — the larger ` +
          'working set is falling out of cache. That favours 65².',
      );
    } else {
      p(
        'Per-vertex cost is flat between the two, so generation does not decide this. ' +
          'The choice should be made on LOD granularity and draw-call count instead — ' +
          'both viewer concerns, measurable in Spike C.',
      );
    }
    p();
  }

  // --- craters ---
  p('## Crater pass (Phase-1 cost model)');
  p();
  p(
    'Phase 0 has no craters. §B.1 nonetheless specifies them as part of the representative ' +
      'tile, so `bench/src/craters.ts` does the work a crater pass does — cell-hashed placement ' +
      'over a fixed face subdivision, compact-support profile compositing — to show how much ' +
      'headroom the fBm pass leaves. **It is a cost model, not a proposed algorithm, and it ' +
      'cannot affect a golden hash.**',
  );
  p();
  p('| Grid | Median ms/tile | Cells visited | Craters placed | Vertex updates |');
  p('|---|---:|---:|---:|---:|');
  for (const c of r.craters) {
    const perIter = c.timing.opsPerIteration;
    p(
      `| ${c.n + 1}² | ${ms(c.timing.msPerOp)} | ${Math.round(c.stats.cellsVisited / perIter).toLocaleString()} | ` +
        `${Math.round(c.stats.cratersPlaced / perIter).toLocaleString()} | ` +
        `${Math.round(c.stats.vertexUpdates / perIter).toLocaleString()} |`,
    );
  }
  p();
  const cr128 = r.craters.find((c) => c.n === 128);
  if (ts128 && cr128) {
    const total = ts128.timing.msPerOp + cr128.timing.msPerOp;
    p(
      `Full Phase-1 tile estimate at 129²: **${ms(total)} ms** ` +
        `(${ms(ts128.timing.msPerOp)} fBm + ${ms(cr128.timing.msPerOp)} craters). ` +
        `${verdict(total, BUDGET.tileMs, true)}`,
    );
    p();
  }
  p(
    `**Global pass** (large-crater placement over ${r.globalPass.resolution}²-per-face): ` +
      `${ms(r.globalPass.medianMs)} ms for the whole planet. Paid once per world, not per tile.`,
  );
  p();

  // --- pool ---
  p('## Worker-pool throughput');
  p();
  p(
    '`node:worker_threads`, not browser `Worker`s: the scaling shape carries over — both are ' +
      'OS threads running the same V8 — but treat the absolute numbers as the reference ' +
      "platform's.",
  );
  p();
  p('| Workers | Grid | Tiles/s | Scaling efficiency | Median ms/tile |');
  p('|---:|---|---:|---:|---:|');
  for (const row of r.pool) {
    p(
      `| ${row.workers} | ${row.n + 1}² | ${row.tilesPerSecond.toFixed(1)} | ` +
        `${(row.scalingEfficiency * 100).toFixed(0)}% | ${ms(row.timing.msPerOp)} |`,
    );
  }
  p();
  const best = [...r.pool].sort((a, b) => b.tilesPerSecond - a.tilesPerSecond)[0];
  if (best) {
    p(
      `**Budget (≥${BUDGET.poolTilesPerSecond} tiles/s sustained):** ` +
        `${verdict(best.tilesPerSecond, BUDGET.poolTilesPerSecond, false)} ` +
        `at ${best.workers} workers.`,
    );
    p();
  }
  const physical = cpus().length / 2;
  const atPhysical = r.pool.find((row) => row.workers === Math.round(physical));
  p(
    '**Read the efficiency column carefully.** It is measured against *one worker*, but this ' +
      `machine has ${Math.round(physical)} physical cores behind ${cpus().length} logical ones. ` +
      (atPhysical
        ? `At ${atPhysical.workers} workers — one per physical core — efficiency is ` +
          `${(atPhysical.scalingEfficiency * 100).toFixed(0)}%. `
        : '') +
      'Beyond that the extra threads share execution units, so the remaining gains come from ' +
      'SMT filling stalls rather than from real parallelism, and the falling percentage is the ' +
      'expected shape rather than a bottleneck to hunt. The main thread also does real work ' +
      'here: it receives every tile and touches it.',
  );
  p();

  // --- transfer ---
  p('## Buffer transfer');
  p();
  p(
    'The plan says "prove transferables, do not assume them", and it is right to: a forgotten ' +
      'transfer list is silent, costs a full copy per tile, and looks exactly like a slow kernel. ' +
      'The `detached` column is `postMessage` having actually zeroed the sender\'s buffer.',
  );
  p();
  p('| Grid | Payload | Alloc only | +transfer | +clone | postMessage: transfer | postMessage: clone | Detached? |');
  p('|---|---:|---:|---:|---:|---:|---:|:--:|');
  for (const t of r.transfer) {
    p(
      `| ${t.n + 1}² | ${bytes(t.bytes)} | ${ms(t.allocMs)} | ${ms(t.transferMs)} | ${ms(t.cloneMs)} | ` +
        `${ms(t.transferOnlyMs)} | ${ms(t.cloneOnlyMs)} | ${t.detached ? 'yes' : '**NO**'} |`,
    );
  }
  p();
  p(
    'The first three columns all include allocating and touching the buffer; the last two ' +
      'subtract that control, isolating `postMessage` itself. Without the control the figures ' +
      'are dominated by allocation — an earlier version of this table reported a 129² transfer ' +
      'as ten times *faster* than a 65² one, which is not a fact about `postMessage`.',
  );
  p();
  if (r.transfer.some((t) => !t.detached)) {
    p('> **A buffer was not detached.** The transfer list is not taking effect; every tile is being copied.');
    p();
  }

  // --- memory ---
  p('## Memory');
  p();
  p('| Grid | Vertices | Raw kernel output | Renderer-ready | Tiles per 256 MiB |');
  p('|---|---:|---:|---:|---:|');
  for (const f of r.footprints) {
    p(
      `| ${f.n + 1}² | ${f.vertices.toLocaleString()} | ${bytes(f.rawBytes)} | ` +
        `${bytes(f.renderBytes)} | ${f.tilesPer256MiB.toLocaleString()} |`,
    );
  }
  p();
  p(
    'The raw kernel output never leaves the worker and is reused between tiles, so the LRU ' +
      'should be sized from the renderer-ready column.',
  );
  p();
  p('| Grid | Cache capacity | ArrayBuffer growth | RSS growth | Per tile (measured) | Per tile (predicted) |');
  p('|---|---:|---:|---:|---:|---:|');
  for (const s of r.steadyState) {
    p(
      `| ${s.n + 1}² | ${s.capacity} | ${bytes(s.arrayBufferGrowthBytes)} | ${bytes(s.rssGrowthBytes)} | ` +
        `${bytes(s.bytesPerTile)} | ${bytes(s.predictedBytesPerTile)} |`,
    );
  }
  p();
  p(
    'Measured against `arrayBuffers`, not `heapUsed`: V8 allocates typed-array backing stores ' +
      'outside the JS heap, so `heapUsed` sees the wrapper objects and misses the data. ' +
      'That mistake reports a tile cache that costs a few hundred bytes per tile.',
  );
  p();
  if (!r.gcExposed) {
    p(
      '> Measured without `--expose-gc`, so the figures include whatever V8 had not yet ' +
        'collected. Run `node --expose-gc bench/dist/cli.js` for a stable number; the shape ' +
        '(level rather than climbing) is meaningful either way.',
    );
    p();
  }

  // --- methodology ---
  p('## Methodology');
  p();
  p(
    '- Every workload is warmed up before measurement, because V8 interprets before it ' +
      'optimises and timing the first calls reports a number two orders of magnitude off.',
  );
  p(
    '- Results are folded into a sink that is printed at the end, so no call can be ' +
      'eliminated as dead code. A benchmark that reports 0.00 ms usually measured nothing.',
  );
  p(
    '- Median and p95 are reported rather than a mean: interference is one-sided, and one ' +
      'GC pause should not be allowed to dominate thirty clean samples. The minimum is the ' +
      "closest estimate of the machine's true cost.",
  );
  p('- Scratch buffers are pooled outside the timed region, as the viewer\'s worker pools them.');
  p();
  p(`Sink checksum: \`${r.sink.toExponential(6)}\` (proof the work was not optimised away).`);
  p();
  p('Regenerate with `pnpm bench`. Numbers move with hardware, Node version and thermal state.');
  p();

  return out.join('\n');
}
