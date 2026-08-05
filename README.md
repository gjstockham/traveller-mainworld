# Traveller Mainworld

A browser-based tool that turns a Universal Planetary Profile (UPP) plus a seed into a fully explorable 3D planet. Paste `C867A69-8`, get a world you can orbit, zoom into, and export as a projected 2D map.

**Status:** Phase 1 (airless rocky worlds), in progress. Phase 0 is complete. The
UPP parser, the `cepheus-1` interpretation layer and hierarchical crater fields
have landed; the input UI, regolith palette, export package and share URLs have
not. See [the PRD](docs/requirements/worldgen-prd.md) for scope.

The generator version is a **prerelease** (`0.2.0-alpha.3`) for the duration of
Phase 1 — see [`CHANGELOG.md`](CHANGELOG.md) for why, and for what moves between
re-pins.

## Layout

| Path | Purpose |
|---|---|
| `packages/core` | Headless deterministic generation. Zero rendering dependencies. |
| `packages/core/src/kernel` | **The whitelisted zone** — see below. |
| `packages/core/src/input` | UPP parsing and seed handling. No rules knowledge. |
| `packages/core/src/ruleset` | `(UPP, ruleset) → PhysicalWorldSpec`. **All** rules knowledge, and the only OGL content. |
| `packages/viewer` | Three.js cube-sphere viewer (Vite). |
| `packages/golden` | Golden-hash battery, fixture worlds, manifests and runners. |
| `crates/kernel-wasm` | Rust→wasm32 twin of the kernel. Must hash identically to it. |
| `bench` | Spike B performance baseline, and the results it produced. |
| `scripts` | Repo checks run in CI. |

## Getting started

Requires Node ≥ 22 and pnpm (via `corepack enable pnpm`).

```sh
pnpm install
pnpm check             # lint + typecheck + build + test
pnpm golden:verify     # both golden artefacts vs their committed manifests
pnpm golden:matrix     # the same, in chromium, firefox and webkit
pnpm golden:invariance # the same, under two further bundler configurations
pnpm --filter @traveller-mainworld/viewer dev    # the viewer
pnpm --filter @traveller-mainworld/viewer e2e    # headless smoke tests
```

The matrix needs browsers: `pnpm exec playwright install chromium firefox webkit`.

The WASM twin additionally needs Rust and the wasm32 target
(`rustup target add wasm32-unknown-unknown`):

```sh
pnpm check:parity    # build the twin, run its Rust tests, compare both kernels
```

Without it, `pnpm check` still passes: the parity tests skip, loudly.

## Benchmarks

```sh
pnpm bench           # writes bench/results/phase0.md
pnpm bench:quick     # reduced iterations, for checking the harness
```

Measures the kernels against the PRD R13 budgets — ≈100 ms per tile
single-threaded, ≥25 tiles/s sustained pool throughput — and produces the
evidence half of the WP6 kernel decision. Run it on an idle machine.

Benchmarks are measurement code, and unmeasured measurement code reports
whatever it likes, so the harness has tests of its own and the defences are
deliberate: warm-up before timing, a printed sink so nothing can be eliminated
as dead code, median and p95 rather than a mean, and a control run subtracted
from the transfer figures. Three numbers in the first draft of the results were
wrong in ways the table did not show — see `bench/test/harness.test.ts`.

`bench/src/craters.ts` was a **cost model** standing in for a crater pass that
did not exist. It exists now (WP10), and the model's 0.700 ms per 129² tile is
not what the real pass costs: warmed medians in Node run 21–32 ms at 65² and
72–115 ms at 129², against a ≈100 ms budget. Those are the shape of a number
rather than a measurement — wrong machine, not through this harness, no
percentiles — and replacing the model with a real one is **WP15's** job, along
with whether ADR-0001's R4 performance trigger fires and Phase 1 open question 1
(65² vs 129²), which the gap between those two rows now bears directly on. Until
then the model stays where it is and should not be quoted as a Phase 1 figure.

The viewer takes `?seed=<text>` to change world, `?debug=1` to preserve the WebGL
drawing buffer so pixels can be read back, and `?fixture=<id>` to fly one of the
ten golden fixture worlds:

```
?fixture=size1-rockball   size2-cinder     size3-ceres      size4-luna
         size5-mercury    size6-mars       size7-temperate  size8-earthlike
         size9-large      sizeA-maximal
```

Deployed at <https://gjstockham.github.io/traveller-mainworld/viewer/>, so a
fixture is one URL away on any device — though note a phone GPU says nothing
about Spike C's exit criteria, which are about the integrated-GPU laptop.

