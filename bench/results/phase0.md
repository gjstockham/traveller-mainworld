# Spike B — Phase 0 performance baseline

**Generated:** 2026-08-03T14:01:44.186Z
**Work package:** WP5 · **Parent:** [Phase 0 spike plan](../../docs/requirements/phase0-spike-plan.md) §B

## Summary

| Question | Answer |
|---|---|
| Does the TypeScript kernel meet the 100 ms/tile budget? | **Yes** — 41.0 ms at 129² |
| Does pool throughput reach 25 tiles/s? | **Yes** — 74 tiles/s at 7 workers |
| How much faster is the WASM kernel? | 2.11× — but see the note below |
| 65² or 129²? | 129², weakly — per-vertex cost falls 8%. Generation does not settle it; see §Grid size |

> **On the WASM speed advantage.** The kernel decision (WP6) turns on the criteria in spike plan §A.3, and "faster" is not one of them. Those criteria ask whether the TypeScript kernel *meets* the budget, not whether anything beats it — and it does, with 2.4× to spare. A 2.1× win on a budget already met buys headroom nobody has asked for, at the cost of a second toolchain in CI and a second implementation to keep in step forever. Recording the number here so WP6 can weigh it deliberately rather than discover it.

## Machine

- **CPU:** 11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz — 8 logical processors
- **RAM:** 15.5 GiB
- **OS:** Linux 6.18.33.1-microsoft-standard-WSL2 (x64)
- **Runtime:** Node v24.11.1, V8 13.6.233.10-node.28
- **Generator:** 0.1.0

This is the integrated-GPU laptop the spike plan names as the minimum target, so these are the numbers that decide rather than an upper bound to be discounted.

> Running under WSL2. CPU-bound work is close to native, but the browser legs of Spike B run on the Windows side and should be measured there separately.

## Single-tile generation

A spread of 24 tiles across all six faces and depths 0-6, so the figure averages over cache behaviours rather than reporting one tile that happens to fit in L2. Terrain is 10 octaves of fBm — the representative Phase-1 tile from §B.1, not the 8-octave default, because octave count is keyed to depth and the deepest tiles are the ones that have to fit the budget.

| Kernel | Grid | Vertices | Median ms/tile | Min | p95 | ns/vertex |
|---|---|---:|---:|---:|---:|---:|
| typescript | 65² | 4,225 | 11.3 | 10.6 | 13.7 | 2679.8 |
| typescript | 129² | 16,641 | 41.0 | 39.4 | 42.8 | 2466.0 |
| wasm | 65² | 4,225 | 5.50 | 5.20 | 7.68 | 1301.7 |
| wasm | 129² | 16,641 | 19.4 | 18.7 | 21.2 | 1167.4 |

The WASM rows include marshalling: `WasmTileGenerator` copies the finished buffers out of linear memory into the caller's arrays, because that is what using the kernel from JavaScript actually costs. Timing the Rust in isolation would flatter it with a number no caller can obtain.

**Budget (100 ms/tile, single-threaded, 129² grid):** **PASS** — 2.4× inside budget

### Grid size: 65² or 129²? (open question 1)

A 129² tile has 3.94× the vertices of a 65² one and costs 3.62× as much to generate. Per vertex that is 0.92×.

The comparison that matters is not per tile but **per unit of screen covered**: at a given screen-space error, one 129² tile replaces four 65² tiles. So if per-vertex cost is flat, the two are a wash on generation and the choice turns on the fixed costs — draw calls, worker messages, cache entries, and how much terrain gets generated beyond the frustum because the LOD granularity is coarse.

Per-vertex cost **falls** by 8% at 129², so the larger grid amortises per-tile overhead measurably. That favours 129².

## Crater pass (Phase-1 cost model)

Phase 0 has no craters. §B.1 nonetheless specifies them as part of the representative tile, so `bench/src/craters.ts` does the work a crater pass does — cell-hashed placement over a fixed face subdivision, compact-support profile compositing — to show how much headroom the fBm pass leaves. **It is a cost model, not a proposed algorithm, and it cannot affect a golden hash.**

| Grid | Median ms/tile | Cells visited | Craters placed | Vertex updates |
|---|---:|---:|---:|---:|
| 65² | 0.194 | 2,171 | 786 | 6,186 |
| 129² | 0.700 | 7,330 | 2,519 | 27,135 |

