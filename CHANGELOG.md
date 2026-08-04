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
