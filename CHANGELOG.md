# Changelog

Generated output is a promise: the same UPP and seed must produce a bit-identical
world on every device, browser and future version of this tool (PRD §2.1, R14).
This file is where any deliberate break in that promise is written down, and why.

## The change protocol

An intentional change to generated output requires all of these **in the same
commit** (implementation plan §7.4):

| # | Requirement | Enforced by |
|---|---|---|
| 1 | The identity that moved is bumped — `GEN_VERSION` for a kernel change, the fixture-spec hash for a fixture change | `golden:update*` refuse when neither moved |
| 2 | The affected manifest is regenerated (`pnpm golden:update`, `pnpm golden:update:fixtures`) | the verify legs of CI fail otherwise |
| 3 | An entry in this file naming what moved and why | `golden:update*` refuse to write until it is here |

Two identities, because they answer different questions:

- **`GEN_VERSION`** covers `packages/core` only. It is embedded in share URLs and
  exports, and PRD R15 obliges the app to keep a code path alive for every version
  it has ever emitted — so it moves when the *arithmetic* moves, and never for a
  change to a test input.
- **The fixture-spec hash** covers the golden fixture worlds: their specs, seeds,
  tile set and grid size. It moves when the fixtures change, which alters the
  golden hashes without altering output for any input a user can reach.

`docs/plans/phase0-implementation-plan.md` is not in version control; the protocol
above is the copy that is, and the README repeats it.

---

## 0.2.0-alpha.1 — crater fields (WP10)

**A prerelease, on purpose.** WP10 changes generated output many times over a
multi-session work package, and `golden:update` refuses to regenerate a manifest
while `GEN_VERSION` is unchanged — which is the gate working. Bumping
`0.2.0 → 0.2.1 → 0.2.2` once per commit would mint a run of versions that never
existed for anyone; a prerelease identifier bumped once per *re-pin* says plainly
that this was never emitted to a user, which is the property the README's
phantom-version objection turns on. `0.2.0` proper lands with WP14. Between
re-pins `golden:verify:fixtures` is legitimately red.

### Kernel

- **Hierarchical crater fields** (`packages/core/src/kernel/craters.ts`), both
  buckets of PRD §8.2: tier-1 global basins placed once per world, capped at 24
  so every sample tests every basin in a bounded loop; tier-2 geometric bands,
  each covering crater radii in `[r, 2r)`, placed on a **3D integer lattice**
  rather than on cube-face cells. There are no faces in a lattice, so there is no
  cell-level face adjacency to get wrong — the bug class that would have shown up
  as a stripe of missing craters along a cube edge. Phase 1 open question 3 is
  answered in favour of the lattice; the density variation within a cell has not
  been assessed visually yet and the cube-face fallback stands until it is.

- **Rational and polynomial profiles only.** Phase 0 open question 2 — can Phase
  1 crater profiles avoid `exp`? — closes **yes**. Parabolic bowls with rim
  uplift and a compact ejecta blanket, flat floors, terraced walls and central
  peaks above the transition diameter, all over `rationalBump`, `compactFalloff`,
  `smoothstep`, `smootherstep`, `powi` and `Math.sqrt`. The size distribution is
  a genuine power law (`p(r) ∝ r⁻³`) sampled through an inverse CDF that needs
  only a square root. Nothing new joined `approx.ts`.

- **Compositing buckets by scale, then by age — a departure from the plan.**
  Phase 1 plan §5.4 asks for age-ordered replacement, oldest first, and is right
  that overlapping craters which merely *add* read as lumpy noise. What it does
  not cover is craters of wildly different sizes: with one accumulator, a 700 m
  crater landing inside an 8 km basin replaces the basin's whole depth, and since
  the band carrying that small crater is gated in one LOD level later, a tile and
  its parent then disagree by eight kilometres at a shared vertex. Measured at
  1 811 m against a derived bound of 1 473 m before the fix. Relief now
  accumulates in two registers, and a band that arrives at depth `d` changes the
  total by its own contribution and nothing else.

