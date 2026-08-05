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

## Unreleased — `?upp=` in the viewer

**No identity moved.** This is viewer routing: which world gets asked for, never
what a tile contains.

- **`?upp=<string>` renders a real UPP**, combining with `?seed=`. It is a slice
  of WP12's D8, not WP12 — no input UI, no info panel, no reduced-fidelity badge,
  and no `gen`/`ruleset` parameters, so R27's four-parameter share URL is still
  ahead. What it unblocks is looking at the bodies the spaceport work made
  readable: `?upp=F20076C-F` is Luna as the Traveller wiki writes it.

- **It is the only route that shows a world the interpreter actually produced.**
  Every fixture overrides the fBm parameters after interpreting — deliberately,
  because the set exists to discriminate and a smooth per-Size curve would hash
  ten worlds differing only in radius and seed — and the default world overrides
  radius, relief *and* fBm. So `cepheus-1`'s `fbmFrequency` and `fbmOctaves`
  columns had never been rendered once, on any route, since they were written.

- **A false alarm, checked rather than left as a worry.** Those columns hand out
  a base frequency of exactly 1.0 at Size 2 and 2.0 at Size 7, and `noise.ts`
  warns in terms to keep base frequencies non-dyadic — on a regular grid, a
  power-of-two frequency can land first-octave samples on the half-lattice, where
  the fade weights collapse and the output is drawn from about fourteen distinct
  values. Measured across all ten sizes with craters off: every one produces
  16 641 distinct elevations from 16 641 samples. The warning is about *regular*
  grids, and sample positions here go through the tangent warp and a
  normalisation before they reach the noise, so they never form one. No banding,
  and no reason for a future `cepheus-2` to avoid those two values.

- **Size 0 is refused by the app, with the reason.** `parseUpp` accepts it and
  `interpret` is total over it, both deliberately — enforcing product scope is
  neither the parser's job nor the interpreter's. PRD §3 makes belts a permanent
  non-goal, and the message says so instead of rendering a 400 km sphere.

- `WorldChoice` gained a `short` field for the diagnostics stamp. The overlay
  derived it from `fixtureId`, which worked with two routes and silently
  mislabelled every UPP world as "default world" the moment there were three —
  and that stamp is what ties a recorded observation to what was on screen.

## Unreleased — spaceport classes

**No identity moved and none should have.** The interpreter reads Size,
Atmosphere and Hydrographics and never looks at position 1, so widening what
that position accepts cannot change a generated value. `GEN_VERSION` stays
`0.2.0-alpha.3`, the `cepheus-1` digest stays `1aee16af5a72464b…`, and the
fixture set stays `4f23f0304c09635f…`. Recorded here anyway, because it changes
which strings the app will take, and that is a promise to a share URL just as
much as a hash is.

- **`parseUpp` accepts the extended spaceport classes** `F`, `G`, `H` and `Y`
  alongside the starport classes `A`–`E` and `X`. `input/upp.ts` predicted this
  in its own words — "if house rules add an `F` starport, the string `F867A69-8`
  is a string this parser should learn to read; that is a parser change, which is
  the honest place for it" — and this is that change, made where the comment said
  it belonged. PRD R1 is amended to match rather than left contradicting the
  parser.

  What prompted it: of the twelve bodies in the Traveller wiki's Terra system,
  eleven carry an extended code and were rejected outright. Those bodies are the
  only real-world data this project has to check `cepheus-1` against, so refusing
  to read them cost something concrete — `packages/core/test/solarSystem.test.ts`
  had to substitute an `X` to get at the physics, and now does not.

- **A spaceport is not a small starport**, and the code says so. `portKind()`
  distinguishes the two sets, `describeUpp` heads the panel "Spaceport" when the
  class is one, and the rejection message names both sets separately — "expected
  a starport (A, B, C, D, E, X) or a spaceport (F, G, H, Y)" rather than ten
  letters in a jumbled order.

