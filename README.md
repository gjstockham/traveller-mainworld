# Traveller Mainworld

A browser-based tool that turns a Universal Planetary Profile (UPP) plus a seed into a fully explorable 3D planet. Paste `C867A69-8`, get a world you can orbit, zoom into, and export as a projected 2D map.

**Status:** Phase 0 (foundations). No product features yet — see [the PRD](docs/requirements/worldgen-prd.md) for scope and [the Phase 0 spike plan](docs/requirements/phase0-spike-plan.md) for what this phase has to prove.

## Layout

| Path | Purpose |
|---|---|
| `packages/core` | Headless deterministic generation. Zero rendering dependencies. |
| `packages/core/src/kernel` | **The whitelisted zone** — see below. |
| `packages/viewer` | Three.js cube-sphere viewer (Vite). |
| `packages/golden` | Golden-hash fixtures, manifest and runners. |
| `crates/kernel-wasm` | Rust→wasm32 twin of the kernel. Must hash identically to it. |
| `bench` | Spike B performance baseline, and the results it produced. |
| `scripts` | Repo checks run in CI. |

## Getting started

Requires Node ≥ 22 and pnpm (via `corepack enable pnpm`).

```sh
pnpm install
pnpm check           # lint + typecheck + build + test
pnpm golden:verify   # determinism battery vs the committed manifest
pnpm golden:matrix   # the same battery in chromium, firefox and webkit
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

The viewer takes `?seed=<text>` to change world, and `?debug=1` to preserve the
WebGL drawing buffer so pixels can be read back.

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

## The determinism battery

`packages/golden` evaluates every kernel function over ≥10⁶ deliberately hostile
inputs — signed zeros, denormals, the normal/denormal boundary, ulp neighbours
of integers and powers of two, and magnitudes at both ends of the double range —
then hashes the canonical little-endian bytes of the results. Those hashes are
committed in `packages/golden/manifest.json`.

Running that battery on every browser and OS, and against the WASM kernel, is
what turns "should be identical" into "demonstrably is". CI fails on any
mismatch.

## The cross-platform matrix

The determinism promise is a claim about *other people's* engines, so the
battery runs on all of them: chromium, firefox and webkit × ubuntu, macOS and
Windows, alongside the Node reference run on the same three OSes. Nine browser
cells, each comparing every hash against the same committed manifest.

```sh
pnpm golden:matrix   # all three engines locally (needs: pnpm exec playwright install)
pnpm golden:page     # serve verify.html on :4174 for a hand-check on a real device
```

A mismatch there is not a flake to retry — it is Spike A answering its question,
and per the spike plan it selects the WASM kernel on correctness grounds
regardless of performance. So the cells never retry, `fail-fast` is off so every
engine reports, and the failure names the first divergent case and its index.

Playwright's WebKit is **not** Safari, so the matrix cannot close this on its
own. Real Safari, iOS Safari and Android Chrome are hand-checked against
`packages/golden/verify.html` — a static page that runs the same battery in a
worker and prints PASS/FAIL, the digest, and a copy-paste evidence block.
Results and method live in
[docs/evidence/wp4-manual-checks.md](docs/evidence/wp4-manual-checks.md).

That page must keep working in a browser, which means nothing on its import
graph may reach `@traveller-mainworld/golden/node` — the one module that touches
`node:fs`. `scripts/check-browser-battery.mjs` walks the graph from the HTML
entry through the worker and into `core`, and fails `pnpm lint` on any Node
import, rather than leaving it to a bundler error or, worse, a silent shim.

An intentional output change requires, **in the same PR**: a generator version
bump, a regenerated manifest (`pnpm golden:update`, which refuses to run without
the bump), and a changelog entry. The manifest diff makes silent drift
impossible.

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
words rather than citing evidence that does not exist; filling in
[the evidence file](docs/evidence/wp4-manual-checks.md) is what promotes it from
Provisional to Accepted, and a divergence anywhere rewrites it as a WASM decision
on correctness grounds.

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
