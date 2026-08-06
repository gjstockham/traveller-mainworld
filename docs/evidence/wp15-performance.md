# WP15 — performance, and closing open question 1

What was measured, what was decided, and what was not checked. Phase 1 plan §10.

Identities after this work package:

| Identity | Value |
|---|---|
| `GEN_VERSION` | `0.2.0` — **unmoved, and that is the finding, not an omission** |
| Battery digest | `1629e5221565ff94…` (22 cases) — unmoved, still hashed at 129² |
| Fixture set | `3c780fc0b3d351e5…` (10 worlds, was `fb5a446ea46f2bb6…`) |
| Fixture digest | `082672301e778cd6…` (was `9d20abd809becf92…`) |
| Ruleset `cepheus-1` | `1aee16af5a72464b…` — unmoved since WP9 |

`pnpm check` green: 44 files, 761 tests. All four golden artefacts verify.

---

## 0. The one-paragraph version

**Open question 1 is closed at 65², and it cost a fixture-spec hash rather than a
generator version.** The measurement is `bench/results/phase1.md`; the argument
is §3 below and it is not primarily about milliseconds. The viewer's LOD metric
does not read the grid resolution and the crater band gate is calibrated against
`BAND_GATE_N = 64`, so a 129² mesh draws *the same tiles sampling the same field*
with four times the vertices. 129² was 3.8× the generation cost for no additional
detail, and it was the only one of the two grids to exceed the R13 budget.

**ADR-0001 R4 was evaluated and does not select WASM** (§2). On the averaged
figure it does not fire at all; on the worst tile at 129² it fires and misses by
1.22×, which is under the 2× that §A.3 row 2 escalates on — and at the grid the
tool now ships and hashes at, nothing misses.

Phase 0's standalone crater cost model is **deleted**, replaced by a differential
across `densityScale` on the shipped generator. **No browser measurement was
taken** (§7), which means §9.2 is still open and still needs the Windows side.

---

## 1. What the tile actually costs

Full run, 15 iterations, `bench/results/phase1.md`. The machine is the same
i7-1165G7 `phase0.md` was measured on — the minimum target the spike plan names —
so these decide rather than bound.

| Measurement | 65² | 129² | Budget |
|---|---:|---:|---|
| Single tile, averaged over depths 0–6 | **26.1 ms** | **99.7 ms** | ≤ 100 ms |
| Single tile, worst depth (both are depth 0) | **37.5 ms** | **122 ms** | ≤ 100 ms |
| Pool throughput, 7 workers | **111.1 tiles/s** | **30.8 tiles/s** | ≥ 25 tiles/s |
| 96-tile shell, generation only | **0.86 s** | **3.12 s** | ≤ 10 s (R13) |
| ns per grid vertex | 6 177 | 5 989 | — |

Three things in that table are worth saying out loud.

**The 129² average is 99.7 ms against a 100 ms budget.** That is not a margin,
it is a coincidence. Its p95 is 107 ms and its minimum is 90.6 ms, so which side
of the line the headline figure lands on is a property of the afternoon.

**The budget belongs on the worst tile, not the average**, and the worst tile is
not where four work packages of comments in this repository assume it is. Cost is
**U-shaped in depth**: 122 ms at depth 0, falling to 83.6 ms at depth 3, rising
to 110 ms at depth 6 (129² column). Two effects cross over. Going down the tree
`bandsForDepth` admits finer crater bands, monotonically. Going *up*, the tile
covers more sphere, so the per-row basin cull rejects less and the tier-2 lattice
cache spans a larger box — a depth-0 tile is a whole cube face and much of the
world's basin field genuinely reaches it. `tilegen.ts` already knew this; its
`ROW_BOXES` comment records a 129² root tile costing 130 ms before the cull was
moved per-row. Nothing had put it in a table next to the budget.

**The expensive tile is a root tile**, which is the one every session draws
first. If this were a problem it would be a startup problem, not a
zoomed-all-the-way-in problem.

**Where the time goes**, at 129², saturated:

| Arm | ms/tile | |
|---|---:|---|
| `densityScale` 1.0 | 103 | the shipped saturated tile |
| `densityScale` 0.5 | 75.5 | |
| `densityScale` 0.0 | 60.0 | fBm, lattice walk, basins, regolith, copy — no crater accepted |

