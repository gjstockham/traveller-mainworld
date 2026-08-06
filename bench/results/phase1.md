# Phase 1 performance baseline

**Generated:** 2026-08-06T10:03:47.044Z
**Work package:** WP15 · **Parent:** [Phase 1 implementation plan](../../docs/plans/phase1-implementation-plan.md) §10

## Summary

| Question | Answer |
|---|---|
| Does the TypeScript kernel meet the 100 ms/tile budget at 65²? | **Yes** — 26.1 ms |
| Does the TypeScript kernel meet the 100 ms/tile budget at 129²? | **Yes** — 99.7 ms |
| Does pool throughput reach 25 tiles/s at 65²? | **Yes** — 111 tiles/s at 7 workers |
| Does pool throughput reach 25 tiles/s at 129²? | **Yes** — 31 tiles/s at 7 workers |
| How much faster is the WASM kernel? | 6.23× — on a narrower tile; see below |
| Where does the budget actually sit? | Depth 0 at 129² costs 122 ms, 1.22× the all-depths average |
| How much of a tile is the crater population? | 42% at 129², saturated — 43.0 ms of 103 |
| 65² or 129²? | **65²** — see §Grid size. Generation is not what settles it; `BAND_GATE_N` is |

## Machine

- **CPU:** 11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz — 8 logical processors
- **RAM:** 15.5 GiB
- **OS:** Linux 6.18.33.1-microsoft-standard-WSL2 (x64)
- **Runtime:** Node v24.11.1, V8 13.6.233.10-node.28
- **Generator:** 0.2.0

This is the same integrated-GPU laptop `phase0.md` was measured on — the machine the spike plan names as the minimum target — so these are the numbers that decide rather than an upper bound to be discounted.

> Running under WSL2. CPU-bound work is close to native, which is what everything in this file is. **Nothing here is a browser measurement**, and nothing here should be quoted as one: the browser legs run on the Windows side and are a separate sitting.

## Single-tile generation

A spread of 24 tiles across all six faces and depths 0-6, so the figure averages over cache behaviours rather than reporting one tile that happens to fit in L2. Terrain is 10 octaves of fBm, and since WP10 the two-tier crater pass and the regolith pass run inside the same call — **this row is a whole Phase-1 tile, not an fBm pass**.

| Kernel | Grid | Vertices | Median ms/tile | Min | p95 | ns/vertex |
|---|---|---:|---:|---:|---:|---:|
| typescript | 65² | 4,225 | 26.1 | 24.2 | 28.8 | 6177.0 |
| typescript | 129² | 16,641 | 99.7 | 90.6 | 107 | 5988.8 |
| wasm | 65² | 4,225 | 4.38 | 4.12 | 4.68 | 1036.4 |
| wasm | 129² | 16,641 | 16.0 | 15.1 | 17.2 | 962.0 |

**The WASM rows are not like for like, and must not be quoted as a 6× alternative.** `crates/kernel-wasm` implements the base terrain field and nothing else: no crater pass, no regolith pass, no apron. `golden:parity` skips `tile.composite` from WP10 onward for exactly this reason. So the comparison above is a Phase-1 tile against a Phase-0 one, and the gap is mostly work the twin does not do. Before WASM can be an answer to an R4 trigger it has to grow both passes, which is the rest of the phase.

**Budget (100 ms/tile, single-threaded, 65² grid):** **PASS** — 3.8× inside budget

**Budget (100 ms/tile, single-threaded, 129² grid):** **PASS** — 1.0× inside budget

### Where the budget actually sits: cost by depth

The average above spans depths 0-6, and an average is not what a budget is about. One tile per face at each depth, timed separately:

| Depth | Bands | 65² ms/tile | 129² ms/tile |
|---:|---:|---:|---:|
| 0 | 2 | 37.5 | 122 |
| 1 | 2 | 31.6 | 103 |
| 2 | 2 | 26.1 | 90.7 |
| 3 | 2 | 24.3 | 83.6 |
| 4 | 3 | 25.6 | 91.8 |
| 5 | 4 | 27.0 | 98.7 |
| 6 | 5 | 29.2 | 110 |

**The cost is U-shaped in depth, and the expensive end is the shallow one.** The cheapest tile at 129² is depth 3 at 83.6 ms; the dearest is depth 0 at 122 ms. Two opposing effects cross over in the middle. Going *down* the tree, `bandsForDepth` admits finer crater bands, monotonically, and each one is more candidates per sample. Going *up*, the tile covers more of the sphere, so the per-row basin cull rejects less of the field and the tier-2 lattice cache spans a larger box — a depth-0 tile is a whole cube face, and a large fraction of the world's basins genuinely reach it.

