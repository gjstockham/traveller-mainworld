# PRD — Traveller Mainworld

**Version:** 0.1 (draft)
**Author:** Geoff Stockham
**Status:** Draft for review
**Last updated:** 2 August 2026

---

## 1. Overview

Traveller Mainworld is a browser-based tool that takes a Universal Planetary Profile (UPP) from the Cepheus Engine rules plus a numeric seed, and procedurally generates a realistic, fully explorable 3D planet. Users navigate the planet like Google Earth — orbiting, zooming from space toward the surface — and can export projected 2D maps (equirectangular, Mercator) for campaign wikis and at-the-table GM reference.

The tool does **not** generate UPPs. Dice rolls happen elsewhere (at the table, in other tools). This product answers the question: *"I rolled C867A69-8 — what does this world actually look like?"*

**Inspiration:** Space Engine (visual fidelity, seamless space-to-surface navigation), Elite Dangerous (procedural planet generation from sparse stellar parameters).

## 2. Goals

1. **Deterministic worlds.** The same UPP + seed produces a bit-identical world on every device, browser, and in every future version of the tool. A GM can share `C867A69-8 / seed 42` in campaign notes and every player sees the same planet, forever.
2. **Physically plausible visuals.** Worlds should look like real planets, not noise spheres. Size, atmosphere, and hydrographics codes should visibly and sensibly shape the result.
3. **Runs in a normal browser.** Target integrated GPUs and mid-range laptops. No install, no accounts, no backend dependency for core functionality.
4. **Ruleset-pluggable core.** Cepheus Engine (open content) is the default interpretation layer, but the mapping from UPP codes to physical parameters is an isolated, swappable module.
5. **Foundation for a suite.** The generation core ships as a headless, viewer-independent package so future tools (economy simulator, sector tools) can consume it.

## 3. Non-goals

- Size 0 (asteroid belt) worlds. A belt is a system-level feature, not a single body; if wanted later it becomes a **separate generator** (likely sharing the small-body/crater maths from `core`). The parser accepts Size 0 UPPs but the app shows a clear "not supported" message rather than a planet.
- Generating or validating UPPs (no dice rolling, no world-creation workflow).
- Multiplayer, accounts, persistence, or any paid features. This is a free, personal → open-source project.
- Ground-level exploration (walking around). "Google Earth zoom" means orbital to high-altitude flyover, not first-person.
- Scientific accuracy beyond plausibility. This is a game aid, not a climate simulator.
- Mobile-first design. Mobile should not be broken, but desktop browser is the target.

## 4. Users and use cases

**Primary user (MVP): the author.** A GM/solo player of Cepheus Engine / Traveller-style games who wants evocative, consistent visual references for worlds in play.

**Secondary (post-MVP): the OSR/Traveller community**, if the tool is open-sourced.

| # | Use case | Notes |
|---|----------|-------|
| U1 | Paste a UPP, get a planet, spin it around during session prep | Core loop; must take < 30 s from paste to interactive globe |
| U2 | Share a world via URL | URL encodes UPP + seed + generator version; no server state |
| U3 | Export a Mercator or equirectangular map as PNG for a campaign wiki | With optional graticule and title block |
| U4 | Re-roll the seed to audition variants of the same UPP | Same codes, different continents |
| U5 | Reference view at the table while GMing | Fast load, works offline once cached (PWA nice-to-have) |

## 5. Background: UPP and licensing

A UPP string like `C867A69-8` encodes Starport, **Size, Atmosphere, Hydrographics**, Population, Government, Law Level, and Tech Level as hex digits. The MVP consumes digits 2–4 (Size, Atmosphere, Hydrographics) and ignores the rest, though the parser must accept and preserve the full string for later phases.

**Licensing constraints:**