- **Licensing: the four new prose entries are not Open Game Content.** The
  extended spaceport codes are not in the Cepheus SRD, so their wording is
  original to this project and is separated inside `prose.ts` with the boundary
  marked at the line. The README's licensing table says so too. The OGL notice at
  the top of that file was previously unqualified and now is not.

## 0.2.0-alpha.3 — a size-frequency distribution with no wall in it (WP10)

Flying `alpha.2` produced a second visual finding — *not enough large craters* —
and this time the model could be checked against reality rather than argued
about. Enumerating every crater the generator places over a whole Luna-sized
sphere and comparing against the real Moon found a **cliff at exactly the tier
boundary**:

| D ≥ | before | real Luna | |
|---|---:|---:|---|
| 50 km | 1 595 | ~830 | 1.9× |
| **70 km** | **23** | **~423** | **0.05×** |
| 100 km | 7 | ~207 | 0.03× |
| largest | 605 km | SPA ~2 500 km | |

A factor of seventy across a factor of 1.4 in diameter is not a distribution.
The cause: **tier 2 was a density and tier 1 was a count.** Tier 2's population
falls out of the lattice cell size; tier 1 was the literal number 24. They met
at `LARGEST_BAND_RADIUS` in *size* and nowhere at all in *density*, so everything
above 70 km on a Luna-sized world was 24 objects.

(Real lunar figures anchor on Head et al. 2010's LOLA survey — 5 185 craters
≥ 20 km — extrapolated on a cumulative slope of −2. That slope is about right
over 20–100 km and steepens above, so the comparison is generous to us at the
large end.)

- **`MAX_BASINS` is now derived, not chosen.** For `p(r) ∝ r⁻³` the population
  above a band's top is a third of the band's own, and a band's population is one
  candidate per shell cell. That gives 1 623 rather than 24, and the ladder is
  one curve:

  | D ≥ | after | real Luna | |
  |---|---:|---:|---|
  | 20 km | 19 618 | 5 185 | 3.8× |
  | 70 km | 1 598 | ~423 | 3.8× |
  | 300 km | 82 | ~23 | 3.6× |

  **The ratio is flat to within 5% across three decades of diameter** — the shape
  now matches the Moon's and only the normalisation is high. That is a single
  dial (`CANDIDATES_PER_CELL`, currently 3); it is left where it is because the
  small-crater density is what was reported as working, and 3.8× a *global*
  lunar count is not unreasonable for a surface whose `densityScale = 1.0` means
  "Luna's highlands", which are denser than the global average. Say the word and
  it comes down.

  Still missing: a South Pole–Aitken. The largest basin generated is 1 029 km, an
  Orientale/Imbrium-class feature. SPA is ~2 500 km on a 3 474 km body and is a
  singular event rather than a draw from a distribution, so it will not fall out
  of a power law and would have to be placed deliberately.

- **`BasinCull`, and why 1 623 basins is affordable.** A loop over every basin at
  every sample would have been the most expensive thing in the generator. Which
  basins can reach a region is a property of the region, so it is answered once —
  and the cull is a *superset* filter, never an exact set, which is what keeps
  plan §5.3 satisfied: a basin it keeps but which cannot reach a given sample is
  dropped by the same exact early-out as everything else. Culling tightly,
  loosely, or not at all gives bit-identical results, asserted directly, because
  that is the property WP13 will rely on when it culls by row band.

  It is rebuilt **per row of the apron grid**, not per tile. Per tile is enough
  almost everywhere, but a depth-0 tile is a whole cube face and a large fraction
  of the world's basins genuinely reach it — culling against the whole face saved
  nothing and a 129² root tile cost 130 ms on its own. A row is a thin slab.

- **Cost**, same conditions as before. 65² runs 21–32 ms; 129² runs 72–115 ms.
  Both are a few milliseconds worse than `alpha.2` — the basin population grew by
  a factor of 68 and the row cull costs one pass over the basin list per row —
  and the deep end still crosses the budget at 129². Unchanged conclusion: 65²
  has the headroom, 129² does not, and that is WP15's to close with open
  question 1.