**Against the 100 ms budget, taken on the worst tile rather than the average — which is what a budget means:** 129² (depth 0, 122 ms) **MISS** by 1.22× — under 2×, so optimise rather than switch kernels; 65² (depth 0, 37.5 ms) **PASS** — 2.7× inside budget.

> The tile that misses is a **root tile**, which is the one every session draws first. It is inside the R13 shell, not out at the end of a zoom.

The **Bands** column is the same at both grid sizes, and that is not a rounding of the table. `bandsForDepth` gates on `BAND_GATE_N = 64` — a *reference* sample spacing, not the caller's grid — so a 129² tile evaluates exactly the bands its 65² counterpart does, over four times the vertices. That is the fact §Grid size turns on.

### What the crater population costs

The same tile set, with `spec.craters.densityScale` overridden and everything else held to the field. At `0` every candidate is rejected by the acceptance hash, so the lattice walk, the basin field and the regolith pass all still run and no crater survives them: the gap between the rows is the crater population and nothing else.

| Density | 65² ms/tile | 129² ms/tile |
|---:|---:|---:|
| 1.00 | 29.3 | 103 |
| 0.50 | 24.2 | 75.5 |
| 0.00 | 18.5 | 60.0 |

**The benchmark world is the expensive case and this is where to see it.** `X800000-0` is Atmosphere 0, which the ruleset interprets to a saturated `densityScale` of 1.0 — the most cratered surface the tables produce. The 1.00 row is therefore a budget check, not a typical world; a world with any atmosphere at all sits lower down this table.

Halving the density buys 27.5 ms and removing the population entirely buys 43.0 ms, so **42% of a saturated tile is craters**. That is the ceiling on what a tighter saturation cap could ever return, and the floor underneath it — the fBm field, the lattice traversal, the regolith pass and the copy — is what any mitigation has to work against.

### The tier-1 basin field

`buildBasins` places 1,623 basins in 0.200 ms. **This is a per-tile cost, not a per-world one**: `generateTile` rebuilds the field on every call rather than caching it per world, deliberately, because a cache here would be a second place for the tile path and the export path to disagree. It is already inside every figure above.

It is also the one part of the pass that does not scale with the grid, so it is 0.2% of a 129² tile and 0.8% of a 65² one — the fixed overhead that a larger tile amortises and a smaller one pays four times over.

## Grid size: 65² or 129²? (open question 1)

A 129² tile has 3.94× the vertices of a 65² one and costs 3.82× as much to generate. Per vertex that is 0.97×.

Phase 0 argued this per unit of screen covered: at a given screen-space error one 129² tile replaces four 65² ones, so a flat per-vertex cost makes the two a wash on **generation** and hands the decision to fixed costs — draw calls, worker messages, cache entries, over-generation beyond the frustum.

**That premise does not hold in the viewer as built, and it is the answer to the question.** Two constants decide it, and neither is in this file:

1. `lod/quadtree.ts`'s `screenSpaceError` is the sagitta of the tile's bounding cap against the sphere. It does not read the grid resolution at all, so the same cut of the quadtree is chosen at either size. A 129² mesh does not replace four 65² ones — it draws the same tiles with four times the vertices.
2. `bandsForDepth` gates crater bands on `BAND_GATE_N = 64`, a reference spacing rather than the caller's grid, and fBm octaves come from the ruleset per world rather than per depth. So the *field* a tile samples is identical at both sizes.

Together those mean a 129² mesh costs 3.82× the generation for a field with no more detail in it — four times the samples of something already band-limited to a 65² grid. Moving the viewer up would only buy detail if `BAND_GATE_N` moved with it, and that constant is inside the whitelisted zone: an output change, a `GEN_VERSION` bump, and a strictly *larger* tile cost than the one measured here — which, at 129² on the worst tile, is already over budget.

Per-vertex cost is flat between the two, so the amortisation argument for the larger grid does not even hold on its own terms.

**Conclusion: 65².** The viewer already meshes there and the band gate is already calibrated there; what has to move is the hashed grid, which is a fixture-spec change and not a generator version — the fixture-spec hash covers the grid size precisely so that pinning a different sampling of an unchanged field does not mint a version no user could reach.

## Worker-pool throughput

`node:worker_threads`, not browser `Worker`s: the scaling shape carries over — both are OS threads running the same V8 — but treat the absolute numbers as the reference platform's.

| Workers | Grid | Tiles/s | Scaling efficiency | Median ms/tile |
|---:|---|---:|---:|---:|
| 1 | 65² | 37.4 | 100% | 26.7 |
| 2 | 65² | 63.5 | 85% | 15.8 |
| 3 | 65² | 79.4 | 71% | 12.6 |
| 4 | 65² | 90.1 | 60% | 11.1 |
| 5 | 65² | 98.4 | 53% | 10.2 |
| 6 | 65² | 105.2 | 47% | 9.50 |
| 7 | 65² | 111.1 | 42% | 9.00 |
| 1 | 129² | 11.1 | 100% | 89.9 |
| 2 | 129² | 17.6 | 79% | 56.7 |
| 3 | 129² | 22.0 | 66% | 45.4 |
| 4 | 129² | 25.6 | 58% | 39.1 |
| 5 | 129² | 27.7 | 50% | 36.1 |
| 6 | 129² | 29.5 | 44% | 33.9 |
| 7 | 129² | 30.8 | 40% | 32.5 |