Full Phase-1 tile estimate at 129²: **41.7 ms** (41.0 fBm + 0.700 craters). **PASS** — 2.4× inside budget

**Global pass** (large-crater placement over 512²-per-face): 7.58 ms for the whole planet. Paid once per world, not per tile.

## Worker-pool throughput

`node:worker_threads`, not browser `Worker`s: the scaling shape carries over — both are OS threads running the same V8 — but treat the absolute numbers as the reference platform's.

| Workers | Grid | Tiles/s | Scaling efficiency | Median ms/tile |
|---:|---|---:|---:|---:|
| 1 | 129² | 25.0 | 100% | 40.0 |
| 2 | 129² | 40.3 | 81% | 24.8 |
| 3 | 129² | 51.2 | 68% | 19.5 |
| 4 | 129² | 59.4 | 59% | 16.8 |
| 5 | 129² | 66.5 | 53% | 15.0 |
| 6 | 129² | 71.7 | 48% | 13.9 |
| 7 | 129² | 74.3 | 42% | 13.5 |

**Budget (≥25 tiles/s sustained):** **PASS** — 3.0× inside budget at 7 workers.

**Read the efficiency column carefully.** It is measured against *one worker*, but this machine has 4 physical cores behind 8 logical ones. At 4 workers — one per physical core — efficiency is 59%. Beyond that the extra threads share execution units, so the remaining gains come from SMT filling stalls rather than from real parallelism, and the falling percentage is the expected shape rather than a bottleneck to hunt. The main thread also does real work here: it receives every tile and touches it.

## Buffer transfer

The plan says "prove transferables, do not assume them", and it is right to: a forgotten transfer list is silent, costs a full copy per tile, and looks exactly like a slow kernel. The `detached` column is `postMessage` having actually zeroed the sender's buffer.

| Grid | Payload | Alloc only | +transfer | +clone | postMessage: transfer | postMessage: clone | Detached? |
|---|---:|---:|---:|---:|---:|---:|:--:|
| 65² | 111.2 KiB | 0.052 | 0.042 | 0.027 | 0.000 | 0.000 | yes |
| 129² | 414.2 KiB | 0.061 | 0.038 | 0.177 | 0.000 | 0.116 | yes |

The first three columns all include allocating and touching the buffer; the last two subtract that control, isolating `postMessage` itself. Without the control the figures are dominated by allocation — an earlier version of this table reported a 129² transfer as ten times *faster* than a 65² one, which is not a fact about `postMessage`.

## Memory

| Grid | Vertices | Raw kernel output | Renderer-ready | Tiles per 256 MiB |
|---|---:|---:|---:|---:|
| 65² | 4,225 | 140.3 KiB | 111.2 KiB | 2,357 |
| 129² | 16,641 | 552.5 KiB | 414.2 KiB | 632 |

The raw kernel output never leaves the worker and is reused between tiles, so the LRU should be sized from the renderer-ready column.

| Grid | Cache capacity | ArrayBuffer growth | RSS growth | Per tile (measured) | Per tile (predicted) |
|---|---:|---:|---:|---:|---:|
| 65² | 512 | 55.6 MiB | -23.1 MiB | 111.2 KiB | 111.2 KiB |
| 129² | 128 | 51.8 MiB | 1.3 MiB | 414.2 KiB | 414.2 KiB |

Measured against `arrayBuffers`, not `heapUsed`: V8 allocates typed-array backing stores outside the JS heap, so `heapUsed` sees the wrapper objects and misses the data. That mistake reports a tile cache that costs a few hundred bytes per tile.

## Methodology

- Every workload is warmed up before measurement, because V8 interprets before it optimises and timing the first calls reports a number two orders of magnitude off.
- Results are folded into a sink that is printed at the end, so no call can be eliminated as dead code. A benchmark that reports 0.00 ms usually measured nothing.
- Median and p95 are reported rather than a mean: interference is one-sided, and one GC pause should not be allowed to dominate thirty clean samples. The minimum is the closest estimate of the machine's true cost.
- Scratch buffers are pooled outside the timed region, as the viewer's worker pools them.

Sink checksum: `-4.464416e+7` (proof the work was not optimised away).

Regenerate with `pnpm bench`. Numbers move with hardware, Node version and thermal state.
