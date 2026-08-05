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

> **Status, 2026-08-05:** all five criteria are measured and pass. C1, C3, C4
> and C5 on build `e444dc8`; **C2 observed on build `2aac354` and recorded
> below** — six depth pairs from 1/2 to 6/7, side lighting, no seam found at any
> of them and none on the cube-face edges either.
>
> **One artefact was seen and is not a seam:** tiles occasionally flicker black
> while zooming. It is recorded as an open finding under C2's notes rather than
> folded into the pass, because it is a real observation about the renderer and
> the one thing that would hide it is calling it cosmetic. It does not meet the
> wording of C2 — a flicker is not a crack or a seam at a boundary — and it
> cannot reach a hash, being downstream of generation entirely.

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
| `session` — elapsed, split into active and hidden | that the 10 minutes were actually 10 minutes |

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
| Machine | Windows laptop, the author's |
| CPU / cores | 8 logical cores (7 workers + main thread) |
| GPU | **not recorded** — see the note below; it is the one gap in C4's provenance |
| OS / browser | Windows 10/11 x64, Chrome 150.0.0.0 |
| Memory / screen | 32 GB, 1920×1080 @ 1 |
| Power | *(not recorded)* |
| Build (commit) | `e444dc8e02edf756aa23ca8d5c8e9158a29f36ad` |
| Fixture | `size8-earthlike` — 6400 km radius, 20000 m relief, 8 octaves |
| Tile mesh `TILE_N` | 64 (65² mesh — note that generation is hashed at 129²; see open question 1) |

**On the GPU line.** C4 is written against "the integrated-GPU laptop", and the
user agent cannot say which GPU rendered. The figures below are from the author's
Windows laptop, which is the machine that phrase refers to, but the block cannot
prove that by itself. Recorded as a gap rather than papered over: if C4 is ever
questioned, this is the line to fill.

## Criteria

All measurements from **block C** below (build `e444dc8`, 2026-08-04) unless
stated. Blocks A and B are earlier runs, kept for what they show.

| # | Criterion (spike plan §C.2) | Measured | Result |
|---|---|---|---|
| C1 | Fly full-disc orbit → close range over a Size-8 world, tiles streaming throughout | Descended from 20.7 Mm (block A, ~3.2 radii, full disc) to **12.8 km altitude at depth 7**; 40 tiles visible, 363 cached, 39.4 MiB streamed, 100% hit rate, nothing queued or cancelled at rest | **PASS** |
| C2 | No visible crack or seam at any LOD boundary | Author's observation, build `2aac354`, `size8-earthlike` at true scale, side-lit (sun ~90° right of view): **no seam at depth pairs 1/2, 2/3, 3/4, 4/5, 5/6 or 6/7**, and none distinguishable on the twelve cube-face edges either — so the faint edge seam the README predicts was not reachable in normal use. Separate artefact recorded below | **PASS**, with an open finding |
| C3 | No stall > 1 s | **Worst frame 18 ms** across an uninterrupted 10m 50s session (bare `session` line and no excluded frames ⇒ the tab never went hidden) | **PASS** |
| C4 | ~60 fps target, 30 fps floor, on the integrated-GPU laptop | **60 fps mean (16.7 ms), 16.9 ms p95**, measured at depth 7 rather than at orbit | **PASS** |
| C5 | Memory stable over a 10-minute session | Heap `+43.2 MiB` over 10m 47s against `39.4 MiB` tiles + `13.0 MiB` mesh resident; no allocation activity at rest. See the argument below | **PASS**, with a stated limitation |

**C4 is met at the hard end.** 16.9 ms p95 at depth 7 with 335.6k triangles is
the target rate, not the 30 fps floor, and it is measured at close range rather
than at the orbit framing where there is least to draw.

**C5 needs its argument written out**, because a single end-of-session sample
cannot show a trend on its own:

- Heap rose 43.2 MiB from a baseline taken 3 s after load. Over the same period
  the cache filled to 363 tiles (39.4 MiB) and the renderer took 4.3 MiB of live
  and 8.7 MiB of pooled mesh buffers — about 53.9 MiB of accounted allocation.
  **The growth is explained by the working set filling, not unexplained drift.**