So **42% of a saturated tile is the crater population**, and 58% is the floor
underneath it. That is the ceiling on what the plan's first mitigation — a
tighter saturation cap — could ever return, and it is worth knowing before
anybody spends a session on one.

`buildBasins` places 1 623 basins in 0.200 ms. `phase0.md` called the global pass
a once-per-world cost; it is not. `generateTile` rebuilds the field on **every
tile**, deliberately, so the tile path and the export path cannot disagree about
it. At 0.2% of a 129² tile and 0.8% of a 65² one it does not matter, but the
claim was wrong and it is now measured through the shipped function.

> **On machine state.** The run was taken with a load average of 1.2 at start and
> 4.9 at finish (the pool leg saturating seven workers is most of the second
> figure), on a box also carrying a VS Code server. These medians are therefore
> an **upper** bound on tile cost rather than a lower one, which is the safe
> direction for a budget check and the wrong direction for a boast. The
> conclusion does not turn on it: 65² has 2.7× headroom on its worst tile.

---

## 2. R4, evaluated

ADR-0001 R4: *"`pnpm bench` shows the 129² Phase-1 tile exceeding 100 ms, or pool
throughput below 25 tiles/s, on the minimum target."*

**The throughput half does not fire and is not close**: 30.8 tiles/s at 129²,
111.1 at 65², against 25.

**The tile half depends on what "the 129² Phase-1 tile" means**, and the honest
answer is that both readings were taken:

| Reading | Figure | Fires? |
|---|---:|---|
| Averaged over depths 0–6, as `phase0.md` reported it | 99.7 ms | **No — by 0.3%**, which is not a margin |
| The worst tile, which is what a budget is | 122 ms | **Yes**, by 1.22× |

**Neither reading selects WASM.** §A.3 row 2's rule is a **2× miss**, and 1.22×
is not one; the spike plan's own words are "a miss by less than 2× says optimise
the TypeScript". So the consequence is an optimisation backlog, not a kernel
decision — and the plan already names the candidates: cheaper band gating,
tighter saturation caps, per-tile candidate amortisation. §1 sizes the second of
those at 42% of a saturated tile.

**And at the grid this tool now ships and hashes at, nothing misses.** 65² is
26.1 ms averaged, 37.5 ms on its worst tile, 2.7× inside the budget. R4 is
written against 129² because that is the grid Phase 0 assumed the answer to open
question 1 would be. WP15 answered it the other way, so the trigger as worded is
now measuring a configuration the tool does not use. **It is left worded as it is
rather than quietly rewritten to match the result** — an ADR trigger edited after
the measurement it governs is not a trigger. The R4 row carries a dated
evaluation instead.

**Do not quote the 6.2× WASM figure as the alternative.** `crates/kernel-wasm`
implements the base terrain field and nothing else — no crater pass, no regolith
pass, no apron — which is why `golden:parity` has skipped `tile.composite` since
WP10. The comparison in the table is a Phase-1 tile against a Phase-0 one, and
most of the gap is work the twin does not do. If R4 ever does fire at 2×, the
twin is not a switch that can be thrown; it is two passes and the rest of a
phase.

---

## 3. Open question 1, closed at 65²

Open since Phase 0 §10 q1, and it has had two answers at once since WP1: the
golden fixtures hashed generation at 129² while `viewer/src/main.ts` meshed at
65². Every determinism claim in the repository was a claim about a grid the
application never drew at.

Phase 0 left it open on a per-vertex argument — cost falls ~9% at 129², so the
larger grid amortises fixed per-tile costs — and deferred the decision to "the
comparison that matters, per unit of screen covered: at a given screen-space
error, one 129² tile replaces four 65² ones."

**That premise is false in the viewer as built**, and once it is false the
argument does not merely weaken, it reverses. Two constants, neither of them in
the benchmark:

1. **`lod/quadtree.ts`'s `screenSpaceError` does not read the grid resolution.**
   It is the sagitta of the tile's bounding cap against the sphere —
   `radius * (1 - cos(angularRadius))` — projected to pixels. Nothing in it
   varies with `n`. So the same cut of the quadtree is selected at either size: a
   129² mesh does not replace four 65² tiles with one, it draws *the same tiles*
   with four times the vertices.
