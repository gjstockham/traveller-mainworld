# WP14 — the golden harness under Phase 1

What was checked, what was measured, and what was not. Phase 1 plan §9.

Identities after this work package:

| Identity | Value |
|---|---|
| `GEN_VERSION` | `0.2.0` — the prerelease sequence landed |
| Battery digest | `1629e5221565ff94…` (22 cases, was 21) |
| Fixture set | `fb5a446ea46f2bb6…` (10 worlds, was `4f23f0304c09635f…`) |
| Fixture digest | `9d20abd809becf92…` |
| Ruleset `cepheus-1` | `1aee16af5a72464b…` — **unmoved since WP9**, and it must stay that way |

`pnpm check` green: 43 files, 743 tests. All four golden artefacts verify, and
the twelve-cell matrix is green on `14212ed` (§8).

---

## 0. The one-paragraph version

The fixture worlds are now ten `(UPP, ruleset, seed)` triples with **nothing
applied on top**, their identity covers the interpreted spec, and a `cepheus-1`
table edit therefore fails at the preflight before a tile is generated —
measured in §4, not asserted. The fBm diversity the old override bought moved
into the determinism battery, where hostile inputs belong. `generatorFor` is a
one-entry registry that refuses an unknown `?gen=` by name. `GEN_VERSION` is
`0.2.0` and is now treated as immutable.

Two things were found rather than built: **`fbm.amplitude` cannot change a
world** (§5), and **the bench report had been double-counting the crater pass
for four work packages** (§6).

---

## 1. What the fixture set is now

Ten worlds, Size 1 to A, one per code. Atmosphere 0 or 1, Hydrographics 0
throughout — the Phase 1 full-fidelity band, asserted against `fidelityFor`
rather than against the digits. **The seed column did not move**, so every hash
that moved in `fixtures.json` is attributable to the spec change alone, which is
the property that makes the diff readable.

The change is that the fBm override is gone. Since WP9 each fixture interpreted
a UPP and then replaced its fBm block with a hand-written one. That bought
test-input diversity and cost the thing the fixture set exists for: the manifest
pinned ten worlds the shipping path cannot reach, and the path a user *can*
reach was pinned nowhere.

**Atmosphere is load-bearing, not decoration.** `interpret` computes
`craters.densityScale = craterPreservation × (1 − hydrographics)`, so Atmo 1
gives 0.95 against Atmo 0's 1.0, with `regolithMaturity = √densityScale` behind
it. Both values appear at both ends of the size range — checked, because a set
where atmosphere correlated with size would let a bug that reads one while
meaning the other pass unseen.

### What was given up, and where it went

`cepheus-1` interprets every world at lacunarity 2 and gain 0.5. So the awkward
lanes the override carried — gain either side of 0.5, non-dyadic lacunarity,
octave counts to the clamp — would simply have stopped being covered.

They are now `battery.ts`'s `noise.fbm3.params` case: **the same ten parameter
blocks, verbatim**, each over ~100 000 adversarial coordinates on the identical
coordinate walk as the existing `noise.fbm3` case. That is a stronger check than
the one it replaces, and the battery is the artefact hostile inputs belonged in
all along. A test asserts the case exists and that `HOSTILE_FBM` still spans the
lanes, so trimming it cannot silently remove the coverage from both places at
once.

### A property of the buffers worth knowing

Regenerating split the ten cleanly. All ten `elevation` hashes moved, because
every world's octave count or frequency came from the table instead of the
override. But the **six fixtures whose UPP was unchanged kept their exact
`materials` and `albedo` hashes**, and only the four that gained an Atmosphere-1
digit moved theirs.

That is not a bug — it is WP11's depth-invariant design visible in the manifest.
Albedo and materials are functions of the crater and province fields, which
depend on radius, seed and `craters.*`; they do not read the fBm terrain at all.
An Atmo-1 digit moves `craters.densityScale`, so it moves them; a changed octave
count does not.

The consequence is worth stating plainly: **an fBm regression is caught by
`elevation` alone.** Three hashed buffers are not three independent checks of
everything.

