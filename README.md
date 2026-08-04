# Traveller Mainworld

A browser-based tool that turns a Universal Planetary Profile (UPP) plus a seed into a fully explorable 3D planet. Paste `C867A69-8`, get a world you can orbit, zoom into, and export as a projected 2D map.

**Status:** Phase 0 (foundations). No product features yet — see [the PRD](docs/requirements/worldgen-prd.md) for scope and [the Phase 0 spike plan](docs/requirements/phase0-spike-plan.md) for what this phase has to prove.

## Layout

| Path | Purpose |
|---|---|
| `packages/core` | Headless deterministic generation. Zero rendering dependencies. |
| `packages/core/src/kernel` | **The whitelisted zone** — see below. |
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

`bench/src/craters.ts` is a **cost model**, not shipping code: Phase 0 has no
craters, but the budget is for a Phase-1 tile, so the pass is modelled at
representative density outside `packages/core` where it cannot touch a hash.

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

What this exposes is that almost everything currently visible on these worlds
was displacement. At true scale they are smooth spheres with four hard-edged
albedo bands, because the things that give a real body its face are not built
yet: craters (Phase 1), albedo that tracks geology rather than elevation
(Phase 4), and shading from the true elevation gradient at full resolution.
Photorealism is those, not a multiplier.

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
comparison, still runs the battery only — its `tile.composite` case covers tile
generation through both kernels, and the archived twin is not maintained against
the fixture set.)

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
kernel** — provisionally, because six of the nine matrix cells and all three
manual device checks had not run when it was written. The ADR says so in its own
words rather than citing evidence that does not exist.

Since then all nine cells have run green on three operating systems, on both
golden artefacts, alongside the Node reference leg and the build-invariance
cell; M3 (Android Chrome, real handset) passed; and **M2 passed on real iOS
Safari**, which is the first time an engine Apple ships has executed this
battery — every WebKit result before it came from Playwright's build, and that
is not the same thing.

It stays **Provisional** anyway, because M1 — desktop Safari on macOS — is still
unrun and R1 asks for all three. The residual is narrow and named rather than
glossed in [the evidence file](docs/evidence/wp4-manual-checks.md): the engine
question is answered, what is left is desktop Safari's build and JIT tiers on
desktop-class hardware. A minute on any borrowed Mac against
[the deployed page](https://gjstockham.github.io/traveller-mainworld/verify.html)
closes it; amending R1 on the record is the other honest route. A divergence
anywhere rewrites the ADR as a WASM decision on correctness grounds.

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

## Licensing

Code is intended for MIT/Apache-2.0 release. Cepheus Engine-derived data tables carry their OGL obligations. "Traveller" is a registered trademark of Mongoose Publishing; this project is non-commercial and relies on the fan-use tradition — see PRD §5 for the conditions that must be met before any public release.