2. **`bandsForDepth` gates crater bands on `BAND_GATE_N = 64`**, a reference
   sample spacing rather than the caller's grid — deliberately, so that a tile
   meshed at one size and hashed at another cannot disagree at the vertices they
   share. And fBm octaves come from `size.fbmOctaves` in the ruleset, per world,
   not per depth. So the *field* is identical at both grid sizes.

Together: the extra vertices at 129² sample a field that is already band-limited
to what a 65² grid resolves. Measured directly — samples across the diameter of
the finest band the gate admits, at every depth the fixture set covers:

| Depth | Bands admitted | Samples across finest crater, 65² | at 129² |
|---:|---:|---:|---:|
| 3 | 2 | 3.3 | 6.5 |
| 4 | 3 | 3.3 | 6.5 |
| 5 | 4 | 3.3 | 6.5 |
| 6 | 5 | 3.3 | 6.5 |

3.3 is `BAND_SAMPLES_ACROSS = 3` doing exactly its job: a band is admitted
precisely when a 65² grid can resolve it. The 129² column is oversampling, not
detail. **Nothing in the second column is a feature the first column misses.**

Buying real detail at 129² means raising `BAND_GATE_N` to 128. That constant is
inside the whitelisted zone: every hash in the repository moves, `GEN_VERSION`
moves with them, and the tile gets *dearer* than the figure that already exceeds
the budget at 129². That is a Phase 2 conversation at best.

### Why this was a fixture-spec change and not a version bump

The handoff into this work package recorded the cost of closing toward 65² as a
`GEN_VERSION` bump, on the reasoning that `0.2.0` is now immutable. **The premise
is right and the conclusion does not follow**, and the difference is the whole
reason there are two identities.

`GEN_VERSION` covers the *arithmetic*. Not one line of
`packages/core/src/kernel/**` changed in this work package — the only edit to
that directory is a comment on `BAND_GATE_N` recording the decision. The
generator computes precisely what it computed before for precisely the same
inputs; every world any user can reach is untouched, including every share URL
already emitted.

The fixture-spec hash covers *what the manifest samples*, and it has always been
defined over the fixture specs, their seeds, the tile set **and the grid size** —
`fixtureSpecHash(fixtures, tiles, n)`. The infrastructure anticipated this move
in detail: `FixtureManifest` carries `fixtureN`, `fixtureManifestPreflight`
refuses to compare hashes across a grid change rather than reporting an
uninterpretable mismatch, and `updateFixtures` accepts `existing.fixtureN !==
FIXTURE_N` as a legitimate reason for hashes to move. None of that was written
for this session; it was written for this case.

Had it been minted as `0.2.1`, the repository would carry a version no share URL
was ever emitted under, and R15 would oblige `generatorFor` to keep a code path
alive for it forever. **The change protocol ran in full**: the identity that
moved is named in `CHANGELOG.md`, the manifest is regenerated in the same commit,
and the entry says what moved and why.

### What did not move, and why not

- **The determinism battery stays at 129²** (`battery.ts`, `tile.composite`). It
  answers a different question — whether two engines agree on the arithmetic —
  where finer sampling is strictly more discriminating and no claim about the
  shipped grid is implied. Moving it would have moved `manifest.json`'s digest
  under an unchanged `GEN_VERSION`, which the protocol rightly refuses.
- **The viewer.** `TILE_N` was already 64. Its comment deferring the question to
  Spike B is now a record of the answer.
- **The exporter.** `detailDepthFor` was written against `referenceSpacing` and
  `BAND_GATE_N` rather than a literal grid size — WP13 did that on purpose for
  this work package — so it follows the decision without an edit. Confirmed by
  grep rather than assumed: nothing outside `packages/golden` reads `FIXTURE_N`.

### The 65² fixture set still discriminates

The obvious objection to a coarser hashed grid is that it catches less. Probed
rather than argued: `SIMPLE_DEPTH_RATIO` perturbed from `0.2` to `0.2000001` —
five parts in ten million, on a constant that scales crater depth —
and `pnpm golden:verify:fixtures` goes red.

The reason it still discriminates is the same reason 65² was the right answer:
the gate admits a band exactly when a 65² grid resolves it, so the fixture set
samples every feature the generator can produce. What the 129² manifest had was
finer sampling of those same features — and that discrimination is not lost, it
is in the **battery**, which still hashes `tile.composite` at 129².

