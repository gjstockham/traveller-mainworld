# ADR-0001 — Generation kernel: TypeScript or Rust/WASM

**Status:** **Accepted** — on an **amended R1**. Not on R1 as originally written: M1
(desktop Safari on macOS) was never run, and [Amendment 2](#amendment-2-2026-08-04--r1-amended-and-this-adr-promoted)
is where that residual is accepted by name and argued. Read it before citing this
ADR as settled.
**Date:** 2026-08-03 · **Accepted:** 2026-08-04
**Work package:** WP6 (implementation plan §6) · **Spike:** A §A.3
**Supersedes:** nothing · **Superseded by:** nothing

---

## What "provisional" meant here, why this ADR opened with it, and how it ended

*Written 2026-08-03, when the status was Provisional. Left standing in full,
because the reasoning is the spine of this document and deleting it on promotion
would destroy the only record of what the promotion had to clear. The closing
note says how it ended.*

Spike A's decision table (§A.3) turns on whether the TypeScript kernel's hashes
"match everywhere". **Everywhere has not been observed.** Nine browser CI cells
exist and none of them has ever run; three hand-checks on real Safari, iOS
Safari and Android Chrome are specified as non-optional and all three rows are
empty. What has been observed is three engines on one operating system, run
locally rather than in CI.

So this ADR does not report that the decision criteria were met. It reports that
**no divergence has been found in the evidence gathered so far**, adopts the
TypeScript kernel on that basis so Phase 0 can continue, and names precisely
what is missing. It becomes **Accepted** when [§Revisit trigger](#revisit-trigger)
item R1 is discharged, and it is rewritten as a WASM decision if any cell
diverges.

The distinction matters because of what this project promises. "The same UPP and
seed produce a bit-identical world on every device, browser and future version"
is a forever-claim, and the whole reason Spike A exists is that *likely* is not a
foundation for it. An ADR that recorded "TS wins, evidence: the matrix" while the
matrix had never run would reintroduce exactly the thing the spike was opened to
prevent — with a citation attached, which is worse, because a citation stops
people looking.

> **How it ended, 2026-08-04.** Twelve automated cells green on three OSes, M2
> green on Apple's own Safari, M3 green on a real Android handset. M1 — desktop
> Safari on macOS — was never run and no Mac was available.
>
> R1 was therefore **amended rather than discharged**, and this ADR promoted on
> the amended criterion. That is the one move the paragraphs above were written
> to guard against being made *silently*, so it was made loudly:
> [Amendment 2](#amendment-2-2026-08-04--r1-amended-and-this-adr-promoted) states
> what residual is being accepted, why, and what would reopen this. The status
> line says "on an amended R1" for the same reason. A reader who cites this ADR
> as evidence that the kernel matches everywhere is still wrong, and the
> document should keep making that hard.

---

## Context

Phase 0 has to retire two project-killing risks. Spike A is the first: can a
pure-TypeScript generation kernel produce bit-identical `Float64` output across
every target engine and OS, or is a WASM kernel required?

The design rests on the fact that IEEE-754 basic operations (`+ − × ÷`,
`Math.sqrt`) are required by the ECMAScript spec to be correctly rounded and are
therefore bit-identical across conforming engines, while transcendentals are
implementation-defined and demonstrably differ between V8, SpiderMonkey and
JavaScriptCore. The kernel is a lint-enforced whitelisted zone from which every
risky operation is banned, with transcendentals replaced by polynomial
approximations over whitelisted ops.

The alternative is a Rust→wasm32 kernel. The WASM spec fully specifies every
float operation, so the same bytes execute identically everywhere — a stronger
guarantee that does not depend on a whitelist holding forever. It costs a second
toolchain in CI and a second implementation to keep in step.

Both were built (WP1, WP3) behind a single `TileGenerator` interface so the
choice would be revisable. This ADR is where it is made.

---

## Decision criteria

Verbatim from spike plan §A.3. These are the criteria; no others were applied,
and none were added.

| Outcome | Decision |
|---|---|
| TS kernel hashes match everywhere AND meets Spike B perf budget | **TS kernel.** Simpler debugging, no toolchain overhead. WASM stays a future optimisation. |
| TS hashes match but perf misses budget | **WASM kernel** (perf grounds). |
| TS hashes diverge anywhere | **WASM kernel** (correctness grounds — the stronger guarantee wins regardless of perf). |

Note the shape of row 1: it asks whether the TypeScript kernel **meets** the
budget, not whether anything beats it. Relative speed is not a criterion. See
[§On the WASM speed advantage](#on-the-wasm-speed-advantage).

---

## Evidence

Generator version **0.1.0**; golden manifest digest
`0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7`; 21 battery
cases, ≥10⁶ deliberately hostile inputs each — signed zeros, denormals, the
normal/denormal boundary, ulp neighbours of integers and powers of two, and
magnitudes at both ends of the double range. Every cell compares all 21 case
hashes plus the overall digest, exactly, against the committed manifest.

> **Amended by WP7 (2026-08-04).** The cells now additionally carry a second
> artefact, `packages/golden/fixtures.json` — ten fixture worlds through the
> shipping `TileGenerator`, hashed per output buffer. That is *more* evidence
> than this ADR was written on, not different evidence, and the digest cited
> above is unchanged: WP7 settled implementation plan §10 q5 as `genVersion`
> covering `core` only, with the fixture set keyed on its own hash, precisely so
> that the number this ADR rests on stays a statement about kernel arithmetic.
> Nothing below was re-decided; R1 still gates this ADR's status, and now reads
> on both artefacts.

### E1 — Cross-platform determinism (WP4)

Source: [`docs/evidence/wp4-manual-checks.md`](../evidence/wp4-manual-checks.md).

| Cell | Engine | Where | Result |
|---|---|---|---|
| Node reference | Node 24.11.1 / V8 13.6 | Ubuntu 24.04 on WSL2, local | **PASS** — `0c6181a0…` |
| chromium | 151.0.7922.34 | Ubuntu 24.04 on WSL2, local | **PASS** — `0c6181a0…` |
| firefox | 153.0 | Ubuntu 24.04 on WSL2, local | **PASS** — `0c6181a0…` |
| webkit | 26.5 | Ubuntu 24.04 on WSL2, local | **PASS** — `0c6181a0…` |
| chromium / firefox / webkit | — | GitHub Actions, ubuntu-latest | **not run** |
| chromium / firefox / webkit | — | GitHub Actions, macos-latest | **not run** |
| chromium / firefox / webkit | — | GitHub Actions, windows-latest | **not run** |
| M1 | Real Safari | macOS | **not run** — no Mac available |
| M2 | Safari | iOS | **not run** — untested by choice |
| M3 | Chrome 150 | Android 10 | **PASS** — `0c6181a0…` / `9843cdd3…` |

*(The table above is as this ADR was written. Since then the nine CI cells have
run green on three OSes, the Node reference leg with them, and M2 and M3 have
been hand-checked — on real iOS Safari and a real Android device respectively —
see the amendments below and the evidence file. M1 never ran; Amendment 2 accepts
that residual explicitly rather than filling it. The original text is left
standing rather than rewritten, because what this decision was made on is a
different question from what is known now.)*

Three engines agree, bit for bit, on **one** operating system. Reading that as
more than it is would be easy in two specific ways, so both are stated plainly:

- **PRD §9.1 requires at least two OSes. One has been tested.** WSL2 is a Linux
  kernel; it is not a second OS.
- **Playwright's WebKit reports a macOS user agent whatever host it runs on.**
  The WebKit cell above ran on Linux. The OS of a cell comes from the cell name,
  never from the user-agent string in its evidence block. A reader skimming the
  artefacts could otherwise count that cell as macOS coverage.

And Playwright's WebKit is not Safari in any case: different build configuration,
different JIT tiers, different release cadence. Apple ships the only WebKit
anyone actually browses with, which is why M1–M3 are specified as non-optional
rather than as nice-to-have, and why `packages/golden/verify.html` exists.

**No divergence has been observed.** That is the honest summary of E1: a
statement about what was looked at, not about the engines that were not.

### E2 — Performance (WP5, Spike B)

Source: [`bench/results/phase0.md`](../../bench/results/phase0.md). Measured on
the integrated-GPU laptop the spike plan names as the minimum target — Intel
i7-1165G7, 4 physical / 8 logical cores, 15.5 GiB, Node 24.11.1 — so these are
the numbers that decide, not an upper bound to be discounted.

Single-tile generation, 24 tiles spread across all six faces and depths 0–6,
10 octaves of fBm (the §B.1 representative Phase-1 tile, not the 8-octave
default, because octave count is keyed to depth and the deepest tiles are the
ones that have to fit):

| Kernel | Grid | Vertices | Median ms/tile | Min | p95 | ns/vertex |
|---|---|---:|---:|---:|---:|---:|
| typescript | 65² | 4,225 | 11.3 | 10.6 | 13.7 | 2679.8 |
| typescript | 129² | 16,641 | **41.0** | 39.4 | 42.8 | 2466.0 |
| wasm | 65² | 4,225 | 5.50 | 5.20 | 7.68 | 1301.7 |
| wasm | 129² | 16,641 | 19.4 | 18.7 | 21.2 | 1167.4 |

The WASM rows include marshalling out of linear memory, because that is what
using the kernel from JavaScript actually costs.

Worker-pool throughput (`node:worker_threads`, 129²):

| Workers | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tiles/s | 25.0 | 40.3 | 51.2 | 59.4 | 66.5 | 71.7 | **74.3** |

Adding the Phase-1 crater cost model (0.700 ms at 129²) gives a full Phase-1
tile estimate of **41.7 ms**.

| Budget (PRD R13) | Requirement | TypeScript kernel | Margin |
|---|---|---|---|
| Single tile, single-threaded, 129² | ≤ 100 ms | 41.7 ms | **2.4× inside** |
| Sustained pool throughput | ≥ 25 tiles/s | 74.3 tiles/s | **3.0× inside** |

**Both budgets met.** The spike plan's escalation rule — "if TS misses these by
< 2×, optimise before switching kernels; ≥ 2× miss → WASM" — is not reached;
there is no miss to escalate.

Two limits on E2, neither of which changes the conclusion: the pool figures come
from `node:worker_threads` rather than browser `Worker`s (same OS threads, same
V8, so the scaling shape carries; treat the absolute numbers as the reference
platform's), and the machine runs under WSL2, where CPU-bound work is near-native
but the browser legs should be measured on the Windows side. A 2.4× margin
absorbs a good deal of both.

### E3 — Mutual parity, TypeScript ↔ WASM (WP3)

All 21 battery cases are bit-identical between the two kernels, on one platform
(the `wasm-parity` job, Ubuntu). The two kernels also agree exactly on
`TAN_AT_ONE`, on the 216-entry octave rotation table, and on tile addressing
across all six faces and depths 0–6.

This is the evidence that matters most and is least visible. A kernel compared
against its own committed manifest proves it is **stable**; two independently
written kernels compared against each other prove it is **right**, because a bug
would have to be reproduced independently in Rust and TypeScript to survive the
comparison. E1 cannot deliver that at any number of cells.

### What the evidence does not cover — and which of it this decision relied on

`docs/evidence/wp4-manual-checks.md` requires this ADR to say explicitly which
evidence it relied on. (That file used to attribute the requirement to "open
question 5 in the implementation plan §10", which was a dangling reference: §10
item 5 is the generator-version scheme. WP7 settled that question and corrected
the citation, so the discrepancy this note flagged is now closed rather than
merely recorded. The requirement itself was always unambiguous and is discharged
here.)

- **The matrix carries the TypeScript kernel only.** The WASM twin is not run
  across the nine cells. This is a deliberate scope choice recorded in
  `docs/evidence/wp4-manual-checks.md`, not an oversight: the WASM spec pins
  every float operation, so a WASM divergence across engines would be a browser
  bug rather than a design risk, and the kernel whose cross-engine behaviour is
  actually in question is the TypeScript one.
- **TS↔WASM parity is one-platform.** One platform is the right amount for the
  question that check asks — "do two independent implementations agree?" — since
  the twin is compared against the TypeScript kernel and the TypeScript kernel is
  what the matrix carries across platforms. It is *not* evidence that the twin
  behaves identically on other platforms, and nothing here claims it is.
- **This decision therefore relied on:** a nine-cell TypeScript matrix of which
  three cells have run, on one OS, locally; plus one-platform TS↔WASM parity;
  plus single-platform performance figures. Every one of those qualifiers is
  load-bearing.

---

## Applying the criteria

Strictly, **no row of the §A.3 table has its antecedent satisfied.** Row 1 needs
hashes matching *everywhere* and six CI cells plus three hand-checks have not
run. Row 3 needs a divergence *somewhere* and none has been seen. The evidence
sits in the gap between them, which is the gap between "no divergence found" and
"no divergence exists".

Row 2 is definitively excluded: performance does not miss the budget, so nothing
selects WASM on performance grounds.

That leaves a choice between adopting the TypeScript kernel provisionally and
blocking Phase 0 until the matrix reports. Adopting provisionally is preferred
because the cost of being wrong is bounded and known: if a cell diverges, §A.3
row 3 selects WASM on correctness grounds regardless of performance, the twin
already exists and is already proven bit-identical, and the swap is a one-line
change at the `TileGenerator` seam — a property this work package tested rather
than assumed (see [§Consequences](#consequences)). What would *not* be bounded is
shipping a golden manifest under a determinism promise that has never been
checked off one operating system, which is why R1 gates Phase 0 exit and not
merely this ADR's status.

---

## Decision

**The viewer and every downstream consumer use the pure-TypeScript kernel
(`TsTileGenerator`).** `crates/kernel-wasm` is archived, not maintained.

Provisionally, on the evidence above, pending R1.

### On the WASM speed advantage

The WASM kernel is 2.11× faster at 129² and 2.05× at 65². That did not enter the
decision, and it is worth saying why rather than leaving the number sitting in a
table looking like an argument.

§A.3 asks whether the TypeScript kernel *meets* the budget. It does, by 2.4×. A
2.1× win on a budget already met buys headroom nobody has asked for, and the
price is a second toolchain in CI and a second implementation to keep in step
forever — paid on every commit, for as long as the project lives.
`bench/results/phase0.md` makes this argument at the point of measurement, and
this ADR adopts it rather than re-deriving it.

The argument would change if the budget stopped being met: if Phase 1's crater
and hydrology passes consume the 2.4× margin, WASM becomes a *performance*
answer under §A.3 row 2, and the measurement that would show it is a rerun of
`pnpm bench`. That is R4 below.

---

## Consequences

### Positive

- One language, one toolchain, one debugger for all generation code. Source maps
  work; a kernel bug is a breakpoint rather than a rebuild.
- CI loses its only Rust job. The required path is `gate`, `test` (3 OSes) and
  `browser-matrix` (9 cells) — no cross-language build to keep green.
- A contributor needs Node and pnpm. Rust becomes optional, and `pnpm check`
  already passes without it (the unit-suite parity test skips, loudly).

### Negative, and accepted

- **The determinism guarantee now rests on the op whitelist holding forever**,
  rather than on the WASM spec pinning every operation. That is a weaker
  foundation, and it is the real cost of this decision. It is mitigated by
  enforcing the whitelist twice — `eslint.config.js`, and
  `scripts/check-kernel-whitelist.mjs`, which deliberately ignores
  `eslint-disable` — so both must be defeated to get a banned operation into
  hashed output, and by the golden manifest failing CI on any drift.
- **The twin will drift.** Archived means unmaintained, so a future failure of
  the parity workflow may mean "the twin is stale" rather than "the kernel is
  wrong", and telling the two apart costs someone an afternoon. The alternative —
  maintaining it — is the cost this decision exists to avoid.
- **The mutual parity check leaves the required CI path.** This is the one
  consequence with real potential to hollow the project out, since E3 is the only
  evidence that two independent implementations agree. Handling: the crate is
  archived rather than deleted; `.github/workflows/wasm-parity.yml` keeps it
  runnable on `workflow_dispatch` plus a monthly schedule, so drift is found by a
  calendar rather than by someone who needs it in a hurry; `pnpm check:parity`
  runs it locally; `crates/kernel-wasm/README.md` documents its status and the
  three rules; and R2 below names it in the revisit trigger.

### Neutral

- The twin's three rules — never enable `relaxed-simd`, never call Rust libm,
  never recompute `OCTAVE_ROTATIONS` — hold while the crate exists, archived or
  not. `pnpm lint:wasm` stays in the `gate` job and runs on every commit. The
  effective-flag probe still skips where rustc is absent, and the parity workflow
  is where it is authoritative.

### The seam, and why it is a tested claim rather than an assertion

This ADR claims the choice stays revisable at the `TileGenerator` boundary. That
claim is worthless unless the swap actually works, so WP6 made it exercisable and
then exercised it:

- `packages/viewer/src/kernel/choice.ts` is the single place the decision is
  written down in code. `packages/viewer/src/workers/tileWorker.ts` names no
  kernel implementation.
- `packages/viewer/src/workers/tileJob.ts` takes the generator as a parameter, so
  it can be run with either kernel without touching the worker.
- `packages/viewer/test/tileJob.test.ts` runs the **real WASM twin** through that
  path and compares the renderer-ready buffers against the TypeScript kernel's,
  element by element. It also runs a stand-in generator whose output no real
  kernel could produce, which is what catches a `runTileJob` that ignores its
  argument. All three failure modes were confirmed by deliberately breaking them.

What that test does not prove: that the kernels agree bit-for-bit. It compares
Float32 positions, so a sub-Float32-ulp difference in Float64 elevation would be
absorbed. `pnpm golden:parity` is the Float64 comparison over the full battery,
and it is the one E3 cites.

---

## Amendment 1, 2026-08-04 — what has been observed since

The evidence above is what this decision was made on. This section is what is
known now. Nothing here changes the decision; it changes how much of R1 remains.

**Discharged.** All nine `browser-matrix` cells have run green across ubuntu,
macOS and Windows, on both golden artefacts (WP7 added a fixture manifest to
every cell). The Node reference leg passed on the same three operating systems,
and the `build-invariance` cell showed that an unminified bundle and a
Vite-default bundle reproduce both digests. Twelve cells, four engines counting
Node, three OSes, identical digests throughout. PRD §9.1 asked for two OSes;
there are three. The "one operating system" limit named in E1 is gone.

**M3 discharged.** Android 10 / Chrome 150, on a real handset, both digests
exact — the first result from actual hardware and the first from an Arm CPU.

**M2 discharged.** iOS Safari 26.5.2 on an iPhone, both digests exact. This is
the one that mattered. Every WebKit result in this document until now came from
Playwright's build, and the ADR says at length why that is not the same thing:
**no engine Apple ships had ever executed this battery.** One now has. The run is
Safari proper rather than a WebKit shell — the user agent carries `Version/…`
with no `CriOS`/`FxiOS`/`EdgiOS` token — so it is Apple's browser, Apple's
JavaScriptCore build, on Apple silicon. The largest single gap in E1 is closed.

**M1 is not discharged.** No Mac is available to the author. What it would add
is now a narrow and specific thing: **desktop** Safari's build configuration and
JIT tiers, on desktop-class hardware with no thermal or memory ceiling. The
engine question is answered; a tiering question is not, and JIT tiering is
precisely a mechanism by which one engine can return two answers for the same
arithmetic. Small is not nothing.

So the shape of the evidence has changed more than a row count suggests. What was
"three engines on one OS, run locally" is now "three engines on three OSes in CI,
plus a real Arm handset, plus the vendor JavaScriptCore this whole file was
written to reach".

**This ADR nonetheless remains Provisional.** R1 as written asks for M1–M3, and
M1's row is blank. Promoting on it would mean recording that the decision
criteria were met when they were not — the failure this document opens by
refusing to commit, and no less a failure for being one row from true. There are
two honest routes: run M1 on any borrowed Mac against the deployed page, or amend
R1 here, on the record, to treat M2 as discharging the JavaScriptCore question
and accept the desktop-tiering residual by name. The second is legitimate. It has
not been done, so the status stands.

*(The second route was taken later the same day. See Amendment 2. This section is
left as written; it is the argument the amendment had to answer.)*

---

## Amendment 2, 2026-08-04 — R1 amended, and this ADR promoted

**Decision: R1 is amended to require M2 and M3, not M1–M3. On the amended
criterion R1 is discharged, and this ADR is promoted from Provisional to
Accepted.** Taken by the author, recorded here rather than enacted by editing
R1's text and moving the status line.

### What is being accepted

M1 — desktop Safari on macOS — has never run and is not scheduled. Every other
cell in [E1](#e1--cross-platform-determinism-wp4) is green. So the residual being
accepted is exactly this: **desktop Safari's build configuration and JIT tiers,
on desktop-class Mac hardware.** Not "Safari"; not "JavaScriptCore"; not "Apple
hardware" — M2 covers all three.

### Why it is acceptable

1. **The engine question is answered.** Spike A's question is whether the kernel
   produces bit-identical `Float64` output across engines. The three engine
   families are V8, SpiderMonkey and JavaScriptCore; all three have now executed
   the full battery and the full fixture set in a browser their vendor ships or
   builds, and JavaScriptCore did so on Apple's own hardware in Apple's own
   browser. No divergence anywhere, in twelve automated cells and two devices.
2. **The whitelist is the actual guarantee, and it is enforced, not hoped for.**
   The kernel is restricted to operations the ECMAScript spec requires to be
   correctly rounded — `+ − × ÷`, `sqrt`, and integer/bitwise work. Those have no
   licence to vary between builds or JIT tiers of one engine; a divergence would
   be a spec violation in Safari, not a difference of implementation. That is a
   materially stronger position than "we tested a lot of things and none broke",
   and it is what makes the residual narrow rather than open-ended.
3. **Desktop and iOS Safari are the same JavaScriptCore source line.** They
   differ in build configuration and JIT tier policy, not in the arithmetic the
   spec pins down. Tiering *is* the plausible mechanism for a same-engine
   divergence, which is why this is a residual at all — but it would have to move
   a correctly-rounded operation to bite, and both tier policies already agree
   with each other everywhere else measured.
4. **The cost of holding is real and the benefit is speculative.** Phase 0 exists
   to retire two project-killing risks. Blocking its exit on borrowing a Mac
   holds the entire project against a check whose expected information content is
   now very low — while leaving the ADR Provisional, which makes every downstream
   document hedge about a decision that is not, in practice, in doubt.

### What is *not* being claimed

This ADR does not claim the TypeScript kernel has been shown to match everywhere.
It claims no divergence has been found in a body of evidence that now covers
every engine family on every target OS plus two real devices, and that the
remaining unmeasured configuration is one whose failure mode would be a browser
bug rather than a design flaw. §A.3 row 1 is satisfied **as amended**. Anyone
citing this ADR for the stronger claim is citing it wrongly.

### What reopens it

M1 is not withdrawn as a check — it is withdrawn as a *blocker*. It stays in the
evidence file as an open row, and running it remains worth a minute on any Mac
that becomes available. If it is ever run and diverges, R1's divergence clause
applies unchanged and this becomes a WASM decision on correctness grounds, status
back to Provisional pending the rewrite. The same holds for any divergence
reported anywhere, by anyone, on any engine. See R6.

---

## Revisit trigger

Any of these reopens this ADR. R1 gated its status and Phase 0's exit and is
discharged as amended; **R6 is the permanent one** and is what the acceptance in
Amendment 2 rests on.

| # | Trigger | Consequence |
|---|---|---|
| **R1** | ~~The nine `browser-matrix` cells run and M1–M3 are hand-checked.~~ **Discharged 2026-08-04 as amended** — twelve cells green on three OSes, M2 green on iOS Safari, M3 green on Android Chrome. **M1 was dropped from this trigger by [Amendment 2](#amendment-2-2026-08-04--r1-amended-and-this-adr-promoted), not satisfied by it.** | ~~All green:~~ §A.3 row 1 is satisfied **as amended**, and this ADR is **Accepted**. Divergence handling moves to R6, which is permanent. |
| **R2** | The `wasm-parity` workflow fails, or has not run in a quarter. | The mutual-parity evidence has expired. Run `pnpm check:parity`, establish whether the twin is stale or the kernel has changed, and repair the twin — it is the only check that two independent implementations agree. |
| **R3** | A new generator feature needs an operation the whitelist bans, and no polynomial approximation over whitelisted ops is practical. | The whitelist is no longer sufficient to carry the determinism promise, which is the foundation this decision rests on. Reopen. |
| **R4** | `pnpm bench` shows the 129² Phase-1 tile exceeding 100 ms, or pool throughput below 25 tiles/s, on the minimum target. | §A.3 row 2 applies: WASM on performance grounds. The 2.4× margin is what makes this unlikely, not impossible — Phase 1 adds passes. |
| **R5** | A target engine is added (a new browser, a native or server-side runtime). | The matrix's coverage claim no longer matches the target set. Extend `browser-matrix` and re-run before relying on this decision. |
| **R6** | **Any** hash divergence is observed anywhere — a matrix cell, a hand-check, a user report, or M1 if it is ever run. | §A.3 row 3 selects the WASM kernel on **correctness** grounds regardless of performance. Status returns to **Provisional** pending the rewrite. Record the engine, version, OS, case and both hashes; do not loosen a comparison to make a cell green. This trigger does not expire, and R1 being discharged does not weaken it — it is the reason accepting M1's residual is safe rather than merely convenient. |

---

## References

- [Phase 0 spike plan](../requirements/phase0-spike-plan.md) §A (criteria in §A.3), §B, risk table
- [Phase 0 implementation plan](../plans/phase0-implementation-plan.md) §6 (WP6), §10 — *not in version control; the change protocol it defines is restated in [CHANGELOG.md](../../CHANGELOG.md) and the README*
- [WP4 cross-platform hash evidence](../evidence/wp4-manual-checks.md)
- [Spike B performance baseline](../../bench/results/phase0.md)
- [The archived twin](../../crates/kernel-wasm/README.md)
- PRD §9.1 (cross-platform requirement), R13 (performance budgets), R14 (generator version), R16 (golden-hash CI)