- **The LOD guarantee is weaker than Phase 0's, by exactly one band.** Splitting
  a tile used to leave the surface untouched. It no longer does — a refinement
  adds the crater band its parent could not resolve, which is what "deeper tiles
  add bands exactly as they add octaves" means once the added thing has a
  non-zero mean. `lodStepBound(depth)` states the bound, `craters.test.ts`
  measures it against the real field, and `generator.test.ts` asserts both
  halves: exact agreement where the gate does not move, and bounded disagreement
  where it does.

- **The band gate takes depth alone.** Making it a function of the caller's grid
  size would have the same tile evaluate different bands at 65² and 129², so the
  viewer and the golden fixtures would disagree at the vertices they share —
  turning Phase 1 open question 1 into a seam rather than an open question. It is
  calibrated at 64 rather than 128 so the hashed 129² path oversamples rather
  than the shipped 65² path aliasing. Open question 1 is **not** closed here, and
  is no worse than it was.

- **The tile apron** (`(n+3)²`, one ring beyond the tile on each side), generated
  in this loop rather than bolted on in WP12. Roughly 6% more samples at 65², and
  the artefact it removes is a normal discontinuity at every tile edge — a
  wireframe grid drawn over the whole planet. Not hashed: it carries no
  information the interior does not. What is asserted instead is the
  relationship, exactly — that a ring value equals the neighbouring tile's own
  interior value, within a face. Across a cube-face boundary it is an
  extrapolation, the same twelve edges the skirts already name.

- **The point-sample path** (`sampleElevation`), and the equality that WP13 rests
  on: point-path and tile-path outputs are bit-identical over the whole fixture
  tile set — ten worlds, six faces, depths 0–6, every face corner. The two are
  genuinely different code, which is what stops the test being a tautology: the
  tile path amortises the lattice hashing into a per-tile cell cache and the
  point path hashes per sample. Perturbing the cache's origin by one cell reddens
  ten tests.

### Viewer

- **The skirt was about a hundred times too short.** `skirtDepthFor` derived the
  crack at an LOD boundary from the fBm's statistical self-similarity, which was
  right when there was nothing else in the field. A crater band's relief is set
  by the crater's own depth rather than by a fraction of the world's total
  relief, so it does not shrink the same way, and the wall would have stopped
  covering the gap it exists to cover. It now carries a third term from
  `lodStepBound`, and `tileMesh.test.ts` holds the two together.

- `?meshprobe=1` — fills a new tile mesh's vertex-colour buffer with magenta, to
  split the three hypotheses for the black-flicker finding in
  `docs/evidence/spikec-exit.md`. Presentation only.

### Determinism battery

- **Digest `513f7af66fbd228c…`** (was `0c6181a0…`). Twenty of the twenty-one
  cases are unchanged to the bit — they measure kernel *functions* and no kernel
  function moved. The one that moved is `tile.composite`, which composes them
  into a tile and therefore runs the crater pass.

  This matters for citations. Evidence blocks that quote `0c6181a0…` — the
  hand-check records in `docs/evidence/wp4-manual-checks.md`, and ADR-0001's
  acceptance — rest on the *arithmetic* being stable across engines, and that
  claim is untouched: no approximation, no hash, no noise function changed. But
  the digest they name no longer exists, so any block quoting it now records a
  build rather than a current result, and the manual checks need re-running
  before Phase 1's exit evidence cites them.

### Golden fixtures

- **Fixture set `4f23f0304c09635f…`** (was `289a78e59ada7f5b…`), fixture digest
  `9131b09897abad9b…` (was `9c0f8603…`). The three
  `craters.*` fields moved out of `fixtures.test.ts`'s `NOT_YET_GENERATED` list
  and into `serialiseFixtureSpecs`, because `generateTile` now reads them. A
  field that reaches generation without reaching this hash is a fixture set that
  cannot tell two different worlds apart.