Those are the same `World` objects `packages/golden/fixtures.json` pins — the
specs live in `core`, not in the harness, so what you fly is what is hashed
rather than a copy that could drift. An unknown id is refused with the list
rather than silently falling back to the default world, and `?seed=` is refused
alongside `?fixture=` because a fixture's seed is part of what is pinned.

Every world is framed from the **same absolute altitude** (15 000 km), not the
same multiple of its own radius, so apparent size tracks real size: a Size 1
rockball starts as a small disc and a Size A world nearly fills the frame. The
camera used to start at 1.5 radii above whatever it was looking at, which made
every world identical on screen and left the only evidence of scale in the
overlay readout — throwing away the one thing a space-to-surface zoom exists to
convey. Zoom does the rest.

**Terrain is rendered at true scale — no vertical exaggeration.** Real planets
are geometrically spheres: Earth's entire range, Marianas to Everest, is 0.31%
of its radius, and a photograph from orbit shows a perfectly circular limb.
Everything visible on Luna or Mars from space is albedo and low-sun shading, not
a departure from a circle. Earlier settings here (a flat 30×, then a square-root
compression at 3.5% of radius) made large worlds look rockier than they are,
which is the opposite of the goal.

`?exaggeration=<n>` overrides it for inspecting terrain that true scale hides —
an inspection tool, not a display default. It is a display choice either way and
cannot touch generated data or a hash.

`?meshprobe=1` fills a newly-created tile mesh's vertex-colour buffer with
magenta instead of leaving it zeroed. It exists for the open finding in
[docs/evidence/spikec-exit.md](docs/evidence/spikec-exit.md) — tiles occasionally
flicker black while zooming — and splits its three hypotheses in one flight: a
**magenta** flash is a mesh drawn before its colours were written, or a pooled
mesh reattached before it was refilled; a flash that stays **black** is geometry,
almost certainly a skirt wall caught face-on. Presentation only.

What this exposes is that almost everything visible on these worlds *was*
displacement. At true scale they were smooth spheres with four hard-edged albedo
bands, because the things that give a real body its face were not built yet.
Craters are the first of them and have landed; what is still missing is albedo
that tracks geology rather than elevation (Phase 4), and shading from the true
elevation gradient at full resolution — smooth per-vertex normals, which is what
the apron below exists for (WP12). Photorealism is those, not a multiplier.

## Skirts and seams

Tiles stream in independently and out of order, so where two LOD levels meet a
crack can open. Rather than stitching edges — which would need neighbour
awareness inside generation — each tile carries a **skirt**: a wall of
duplicated edge vertices pushed inward to plug the gap from behind.

Skirts are not free. The wall is near-radial, so it is barely lit and renders
almost black; multisampling then blends the surface against it and leaves a
hairline at every tile join. Drawn unconditionally, that is a dark grid tracing
the whole quadtree across the globe.

