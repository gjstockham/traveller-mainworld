/**
 * Markdown emitter for `bench/results/phase<N>.md`.
 *
 * The deliverable is a document someone can disagree with: machine specs so the
 * numbers can be reproduced, methodology so they can be challenged, and the
 * budget verdicts stated as arithmetic against R13 rather than as an opinion.
 * A table of milliseconds with no context is not evidence for a decision.
 */
import { availableParallelism, cpus, release, totalmem, type } from 'node:os';

import { BAND_GATE_N, GEN_VERSION } from '@traveller-mainworld/core';

import { bytes, ms } from './harness.js';
import type { FootprintRow, SteadyStateRow } from './memory.js';
import type { PoolRow, TransferRow } from './pool.js';
import type { BasinBenchRow, DensityBenchRow, DepthBenchRow, TileBenchRow } from './tile.js';

/** Budgets from spike plan §B.3, derived from PRD R13. */
export const BUDGET = Object.freeze({
  /** Milliseconds per tile, single-threaded. */
  tileMs: 100,
  /** Sustained pool throughput, tiles per second. */
  poolTilesPerSecond: 25,
  /** Below this multiple of the budget, optimise rather than switch kernels. */
  switchKernelFactor: 2,
  /**
   * Tiles in the initial low-LOD shell, and the seconds R13 gives it.
   *
   * The two figures the 100 ms/tile budget was *derived* from, kept here so the
   * derivation can be checked against measurement rather than trusted. The
   * per-tile budget is a proxy; this is the requirement.
   */
  shellTiles: 96,
  shellSeconds: 10,
});