- The Cepheus Engine SRD is open content (OGL 1.0a); its tables and terminology are safe to implement.
- "Traveller" is a registered trademark, owned by Mongoose Publishing since the 2024 handover from Far Future Enterprises. The product name relies on the Traveller fan-use tradition (liberal permission for strictly non-commercial fan works — a tradition with strong precedent in tools such as TravellerMap), which historically requires: (a) the standard site-wide copyright/trademark disclaimer naming the rights-holder, (b) notifying the rights-holder, and (c) accepting that permission is revocable on notice. **Conditions for this project:** the product is non-commercial forever (no charges, no donations); before any public release, check Mongoose's then-current Fair Use Policy, add the required disclaimer, and notify them; keep a trademark-free fallback name in reserve in case permission is withdrawn.
- If open-sourced, the repo needs a clear licence split: code under MIT/Apache-2.0, Cepheus-derived data tables under their OGL obligations, and the fan-use disclaimer in the README/app.

## 6. Product requirements

### 6.1 Input

- **R1.** Accept a full UPP string (with or without hyphen/starport digit); parse and validate hex codes. Invalid input produces a clear inline error, not a broken planet.
- **R2.** Accept a seed: any string, hashed internally to a 64-bit value. Blank seed generates a random one and displays it (so it can be recorded).
- **R3.** "Re-roll seed" control that keeps the UPP and randomises the seed.
- **R4.** The full input state is round-trippable via URL query parameters, including generator version (see §6.4).

### 6.2 Ruleset interpretation layer (pluggable)

The interpreter is a pure function: `(UPP, ruleset) → PhysicalWorldSpec`. It contains **all** rules knowledge; the generator downstream knows nothing about UPPs.

- **R5.** `PhysicalWorldSpec` includes at minimum: planetary radius (km), surface gravity, atmospheric pressure band and composition class, hydrographic coverage fraction, and derived hints (temperature band, ice likelihood, terrain roughness scaling).
- **R6.** Cepheus Engine mapping ships as the default implementation, driven by data tables rather than hard-coded logic where practical.
- **R7.** The interface is documented and versioned so alternative rulesets (e.g. Mongoose 2e mappings, house rules) can be added without touching the generator or viewer. Adding a ruleset must not change output for existing ruleset + UPP + seed combinations.

Illustrative MVP mapping (Cepheus):

| Code | Drives | Examples |
|------|--------|----------|
| Size 0–A | Radius, gravity, terrain amplitude, crater density | Size 0–1: airless rockball, heavy cratering; Size 8+: subdued relief relative to radius |
| Atmosphere 0–F | Sky/haze rendering, erosion character, cloud presence and style, surface tinting | 0–1: no sky, stark shadows; 4–9: Earthlike scattering; A–C: dense exotic haze, muted palette; B–C corrosive: chemically stained surfaces |
| Hydrographics 0–A | Sea level solved against terrain to hit the target coverage %, coastline character, ice caps interaction | Hydro 0 on Atmo 4+: desert world with dry basins; Hydro A: scattered island peaks only |

- **R8.** Hydrographic coverage is a hard constraint: the generator solves sea level against the generated terrain so actual water coverage matches the code's band (±2% of the canonical value), rather than hoping noise parameters land close.

### 6.3 Generation core

- **R9.** Written as a standalone, headless TypeScript package (`@worldforge/core` or similar) with zero rendering dependencies. Consumable from the viewer, Node scripts, or future suite tools.
- **R10.** Output is a set of terrain/attribute tiles on a quadtree cube-sphere: elevation, water mask, and per-tile material/climate classification sufficient for the renderer to texture the planet. Tiles are generated on demand by level of detail.
- **R11.** All generation math is CPU-side and deterministic: fixed-point or carefully specified double-precision arithmetic, seeded PRNG with a specified algorithm (e.g. PCG64), and a specified noise implementation. No GPU computation in the generation path, no `Math.random`, no locale/date dependence.
- **R12.** Generation runs in Web Workers so the UI never blocks; tiles stream in progressively as the camera moves.
- **R13.** Performance budget: first interactive globe (low-LOD full sphere) within 10 seconds on an integrated-GPU laptop; tile generation keeps up with typical zoom/pan without visible stalls longer than ~1 s.

### 6.4 Determinism and versioning

