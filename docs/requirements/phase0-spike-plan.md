# Traveller Mainworld — Phase 0 Spike Plan

**Version:** 0.1 (draft)
**Parent doc:** PRD v0.1 (§7 Phase 0, §8, §10)
**Purpose:** Retire the two project-killing risks — cross-platform float determinism and CPU tile-generation performance — and stand up the rendering skeleton and CI harness that every later phase builds on.

**Phase 0 exit criteria (from PRD):** identical tile hashes across Chrome, Firefox, and Safari on at least two OSes; tile generation performance within budget on an integrated-GPU laptop; a flat-shaded noise sphere navigable from orbit to close range with streaming LOD and no visible cracks; golden-hash CI green.

Phase 0 is three spikes plus a harness. Spike A gates everything; B depends on A's candidate kernels; C can proceed in parallel with A/B using a placeholder kernel.

---

## Spike A — Float determinism (the decision spike)

**Question to answer:** can a pure-TypeScript generation kernel produce bit-identical `Float64` output across all target engines and OSes — or do we need a WASM kernel?

### A.1 Background facts the design rests on

- **IEEE-754 basic operations are safe.** `+ − × ÷` and `Math.sqrt` are required by the ECMAScript spec to be correctly rounded, so they are bit-identical across conforming engines. JIT compilers must preserve per-operation rounding semantics (no FMA contraction), so optimisation levels don't change results.
- **Transcendentals are NOT safe.** `Math.sin/cos/tan/exp/log/pow/atan2/cbrt/hypot` have implementation-defined precision; V8, SpiderMonkey, and JavaScriptCore use different implementations and demonstrably differ in the last bits. **These are banned from the kernel.**
- **Integer paths are safe.** 32-bit integer ops (`| 0`, `>>>`, `Math.imul`), `Math.fround`, `Math.floor/ceil/trunc/round/abs/min/max` are exactly specified. `BigInt` is deterministic but too slow for inner loops.
- **NaN bit patterns are not guaranteed** (in JS or WASM). Kernel logic must never branch on NaN payloads; outputs must be NaN-free by construction (assert in tests).
- **WASM core is deterministic for floats.** The WASM spec fully specifies all float ops (again except NaN payloads). A Rust→wasm32 build bundles its own `libm`, so even `sin`/`cos` are deterministic — the same bytes execute everywhere. **Caveat:** *relaxed-SIMD is nondeterministic by design and must never be enabled;* fixed-width `simd128` is fine.

### A.2 Work items

1. **Define the kernel op whitelist** as a lint-enforced module boundary: basic arithmetic, `sqrt`, integer ops, comparisons, `fround`. Add an ESLint rule (or simple grep in CI) banning `Math.*` transcendentals and `Math.random` inside `core`.
2. **In-house deterministic transcendentals** for the few places they're genuinely needed, built only from whitelisted ops:
   - `tan` on [−π/4, π/4] (minimax polynomial or rational approximation) — needed once for the tangent-adjusted cube-sphere mapping. Accuracy target ~1e-12 relative; exactness doesn't matter, *cross-platform identity* does, which polynomial evaluation over basic ops gives us for free.
   - `exp`-like falloff for crater/stamp profiles — or sidestep entirely with rational/polynomial falloff shapes (preferred: pick profile functions that never need `exp`).
3. **PRNG selection and stream design.** A 32-bit-native generator (`sfc32` or `pcg32` via `Math.imul`) for speed; 64-bit seeds handled as two 32-bit lanes. Tile-local determinism via SplitMix-style hashing: `streamSeed = mix(worldSeed, faceId, quadPath, layerId)`, so any tile/layer's RNG stream is derivable independently, in any order.
4. **Noise implementation.** 3D gradient noise (improved-Perlin gradients or OpenSimplex-style) with hash-derived gradients — needs only integer hashing and basic float ops, no trig. fBm layering with per-octave rotation matrices *precomputed as constants* (so no runtime trig).
5. **Build the identical kernel twice:** TypeScript, and Rust→wasm32 (same algorithms, same constants). This is the comparison pair for the decision and doubles as a cross-check that both are bug-free (they must hash identically to *each other* too).
6. **Test battery.** For each kernel function (PRNG, hash, noise, fBm, transcendental approximations, a composite "mini-tile"): sample ≥1e6 inputs covering normal ranges plus adversarial cases (denormals, ±0, values near octave boundaries, large coordinates), write results to a `Float64Array`, hash the canonical little-endian bytes with SHA-256.
7. **Cross-platform matrix.** Automated: Playwright driving Chromium, Firefox, and WebKit on Linux/macOS/Windows CI runners, plus Node as the reference. Manual spot-checks (Playwright WebKit is not identical to real Safari): real Safari on macOS, iOS Safari, Android Chrome. All hashes must match the reference exactly.

### A.3 Decision criteria

| Outcome | Decision |
|---------|----------|
| TS kernel hashes match everywhere AND meets Spike B perf budget | **TS kernel.** Simpler debugging, no toolchain overhead. WASM stays a future optimisation. |
| TS hashes match but perf misses budget | **WASM kernel** (perf grounds). |
| TS hashes diverge anywhere | **WASM kernel** (correctness grounds — the stronger guarantee wins regardless of perf). |

Either way, the kernel sits behind a single `TileGenerator` interface so the choice is revisable. Record the decision and evidence in an ADR.

**Prior/expectation:** TS is likely to pass — the risky ops are all banned — but the spike exists because "likely" is not a foundation for a bit-identical-forever promise.

---

## Spike B — Performance baseline

**Question to answer:** does CPU-side generation meet the PRD budgets (R13) on the minimum hardware target?