- **The exclusion list is now checked rather than claimed.** Every remaining
  entry is perturbed, one small tile is regenerated, and the elevation hash must
  not move. WP9 could not write this test — every excused field was unread, so it
  would have passed vacuously over all eleven and proved nothing about any. It
  stopped being vacuous the moment a crater parameter reached the tile pass, and
  it names the offending field when it fires. It did fire, on
  `craters.densityScale`, which is how those three came to be moved.

  Worth recording: the first version perturbed by one ulp and passed over
  `densityScale` in silence. That field is the acceptance threshold for every
  crater candidate on the planet, so a one-ulp step changes no decision anywhere.
  A one-ulp step is the right probe for whether a *serialiser* reads a field and
  the wrong one for whether *generation* does.

### The archived WASM twin

- **`crates/kernel-wasm` does not implement the crater pass**, so it no longer
  agrees with the TypeScript kernel on a tile. That is the drift ADR-0001
  accepted by name when it archived the crate rather than maintaining it, and
  `tile.composite` is where it shows. That one case is now **excluded from the
  parity comparison**, named in `UNIMPLEMENTED_IN_TWIN`, and printed in every
  passing report — leaving it in would turn `pnpm check:parity` permanently red
  and train whoever saw it to ignore the one check that says two independent
  implementations agree. The other twenty cases are kernel functions and still
  compare bit-for-bit over the full battery.

  What is lost is real and should not be glossed: `tile.composite` was the only
  place a *second implementation* checked that composing kernel functions into a
  tile is correct, and a kernel function can be perfectly stable while the
  composition of them is not. The golden fixture set still checks composition,
  but against the TypeScript kernel's own past output rather than against
  another kernel — which is a weaker claim, and the one the ADR accepted.

  `packages/viewer/test/tileJob.test.ts` keeps its byte-exact comparison by
  running both kernels over a world with `densityScale: 0`, where the TypeScript
  elevation is its base fBm field and the twin computes the same thing — plus an
  assertion that the crater-free world really is crater-free, so the comparison
  cannot quietly become a comparison of nothing.

### Not done in this work package

- The crater fields have **not been looked at**. Browser work happens on the
  Windows side; the visual acceptance criteria in plan §5 — saturated at Size
  1–2, sparse at Size 9–A, no seam introduced at any LOD or face boundary — and
  the C2 re-fly are outstanding.
- **Cost is not properly measured, but it is close enough to the budget to say
  so now.** Warmed medians of 15 runs, `size4-luna` (density 1.0), Node 24 under
  WSL2 — *not* the integrated-GPU laptop the R13 budget is written against, and
  not the bench harness with its warm-up, sink and percentiles:

  | | d0 | d4 | d8 | d10 | d12 |
  |---|---:|---:|---:|---:|---:|
  | 65² | 16.5 | 16.5 | 20.6 | 24.2 | 27.5 |
  | 129² | 58.4 | 60.4 | 80.2 | 95.5 | **111.0** |

  Two things are worth reading off it. **The base fBm dominates at shallow
  depth** — depth 0 gates in no crater bands at all, so its 58 ms at 129² is
  terrain, and the crater pass roughly doubles the cost by depth 12 rather than
  tripling it. And **129² crosses the ≈100 ms budget somewhere past depth 10**,
  which is ADR-0001's R4 trigger. 65² has three times that headroom.

  This lands squarely on Phase 1 open question 1 (65² vs 129²), which WP15
  closes: the shipped path meshes at 65² and the hashed path generates at 129².
  Nothing here closes it, and the plan's listed mitigations — cheaper band
  gating, tighter saturation caps, further amortisation — are all still
  untouched. Per-tile candidate amortisation is done; per-tile basin culling and
  merging the two apron passes are not, and both are ordinary optimisations
  rather than kernel decisions.

## Unreleased

### Ruleset interpretation (WP9)

- **`cepheus-1` minted**, table digest `1aee16af5a72464b…`. The first ruleset:
  Size, Atmosphere and Hydrographics tables plus plain-English prose for all
  eight positions, assembled into a `PhysicalWorldSpec` by
  `ruleset/interpret.ts`. First OGL-derived content in the repository — see
  `LICENSE-OGL.txt` and the README's Licensing section for the split.