- **R14.** A **generator version** (semver) is embedded in every share URL and every export's metadata. Any change that alters output for any input bumps the version.
- **R15.** The app can render worlds from older generator versions — either by keeping old algorithm code paths behind the version switch, or (fallback) by clearly labelling the world as generated under a newer version. Target: keep old paths; they are pure functions and cheap to retain.
- **R16.** A golden-output test suite hashes generated tiles for a fixed set of UPP + seed pairs on every CI run; any unintended hash change fails the build. This is the enforcement mechanism for R11/R14.

### 6.5 Viewer

- **R17.** WebGL (Three.js) rendering of the cube-sphere with quadtree LOD, from full-disc orbital view down to a zoom level where individual mountain ranges and coastlines are clearly resolved (target ground resolution at max zoom: on the order of 1–2 km/texel for an Earth-sized world; exact figure to be tuned against memory budget).
- **R18.** Google Earth-style navigation: drag to rotate, scroll/pinch to zoom, smooth inertial motion, double-click to fly-to. Keyboard fallbacks for accessibility.
- **R19.** Atmospheric rendering appropriate to the atmosphere code: Rayleigh-style scattering for breathable bands, dense haze for exotic/dense codes, none for vacuum worlds. Simple analytic sky is acceptable for MVP; full volumetric scattering is not required.
- **R20.** Directional sunlight with adjustable light direction; day/night terminator visible from orbit. (Cloud layers: stretch goal for MVP, in scope for v1.1.)
- **R21.** An info panel showing the parsed UPP, its plain-English Cepheus interpretation, the seed, and the generator version.
- **R22.** Graceful WebGL capability detection with a clear message on unsupported browsers.

### 6.6 Export

- **R23.** Export projected 2D maps as PNG: equirectangular and Mercator at MVP; projection architecture keeps adding others (e.g. Winkel tripel, azimuthal) cheap later.
- **R24.** Export resolutions: 2048×1024 and 4096×2048 (equirectangular reference sizes). Rendered from generation data, not screenshots, so exports are seam-free and independent of viewport.
- **R25.** Optional overlays at export time: graticule (15°/30°), title block containing UPP, seed, generator version, and projection name.
- **R26.** Export runs client-side (canvas/offscreen render); no server round-trip.

### 6.7 Sharing

- **R27.** Stateless share URLs: `?upp=C867A69-8&seed=42&gen=1.0.0&ruleset=cepheus-1`. Opening the URL reproduces the exact world and (nice-to-have) camera position.

## 7. Roadmap

The roadmap is a vertical-slice strategy: **Phase 1 (MVP) is airless rocky worlds only.** These exercise the entire hard infrastructure — determinism, cube-sphere LOD streaming, workers, export, sharing — while requiring no water, climate, tectonics, or erosion modelling. Every subsequent phase adds one generation subsystem and widens the range of UPPs rendered with full fidelity. At every phase, *all* valid UPPs (Size 1+) must still load; codes whose subsystem is not yet built simply render at reduced fidelity, marked with a badge. **Release policy: no public/open-source release until all core phases (0–5) are complete**, so reduced-fidelity rendering is purely an internal development state and never a shipped compromise.

**Phase 0 — Foundations (no product features).** Determinism spike (pure-TS vs WASM kernel; see §10). Tangent-adjusted cube-sphere quadtree with worker-based tile streaming, rendering a flat-shaded noise sphere. Golden-hash CI harness live from the first tile. *Exit criterion: identical tile hashes across Chrome/Firefox/Safari on two OSes.*

**Phase 1 — Airless rocky worlds (MVP).** Sizes 1–A with Atmo 0–1, Hydro 0. Layered 3D-position noise terrain scaled by Size (relief amplitude vs radius); hierarchical deterministic crater fields as the terrain centrepiece; regolith palette variation from seed; directional lighting with stark vacuum shadows; equirectangular + Mercator export; share URLs. Size 0 (asteroid belt) is **out of scope for this product** — see §3. Other UPPs render as rocky worlds with a "reduced fidelity" badge; since there is no public release until all phases are complete (see §7 note below), this badge is a development aid, not a user-facing compromise. *Exit criterion: success criteria §9.1, .2, .4, .5, plus visually convincing Luna/Mercury/Ceres analogues.*