- One more test was asserting the pre-WP10 bound that elevation stays inside
  `terrainAmplitudeM`, and passed until basins became numerous enough to reach
  the tile it looked at. Same fix as the two in `alpha.2`.

## 0.2.0-alpha.2 — craters that are visible from orbit (WP10)

The first flight of `0.2.0-alpha.1` found the band gate wrong in the way that
mattered most: **craters popped in, and craters that should have been visible
from higher up were not there.** Both come from the same mistake.

- **The gate asked the wrong question.** It asked whether a *tile's own vertex
  grid* can resolve a crater. That is right for aliasing and wrong for
  visibility: a full-disc view resolves far finer than a depth-0 tile's
  1.4°-per-sample grid, because the screen has more pixels across the planet than
  the tile has vertices. An orbital view sits at depth 1, where the gate admitted
  no bands at all — so it showed 24 basins and nothing else, and the largest
  tier-2 craters (35–70 km across on a Luna-sized world, the ones that give it
  its face) waited for a descent to depth 3 and then arrived together.

  **`ALWAYS_ON_BANDS = 2`**: the two largest bands are evaluated at every depth,
  like the basins above them. On a Luna-sized world that is craters 17–70 km
  across, which is about what a full-disc view can distinguish. Three bands would
  be tens of thousands of lattice cells and megabytes of cache at depth 0, which
  is why it is two.

- **`BAND_SAMPLES_ACROSS`: 6 → 3.** This started at 6 on the reasoning that three
  samples across renders a crater as a faceted pit. The reasoning ignored that
  the same constant sets how *late* a band arrives and how *large* its craters
  are when they do — so 6 both delayed every band by a level and doubled the pop
  when it came. It also halves the LOD crack, and therefore the skirt. The
  faceting it costs is on the newly-gated band alone, which the next level of
  refinement fixes.

  The ladder is now: two bands from orbit, then one new band per level from depth
  4, each half the size of the last.

- **A hypothesis that the measurement killed, recorded so it is not re-run.** The
  obvious suspect was the LOD selector, whose screen-space error is pure sphere
  curvature and ignores terrain entirely — plausibly it stops refining as the
  camera descends, exactly when detail matters. A `lodStepBound`-derived detail
  term was written and then measured: at the altitudes that matter it changes
  nothing (identical tile counts and depths from 8.6 down to 0.02 radii), and it
  only bites below 0.005 radii, where it costs 58% more tiles to gain one depth
  level. Reverted. The curvature metric is adequate; the gate was the problem.

- **Craters are not bounded by `terrainAmplitudeM`, and nothing had noticed.**
  That field bounded the whole surface through Phase 0 and now bounds only the
  fBm half of it — a crater's depth comes from its diameter and the world's
  gravity, so a large basin on a geologically flat world is deep because the
  impact was large. Two tests asserted the old bound and passed anyway, because
  the tiles they looked at happened to miss the basins; putting bands at every
  depth is what surfaced it. Both are rewritten to assert the two halves
  separately, and `PhysicalWorldSpec` says so at the field.

- **Cost**, same conditions as `alpha.1`'s table. 65² — the shipped path — runs
  18–30 ms across the whole depth range. 129² runs 66–110 ms: the always-on bands
  add about 20 ms at the shallow depths that previously paid nothing, and the
  deep end is unchanged because those bands were already gated in. It still
  crosses the budget past depth 10 at 129², and that remains WP15's to close
  along with open question 1.

- **`GEN_VERSION` moved and the fixture set did not**, which is the two-identity
  design doing its job: the fixture *inputs* — specs, seeds, tile set, grid size
  — are untouched, and only the arithmetic reading them changed. The fixture set
  stays `4f23f0304c09635f…`; both manifests are regenerated because the hashes
  they hold are of output, not of inputs. Battery digest `fd524e07732c8ad5…`
  (was `513f7af6…`), fixture digest `2fa27beada75a160…`.

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