- **A third identity, and its rule.** A ruleset id covers the interpretation
  tables. **A table change mints a new id; it never bumps `GEN_VERSION` and
  never edits an existing ruleset in place.** A share URL carries
  `?ruleset=cepheus-1` (R27), so the id is a promise to a URL somebody else is
  holding, and editing a digit under that name would silently change every
  world ever shared with no version moving to say so. Enforced by
  `pnpm ruleset:update`, which refuses to re-bless an id whose digest has
  moved and prints the steps for minting a new one. The README carries the
  rule in full, since the implementation plan it comes from is not in version
  control.

- **`GEN_VERSION` does not gain a ruleset component** (Phase 1 plan open
  question 4, confirmed). Separate lifecycles, separate URL parameters.

- **No output moved and no identity moved.** `GEN_VERSION` stays `0.1.0`, the
  battery digest stays `0c6181a0…`, and the fixture set stays
  `289a78e59ada7f5b…`. That last one is the load-bearing claim: the fixture
  specs are now *interpreted* from airless UPPs (`X100000-0` … `XA00000-0`)
  rather than hand-written, and they reproduce the Phase 0 values to the bit
  because `cepheus-1`'s Size table adopts the amplitude curve the `289a78e5…`
  set tuned against real bodies. The fBm parameters stay hand-written and
  overridden — they are deliberate test-input diversity, not a physical claim,
  and what regenerated fixtures do about that is WP14's call.

  The coupling is deliberate: a ruleset table edit now also moves the
  fixture-spec hash, which is §4.3's enforcement arriving early. Under the
  "never edit in place" rule it cannot fire spuriously.

- **`PhysicalWorldSpec` grew to PRD R5's full field set** — surface gravity,
  atmospheric pressure band and composition class, hydrographic coverage,
  derived hints, and Phase 1's crater parameters. All of it at once, because a
  field that arrives in Phase 2 arrives with a fixture-hash change attached.
  Most of it is stored and unused; `packages/golden/test/fixtures.test.ts`
  now fails on any spec field that is neither covered by the fixture-spec hash
  nor listed with the phase that will consume it.

- **The interpreter is not the kernel, and its arithmetic still reaches a
  hash.** `eslint.config.js` extends the banned-transcendental rule to
  `ruleset/**`. The crater parameters it computes are read by tile generation
  from WP10, so a `Math.pow` there would be exactly as unportable as one in
  `kernel/`.

- Starport class validation **stays in the parser** — an encoding fact, not a
  ruleset fact, consistent with every other position's ceiling already living
  on `UPP_POSITIONS`. Reasoning is in `input/upp.ts`; the ruleset's obligation
  runs the other way and is tested.

### Golden fixtures

