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
| `scripts` | Repo checks run in CI. |

## Getting started

Requires Node ≥ 22 and pnpm (via `corepack enable pnpm`).

```sh
pnpm install
pnpm check           # lint + typecheck + build + test
pnpm golden:verify   # determinism battery vs the committed manifest
pnpm --filter @traveller-mainworld/viewer dev
```

## The determinism battery

`packages/golden` evaluates every kernel function over ≥10⁶ deliberately hostile
inputs — signed zeros, denormals, the normal/denormal boundary, ulp neighbours
of integers and powers of two, and magnitudes at both ends of the double range —
then hashes the canonical little-endian bytes of the results. Those hashes are
committed in `packages/golden/manifest.json`.

Running that battery on every browser and OS, and later against the WASM kernel,
is what turns "should be identical" into "demonstrably is". CI fails on any
mismatch.

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

## Licensing

Code is intended for MIT/Apache-2.0 release. Cepheus Engine-derived data tables carry their OGL obligations. "Traveller" is a registered trademark of Mongoose Publishing; this project is non-commercial and relies on the fan-use tradition — see PRD §5 for the conditions that must be met before any public release.