**Phase 2 — Water and sky.** Hydro codes go live: sea-level solve against terrain (R8), coastline shading, shallow/deep water colouring, ice caps for cold worlds. Atmosphere codes go live visually: analytic Rayleigh-style scattering for standard atmospheres, dense haze for A+, none for vacuum; atmosphere-dependent surface palettes. Adds the thin-cryogenic (Mars-like) regime: aeolian softening, polar frost. *Fidelity now full for any UPP without significant tectonic/biome expectations.*

**Phase 3 — Macrostructure (fake tectonics).** Deterministic spherical-Voronoi plates with motion vectors; boundary classification (convergent/divergent/transform) drives mountain arcs, offshore trenches, rift valleys, and volcanic provinces as analytic elevation stamps in the global pass. Gated by a derived "geological activity" parameter (function of Size, Atmo, Hydro) so small dead worlds remain crater-dominated. This phase kills the "uniform noise planet" look for large worlds.

**Phase 4 — Climate regimes and biomes.** Parameterised climate classifier on the coarse global grid: temperature (latitude insolation + lapse rate + greenhouse offset from Atmo), volatile availability (Hydro), heat transport (atmospheric density — thin = extreme gradients, dense = uniform). Regimes: airless-thermal, thin-cryogenic, temperate-hydrous (Köppen-style banding with Hadley-band moisture and rain shadow), dense-greenhouse (Venus-like), exotic (parameterised volatiles, e.g. methane for Titan analogues). Biome-driven surface texturing for temperate-hydrous worlds. Crater freshness/density now coupled to erosion regime (craters saturated and crisp on airless worlds; only young large impacts survive on wet ones).

**Phase 5 — Hydrology and erosion refinement.** Coarse global drainage pass (flow direction/accumulation on the base grid), major valley carving, rivers stored as vector data respected by tile generation. Slope- and regime-dependent analytic erosion character per tile (ridged vs billowed noise, valley smoothing). Aeolian features (dune fields) for thin-atmosphere desert worlds.

**Phase 6 — Habitation.** Population, Tech Level, and Starport codes drive deterministic settlement placement (coastal/river/resource-biased), city night-lights on the dark side, starport marker, optional political/data overlays.

**Phase 7 — Suite integration.** Publish `core` as a standalone package; stable world-data query API for sibling tools (economy simulator consuming the same world spec); sector-level import (TravellerMap-style data).

**Continuous candidates (unscheduled):** cloud layers, additional projections, PWA offline mode, alternative ruleset plugins, tidally locked worlds (rotation is not UPP-encoded; would be seed-derived flavour), print-oriented export styling, a separate Size-0 asteroid-belt generator built on `core`'s small-body maths.

## 8. Technical approach

### 8.1 The two-bucket rule

Strict determinism (R11) plus on-demand LOD tile streaming (R10) impose a hard constraint on every generation technique. Each must be either:

- **(a) A pure function of 3D position on the sphere** — evaluatable per tile, at any LOD, in any order, with identical results. All noise-based terrain, analytic crater profiles, and per-tile detail live here.
- **(b) A low-resolution global pass** — run once, deterministically, at world load (target: < 2 s on a ~512²-per-face base grid), whose outputs (plate boundaries, climate fields, drainage vectors) are inputs to the per-tile functions.

Techniques requiring high-resolution global *sequential* simulation — true hydraulic erosion, real plate simulation, fluid dynamics — are excluded by construction. Every roadmap phase above is designed to fit one of the two buckets.

### 8.2 Generation pipeline