- **Fixture set `289a78e59ada7f5b…`** (was `3ed32303b19de99a…`). Every
  `terrainAmplitudeM` retuned against real solar-system bodies. Ids, seeds and
  fBm parameters are untouched, and `GEN_VERSION` does not move: this changes
  what the fixtures *are*, not how the generator behaves, and no input a user can
  reach produces different output.

  The old figures were invented rather than derived, and looking at the rendered
  worlds for the first time showed two problems. The small end carried far too
  much relief — Size 1 at 3.0% of its radius, where the real bodies near that
  size run 1.0% (Rhea) to 2.7% (Iapetus, and that is a freak equatorial ridge).
  The large end carried too little: `size8-earthlike` had 8 km of relief at
  Earth's radius, against Earth's actual 20 km, so it was the least Earth-like
  entry in the set and `size7` was closer to Earth than the fixture named for it.

  The underlying mistake was assuming absolute relief falls away with size. It
  does not. Luna has 20 km, Mars 30 km, Earth 20 km, Venus 14 km — roughly flat
  between 14 and 30 km across the whole range, because maximum relief is set by
  material strength against gravity rather than by radius. Relief *as a fraction
  of radius* falls, and only because the radius grows.

  | Fixture | radius | relief was → now | ratio now | real anchor |
  |---|---:|---:|---:|---|
  | size1-rockball | 800 km | 24 → 14 km | 1.75% | between Rhea 1.0% and Iapetus 2.7% |
  | size2-cinder | 1600 km | 30 → 17 km | 1.06% | Luna 1.15% |
  | size3-ceres | 2400 km | 28 → 19 km | 0.79% | between Mercury 0.41% and Mars 0.86% |
  | size4-luna | 3200 km | 26 → 28 km | 0.875% | Mars 0.86% |
  | size5-mercury | 4000 km | 22 → 26 km | 0.65% | interpolated; no real body here |
  | size6-mars | 4800 km | 21 → 24 km | 0.50% | interpolated toward Venus |
  | size7-temperate | 5600 km | 16 → 21 km | 0.375% | just above Earth |
  | size8-earthlike | 6400 km | 8 → 20 km | 0.3125% | Earth 0.31% |
  | size9-large | 7200 km | 7 → 18 km | 0.25% | beyond Earth |
  | sizeA-maximal | 8000 km | 6 → 17 km | 0.21% | beyond Earth |

  The relief-to-radius spread narrows from 40× to 8× as a result. That is the
  realistic figure, and it slightly reduces the set's value as a stress test —
  recorded because it is a real cost, not a free improvement.

  **Consequence for recorded evidence.** The fixture digest moves, so the
  hand-check blocks in `docs/evidence/wp4-manual-checks.md` cited a digest that
  no longer exists and needed re-running. Done: M2 and M3 were both re-run
  against fixture set `289a78e5…` and digest `9c0f8603…`, both exact, and M2 on
  real iOS Safari this time rather than a WebKit shell. M1 was never filled. The
  battery digest `0c6181a0…` is untouched, so all twelve automated determinism
  cells and every claim resting on kernel arithmetic remain valid.

## 0.1.0 — 2026-08-04

First recorded generator version. Phase 0: airless rocky worlds, flat-shaded,
no ruleset interpreter.

### Kernel

- Determinism battery manifest `packages/golden/manifest.json`, digest
  `0c6181a0…`, 21 cases at ≥10⁶ hostile inputs each. Produced by the pure
  TypeScript kernel, which ADR-0001 selected (provisionally) in WP6.

### Golden fixtures

- Fixture set `3ed32303b19de99a…` — the first fixture manifest
  (`packages/golden/fixtures.json`, WP7). Ten hand-written `PhysicalWorldSpec`s
  spanning Cepheus sizes 1–A, each generated across a fixed 90-tile set covering
  all six faces at depths 0–6 and deliberately including face corners and
  edge-adjacent tiles, at 129² per tile. Hashed per output buffer: elevation,
  water mask, materials.
- **The water-mask hashes are hashes of a constant.** Phase 0 worlds are airless,
  so `generateTile` writes zero to every water-mask element and these hashes will
  keep matching when the Phase 2 water pass lands broken. `fixtures.json` records
  `waterMaskAllZero: true` per fixture so the claim is data rather than a comment,
  and `packages/golden/test/fixtures.test.ts` asserts it against the real buffer —
  the day Phase 2 makes it false, the suite says so and this note is what gets
  revisited.
- Fixture specs are hand-written because Phase 0 has no ruleset interpreter
  (PRD R5–R7). When the interpreter lands in Phase 1 they get regenerated from
  real UPPs; that is a fixture-spec change, not a generator version bump.
- **Discrimination checked before this manifest was committed, not after.**
  `TAN_P2` in `kernel/approx.ts` was moved by one ulp and the fixtures were run
  against the manifest: all ten elevation hashes changed, and the coefficient was
  put back. Worth recording is what did *not* change — every `materials` hash
  survived it. Material classification quantises elevation into four bands, so it
  discriminates far more coarsely than the buffer it is derived from. Hashing the
  three buffers separately is what makes that visible instead of averaging it
  away, and a `materials`-only match should never be read as a passing fixture.
- Build invariance (§7.3): the same page built unminified and under Vite's
  defaults reproduces both digests exactly. `pnpm golden:invariance`.