### B.1 Representative workload

A realistic Phase-1 tile: 129×129 elevation grid, 10 octaves of fBm, 2 crater size-bands (placement + analytic profile compositing), water mask pass (trivially empty for airless worlds but keep the pass in the loop), material classification. Also a global-pass workload: large-crater placement over a 512²-per-face base grid.

### B.2 Measurements

- Single-tile generation time, TS vs WASM kernels, on: (a) integrated-GPU laptop (the minimum target), (b) a mid-range desktop, (c) an iPad/phone for curiosity (not a target).
- Worker-pool throughput at `hardwareConcurrency − 1` workers; confirm linear-ish scaling.
- Transfer cost of tile buffers to the main thread — must use transferable `ArrayBuffer`s, not structured clone copies; measure to prove it.
- Memory: per-tile footprint and steady-state total with an LRU cache sized for typical navigation.

### B.3 Budgets (derived from PRD R13)

First interactive globe ≤ 10 s implies the initial low-LOD shell (6 faces × depth-1/2 ≈ 24–96 tiles) completes within it: **≈ 100 ms per tile single-threaded** is comfortably sufficient with 4 workers. Streaming during zoom implies sustained **≥ 20–30 tiles/s** pool throughput. If TS misses these by < 2×, optimise before switching kernels; ≥ 2× miss → WASM per Spike A criteria.

---

## Spike C — Cube-sphere LOD skeleton

**Goal:** the walking skeleton — a navigable, streaming, flat-shaded noise sphere — proving geometry, tile addressing, worker pipeline, and renderer integration. Runs with a placeholder kernel until Spike A decides.

### C.1 Work items

1. **Geometry & addressing.** Tangent-adjusted cube-sphere (tangent warp on face UVs before normalisation to radius, using the Spike A deterministic `tan`). Tile ID = `(face 0–5, quadtree path, depth)` packed into a compact key used for addressing, hashing, RNG streams, and cache keys alike.
2. **Tile mesh.** 65² or 129² vertex grids (decide from Spike B numbers) with **skirts** to hide cracks between adjacent LOD levels — chosen over edge-stitching for simplicity; revisit only if skirts visibly artefact at low sun angles.
3. **LOD selection.** Screen-space-error metric with hysteresis (split/merge thresholds separated) to prevent flicker at zoom boundaries.
4. **Worker pipeline.** Priority queue keyed by camera relevance; cancellation of stale requests on camera movement; in-memory LRU tile cache (IndexedDB persistence deferred to later phases); transferable buffers throughout.
5. **Rendering.** Three.js; per-vertex elevation displacement; flat shading with a simple elevation-tinted material and one directional light. No textures, no atmosphere — Phase 1 concerns.
6. **Camera/controls.** Orbit + zoom with inertial damping; zoom speed scaled by altitude (the Google-Earth feel); fly-to on double-click as a stretch item.

### C.2 Exit criteria

Fly from full-disc orbit down to close range over a Size-8 world: tiles stream in without stalls > 1 s, no cracks or seams at any LOD boundary, frame rate acceptable on the integrated-GPU laptop (target ~60 fps, floor 30), memory stable over a 10-minute session.

---

## Golden-hash harness (CI, permanent)

Live from the first real tile and never turned off — this is the enforcement mechanism for the determinism promise (PRD R16).

- **Fixtures:** ~10 (UPP, seed) pairs spanning the size range, plus a fixed tile set per fixture covering all 6 faces and depths 0–6.
- **Hashing:** SHA-256 over the canonical little-endian bytes of each output buffer (elevation, water mask, materials); manifest of expected hashes committed to the repo.
- **CI matrix:** GitHub Actions on ubuntu/macos/windows runners: Node reference run + Playwright browser runs; any hash mismatch anywhere fails the build.
- **Change protocol:** an intentional output change requires, in the same PR: generator version bump, regenerated manifest, and a changelog entry. The diff makes silent drift impossible.

---

## Sequencing and effort

| Order | Item | Rough effort (evening/weekend sessions) | Depends on |
|-------|------|------------------------------------------|------------|
| 1 | Spike A: whitelist, PRNG, noise, transcendentals, test battery | 4–6 | — |
| 1 (parallel) | Spike C skeleton with placeholder kernel | 6–9 | — |
| 2 | Spike A: WASM twin + cross-platform matrix | 2–3 | A core |
| 3 | Spike B benchmarks | 2 | A kernels |
| 4 | Kernel decision ADR; wire real kernel into C | 1 | A, B |
| 5 | Golden-hash harness in CI | 2 | A, C |

Total ≈ 17–23 sessions. The long pole is Spike C, which is also the most fun — reasonable to start it first for motivation and run Spike A alongside.

## Spike-specific risks

| Risk | Handling |
|------|----------|
| Playwright WebKit ≠ real Safari | Treat Playwright as smoke test; manual real-Safari + iOS spot-checks are part of Spike A's exit, not optional. |
| Denormal handling differences | Spec says IEEE-conformant, so low risk — but the test battery includes denormal inputs precisely because "low risk" isn't zero for a forever-promise. |
| WASM build/toolchain friction (Rust, wasm-pack) in a TS project | Contained: the WASM twin is one crate with a thin JS binding; if the TS kernel wins, the crate is archived, not maintained. |
| Skirt artefacts at grazing light angles | Known trade-off; acceptable for Phase 0/1 flat shading. Re-evaluate when Phase 2 adds water edges and scattering. |
| Worker cancellation races corrupting the cache | Tiles are immutable value objects keyed by (tileId, genVersion); a cancelled result is simply discarded, never partially applied. |