The fixture leg now runs locally in **23.0 s**. It was not timed locally before
the change, so the honest comparison is against the handoff's figure for CI's
fixture leg — ~85 s on a four-core runner — which a 4× reduction in samples
should carry, but that is an expectation and not a measurement until the matrix
runs on this commit.

---

## 4. The crater cost model is gone

`bench/src/craters.ts` is deleted, and with it 227 lines of synthetic crater
placement, its six tests, and the `globalCraterPass` stand-in.

It was written for Phase 0, when the kernel had no crater pass and §B.1 still
specified craters as part of the representative tile. Since WP10 the real
two-tier pass and the regolith pass run inline in `TsTileGenerator.generate`, so
the model had stopped standing in for anything — and while it stood there, the
Phase 0 summary added its 0.700 ms to a single-tile figure that already contained
the real pass. WP14 found and fixed the arithmetic; the second implementation was
what made the mistake available, and it was WP15's call to retarget or delete it.

**Deleted rather than retargeted**, because the thing worth measuring is not an
analogue of the crater pass but the difference it makes to the tile that ships.
What replaces it is a differential: the same tile set generated at
`densityScale` 1.0, 0.5 and 0, with everything else held to the field. At 0 the
acceptance hash rejects every candidate, so the lattice walk, the basin field and
the regolith pass all still run and no crater survives them — the gap between the
rows is the crater population and nothing else, which is what makes it usable as
a mitigation estimate.

The tier-1 global pass is now measured through the shipped `buildBasins`, which
corrected a claim in `phase0.md` while it was at it: that pass is **not** paid
once per world. `generateTile` rebuilds the basin field on every tile,
deliberately, so the tile path and the export path cannot disagree about it.

---

## 5. `pnpm bench` writes `phase1.md`, and refuses `phase0.md`

The full run defaulted to `phase0.md`, which is how WP14 nearly lost it to a
three-iteration quick run. The quick path got its own filename then; the full
path did not, and the file it pointed at is cited by ADR-0001 §E2 as the evidence
the kernel decision was made on.

`--phase` now defaults to 1, `--phase=0` is **refused outright**, and `--out=` is
the way past the guard so that the guard does not become the thing somebody
deletes. `bench/results/.gitignore` widened from `phase0-quick.md` to
`*-quick.md`, which the next phase would otherwise have had to remember.

`phase0.md` is not regenerable in any case, and that is the honest reason for the
refusal: it records a generator version, a machine state and a tile that had no
crater pass in it. Nothing on this kernel reproduces it.

---

## 6. Mutations

Thirteen mutations against the new measurement code and its tests, plus one
against the decision itself. **All fourteen caught, none escaped.**

| # | Mutation | Caught by |
|---|---|---|
| M1 | Per-depth verdict takes the *cheapest* row rather than the dearest | `takes the per-depth verdict on the dearest tile` |
| M2 | Escalation factor raised 10×, so no miss ever reaches the WASM trigger | `escalates at 2× or worse` |
| M3 | Crater share reports the whole tile rather than the difference | `reports the difference between the density arms` |
| M4 | Pool best-row takes the first row rather than the fastest | `checks R13 against the shell` |
| M5 | Root-tile note fires for a miss at any depth | `says a root-tile miss is inside the startup shell` |
| M6 | Shell seconds computed at twice the measured throughput | `checks R13 against the shell` |
| M7 | `worldAtDensity` ignores its argument | `leaves exactly the base terrain field at density 0` |
| M8 | `tilesAtDepth` returns depth-0 tiles at every depth | `puts one tile on every face at the depth asked for` |
| M9 | The `phase0.md` guard is disabled | `refuses to write phase0.md` |
| M10 | Quick runs write the full run's filename | `defaults to the current phase, and separates quick runs` |
| M11 | `benchBasins` discards the field it built | `places basins rather than timing an empty loop` |
| M12 | `benchDensity` generates the unmodified world at every density | `generates a different world at each density` |
| M13 | `benchByDepth` measures depth 0 at every depth | `generates a different tile set at each depth` |
| M14 | `SIMPLE_DEPTH_RATIO` 0.2 → 0.2000001 (kernel) | `golden:verify:fixtures`, at the new 65² grid |