---

## 2. Spec hashing — the R7 enforcement

The fixture-spec hash now covers the UPP, the ruleset id, the seed and the whole
interpreted spec, the last through `core`'s own `serialiseSpec` rather than a
second field list. Each fixture also carries its own `specHash` in
`fixtures.json`.

The per-fixture hashes are not redundant with the aggregate. The aggregate says
*that* the inputs moved; ten of them in a diff say **which worlds changed and
which did not**, and that is what separates a ruleset edit (some move) from a
kernel change (none move, every buffer hash does). From the aggregate alone
those two are the same event.

A deliberate consequence: a field reaching no tile is hashed anyway. Editing
`atmosphere.pressureBar` today moves this hash while every buffer hash stays
put. The fixture identity is what the interpreter produced, not the subset this
phase consumes.

---

## 3. What the albedo hash pins — decided, not inherited

`albedo` joined the per-buffer hashes in WP11; WP14 is where it became a claim
CI makes, so the claim is written down in three places (`FixtureResult.albedo`,
`regolith.ts`, the README): **it pins the byte, not the scalar behind it.**

One albedo byte is 1/255. Reordering a float sum moves the value behind it by
~1e-16, about 4e-14 of a byte. So a compositing-order change that reddens
`elevation` instantly is invisible here, for every value except one landing
within 1e-16 of a rounding boundary.

**An albedo change smaller than 1/255 everywhere is a change this manifest will
call clean.** The buffer making the bit-stability claim is `elevation`, hashed
as `Float64` on the same tiles in the same run. Pinning the scalar as well was
considered and rejected: a second hashed buffer of a quantity nothing renders,
to catch a class of change `elevation` already catches.

---

## 4. The acceptance criterion, measured

Plan §9: *the deliberate-edit tests (kernel op, ruleset table, fixture spec)
each fail the intended check and no other.* Each edit was applied to a clean
tree, all four gates run, and the tree restored. The gates were confirmed green
before and after.

| Edit | `golden:verify:battery` | `golden:verify:fixtures` | `ruleset:check` | kernel whitelist |
|---|---|---|---|---|
| *(none)* | pass | pass | pass | pass |
| **A.** `smootherstep`'s `10` → `10.0000001` | **FAIL** (5 cases) | **FAIL** (22 buffer mismatches) | pass | pass |
| **B.** `cepheus-1` Size 3 radius `2400` → `2401` | pass | **FAIL** (spec hash, at preflight) | **FAIL** | pass |
| **C.** fixture `X900000-0` → `X910000-0` | pass | **FAIL** (spec hash, at preflight) | pass | pass |

The three signatures are distinct, and that is the whole point of there being
more than one gate:

- **A** fails on *buffer* hashes, not on the spec hash. The fixture inputs did
  not change, so the preflight passes and the report reads "the arithmetic
  moved" — the correct diagnosis.
- **B** fails at the **preflight, before a single tile is generated**, naming the
  fixture set. That is plan §4.3 working exactly as specified: a one-digit table
  edit cannot reach a tile, let alone a share URL. The battery stays green, so
  evidence about arithmetic that did not change is not invalidated.
- **C** is B without `ruleset:check`. That one gate is what distinguishes "a
  table moved under the fixtures" from "a fixture was edited".

The whitelist check fires on none of them, correctly: no edit added a banned op.

---

## 5. `fbm.amplitude` decides nothing

The partition test over spec fields was rewritten to run in **both** directions:
every field listed as reaching no hashed buffer must move none, *and* every
field not listed must move one. The second half is new. It caught something on
its first run.

`fbm.amplitude` cancels. The tile pass computes `scale = terrainAmplitudeM /
fbmNormalisation(fbm)`, and both the fBm sum and that normalisation are
homogeneous of degree 1 in amplitude.

| Amplitude | Tile hash |
|---|---|
| 0.25, 0.5, 2, 1024 | **byte-identical** to amplitude 1 |
| 0.3 | differs, by at most **1.36e-12 m** |