- At rest the panel reports `gen 0.0 tiles/s`, `queue 0`, `cancel 0`: nothing was
  being allocated during the soak.
- Both resident figures are bounded by construction — cache capacity 512 tiles,
  mesh pool 256 — and those bounds are unit-tested.
- **Block B is the cross-check that matters.** A 17m 37s session on the previous
  build drifted `+44.6 MiB`; this 10m 47s one drifted `+43.2 MiB`. 63% more
  elapsed time produced 3% more drift, so growth tracks *work done* rather than
  time — which is what distinguishes a working set from a leak.

*The limitation, stated rather than glossed:* the panel reports drift against a
baseline, not a series, so "grew during the descent then went flat" and "grew
steadily throughout" are not distinguishable from one block. The three bullets
above are what makes the first reading the better-supported one; a sampled trend
would settle it outright and does not exist.

**C2 is measured, and it is the one criterion no instrument could supply.** The
description asked for three things and got them: six depth pairs from 1/2 to
6/7, side lighting rather than a sub-solar flypast, and an explicit answer on
the cube-face edges. Skirts are drawn unconditionally across those twelve edges
today, so a faint seam there was *expected* and would not have been a finding —
it was not seen either, which is a slightly stronger result than the README
currently claims and is worth knowing before craters land.

**What the pass does not cover.** Two limits, stated rather than glossed. It is
one observer on one machine at one lighting angle, so it is an observation and
not a measurement — that is inherent to the criterion and is why the spike plan
asks for a description. And the black-flicker finding below was seen in the same
session; it is not a seam, but it is in the same subsystem, and a reader
concluding "the tile renderer is clean" from this row would be going further
than the row goes.

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

**Keep the tab visible for the whole session.** `requestAnimationFrame` stops in
a hidden tab, so the first frame back carries the entire gap in its delta — and
as a frame time that is indistinguishable from a stall. The first ten-minute
attempt reported a `58,532 ms` worst frame with an empty queue, an idle worker
pool and a 16.9 ms p95, which is a backgrounded tab and nothing like a stall.

The panel now separates the two rather than leaving it to be argued afterwards:
the resumed frame is excluded from the timing statistics and `worst` says so, and
the `session` line reads `17m 40s total — 3m 40s active, 14m 00s hidden in 2
gaps` when it applies. A bare duration therefore means an uninterrupted session.
A block with hidden time in it is still usable evidence for C5 — but the number
that matters is **active**, because nothing renders, streams or allocates while
the tab is away.

### Block A — full-disc orbit, 25 s (context, not a criterion)

Kept because it is the other end of C1's flight and the only record of the orbit
framing. It does *not* evidence C1 on its own: `altitude 20.7 Mm` on a 6400 km
world is about 3.2 radii, and `session 25s` is not a soak.

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

### Block B — 17m 37s, and the instrument it broke

**This block records a measurement failure, and is kept for that reason.** Read
`worst 58532 ms <-- STALL > 1s` alongside `queue 0`, `gen 0.0 tiles/s` and a
`16.9 p95`: nothing was running. `requestAnimationFrame` stops in a hidden tab,
so the first frame back carried the whole background period in its delta, and the
panel booked it as a stall. The criterion it appeared to fail is C3, so an
instrument that cannot separate those two cannot answer C3 at all.

Fixed in `e444dc8`, which excludes the resumed frame from the timing statistics
and splits the session line into active and hidden. Block C is the re-run.

Its memory figures stand and are cited above as C5's cross-check — nothing about
the hidden tab affects the heap or resident readings.