M12 and M13 are the reason `DensityBenchRow` and `DepthBenchRow` carry a
`checksum` that is never printed. A benchmark that took a parameter and ignored
it would return plausible, slightly different timings and have no other symptom
at all — the timings cannot carry that assertion, so a value that is a pure
function of the world generated does.

**One test escaped a change it existed to catch, and it was in this repository
already.** `fixtures.test.ts`'s "moves when the tile set or grid size changes"
asserted `fixtureSpecHash(FIXTURES, FIXTURE_TILES, 64) !== fixtureSpecHash()`
with `64` written as a literal while `FIXTURE_N` was 128. Moving the grid turned
it into `x !== x` — it failed loudly, which is the good outcome, but it had been
one constant away from asserting nothing at all. It now reads `FIXTURE_N * 2`.

---

## 7. What was not checked

**No browser measurement was taken, on any machine.** Everything in
`phase1.md` is Node under WSL2, which is the right platform for CPU-bound
generation and the wrong one for anything with a compositor in it.

| Not measured | Why not | Whose |
|---|---|---|
| **§9.2 — paste to interactive globe under 10 s** | Needs a real browser on the Windows side. The handoff asked for it in the same sitting as the bench; the bench does not need a browser and this does, so it was not taken. **Still open, still unmeasured, and now five work packages old.** | WP16 |
| Frame timings, anywhere | Deliberate. Headless Chromium rasterises in software; no frame timing from a Playwright run enters an evidence file in this repository. | — |
| Browser worker-pool throughput | `phase1.md`'s pool figures are `node:worker_threads`. The scaling *shape* carries over; the absolute numbers are the reference platform's. | — |
| The mesh/upload/draw half of the shell | `phase1.md` reports generation only, and says so at the point of measurement. **0.86 s is a lower bound on R13's ten seconds, not a claim about them.** | WP16 |
| The Playwright globe spec under WSL2 | Not re-checked. Last checked WP10, five work packages ago. | carried |
| Whether the re-hashed fixture worlds look like planets | **Nobody has flown one since WP14 changed all ten.** This work package did not change what they look like — `FIXTURE_N` is read only by `packages/golden`, so no viewer or exporter output moved — but the visual debt is a work package older now. | carried |

The one thing worth saying plainly: **the primary deliverable did not need the
laptop, because it already was the laptop.** The handoff expected the bench to
need a trip to the minimum-target machine. It did not — `phase0.md` §Machine
records that this WSL2 box *is* the integrated-GPU laptop the spike plan names,
and the CPU-bound legs run close to native there. What still needs the Windows
side is §9.2, and only §9.2.

---

## 8. What this hands WP16

**A grid size that has stopped moving**, which is the one thing WP16's sequencing
rule demanded. `fixtures.json` is re-pinned at 65², the viewer meshes at 65², the
band gate is calibrated at 64, and the exporter follows the gate. There is no
second re-pin waiting to invalidate an exit-evidence file written after this
commit.

**A performance row that can be written as a number rather than a judgement.**
Golden-hash determinism (§9.1) is already evidenced; §9.2 is the row WP15 could
not close and did not pretend to.

**Three things to carry, in the order they matter:**

1. **§9.2 still needs the Windows side**, and it is now the only thing that does.
   One sitting, a real browser, mains power, the overlay timing written down.
2. **`docs/evidence/wp4-manual-checks.md` is one degree staler.** Its hand-check
   rows already named digests that no longer exist; they now also name a grid
   that no longer exists — "10 worlds × 90 tiles at 129²" is wrong as of this
   commit. Re-run it before WP16 cites it, or stop citing it.
3. **An optimisation backlog, not a kernel decision.** If anyone wants the 129²
   root tile under 100 ms — and nothing in Phase 1 requires it — §1 says where
   the time is: 42% crater population, and a depth-0 tile paying for a basin cull
   that a whole cube face defeats. Neither is a kernel-language problem.

**And one thing that should be cheaper:** the fixture leg runs locally in 23.0 s
at 65². CI's was ~85 s at 129²; whether the matrix sees the same 4× is unverified
until it runs on this commit. It was a side effect rather than a goal — worth
saying so, because a fixture set that got faster because somebody wanted it
faster would be a fixture set to distrust.