Elevations on the probe tile span roughly ±3.8 km, so that is 1.4 picometres on
a mountain range — a relative 7.2e-14. Powers of two are exact, which is why
they agree to the bit; everything else differs only in the rounding of each
partial product. `terrainAmplitudeM` is the real relief control and always was.

The field stays hashed: the fixture identity is the whole spec, and carving out
exceptions is how a serialiser stops matching what it serialises. It is recorded
as `inert` rather than `pending`, since no phase will consume it.

**This is the halving trap from the other side.** The repo's standing warning is
that a one-ulp perturbation is too weak to probe generation, so the probe halves
instead. Halving is exact in binary floating point, and this is the one
scale-invariant field in the spec — so the deliberately-strong probe is, for
this field alone, the one probe guaranteed to move nothing. It was found by the
*direction* of the check, not by its strength.

---

## 6. Performance — a number, and what it is not

The handoff asked for a real figure on a 129² Phase-1 tile before `0.2.0` was
pinned, because ADR-0001 R4 is a live trigger.

| Measurement | Value | Trigger | Fires? |
|---|---|---|---|
| Single tile, 129², TypeScript | **90.2 ms** | > 100 ms | No — at 90% of it |
| Pool throughput | **29.0 tiles/s** at 6 workers | < 25 tiles/s | No — at 116% of it |

**This is not evidence and must not be cited as any.** It is `pnpm bench:quick`
(three iterations, not fifteen) under WSL2 on a development machine, not `pnpm
bench` on the minimum-target laptop. WP15 owns the measurement that counts. What
it is good for is the decision it was needed for: nothing here says `0.2.0`
should not be pinned, and R4 does not fire on the only numbers available.

For scale, the figure the WP13 handoff flagged as uncomfortable — 13.03 µs per
sample on a 4096×2048 export — is a different workload (point path, no tile
amortisation) and is not contradicted by this one.

### The bench report was double-counting the crater pass

Found while taking that measurement. The report's *"Full Phase-1 tile estimate at
129²: 90.8 ms (90.2 fBm + 0.591 craters)"* summed two things that overlap.

`TsTileGenerator.generate` has run the real two-tier crater pass and the regolith
pass inline **since WP10**, so the single-tile row was already a whole Phase-1
tile — while still being labelled "fBm" — and `bench/src/craters.ts` is a
*separate synthetic cost model* written for Phase 0, when there were no craters
in the generator. The estimate added a model of a pass that was already inside
the number it was being added to.

It was 0.6 ms out, which is exactly why it survived four work packages: the
arithmetic was wrong and no verdict moved. **WP15 reads this line to decide a
kernel**, so it is fixed rather than noted: the summary now reports the measured
tile and states the cost model separately, without adding it.

Same session, same file: **`pnpm bench:quick` overwrote the committed Phase 0
results.** A three-iteration run silently replaced `bench/results/phase0.md`, and
the only reason it was noticed is that `git status` was read afterwards. The
report labels itself a quick run in its own header, which warns a reader of the
file and does not warn the working tree at all. Quick runs now write
`phase0-quick.md`, gitignored.

---

## 7. Mutations

Twenty-three run, **twenty caught, three escaped**, and all three escapes are
explained below rather than counted as gaps. Every mutation was applied to a
clean tree and reverted; core mutations rebuild first (see the trap below).

Caught: `generatorFor` falling back to the current version on an unknown one;
`generatorFor` returning a shared instance; `checkGenVersion` reverting to
equality against the current version; the fixture identity dropping the ruleset
id, the UPP, the seed, or the interpreted spec; the per-fixture `specHash`
becoming a constant; `buildFixtureManifest` not writing it; the comparison not
reading it; `HOSTILE_FBM` losing a parameter block; `noise.fbm3.params` ignoring
its parameter set; a fixture losing its trace atmosphere; a fixture keeping a
hand-written fBm override; `quantiseAlbedo` losing a byte of range; the inert
field dropping out of the partition list; a live field being claimed inert;
`perturb` returning the world unchanged; a fixture leaving the scope fence by
atmosphere; and a fixture gaining hydrographics.

