# Spike C — exit-criteria evidence

**Work package:** Spike C (spike plan §C.2, implementation plan §4)
**Consumed by:** Phase 0 exit, and open question 1 (65² or 129² tile mesh)

Spike C asks whether the second project-killing risk is retired: **does CPU-side
generation, streamed under real navigation, hold up on the minimum hardware
target?** Spike B answered the throughput question in isolation, on a bench. This
file is where the *navigated* answer is recorded — the one that includes LOD
churn, worker contention, the renderer, and a session long enough for a leak to
show.

> **"All looks good" is not an entry in this file.** Five criteria, five
> measurements, each with a number or a described observation next to it. The
> impression that the fixtures fly nicely on a Windows laptop is what prompted
> the measuring; it is not a substitute for it. A criterion that was not measured
> is recorded as **not measured** — never inferred from the four that were.

## What is measured, and with what

Everything below is read off the diagnostics overlay in the viewer
(`packages/viewer/src/diagnostics/overlay.ts`), which exists for this purpose:
the measurements come from the running system rather than a parallel harness
that might not match it.

```
https://gjstockham.github.io/traveller-mainworld/viewer/?fixture=size8-earthlike
```

or locally, `pnpm --filter @traveller-mainworld/viewer dev`.

The panel reports, in the order the criteria need them:

| Panel line | Criterion it serves |
|---|---|
| `fps` — mean, p95 | ~60 fps target, 30 fps floor |
| `worst` — un-smoothed high-water mark, flagged `<-- STALL > 1s` | no stall over 1 s |
| `queue`, `gen`, `cancel` | why a stall happened, when one does |
| `heap` — main-thread JS heap and its drift from a post-startup baseline | memory stable over 10 minutes |
| `resident` — cached tile bytes, live and pooled mesh bytes | memory stable over 10 minutes |
| `session` — elapsed | that the 10 minutes were actually 10 minutes |

**The two memory numbers are independent on purpose, and neither is sufficient
alone.**

- `heap` comes from `performance.memory`, which is **non-standard, Chrome-only,
  quantised, and blind to worker heaps**. Tile generation happens in workers, so
  the number that looks most like "memory used" cannot see the generator. On
  Firefox and Safari the panel says the reading is unavailable rather than
  showing a zero, because a zero reads as a measurement.
- `resident` is counted rather than sampled: the tile cache sums the bytes it
  holds and the renderer sums its vertex and index buffers. Exact, and it covers
  the allocations a streaming viewer would actually leak.

Read together they localise a problem: flat resident with a rising heap points
at the main thread; rising resident points at the cache or the mesh pool. The
mesh pool is bounded (`poolSize`, default 256) and the cache is bounded
(`cacheCapacity`, default 512 tiles), so **both numbers reaching a plateau and
staying there is the shape a healthy long session has** — and a resident count
that keeps climbing past those bounds is a bug, not a workload.

## Two traps that invalidate a measurement

1. **Headless Chromium rasterises in software.** Frame timings from a Playwright
   run are meaningless and must never be pasted into this file (traps list, item
   8). Every fps and stall figure here comes from a real browser window on real
   hardware.
2. **WSL2 is not where the browser legs get measured.** CPU numbers there are
   near-native, so `pnpm bench` is fine, but the browser runs on the Windows
   side. A row measured under WSL2 says so.

A third, smaller: run on mains power with the machine otherwise idle. The M3
hand-check in [the WP4 evidence](wp4-manual-checks.md) took 264 s against 28 s
for the same work on the same device, purely from thermal throttling. A
contended machine produces numbers that mean nothing.

**Known harness limitation, recorded so it is not mistaken for a finding.**
`packages/viewer/e2e/smoke.spec.ts` is careful never to assert a frame time, but
`renders a recognisable globe` does wait for more than 20 tiles to become visible
within 30 s — a *streaming-rate* assertion, under software rasterisation, and
therefore sensitive to machine load in the same way trap 8 warns about. On a
contended WSL2 box it stalls at ~16 tiles and fails. Observed failing identically
on an unmodified tree with a fresh build, so it is a harness property rather than
a regression signal. It is not evidence about any criterion below; nothing in
this file may be read off a headless run.

## The target machine

Spike B's budgets are stated against "the minimum target": the integrated-GPU
laptop. Record which machine each run used, because the criteria are only
meaningful against that class.