```
world         fixture size8-earthlike — 6400 km radius, 20000 m relief, 8 octaves
tile mesh     65² (TILE_N 64)
exaggeration  1 (true scale)
user agent    Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36
hardware      cores 8, memory 32 GB
screen        1920×1080 @ 1
run at        2026-08-04T15:21:42.983Z
build         75c26ac75f4c85b0bcabbb8c5c8dd4af08ed0d1e

world    size8-earthlike  ·  build 75c26ac

fps         60   (16.7 ms mean, 16.9 p95)
worst    58532 ms  <-- STALL > 1s
altitude 12.8 km

tiles       41 visible, depth 7
tris     346.1k
queue        0 queued, 0/7 busy
gen      0.0 tiles/s, 10.1 ms/tile
cancel       0 dropped before start

cache    476/512  100% hit
xfer     51.7 MiB

heap     88.7 MiB / 4.09 GiB main thread only  +44.6 MiB over 17m 37s
resident 51.7 MiB tiles (476), 4.5 MiB mesh live, 11.9 MiB pooled (110), 1.5 MiB shared
session  17m 40s
```

### Block C — the record: C1, C3, C4, C5

Uninterrupted: the `session` line is a bare duration and `worst` carries no
excluded-frame note, which together mean the tab stayed visible for all 10m 50s.
That is what makes `worst 18 ms` a number about the renderer.

```
world         fixture size8-earthlike — 6400 km radius, 20000 m relief, 8 octaves
tile mesh     65² (TILE_N 64)
exaggeration  1 (true scale)
user agent    Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36
hardware      cores 8, memory 32 GB
screen        1920×1080 @ 1
run at        2026-08-04T15:48:59.958Z
build         e444dc8e02edf756aa23ca8d5c8e9158a29f36ad

world    size8-earthlike  ·  build e444dc8

fps         60   (16.7 ms mean, 16.9 p95)
worst       18 ms
altitude 12.8 km

tiles       40 visible, depth 7
tris     335.6k
queue        0 queued, 0/7 busy
gen      0.0 tiles/s, 10.9 ms/tile
cancel       0 dropped before start

cache    363/512  100% hit
xfer     39.4 MiB

heap     74.0 MiB / 4.09 GiB main thread only  +43.2 MiB over 10m 47s
resident 39.4 MiB tiles (363), 4.3 MiB mesh live, 8.7 MiB pooled (80), 1.5 MiB shared
session  10m 50s
```

### Notes on what was seen

**C2 — recorded, and passing.** See the filled block further down, and the
finding immediately below, which is deliberately kept out of the pass.

#### Open finding — tiles flicker black while zooming

Seen during the C2 session on build `2aac354`. Not reproduced to a rule: it is
occasional and correlated with zooming rather than with any particular depth or
face. **Not a seam**, so C2's wording is not affected; recorded here because the
alternative is that it lives only in a chat log.

It cannot affect a hash. The tile data is generated in a worker and hashed
before it is ever drawn, and everything downstream of `buildTileColours` is
presentation. So this is a renderer bug or a mesh-lifecycle bug, and it is
bounded to those.

Three hypotheses, cheapest first, and each is falsifiable without much work:

1. **A skirt caught face-on.** The most likely, and it fits "while zooming"
   exactly. A skirt is a wall of duplicated edge vertices pushed inward; it is
   near-radial, so it is barely lit and renders almost black — the README says
   so under "Skirts and seams". `lod/neighbours.ts` reselects which of the
   sixteen index buffers a tile uses whenever a neighbour's depth changes, which
   is precisely what a zoom causes. If a tile is briefly drawn with skirts on
   all four edges while the camera is close enough to see the wall, that is a
   black flash. **Check:** force the all-edges index buffer and see whether the
   artefact becomes constant.
2. **A frame drawn before the colour buffer is written.** `buildTileColours`
   fills per-vertex colours; a mesh added to the scene one frame before that
   completes would draw with a zeroed colour attribute, which is black.
   **Check:** does the artefact survive setting the pool's default colour to
   magenta? If the flash turns magenta, it is an unpopulated buffer, not a
   skirt.
3. **Mesh-pool reuse.** A pooled mesh reattached with stale geometry for a
   frame. Same test as 2 discriminates it — magenta says buffer, black says
   geometry.

Hypothesis 2's check is the one to run first: it is one line, and it splits the
three cleanly.