**Two assertions were added because thinking through mutations found them
missing**, before the mutations were run: `reproduces the committed hashes`
never compared `specHash`, and nothing asserted that the manifest comparison
*reports* a spec mismatch as its own kind. Both would have escaped.

### The three expected escapes

1. **`interpret(parsed, requireRuleset(id))` → `interpret(parsed)`.** There is
   one ruleset and `interpret`'s default parameter is `CEPHEUS_1`, so these are
   the same call. It becomes catchable the day `cepheus-2` exists, and the thing
   that will catch it is the per-fixture `specHash` this work package added.
2. **Narrowing the partition probe from three buffers to elevation alone.**
   Changes no verdict: every spec field that moves any hashed buffer also moves
   elevation. The width is deliberate anyway — the claim is about the buffers the
   manifest pins, and an elevation-only probe would quietly make a narrower claim
   than the manifest does. Phase 2's water pass is the first thing likely to
   break the coincidence. This is recorded in the test's own header.
3. **Loosening the scope-fence bound from Atmo ≤ 1 to Atmo ≤ 15.** A guard whose
   data sits well inside it cannot fail when the bound moves. Checked from the
   other side instead: moving a *fixture* to Atmo 6 or to Hydro 3 fires it, along
   with three other tests.

### The trap this pass hit

Two mutations first reported as escapes and were not. Tests import
`@traveller-mainworld/core` from **`dist`**, so a mutation to `core/src` that is
not rebuilt never reaches the code under test. The harness now rebuilds before
running, and both were caught on the re-run. *A number that seems surprising
usually means the harness is wrong* — the same lesson WP12 learned at 170°.

---

## 8. What was not checked

- ~~**The twelve-cell matrix has not been run for `0.2.0`.**~~ **Now evidenced.**
  Run `31086245914` on commit `14212ed`: all twelve green — chromium, firefox and
  webkit × ubuntu, macOS and Windows, plus the three Node reference cells — along
  with the `golden` and `build-invariance` jobs. So the new battery case and the
  regenerated fixtures reproduce bit-for-bit on three engines and three operating
  systems, which is the half of plan §9's acceptance WP14 could not self-certify
  from one machine. **Both halves of the acceptance are now met.**
- **The WASM parity leg was not run.** `pnpm check:parity` needs a `wasm:build`,
  and `noise.fbm3.params` is a new case the twin has never evaluated. It exercises
  `fbm3` with parameters the marshalling already passes, so there is no reason to
  expect a divergence — but *no reason to expect one* is not a measurement, and
  this one is cheap for whoever has the toolchain.
- **The 90.2 ms is a quick run under WSL2.** See §6. Not evidence.
- **The archived 0.1.0 manifests were not verified** and cannot be: `golden:verify`
  runs the code in this tree, which is `0.2.0`. They are a record, not a check.
- **No world was flown.** The fixture worlds all changed shape in this work
  package — every elevation hash moved — and **nobody has looked at one**. They
  are ten different planets than the ones WP11 and WP12 were judged against, and
  the WP11 visual-acceptance row was already never flown. An export is one
  command (`node packages/export/dist/cli.js --fixture size2-cinder`) and it was
  not run.
- **`docs/plans/` is still gitignored.** Deferred an eighth time.

---

## 9. What this hands WP15

- **Open question 1 is untouched and is now the loudest thing outstanding.** The
  fixtures hash at 129² and the viewer meshes at 65², so the shipped path is
  still not the hashed path. WP14 pinned `0.2.0` on the 129² numbers, which
  means closing it toward 65² is now a **version bump**, not a free change. That
  is a real cost this work package added, and it was added knowingly: leaving
  the harness on a prerelease to keep the option open would have meant WP14 did
  not do the thing it exists to do.
- **The bench report can be trusted again**, and its crater section should be
  either retargeted at the shipped pass or deleted.
- **R4 does not fire on the numbers available**, at 90% and 116% of its two
  triggers. Both are close enough that the real measurement decides it.