| Field | Value |
|---|---|
| Machine | *(not recorded)* |
| CPU / cores | *(not recorded)* |
| GPU | *(not recorded)* |
| OS / browser | *(not recorded)* |
| Power | *(mains / battery)* |
| Build (commit) | *(not recorded)* |
| Fixture | *(e.g. `size8-earthlike`)* |
| Tile mesh `TILE_N` | 64 (65² mesh — note that generation is hashed at 129²; see open question 1) |

## Criteria

| # | Criterion (spike plan §C.2) | Measured | Result |
|---|---|---|---|
| C1 | Fly full-disc orbit → close range over a Size-8 world, tiles streaming throughout | | **not measured** |
| C2 | No visible crack or seam at any LOD boundary | | **not measured** |
| C3 | No stall > 1 s | | **not measured** |
| C4 | ~60 fps target, 30 fps floor, on the integrated-GPU laptop | | **not measured** |
| C5 | Memory stable over a 10-minute session | | **not measured** |

C2 is the one with no number attached, so it needs the most specific
description: which LOD boundaries were inspected, at what sun angle, and whether
the twelve cube-edge seams (open question 2) were distinguishable from LOD-level
seams. Skirts are drawn unconditionally across cube-face edges today and a faint
seam is *expected* there; a seam anywhere else is a finding.

## Results

Press **Copy evidence** under the panel and paste the block verbatim, the same
way the WP4 evidence blocks work — a transcribed summary is a claim, a pasted
block is evidence. The block carries a stamp above the numbers: world, mesh
resolution, exaggeration, user agent, hardware, screen, timestamp and the commit
the bundle was built from. That stamp is most of the machine table above, so
fill that in from a pasted block rather than from memory.

If the page is served over plain HTTP — a LAN address, say — `navigator.clipboard`
does not exist. The button then reveals the block in a selectable box and says
why, rather than silently doing nothing.

One block at the end of the orbit-to-surface flight (C1, C3, C4) and one at the
ten-minute mark (C5), so the two memory readings have a real interval between
them.

Fly with DevTools closed: having it open taxes the frame rate being measured.
The `session` clock and the heap baseline survive opening it afterwards.

<!-- C1/C3/C4 — end of the descent -->
```
world         fixture size8-earthlike — 6400 km radius, 20000 m relief, 8 octaves
tile mesh     65² (TILE_N 64)
exaggeration  1 (true scale)
user agent    Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36
hardware      cores 8, memory 32 GB
screen        1920×1080 @ 1
run at        2026-08-04T14:29:15.793Z
build         15664dfce7b7f2500155cfcb3cbce2d55e1a25eb

world    size8-earthlike  ·  build 15664df

fps         60   (16.7 ms mean, 16.9 p95)
worst       34 ms
altitude 20.7 Mm

tiles       60 visible, depth 3
tris     503.8k
queue        0 queued, 0/7 busy
gen      0.0 tiles/s, 10.1 ms/tile
cancel       4 dropped before start

cache    512/512  100% hit
xfer     77.5 MiB

heap     120.4 MiB / 4.09 GiB main thread only  +63.7 MiB over 22s
resident 55.6 MiB tiles (512), 6.5 MiB mesh live, 12.1 MiB pooled (111), 1.5 MiB shared
session  25s
```

<!-- C5 — ten minutes in -->
```
NOT MEASURED
```

### Notes on what was seen

*(Free text. C2 lives here, and so does anything the panel cannot say — a
hitch that felt wrong but did not trip the 1 s flag, a tile that arrived
visibly late, a seam that appears only at a grazing sun angle.)*

## If a criterion fails

1. **Record the failure here first**, with the panel block that shows it. A
   criterion that fails and is then fixed leaves both rows — the fix is evidence
   too.
2. `worst` over 1 s: read `queue`, `inFlight` and `gen` in the same block. A
   stall with an empty queue is a renderer or GC problem; a stall with a deep
   queue and every worker busy is a generation-throughput problem and belongs to
   ADR-0001's R4, not here.
3. fps under the floor with generation idle points at triangle count or fill
   rate — `tris` and the pixel ratio, not the kernel.
4. `resident` climbing past the cache and pool bounds is a leak in the eviction
   path. `heap` climbing with `resident` flat is a main-thread leak, and the
   workers are invisible to it either way.
5. A crack or seam that is not on a cube-face edge means the skirt depth or the
   neighbour mask is wrong for that LOD pair. Note the depth pair — it is the
   first thing anyone debugging it will want.