So skirts are drawn **only where they are needed**. Adjacent tiles at the same
depth share their edge vertices bit-for-bit (the kernel's seam guarantee), so
there is no crack between them and no wall required. `lod/neighbours.ts` works
out which of a tile's four edges face a different LOD and selects one of sixteen
prebuilt index buffers accordingly.

*Known limitation:* edges crossing a **cube-face boundary** are still skirted
unconditionally, because cross-face adjacency needs a rotation table the viewer
does not yet carry. Twelve cube edges are affected, and a faint seam is visible
along them at some angles.

**Craters made the crack about a hundred times bigger, and the skirt had to grow
with it.** A tile carries one crater band its parent could not resolve, so where
two LOD levels meet they disagree at a shared vertex by that band's crater
depth. `skirtDepthFor` used to size the wall from the fBm's statistical
self-similarity — relief across a cell shrinks with the cell — and that reasoning
does not transfer: a crater's depth is set by the crater, not by a fraction of
the world's relief. The wall now carries a third term from `lodStepBound` in
`core`, which is zero wherever the band gate does not move and is asserted
against the real field rather than argued for in a comment. It settles at around
5% of a tile edge, and that figure is scale-invariant — making it smaller means
gating bands in later, not tuning the skirt.

**The apron.** Tile generation also produces an `(n+3)²` elevation grid, one ring
beyond the tile on each side. It is not drawn: WP12 needs it to compute smooth
per-vertex normals, because a normal at an edge vertex needs elevation from
outside the tile and without it every tile boundary gets a normal discontinuity
that reads as a wireframe grid over the whole planet. Within a face the ring is
the neighbour's own elevation bit-for-bit; across a cube-face boundary it is an
extrapolation, the same twelve edges named above.

## The two golden artefacts

`packages/golden` commits two records of what the generator produces, and every
cell of the matrix checks both.

**The determinism battery** (`manifest.json`) evaluates every kernel function
over ≥10⁶ deliberately hostile inputs — signed zeros, denormals, the
normal/denormal boundary, ulp neighbours of integers and powers of two, and
magnitudes at both ends of the double range — then hashes the canonical
little-endian bytes of the results.

**The golden fixtures** (`fixtures.json`) generate ten whole worlds through the
same `TileGenerator` the viewer ships. Ten hand-written specs spanning Cepheus
sizes 1–A, each evaluated over a fixed 90-tile set covering all six faces at
depths 0–6 — deliberately including every face corner and edge-adjacent tiles in
both orientations, because that is where a tangent-warp mapping bug shows first
and a face interior is where it shows last. Each output buffer is hashed
separately: elevation, water mask, materials. A kernel function can be perfectly
bit-stable while the composition of them into a tile is not, and this is what
catches that.

Running both on every browser and OS is what turns "should be identical" into
"demonstrably is". CI fails on any mismatch. (`pnpm golden:parity`, the TS↔WASM
comparison, runs the battery only, and **from WP10 it skips `tile.composite`** —
the archived twin does not implement the crater pass, so that one case
legitimately differs. It is named in the report every time it is skipped. The
consequence is that composition is no longer checked by a second implementation,
only against this kernel's own past output; see the note in `parity.ts`.)

**The water-mask hashes are hashes of a constant.** Phase 0 worlds are airless,
so the water mask is all zeros for every fixture and its hash is identical
across all ten. It is compared — an unintended non-zero would fail — but it is
not coverage of a water pass that does not exist yet, and it will keep passing
when Phase 2's lands broken. `fixtures.json` records `waterMaskAllZero` per
fixture so that is data rather than a comment, and a test asserts the flag
against the real buffer so it cannot quietly become false.

### Why two files rather than more rows in one

`genVersion` is not a manifest key. It is embedded in share URLs and exports,
and PRD R15 obliges the app to keep a code path alive for every version it ever
emits — so it moves when the *arithmetic* moves. A fixture spec is a test input:
editing one alters output for no input a user can reach, and bumping the
generator version for it would mint a phantom version with no code behind it.

So `genVersion` covers `packages/core` only, and the fixture set carries its own
identity — a **fixture-spec hash** over the specs, seeds, tile set and grid size.
Edit a radius and that hash moves, visibly, without touching the kernel's version
and without invalidating evidence about arithmetic that did not change. Given the
fixture set needs its own key regardless, folding its hashes into `manifest.json`
would buy one file and cost the thing that matters: the battery digest would then
move whenever a fixture changed, so every citation of it as *kernel* evidence
would go stale for reasons unrelated to the kernel.

Two files can drift. Three things stop that being a standing question: both carry
`genVersion` and the fixture comparison refuses to run when they disagree;
`golden:verify` runs both, so there is no command that checks one and reports
success; and every matrix cell asserts both ran.

## The cross-platform matrix

The determinism promise is a claim about *other people's* engines, so both
artefacts run on all of them: chromium, firefox and webkit × ubuntu, macOS and
Windows, alongside the Node reference run on the same three OSes. Nine browser
cells, each comparing every hash against the same committed manifests. A quick
ubuntu/Node job runs the identical comparison first and gates the rest, so a
hash that has already moved says so once in about a minute rather than twelve
times in twenty.

```sh
pnpm golden:matrix   # all three engines locally (needs: pnpm exec playwright install)
pnpm golden:page     # serve verify.html on :4174 for a hand-check on a real device
```

The page runs the battery in one worker and shards the fixture worlds across a
small pool, because a hand-check on a borrowed phone has to finish while the tab
is still in the foreground. Sharding is a property of the runner: each fixture is
an independent pure function of its own spec and seed, so which worker evaluates
one cannot reach its hash, and a test proves a sharded run equals a whole one. If
a cell is slow, that is a runner to fix — never a fixture set to trim, because
the moment the count answers to a stopwatch the number in the manifest stops
meaning anything.

A mismatch there is not a flake to retry — it is Spike A answering its question,
and per the spike plan it selects the WASM kernel on correctness grounds
regardless of performance. So the cells never retry, `fail-fast` is off so every
engine reports, and the failure names the first divergent case or fixture, which
buffer it was, and both hashes.

Playwright's WebKit is **not** Safari, so the matrix cannot close this on its
own. Real Safari, iOS Safari and Android Chrome are hand-checked against
[the deployed verification page](https://gjstockham.github.io/traveller-mainworld/verify.html)
— the same static page the matrix cells drive, running the same battery and the
same fixture worlds, printing PASS/FAIL, both digests, the fixture-set hash and a
copy-paste evidence block.

It is published by `.github/workflows/pages.yml` on every push to `main`, and
only after `pnpm golden:verify` passes in the same job, so a build that already
disagrees with the manifests never reaches a borrowed device. Each deploy stamps
its commit into the evidence block: a result that cannot be mapped back to a
commit is a tick rather than evidence.
Results and method live in
[docs/evidence/wp4-manual-checks.md](docs/evidence/wp4-manual-checks.md).

That page must keep working in a browser, which means nothing on its import
graph may reach `@traveller-mainworld/golden/node` — the one module that touches
`node:fs`. `scripts/check-browser-battery.mjs` walks the graph from the HTML
entry through the worker and into `core`, and fails `pnpm lint` on any Node
import, rather than leaving it to a bundler error or, worse, a silent shim.

## Build invariance

PRD R11 promises deterministic generation and says nothing about bundlers, but a
minifier is free to rewrite an expression in ways that change float results
without changing what the source says. All nine matrix cells drive one bundle, so
they would agree with each other perfectly while every one of them ran rewritten
arithmetic.

So `pnpm golden:invariance` builds the same page two further ways — unminified,
and under Vite's defaults exactly as `packages/viewer` builds itself — and holds
each to the same committed manifests. One engine, three pipelines; a bundler is
not an engine, so running it in all three would say nothing three times.
`packages/golden/build-profiles.mjs` holds the configurations, and
`scripts/check-build-invariance.mjs` fails `pnpm lint` if the viewer stops
building under Vite's defaults — otherwise the profile would quietly cease to
mirror the bundle that actually ships, with the cell still green.

## The change protocol

An intentional output change requires all three of these **in the same commit**,
and all three are enforced:

1. **The identity that moved is bumped** — `GEN_VERSION` for a kernel change, the
   fixture-spec hash for a fixture change. `golden:update` and
   `golden:update:fixtures` refuse when neither moved.
2. **The affected manifest is regenerated** — `pnpm golden:update`,
   `pnpm golden:update:fixtures`. The verify legs fail otherwise.
3. **A `CHANGELOG.md` entry naming what moved and why.** Also refused without:
   the update commands check for a section for the new version, or for the new
   fixture-spec hash, before they will write. The gate lives there rather than in
   a CI diff check because this repository is developed by committing to `main`,
   where a pull-request diff would never fire.

The manifest diff shows *that* hashes moved; only the changelog says whether that
was intended. [`CHANGELOG.md`](CHANGELOG.md) carries the protocol in full, since
the implementation plan it comes from is not in version control.

## The kernel whitelist

The project's central promise is that the same UPP + seed produces a **bit-identical** world on every device, browser and future version. That promise lives or dies on the arithmetic in `packages/core/src/kernel`.

IEEE-754 basic operations (`+ − × ÷`, `Math.sqrt`) are required by the ECMAScript spec to be correctly rounded, so they are bit-identical everywhere. Transcendentals (`Math.sin`, `pow`, `exp`, `log`, ...) are **not** — V8, SpiderMonkey and JavaScriptCore demonstrably differ in the last bits. So the kernel may use only:

> `+ − × ÷ %`, `Math.sqrt`, `Math.floor/ceil/trunc/round/abs/min/max/sign`, `Math.fround`, `Math.imul`, bitwise ops, comparisons, typed arrays.

Transcendentals needed by the generator are implemented as polynomial approximations over those operations in `kernel/approx.ts`. Cross-platform *identity* is the requirement; absolute accuracy only has to be good enough not to show.

Two independent checks enforce this, and both must be defeated to get a banned operation into generated output:

1. `eslint.config.js` — `no-restricted-properties` / `no-restricted-syntax` scoped to `kernel/**`.
2. `scripts/check-kernel-whitelist.mjs` — a source scan that does **not** honour `eslint-disable`, and additionally rejects any import that leaves the kernel directory.

## The WASM twin

`crates/kernel-wasm` is the same kernel written again in Rust. The point is not
redundancy: the two implementations must hash identically **to each other**, not
merely each be self-consistent. A kernel compared against its own past output
proves it is stable; two kernels compared against each other proves they are
*right*, because a bug would have to be reproduced independently in two
languages to survive. `pnpm golden:parity` runs the whole battery through both
and compares. That comparison is the reason the twin exists.

It is built as a raw `cdylib` with `#[no_mangle] pub extern "C"` exports over
linear memory — **no wasm-bindgen, no wasm-pack**. Those tools generate glue
that sits between the source and the float operations being judged, which is
precisely what must not be in the loop. The binding in `core/src/wasm` is
hand-written `DataView` work instead.

Three rules silently destroy the guarantee if broken, so each has a check:

| Rule | Why | Enforced by |
|---|---|---|
| Never enable `relaxed-simd` | Nondeterministic **by design** — its instructions may choose between fused and unfused multiply-add per implementation. Fixed-width `simd128` is fine. | `scripts/check-wasm-flags.mjs`, which asks rustc what it would actually enable |
| Never call Rust's libm (`sin`, `powf`, `mul_add`, …) | Deterministic *within* WASM, which is the trap: the twin must match the **TypeScript**, which evaluates polynomials. `sqrt`/`abs`/`floor` are fine — spec-exact WASM instructions. | `scripts/check-kernel-whitelist.mjs` |
| Never recompute `OCTAVE_ROTATIONS` | A committed generated artefact. Rust's `sin` is not V8's, so recomputing would rotate the fBm octaves differently. | `scripts/gen-wasm-rotations.mjs --check` transcribes it and CI verifies it is current |

Rust and JavaScript also disagree on three things that look like faithful
translations: `x | 0` wraps where `as i32` saturates, `Math.min`/`Math.max`
order signed zeros and propagate NaN where `f64::min`/`f64::max` do neither, and
`f64::round` breaks ties away from zero where `Math.round` breaks them toward
+∞. `crates/kernel-wasm/src/jsnum.rs` reproduces the JavaScript semantics; the
banned-method scan covers the rest.

## The kernel decision

[ADR-0001](docs/adr/ADR-0001-generation-kernel.md) selected the **TypeScript
kernel** — provisionally at first, because six of the nine matrix cells and all
three manual device checks had not run when it was written. The ADR said so in
its own words rather than citing evidence that did not exist.

All nine cells have since run green on three operating systems, on both golden
artefacts, alongside the Node reference leg and the build-invariance cell; M3
(Android Chrome, real handset) passed; and **M2 passed on real iOS Safari** — the
first time an engine Apple ships has executed this battery, every WebKit result
before it having come from Playwright's build, which is not the same thing.

The ADR is now **Accepted, on an amended R1**. M1 — desktop Safari on macOS —
never ran, so rather than declare the criteria met, R1 was amended to drop it and
the residual accepted by name in
[Amendment 2](docs/adr/ADR-0001-generation-kernel.md#amendment-2-2026-08-04--r1-amended-and-this-adr-promoted):
the engine question is answered on all three engine families, and what is left is
desktop Safari's build and JIT tiers on desktop-class hardware. That residual is
narrow for a reason worth knowing — the kernel uses only operations the
ECMAScript spec requires to be correctly rounded, so a divergence there would be
a browser bug rather than a design flaw.

M1's row stays open in [the evidence file](docs/evidence/wp4-manual-checks.md)
and a minute on any borrowed Mac against
[the deployed page](https://gjstockham.github.io/traveller-mainworld/verify.html)
still fills it. **A divergence anywhere, from any source, rewrites the ADR as a
WASM decision on correctness grounds** — trigger R6, which is permanent and is
what the acceptance rests on.

So `crates/kernel-wasm` is **archived, not maintained** — see
[its README](crates/kernel-wasm/README.md). The parity check left the required CI
path (it would otherwise redden unrelated pull requests as the crate drifts) for
`.github/workflows/wasm-parity.yml`: `workflow_dispatch` plus a monthly schedule.
`pnpm check:parity` runs it locally. `pnpm lint:wasm` stays on every commit,
because the twin's three rules hold while the crate exists.

Which kernel the viewer runs is written down in exactly one place,
`packages/viewer/src/kernel/choice.ts`; the tile worker names no implementation.
`packages/viewer/test/tileJob.test.ts` runs the real WASM twin through the same
job path and compares the renderer-ready buffers, so "the choice stays revisable"
is a tested claim rather than a comment.

## Ruleset identity

The interpretation layer (`packages/core/src/ruleset`) turns a UPP into a
`PhysicalWorldSpec`. It ships one ruleset, **`cepheus-1`**, and that id is a
third identity alongside the two the change protocol already names:

| Identity | Covers | Moves when | Lives in |
|---|---|---|---|
| `GEN_VERSION` | `packages/core` generation arithmetic | the kernel's maths changes | `core/index.ts` |
| **Ruleset id** (`cepheus-1`) | the interpretation tables | *never* — see below | `core/src/ruleset/cepheus1/` |
| Fixture-spec hash | the golden fixture set's inputs | fixtures change | `packages/golden/fixtures.json` |

**The rule: a change to a ruleset table mints a new id. It never bumps
`GEN_VERSION`, and it never edits an existing ruleset in place.**

A share URL carries `?ruleset=cepheus-1` (R27), so the id is a promise to a URL
somebody else is holding. Editing one digit of a table under that name silently
changes every world anyone has ever shared, and no version anywhere moves to say
so. Minting `cepheus-2` instead costs one frozen data module and keeps every old
URL correct forever — the same obligation R15 places on generator versions, and
far cheaper to honour here because a ruleset is data rather than a code path.
`RULESETS` therefore grows and never shrinks, and an unknown id fails loudly
rather than falling back to the default.

`GEN_VERSION` does **not** gain a ruleset component. They have separate
lifecycles and both travel in the share URL as separate parameters.

Three things enforce it:

1. `pnpm ruleset:check` — and `packages/core/test/interpret.test.ts` — compare
   `cepheus-1`'s table digest against `packages/core/test/data/ruleset-expectations.json`.
2. `pnpm ruleset:update` **refuses to re-bless an id whose digest has moved**, and
   prints the steps for minting a new one instead. Without that refusal the file
   would be a snapshot that gets re-blessed whenever it goes red.
3. The golden fixture specs are interpreted from UPPs, so a table edit also moves
   the fixture-spec hash and reddens `golden:verify:fixtures`. From WP14 the
   fixtures hash the interpreted spec directly.

**The interpreter is not the kernel, and its arithmetic still reaches a hash.**
The crater parameters it computes are read by tile generation, so
`eslint.config.js` extends the banned-transcendental rule to `ruleset/**` — with
the differences that the directory may import freely and `check-kernel-whitelist.mjs`
does not scan it.

## Licensing

Code is **MIT** ([`LICENSE`](LICENSE)). The Cepheus Engine-derived data tables are
Open Game Content under the OGL 1.0a ([`LICENSE-OGL.txt`](LICENSE-OGL.txt)).

| Path | Licence |
|---|---|
| Everything not listed below | MIT |
| `packages/core/src/ruleset/cepheus1/size.ts` | OGL 1.0a — Open Game Content |
| `packages/core/src/ruleset/cepheus1/atmosphere.ts` | OGL 1.0a — Open Game Content |
| `packages/core/src/ruleset/cepheus1/hydrographics.ts` | OGL 1.0a — Open Game Content |
| `packages/core/src/ruleset/cepheus1/prose.ts` | OGL 1.0a — Open Game Content |

Within those four files the Open Game Content is the *rules-derived data* — the
code-to-value mappings and the plain-English meaning of each code. The
surrounding TypeScript is not, and neither are the columns that no ruleset has
an opinion about (`craterPreservation` and `baseTemperature` on the atmosphere
table; `terrainAmplitudeM`, `fbmFrequency` and `fbmOctaves` on the size table),
**nor the spaceport classes `F`, `G`, `H` and `Y` in `prose.ts`** — those are
Traveller's extended set for non-mainworld system bodies, are not in the Cepheus
SRD, and their wording is original to this project. Each file marks its own
boundary at the line rather than leaving it to this paragraph. The assembler in
`ruleset/interpret.ts` holds no table values and is MIT.

**Two obligations are outstanding and both are pre-release, not pre-merge:**

1. [`LICENSE-OGL.txt`](LICENSE-OGL.txt) **does not yet contain the licence text.**
   OGL §10 requires an exact copy to travel with the content, so it must be pasted
   from an authoritative source rather than reconstructed. Its Section 15 chain
   also needs checking against the Cepheus SRD's own. The file says so at the top.
2. "Traveller" is a registered trademark of Mongoose Publishing and is **not**
   covered by the OGL. This project is non-commercial forever and relies on the
   fan-use tradition, which requires the site-wide disclaimer and notifying the
   rights-holder before any public release — PRD §5 has the conditions and the
   fallback-name reserve.