```
UPP + seed + ruleset
        │
        ▼
Ruleset interpreter (pure) ──► PhysicalWorldSpec
        │
        ▼
GLOBAL PASS (bucket b, once per world, coarse grid)
  plates & boundaries → macrostructure stamps      (Phase 3)
  temperature / moisture / regime fields           (Phase 4)
  drainage & rivers                                (Phase 5)
  large-crater placement (power-law SFD)           (Phase 1)
        │
        ▼
PER-TILE FUNCTIONS (bucket a, on demand, per LOD)
  base terrain: layered 3D noise, octaves keyed to LOD depth
  macrostructure stamps sampled from global pass
  crater bands: per-tile hashed placement, analytic profiles,
    age-ordered compositing, regime-scaled freshness
  erosion character: slope/regime-dependent noise shaping
  sea-level application & water mask (R8)
  material classification from climate fields
        │
        ▼
Tiles (elevation, water mask, material) ──► viewer / export
```

### 8.3 Geometry and noise

- **Tangent-adjusted cube-sphere:** cube faces with tangent-warped UVs normalised to the sphere, evening out edge distortion; tile addressing is face + quadtree path.
- **Seam-free by construction:** all noise and analytic terms are functions of 3D position (not face UVs), so adjacent tiles and successive LODs sample the same underlying fields; deeper tiles simply add higher octaves.
- **Small bodies:** worlds below the "potato radius" (~Size 1 boundary) are candidates for non-spherical shape via low-frequency radius perturbation; deferred decision, not MVP.

### 8.4 Stack and structure

- **Language/stack:** TypeScript throughout; Vite; Three.js for rendering; Web Workers for all generation. The noise/terrain kernel is the WASM candidate: Rust→WASM if the Phase 0 spike shows pure-TS transcendental determinism is fragile, or if profiling demands it — WASM is also the strongest cross-platform float-determinism guarantee.
- **Architecture:** three packages — `core` (interpretation + global pass + tile generation, headless), `viewer` (Three.js app), `export` (projection renderer). The ruleset interpreter is a plugin interface inside `core`.
- **Key risk-driven decision:** CPU-side generation is a deliberate trade of raw speed for determinism and hardware reach; LOD streaming, worker parallelism, and tile caching (IndexedDB) are the mitigations.

## 9. Success criteria

1. Golden-hash determinism suite passes across Chrome, Firefox, and Safari on at least two OSes.
2. U1 loop (paste → interactive globe) under 10 s on an integrated-GPU laptop; under 30 s worst case.
3. Visual distinctiveness, phase-scoped: at MVP, five airless UPPs spanning Size 1–A produce clearly distinct, plausible worlds (Luna, Mercury, Ceres analogues among them); by Phase 4, ten varied UPPs (rockball, desert, water world, exotic-atmosphere, Earthlike) are distinct enough that a Cepheus-literate viewer could roughly reverse-engineer their codes.
4. Exported 4096×2048 equirectangular map is seam-free and matches the 3D view.
5. Share URL opened on a second machine reproduces the identical world (hash-verified).

## 10. Risks and open questions

| Risk / question | Notes / mitigation |
|-----------------|--------------------|
| Float determinism in pure TS across JS engines | IEEE-754 doubles are specified, but transcendental functions (`sin`, `pow`) are not bit-specified across engines. Mitigation: restrict the generation kernel to operations with specified results, ship our own approximations for transcendentals, or go WASM early. **Needs a spike before core work begins.** |
| CPU generation too slow at deep zoom | Mitigate with aggressive LOD, worker pool, tile caching (IndexedDB), and capping max zoom. Prototype the tile pipeline first. |
| Keeping old generator versions alive (R15) | Pure-function code paths make this tractable, but the test matrix grows per version. Decide a support horizon (e.g. last 3 majors) before v1.0. |
| Trademark: name uses the Traveller mark under fan-use tradition | Mitigated per §5 (non-commercial forever, disclaimer, notify Mongoose, check updated policy pre-release); residual risk is revocation, covered by the fallback-name reserve. |
| Scope creep toward Space Engine | The non-goals section is the defence. Surface-level exploration is explicitly out. |
| Open question: should ruleset plugins be data-only (JSON tables) or code? | Data-only is safer for determinism and community contributions; code is more expressive. Lean data-first with an escape hatch. |
| ~~Open question: product name~~ Resolved | "Traveller Mainworld", under the fan-use conditions in §5. Fallback name TBD (trademark-free, e.g. Cepheus-derived). |
