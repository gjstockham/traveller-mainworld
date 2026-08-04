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

Nothing yet.

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