**Budget (≥25 tiles/s sustained, 65²):** **PASS** — 4.4× inside budget at 7 workers.

**Budget (≥25 tiles/s sustained, 129²):** **PASS** — 1.2× inside budget at 7 workers.

**The requirement underneath both budgets is R13: an interactive globe within 10 s.** The 100 ms/tile figure is a proxy for it, derived from a 96-tile initial shell across four workers. Since the LOD cut does not depend on grid resolution, that shell is the same *number* of tiles at either size, so the proxy can be checked directly:

| Grid | Best tiles/s | Shell of 96 tiles | R13 (≤10 s) |
|---|---:|---:|---|
| 65² | 111.1 | 0.86 s | **PASS** — 11.6× inside |
| 129² | 30.8 | 3.12 s | **PASS** — 3.2× inside |

> Generation only. The shell also has to be meshed, uploaded and drawn, and that half has never been measured on the target machine in a real browser — it is §9.2, and it is still open. This row is a lower bound on the ten seconds, not a claim about them.

**Read the efficiency column carefully.** It is measured against *one worker*, but this machine has 4 physical cores behind 8 logical ones. At 4 workers — one per physical core — efficiency is 58%. Beyond that the extra threads share execution units, so the remaining gains come from SMT filling stalls rather than from real parallelism, and the falling percentage is the expected shape rather than a bottleneck to hunt. The main thread also does real work here: it receives every tile and touches it.

## Buffer transfer

The plan says "prove transferables, do not assume them", and it is right to: a forgotten transfer list is silent, costs a full copy per tile, and looks exactly like a slow kernel. The `detached` column is `postMessage` having actually zeroed the sender's buffer.

| Grid | Payload | Alloc only | +transfer | +clone | postMessage: transfer | postMessage: clone | Detached? |
|---|---:|---:|---:|---:|---:|---:|:--:|
| 65² | 111.2 KiB | 0.012 | 0.047 | 0.087 | 0.035 | 0.075 | yes |
| 129² | 414.2 KiB | 0.071 | 0.071 | 0.079 | 0.001 | 0.008 | yes |

The first three columns all include allocating and touching the buffer; the last two subtract that control, isolating `postMessage` itself. Without the control the figures are dominated by allocation — an earlier version of this table reported a 129² transfer as ten times *faster* than a 65² one, which is not a fact about `postMessage`.

## Memory

| Grid | Vertices | Raw kernel output | Renderer-ready | Tiles per 256 MiB |
|---|---:|---:|---:|---:|
| 65² | 4,225 | 140.3 KiB | 111.2 KiB | 2,357 |
| 129² | 16,641 | 552.5 KiB | 414.2 KiB | 632 |

The raw kernel output never leaves the worker and is reused between tiles, so the LRU should be sized from the renderer-ready column.

| Grid | Cache capacity | ArrayBuffer growth | RSS growth | Per tile (measured) | Per tile (predicted) |
|---|---:|---:|---:|---:|---:|
| 65² | 512 | 55.6 MiB | 0 B | 111.2 KiB | 111.2 KiB |
| 129² | 128 | 51.8 MiB | 0 B | 414.2 KiB | 414.2 KiB |

Measured against `arrayBuffers`, not `heapUsed`: V8 allocates typed-array backing stores outside the JS heap, so `heapUsed` sees the wrapper objects and misses the data. That mistake reports a tile cache that costs a few hundred bytes per tile.

## Methodology

- Every workload is warmed up before measurement, because V8 interprets before it optimises and timing the first calls reports a number two orders of magnitude off.
- Results are folded into a sink that is printed at the end, so no call can be eliminated as dead code. A benchmark that reports 0.00 ms usually measured nothing.
- Median and p95 are reported rather than a mean: interference is one-sided, and one GC pause should not be allowed to dominate thirty clean samples. The minimum is the closest estimate of the machine's true cost.
- Scratch buffers are pooled outside the timed region, as the viewer's worker pools them.
- Every tile figure here comes from `TsTileGenerator.generate` — the shipped path. Phase 0 carried a standalone crater cost model alongside it; WP15 deleted it. Two implementations of one pass is how the Phase 0 summary came to add a pass to a figure that already contained it.

Sink checksum: `-1.220685e+7` (proof the work was not optimised away).

Regenerate with `pnpm bench`. Numbers move with hardware, Node version and thermal state.