export interface ReportInput {
  /** Which phase's numbers these are. Sets the title and the parent link. */
  readonly phase: number;
  readonly startedAt: string;
  readonly quick: boolean;
  readonly wasmAvailable: boolean;
  readonly gcExposed: boolean;
  readonly tiles: readonly TileBenchRow[];
  readonly depths: readonly DepthBenchRow[];
  readonly densities: readonly DensityBenchRow[];
  readonly basins: BasinBenchRow;
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

/** The parent document a phase's numbers answer to. */
function parentLink(phase: number): string {
  return phase === 0
    ? '**Work package:** WP5 · **Parent:** [Phase 0 spike plan](../../docs/requirements/phase0-spike-plan.md) §B'
    : '**Work package:** WP15 · **Parent:** [Phase 1 implementation plan](../../docs/plans/phase1-implementation-plan.md) §10';
}

export function renderReport(r: ReportInput): string {
  const out: string[] = [];
  const p = (s = ''): void => void out.push(s);
  const tsAt = (n: number): TileBenchRow | undefined =>
    r.tiles.find((t) => t.kernel === 'typescript' && t.n === n);
  const bestPool = (n: number): PoolRow | undefined =>
    [...r.pool].filter((row) => row.n === n).sort((a, b) => b.tilesPerSecond - a.tilesPerSecond)[0];

  p(`# Phase ${String(r.phase)} performance baseline`);
  p();
  p(`**Generated:** ${r.startedAt}`);
  p(parentLink(r.phase));
  if (r.quick) {
    p();
    p(
      '> **Quick run.** Reduced iteration counts, for checking the harness works. ' +
        'Do not quote these numbers — regenerate with `pnpm bench`.',
    );
  }
  p();

  // --- summary ---
  const sTs64 = tsAt(64);
  const sTs128 = tsAt(128);
  const sWasm128 = r.tiles.find((t) => t.kernel === 'wasm' && t.n === 128);
  p('## Summary');
  p();
  p('| Question | Answer |');
  p('|---|---|');
  for (const row of [sTs64, sTs128]) {
    if (row) {
      p(
        `| Does the TypeScript kernel meet the ${BUDGET.tileMs} ms/tile budget at ${row.n + 1}²? | ` +
          `**${row.timing.msPerOp <= BUDGET.tileMs ? 'Yes' : 'No'}** — ${ms(row.timing.msPerOp)} ms |`,
      );
    }
  }
  for (const n of [64, 128]) {
    const best = bestPool(n);
    if (best) {
      p(
        `| Does pool throughput reach ${BUDGET.poolTilesPerSecond} tiles/s at ${n + 1}²? | ` +
          `**${best.tilesPerSecond >= BUDGET.poolTilesPerSecond ? 'Yes' : 'No'}** — ` +
          `${best.tilesPerSecond.toFixed(0)} tiles/s at ${best.workers} workers |`,
      );
    }
  }
  if (sTs128 && sWasm128) {
    p(
      `| How much faster is the WASM kernel? | ` +
        `${(sTs128.timing.msPerOp / sWasm128.timing.msPerOp).toFixed(2)}× — on a narrower tile; see below |`,
    );
  }
  const worstAt = (n: number): DepthBenchRow | undefined =>
    [...r.depths].filter((d) => d.n === n).sort((a, b) => b.timing.msPerOp - a.timing.msPerOp)[0];
  const worst128 = worstAt(128);
  const worst64 = worstAt(64);
  if (worst128 && sTs128) {
    p(
      `| Where does the budget actually sit? | Depth ${String(worst128.depth)} at 129² costs ` +
        `${ms(worst128.timing.msPerOp)} ms, ${(worst128.timing.msPerOp / sTs128.timing.msPerOp).toFixed(2)}× the ` +
        'all-depths average |',
    );
  }
  const full = r.densities.find((d) => d.n === 128 && d.densityScale === 1);
  const bare = r.densities.find((d) => d.n === 128 && d.densityScale === 0);
  if (full && bare) {
    const share = 1 - bare.timing.msPerOp / full.timing.msPerOp;
    p(
      `| How much of a tile is the crater population? | ${(share * 100).toFixed(0)}% at 129², ` +
        `saturated — ${ms(full.timing.msPerOp - bare.timing.msPerOp)} ms of ${ms(full.timing.msPerOp)} |`,
    );
  }
  if (sTs64 && sTs128) {
    p(
      `| 65² or 129²? | **65²** — see §Grid size. Generation is not what settles it; ` +
        `\`BAND_GATE_N\` is |`,
    );
  }
  p();

  // --- machine ---
  p('## Machine');
  p();
  p(machineBlock());
  p();
  p(
    'This is the same integrated-GPU laptop `phase0.md` was measured on — the machine the ' +
      'spike plan names as the minimum target — so these are the numbers that decide rather ' +
      'than an upper bound to be discounted.',
  );
  if (isWsl()) {
    p();
    p(
      '> Running under WSL2. CPU-bound work is close to native, which is what everything in ' +
        'this file is. **Nothing here is a browser measurement**, and nothing here should be ' +
        'quoted as one: the browser legs run on the Windows side and are a separate sitting.',
    );
  }
  p();

  // --- single tile ---
  p('## Single-tile generation');
  p();
  p(
    'A spread of 24 tiles across all six faces and depths 0-6, so the figure averages ' +
      'over cache behaviours rather than reporting one tile that happens to fit in L2. ' +
      'Terrain is 10 octaves of fBm, and since WP10 the two-tier crater pass and the regolith ' +
      'pass run inside the same call — **this row is a whole Phase-1 tile, not an fBm pass**.',
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
  if (r.wasmAvailable) {
    p(
      '**The WASM rows are not like for like, and must not be quoted as a 6× alternative.** ' +
        '`crates/kernel-wasm` implements the base terrain field and nothing else: no crater ' +
        'pass, no regolith pass, no apron. `golden:parity` skips `tile.composite` from WP10 ' +
        'onward for exactly this reason. So the comparison above is a Phase-1 tile against a ' +
        'Phase-0 one, and the gap is mostly work the twin does not do. Before WASM can be an ' +
        'answer to an R4 trigger it has to grow both passes, which is the rest of the phase.',
    );
    p();
  } else {
    p(
      '> The WASM rows are missing: no compiled artefact was present. Build it with ' +
        '`pnpm wasm:build` and re-run. Note that the twin implements the base field only, so ' +
        'the comparison is not like for like in any case.',
    );
    p();
  }

  for (const row of [sTs64, sTs128]) {
    if (row) {
      p(
        `**Budget (${BUDGET.tileMs} ms/tile, single-threaded, ${row.n + 1}² grid):** ` +
          `${verdict(row.timing.msPerOp, BUDGET.tileMs, true)}`,
      );
      p();
    }
  }

  // --- by depth ---
  p('### Where the budget actually sits: cost by depth');
  p();
  p(
    'The average above spans depths 0-6, and an average is not what a budget is about. One ' +
      'tile per face at each depth, timed separately:',
  );
  p();
  p('| Depth | Bands | 65² ms/tile | 129² ms/tile |');
  p('|---:|---:|---:|---:|');
  const byDepth = new Map<number, { bands: number; at64?: number; at128?: number }>();
  for (const d of r.depths) {
    const entry = byDepth.get(d.depth) ?? { bands: d.bands };
    if (d.n === 64) entry.at64 = d.timing.msPerOp;
    if (d.n === 128) entry.at128 = d.timing.msPerOp;
    byDepth.set(d.depth, entry);
  }
  for (const [depth, e] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    p(
      `| ${String(depth)} | ${String(e.bands)} | ${e.at64 === undefined ? '—' : ms(e.at64)} | ` +
        `${e.at128 === undefined ? '—' : ms(e.at128)} |`,
    );
  }
  p();
  const shallow128 = r.depths.find((d) => d.n === 128 && d.depth === 0);
  const mid128 = [...r.depths].filter((d) => d.n === 128).sort((a, b) => a.timing.msPerOp - b.timing.msPerOp)[0];
  if (worst128 && shallow128 && mid128) {
    p(
      `**The cost is U-shaped in depth, and the expensive end is the shallow one.** The ` +
        `cheapest tile at 129² is depth ${String(mid128.depth)} at ${ms(mid128.timing.msPerOp)} ms; ` +
        `the dearest is depth ${String(worst128.depth)} at ${ms(worst128.timing.msPerOp)} ms. Two ` +
        'opposing effects cross over in the middle. Going *down* the tree, `bandsForDepth` ' +
        'admits finer crater bands, monotonically, and each one is more candidates per sample. ' +
        'Going *up*, the tile covers more of the sphere, so the per-row basin cull rejects less ' +
        'of the field and the tier-2 lattice cache spans a larger box — a depth-0 tile is a ' +
        'whole cube face, and a large fraction of the world\'s basins genuinely reach it.',
    );
    p();
  }
  if (worst128 && worst64) {
    p(
      `**Against the ${BUDGET.tileMs} ms budget, taken on the worst tile rather than the ` +
        `average — which is what a budget means:** 129² (depth ${String(worst128.depth)}, ` +
        `${ms(worst128.timing.msPerOp)} ms) ${verdict(worst128.timing.msPerOp, BUDGET.tileMs, true)}; ` +
        `65² (depth ${String(worst64.depth)}, ${ms(worst64.timing.msPerOp)} ms) ` +
        `${verdict(worst64.timing.msPerOp, BUDGET.tileMs, true)}.`,
    );
    p();
    if (worst128.timing.msPerOp > BUDGET.tileMs && worst128.depth <= 1) {
      p(
        '> The tile that misses is a **root tile**, which is the one every session draws ' +
          'first. It is inside the R13 shell, not out at the end of a zoom.',
      );
      p();
    }
  }
  p(
    `The **Bands** column is the same at both grid sizes, and that is not a rounding of the ` +
      `table. \`bandsForDepth\` gates on \`BAND_GATE_N = ${String(BAND_GATE_N)}\` — a *reference* ` +
      'sample spacing, not the caller\'s grid — so a 129² tile evaluates exactly the bands its ' +
      '65² counterpart does, over four times the vertices. That is the fact §Grid size turns on.',
  );
  p();

  // --- by density ---
  p('### What the crater population costs');
  p();
  p(
    'The same tile set, with `spec.craters.densityScale` overridden and everything else held ' +
      'to the field. At `0` every candidate is rejected by the acceptance hash, so the lattice ' +
      'walk, the basin field and the regolith pass all still run and no crater survives them: ' +
      'the gap between the rows is the crater population and nothing else.',
  );
  p();
  p('| Density | 65² ms/tile | 129² ms/tile |');
  p('|---:|---:|---:|');
  const byDensity = new Map<number, { at64?: number; at128?: number }>();
  for (const d of r.densities) {
    const entry = byDensity.get(d.densityScale) ?? {};
    if (d.n === 64) entry.at64 = d.timing.msPerOp;
    if (d.n === 128) entry.at128 = d.timing.msPerOp;
    byDensity.set(d.densityScale, entry);
  }
  for (const [density, e] of [...byDensity.entries()].sort((a, b) => b[0] - a[0])) {
    p(
      `| ${density.toFixed(2)} | ${e.at64 === undefined ? '—' : ms(e.at64)} | ` +
        `${e.at128 === undefined ? '—' : ms(e.at128)} |`,
    );
  }
  p();
  if (full && bare) {
    const half = r.densities.find((d) => d.n === 128 && d.densityScale === 0.5);
    p(
      `**The benchmark world is the expensive case and this is where to see it.** \`X800000-0\` ` +
        'is Atmosphere 0, which the ruleset interprets to a saturated `densityScale` of 1.0 — ' +
        'the most cratered surface the tables produce. The 1.00 row is therefore a budget ' +
        'check, not a typical world; a world with any atmosphere at all sits lower down this ' +
        'table.',
    );
    p();
    p(
      `Halving the density buys ` +
        `${half ? ms(full.timing.msPerOp - half.timing.msPerOp) : 'n/a'} ms and removing the ` +
        `population entirely buys ${ms(full.timing.msPerOp - bare.timing.msPerOp)} ms, so ` +
        `**${((1 - bare.timing.msPerOp / full.timing.msPerOp) * 100).toFixed(0)}% of a saturated ` +
        'tile is craters**. That is the ceiling on what a tighter saturation cap could ever ' +
        'return, and the floor underneath it — the fBm field, the lattice traversal, the ' +
        'regolith pass and the copy — is what any mitigation has to work against.',
    );
    p();
  }

  // --- basins ---
  p('### The tier-1 basin field');
  p();
  p(
    `\`buildBasins\` places ${r.basins.count.toLocaleString()} basins in ` +
      `${ms(r.basins.timing.msPerOp)} ms. **This is a per-tile cost, not a per-world one**: ` +
      '`generateTile` rebuilds the field on every call rather than caching it per world, ' +
      'deliberately, because a cache here would be a second place for the tile path and the ' +
      'export path to disagree. It is already inside every figure above.',
  );
  p();
  if (sTs128 && sTs64) {
    p(
      `It is also the one part of the pass that does not scale with the grid, so it is ` +
        `${((r.basins.timing.msPerOp / sTs128.timing.msPerOp) * 100).toFixed(1)}% of a 129² tile and ` +
        `${((r.basins.timing.msPerOp / sTs64.timing.msPerOp) * 100).toFixed(1)}% of a 65² one — the ` +
        'fixed overhead that a larger tile amortises and a smaller one pays four times over.',
    );
    p();
  }

  // --- grid size ---
  p('## Grid size: 65² or 129²? (open question 1)');
  p();
  const g65 = sTs64;
  const g129 = sTs128;
  if (g65 && g129) {
    const perTile = g129.timing.msPerOp / g65.timing.msPerOp;
    const perVertex = g129.nsPerVertex / g65.nsPerVertex;
    p(
      `A 129² tile has ${(g129.vertices / g65.vertices).toFixed(2)}× the vertices of a 65² one and ` +
        `costs ${perTile.toFixed(2)}× as much to generate. Per vertex that is ${perVertex.toFixed(2)}×.`,
    );
    p();
    p(
      'Phase 0 argued this per unit of screen covered: at a given screen-space error one 129² ' +
        'tile replaces four 65² ones, so a flat per-vertex cost makes the two a wash on ' +
        '**generation** and hands the decision to fixed costs — draw calls, worker messages, ' +
        'cache entries, over-generation beyond the frustum.',
    );
    p();
    p(
      '**That premise does not hold in the viewer as built, and it is the answer to the ' +
        'question.** Two constants decide it, and neither is in this file:',
    );
    p();
    p(
      '1. `lod/quadtree.ts`\'s `screenSpaceError` is the sagitta of the tile\'s bounding cap ' +
        'against the sphere. It does not read the grid resolution at all, so the same cut of ' +
        'the quadtree is chosen at either size. A 129² mesh does not replace four 65² ones — ' +
        'it draws the same tiles with four times the vertices.',
    );
    p(
      `2. \`bandsForDepth\` gates crater bands on \`BAND_GATE_N = ${String(BAND_GATE_N)}\`, a ` +
        'reference spacing rather than the caller\'s grid, and fBm octaves come from the ' +
        'ruleset per world rather than per depth. So the *field* a tile samples is identical ' +
        'at both sizes.',
    );
    p();
    p(
      `Together those mean a 129² mesh costs ${perTile.toFixed(2)}× the generation for a field ` +
        'with no more detail in it — four times the samples of something already band-limited ' +
        'to a 65² grid. Moving the viewer up would only buy detail if `BAND_GATE_N` moved with ' +
        'it, and that constant is inside the whitelisted zone: an output change, a `GEN_VERSION` ' +
        'bump, and a strictly *larger* tile cost than the one measured here — which, at 129² on ' +
        'the worst tile, is already over budget.',
    );
    p();
    if (perVertex < 0.95) {
      p(
        `Per-vertex cost does still **fall** by ${((1 - perVertex) * 100).toFixed(0)}% at 129², so ` +
          'the larger grid amortises the fixed per-tile costs — the basin field above is most ' +
          'of that. It is a real effect and it is buying nothing here, because the extra ' +
          'vertices are not wanted in the first place.',
      );
    } else if (perVertex > 1.05) {
      p(
        `Per-vertex cost **rises** by ${((perVertex - 1) * 100).toFixed(0)}% at 129² — the larger ` +
          'working set is falling out of cache. That points the same way.',
      );
    } else {
      p(
        'Per-vertex cost is flat between the two, so the amortisation argument for the larger ' +
          'grid does not even hold on its own terms.',
      );
    }
    p();
    p(
      `**Conclusion: 65².** The viewer already meshes there and the band gate is already ` +
        `calibrated there; what has to move is the hashed grid, which is a fixture-spec change ` +
        'and not a generator version — the fixture-spec hash covers the grid size precisely so ' +
        'that pinning a different sampling of an unchanged field does not mint a version no ' +
        'user could reach.',
    );
    p();
  }

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
  for (const n of [64, 128]) {
    const best = bestPool(n);
    if (best) {
      p(
        `**Budget (≥${BUDGET.poolTilesPerSecond} tiles/s sustained, ${n + 1}²):** ` +
          `${verdict(best.tilesPerSecond, BUDGET.poolTilesPerSecond, false)} ` +
          `at ${best.workers} workers.`,
      );
      p();
    }
  }
  p(
    `**The requirement underneath both budgets is R13: an interactive globe within ` +
      `${String(BUDGET.shellSeconds)} s.** The ${String(BUDGET.tileMs)} ms/tile figure is a proxy ` +
      `for it, derived from a ${String(BUDGET.shellTiles)}-tile initial shell across four workers. ` +
      'Since the LOD cut does not depend on grid resolution, that shell is the same *number* of ' +
      'tiles at either size, so the proxy can be checked directly:',
  );
  p();
  p('| Grid | Best tiles/s | Shell of 96 tiles | R13 (≤10 s) |');
  p('|---|---:|---:|---|');
  for (const n of [64, 128]) {
    const best = bestPool(n);
    if (best) {
      const seconds = BUDGET.shellTiles / best.tilesPerSecond;
      p(
        `| ${n + 1}² | ${best.tilesPerSecond.toFixed(1)} | ${seconds.toFixed(2)} s | ` +
          `${seconds <= BUDGET.shellSeconds ? `**PASS** — ${(BUDGET.shellSeconds / seconds).toFixed(1)}× inside` : '**MISS**'} |`,
      );
    }
  }
  p();
  p(
    '> Generation only. The shell also has to be meshed, uploaded and drawn, and that half ' +
      'has never been measured on the target machine in a real browser — it is §9.2, and it is ' +
      'still open. This row is a lower bound on the ten seconds, not a claim about them.',
  );
  p();
  const physical = cpus().length / 2;
  const atPhysical = r.pool.find((row) => row.workers === Math.round(physical) && row.n === 128);
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
  p(
    '- Every tile figure here comes from `TsTileGenerator.generate` — the shipped path. Phase 0 ' +
      'carried a standalone crater cost model alongside it; WP15 deleted it. Two implementations ' +
      'of one pass is how the Phase 0 summary came to add a pass to a figure that already ' +
      'contained it.',
  );
  p();
  p(`Sink checksum: \`${r.sink.toExponential(6)}\` (proof the work was not optimised away).`);
  p();
  p('Regenerate with `pnpm bench`. Numbers move with hardware, Node version and thermal state.');
  p();

  return out.join('\n');
}