**Why this matters more than it looks.** Craters are the highest-frequency
signal this project will ever draw, and WP12's apron changes the same mesh path
this artefact lives in. Diagnosing it *now*, against flat-shaded Phase 0
geometry, is the same argument that put C2 before WP10 — afterwards it is
ambiguous between the skirt, the apron and a crater band.

*(Free text. C2 lives here, and so does anything the panel cannot say — a
hitch that felt wrong but did not trip the 1 s flag, a tile that arrived
visibly late, a seam that appears only at a grazing sun angle.)*

#### How to fly C2, and what the three answers are

**The sun does not move, and there is no control for it.** `render/planet.ts`
fixes one directional light at `(1, 0.35, 0.6)` normalised, and `main.ts` pins
it to the world rather than the camera, so it stays put as you orbit. There is
no `?sun=` parameter. **The sun angle is therefore chosen by where you fly**:
orbit until the patch you want to inspect sits near the terminator, and the
light is grazing; fly to the sub-solar point and it is flat.

That matters, because the two conditions answer different questions. Grazing
light near the terminator is what *reveals* a seam — a skirt wall is near-radial
and catches low light, and a normal discontinuity throws a hard line. Flat
sub-solar light hides all of it. **Inspect near the terminator.** A "no seams"
observation made at the sub-solar point is close to worthless and should say
which it was.

**Which LOD boundaries.** A boundary is wherever a coarse tile abuts a finer
one, which is the ring around wherever the camera is looking as you descend.
The overlay's `tiles N visible, depth D` gives the depth at the centre of view,
so the ring you are looking at is the `D-1 / D` pair. Descend slowly through
several, and write down the pairs you actually stopped and looked at — "depths
4/5, 5/6 and 6/7" is an answer; "all of them" is not.

**Cube-edge versus LOD seam.** Twelve cube-face edges are skirted
unconditionally today (README, "Skirts and seams"), because cross-face
adjacency needs a rotation table the viewer does not carry, so **a faint seam
along a cube edge is expected and is not a finding**. To tell them apart: pull
back to orbit first and note where the six face boundaries run across the globe
— at depth 0 those *are* the twelve cube edges — then descend deliberately, once
along a face boundary and once through the middle of a face. A seam in the
face interior is a finding; a seam on the boundary is the known limitation.

If you find one that is not on a cube edge, **note the depth pair** — per "If a
criterion fails" item 5, it means the skirt depth or the neighbour mask is wrong
for that pair, and the pair is the first thing anyone debugging it will want.

#### C2 — fill this in

```
Build (commit):        2aac354
Machine / browser:     same                  (same laptop as the blocks above?)
Fixture:               size8-earthlike
Exaggeration:          1                     (1 unless there is a reason)

LOD boundaries inspected (depth pairs):
                       1/2 2/3 3/4 4/5 5/6 6/7

Sun angle at inspection:
                       90 to the right          (near terminator / sub-solar / other)

Cube-face edges — seam visible?      no
   distinguishable from LOD seams?   no
   how it was told apart:            can't see any seams

Face interior — seam at any LOD boundary?   no
   if yes, depth pair(s):            ____________
   description:                      ____________

Verdict:               PASS

Note: I cannot see any seams, although occasionally while zooming tiles flicker black
```

Two answers that are both fine to record: "no seam at any of depths 4/5, 5/6,
6/7 in the face interior at grazing light; faint expected line on the cube
edges" is a **PASS**. So is "did not get a grazing-light look at the face
interior" — that is **still not measured**, honestly recorded, and it is a
better entry than a PASS that rests on a sub-solar flypast.

### A number worth carrying forward

`10.9 ms/tile` at 65², measured under real navigation rather than on a bench.
R13's budget is 100 ms and ADR-0001's R4 reopens the kernel decision above it, so
this is nine times inside the trigger — at 65² and for Phase 0's single fBm pass.
Phase 1 adds crater passes and may want 129²; that is the headroom they eat into,
and open question 1 is decided against this figure.

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
