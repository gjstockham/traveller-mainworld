/**
 * Hierarchical deterministic crater fields (Phase 1 plan §5).
 *
 * Two tiers, split by size, matching PRD §8.2's two buckets:
 *
 * - **Tier 1, global basins** (bucket b). The largest impacts, placed once per
 *   world at load. A basin can span several tiles and more than one cube face,
 *   so a per-tile cell scheme at that scale would need cells bigger than a face
 *   and the addressing stops meaning anything. The count is capped in the tens,
 *   so every sample can test every basin in a fixed, bounded loop.
 * - **Tier 2, per-tile size bands** (bucket a). Geometric bands, each covering
 *   crater radii in `[r, 2r)`, evaluated as a pure function of position.
 *
 * ## Placement is on a 3D integer lattice, not on cube-face cells
 *
 * The obvious scheme — hash face cells and look at the 3×3 neighbourhood —
 * needs cell-level face adjacency, including the corners where three faces meet
 * and one neighbour does not exist. That is the same class of problem as
 * `lod/neighbours.ts`, at a resolution where a mistake is invisible until it is
 * a stripe of missing craters along a cube edge. There are no faces in a 3D
 * lattice, so there is no adjacency to get wrong, and it is seam-free by
 * exactly the argument PRD §8.3 makes for the noise: a function of 3D position,
 * not of face UVs.
 *
 * The cost is that lattice cells intersect the sphere shell unequally, so
 * density varies mildly with position within a cell. That is Phase 1 open
 * question 3, with cube-face cells as the fallback if it reads visually.
 *
 * ## The neighbourhood lemma, which the cell sizes exist to satisfy
 *
 * Everything downstream assumes that **every candidate able to affect a sample
 * lies in the 3×3×3 lattice neighbourhood of that sample's own cell.** That is
 * not an approximation; it follows from two constants:
 *
 * - a candidate's raw lattice point `q` is accepted only when `| |q| − 1 | ≤
 *   c/2`, so projecting it onto the sphere moves it by at most `c/2`;
 * - a candidate contributes only within `SUPPORT_RATIO · r` of its projected
 *   centre, and `r < rMax` with `c = 2 · SUPPORT_RATIO · rMax`, so that reach is
 *   strictly under `c/2`.
 *
 * Hence `|q − p| < c` for any sample `p` a candidate can reach, and two
 * coordinates differing by less than `c` cannot fall more than one cell apart.
 * {@link CELL_RATIO} is `2 · SUPPORT_RATIO` for this reason and no other —
 * shrinking it silently drops craters along cell boundaries, which is precisely
 * the kind of bug that shows up as a stripe.
 *
 * ## Two evaluation paths, and why they agree bit-for-bit
 *
 * Per-tile generation amortises the lattice hashing across a tile
 * ({@link CraterCells}); the export path point-samples and hashes per sample
 * ({@link collectFromLattice}). Plan §5.3 is about what makes those agree:
 *
 * 1. **Compact support with an exact early-out.** A candidate outside its
 *    support is skipped by `if (d2 >= reach·reach) continue` and contributes no
 *    arithmetic at all — not a multiply by zero, which would still perturb the
 *    accumulator.
 * 2. **A canonical compositing order that is a property of the candidates, not
 *    of the list** — age first, then a total order on the candidate's own
 *    lattice identity. {@link CraterCandidates} sorts an index array by
 *    insertion; the whitelist bans comparator-less `Array.prototype.sort` and a
 *    fixed-capacity array sidesteps the question entirely.
 *
 * With both, the two paths could enumerate different supersets and still agree.
 * They in fact enumerate the *same* set, which makes the equality test in
 * `packages/core/test/craters.test.ts` a real test of the cell cache's index
 * arithmetic rather than a tautology.
 *
 * ## No transcendentals, and no NaN
 *
 * Phase 0 open question 2 asked whether Phase 1 crater profiles can be rational
 * and polynomial only. They can, and this file is the answer: `rationalBump`,
 * `compactFalloff`, `smoothstep`, `smootherstep`, `powi` and `Math.sqrt`. The
 * two divisions that could produce a NaN are both provably safe and say so at
 * the site — the size distribution's denominator is bounded below by 1/2, and
 * the projection's by `1 − c/2`.
 */
import { compactFalloff } from './approx.js';
import { hash3, hashToSigned, hashToUnit, mix32 } from './hash.js';
import { clamp, lerp, powi, smoothstep, smootherstep } from './ops.js';

// --- the band ladder ---------------------------------------------------------

/** π/2: the angular width of a cube face, and so of a depth-0 tile. */
const QUARTER_TURN = 1.5707963267948966;

/**
 * Radius of the largest tier-2 crater, as a fraction of the planetary radius.
 *
 * 2% of the radius is a 70 km crater on a Luna-sized body and a 256 km one on
 * an Earth-sized body. Above this the field is tier 1 — {@link BASIN_MIN_RADIUS}
 * picks up exactly here, so the size-frequency distribution is continuous
 * across the tier split rather than having a gap or an overlap at the join.
 */
export const LARGEST_BAND_RADIUS = 0.02;

/**
 * Ceiling on how many bands a tile evaluates.
 *
 * At band 13 the crater radius is `LARGEST_BAND_RADIUS · 2⁻¹⁴`, about 8 m on an
 * Earth-sized world — far below anything the deepest supported tile resolves.
 * The cap exists so the per-sample candidate capacity is a constant rather than
 * a function of how deep somebody zooms.
 */
export const MAX_BANDS = 14;

/**
 * Compact support of a crater profile, in crater radii.
 *
 * The ejecta blanket reaches `SUPPORT_RATIO · r` from the centre and is exactly
 * zero beyond it — `compactFalloff` reaches zero rather than approaching it, so
 * "outside the support" is a comparison and not a tolerance. Continuous ejecta
 * on real craters extends about one crater radius past the rim; rays go much
 * further, but rays are albedo and belong to WP11.
 */
export const SUPPORT_RATIO = 2.2;

/**
 * Lattice cell size, in units of the band's largest crater radius.
 *
 * `2 · SUPPORT_RATIO` exactly — see the neighbourhood lemma in the file header.
 * This is a correctness constant, not a tuning knob.
 */
export const CELL_RATIO = 2 * SUPPORT_RATIO;

/**
 * Candidate slots per lattice cell.
 *
 * **This is the saturation cap**, and it is structural rather than a tuned
 * threshold: a cell can hold at most this many craters however dense the world
 * is, which is what real airless surfaces do when every new impact destroys an
 * old one. Three slots at {@link CELL_RATIO} give roughly 27% areal coverage per
 * band at full density, and bands compound.
 */
export const CANDIDATES_PER_CELL = 3;

/**
 * Samples that must span the smallest crater in a band for it to be gated in.
 *
 * **It also sizes the crack at an LOD boundary, and it makes that crack bigger
 * rather than smaller.** A tile at depth `d+1` carries one band its parent does
 * not, so at a shared position the two differ by that band's crater relief. Band
 * `B` is gated in at `d+1` and not at `d`, so its smallest radius lies in
 * `[k/2, k)` sample spacings, its largest is under `2k`, and a fresh simple
 * crater's floor sits `0.4 · r` below the datum. The step is bounded by
 * **`0.8 · k` sample spacings** — not the fraction of one that layered noise
 * gives.
 *
 * So `k` trades two things off, and **both of them favour a small value**: a
 * larger `k` means a band arrives a level later, and arrives as craters that are
 * proportionally larger and therefore pop harder. This started at 6, on the
 * reasoning that three samples across renders a crater as a faceted pit. Flying
 * it said otherwise — the first thing anyone noticed was craters appearing
 * abruptly that should have been visible from higher up — and the trade is
 * simply not close: 3 halves the LOD crack, brings every band in a level
 * earlier, and the faceting it costs is on the *newly-gated* band only, which
 * the next level of refinement fixes.
 *
 * The other half of that finding is {@link ALWAYS_ON_BANDS}.
 *
 * `craters.test.ts` asserts the bound, so this and the viewer's skirt cannot
 * drift apart silently.
 */
export const BAND_SAMPLES_ACROSS = 3;

/**
 * Bands evaluated at every depth, however coarse the tile.
 *
 * The band gate asks whether a tile's own vertex grid can resolve a crater. That
 * is the right question for aliasing and the wrong one for visibility: a
 * full-disc view resolves far finer than a depth-0 tile's 1.4°-per-sample grid,
 * because the screen has more pixels across the planet than the tile has
 * vertices. Gating on the tile alone left an orbital view showing 24 basins and
 * nothing else, and put the largest tier-2 craters — 35 to 70 km across on a
 * Luna-sized world, the ones that give it its face — behind a descent to depth
 * 3, where they arrived all at once.
 *
 * Two bands are unconditional instead, spanning crater radii from
 * `LARGEST_BAND_RADIUS / 4` up. On a Luna-sized world that is 17 to 70 km in
 * diameter, which is about what a full-disc view can actually distinguish;
 * band 2 would be a pixel or two and is left to the gate.
 *
 * It costs a fixed `2 · 27 · CANDIDATES_PER_CELL` cell lookups per sample at the
 * depths that did not previously pay them, and a lattice cache over a whole cube
 * face at depth 0 — a few thousand cells, because the cell size scales with the
 * band. Three would be tens of thousands and megabytes, which is why it is two.
 */
export const ALWAYS_ON_BANDS = 2;

/**
 * Reference sample spacing at a quadtree depth, in radians of arc.
 *
 * The spacing the band gate is calibrated against — {@link BAND_GATE_N} samples
 * across a tile — rather than whatever grid the caller happens to use.
 */
export function referenceSpacing(depth: number): number {
  return QUARTER_TURN / (powi(2, depth) * BAND_GATE_N);
}

/**
 * Upper bound on the elevation difference between a tile at `depth` and its
 * parent at a shared position, as a fraction of the planetary radius.
 *
 * The two differ by whichever band the gate lets in at `depth` and not before,
 * and by nothing else — {@link compositeCraters}'s scale bucketing is what makes
 * that true rather than approximately true. So the bound is that band's deepest
 * possible crater: `0.4 · rMax`, since a fresh simple crater's floor sits
 * `2 · SIMPLE_DEPTH_RATIO · r` below the datum and every other profile in this
 * file is shallower.
 *
 * **Zero where the gate does not move**, which is most levels near the top: the
 * first band arrives at depth 3, so depths 0 to 2 differ by nothing at all.
 * Writing that as `k · spacing` instead — a blanket multiple of the sample
 * spacing — gave the viewer's depth-0 skirt a wall almost twice as long as the
 * tile was wide, which is the failure the skirt exists to prevent.
 *
 * Exported because the viewer sizes its skirt from it: the crack at an LOD
 * boundary is now dominated by this term, and a second copy of the derivation in
 * `tileMesh.ts` would be a second copy to forget.
 */
export function lodStepBound(depth: number): number {
  if (depth <= 0) {
    return 0;
  }
  const count = bandsForDepth(depth);
  if (count === 0 || count === bandsForDepth(depth - 1)) {
    return 0;
  }
  // Plus a little: ejecta from a second crater of the same band can land on the
  // first one's rim, and the bowl bound above does not cover that stacking.
  return 1.25 * (2 * SIMPLE_DEPTH_RATIO) * bandMaxRadius(count - 1);
}

/**
 * Grid resolution the band gate is calibrated against.
 *
 * **The gate takes depth alone, deliberately.** Making it a function of the
 * caller's grid size would mean a tile meshed at 65² and the same tile hashed at
 * 129² evaluated different band sets, so the two would disagree at the vertices
 * they share — which is exactly the seam the whole design exists to avoid, and
 * it would turn Phase 1 open question 1 (65² vs 129²) from an open question into
 * a defect.
 *
 * 64 rather than 128 because it errs toward evaluating *fewer* bands: the 129²
 * hashed path then samples the same craters more finely, which costs nothing,
 * whereas calibrating at 128 would leave the 65² viewer aliasing craters it
 * cannot resolve. If WP15 moves the viewer to 129², raising this is a deliberate
 * output change under the change protocol.
 */
export const BAND_GATE_N = 64;

/** Smallest crater radius in band `b`, as a fraction of the planetary radius. */
export function bandMinRadius(band: number): number {
  return LARGEST_BAND_RADIUS * powi(0.5, band + 1);
}

/** Largest crater radius in band `b`. Bands cover `[r, 2r)`, so this is twice the minimum. */
export function bandMaxRadius(band: number): number {
  return LARGEST_BAND_RADIUS * powi(0.5, band);
}

/** Lattice cell size for band `b`. See the neighbourhood lemma. */
export function bandCellSize(band: number): number {
  return CELL_RATIO * bandMaxRadius(band);
}

/**
 * How many bands a tile at `depth` evaluates (plan §5.5).
 *
 * Deeper tiles add bands exactly as they add fBm octaves, which is the
 * established seam-free-by-construction pattern: a band a shallow tile skips is
 * one a deeper tile adds, and both agree on everything they both evaluate.
 *
 * The first {@link ALWAYS_ON_BANDS} are never gated — see that constant for why
 * the tile's own resolution is the wrong question to ask about the largest
 * craters.
 *
 * **Both the tile path and the export path must call this one function.** A gate
 * that differs by one band between them is precisely the PRD §9.4 failure — an
 * exported map that is subtly not the planet.
 *
 * Monotonic non-decreasing in depth, and asserted so.
 */
export function bandsForDepth(depth: number): number {
  const resolvable = (BAND_SAMPLES_ACROSS / 2) * referenceSpacing(depth);

  let count = 0;
  while (count < MAX_BANDS && bandMinRadius(count) >= resolvable) {
    count++;
  }
  // `max` of a monotonic function and a constant is still monotonic, so the
  // floor cannot break the gate's ordering guarantee.
  return Math.max(count, ALWAYS_ON_BANDS);
}

// --- world seeds -------------------------------------------------------------

/** Layer id for the tier-2 band lattice. Distinct streams so adding one never perturbs another. */
export const LAYER_CRATER_BANDS = 1;
/** Layer id for the tier-1 basin field. */
export const LAYER_BASINS = 2;

/**
 * Derive a per-layer 32-bit seed from the 64-bit world seed.
 *
 * `tilegen.ts` derives the terrain layer's seed inline and must keep doing so:
 * that expression is pinned by every committed elevation hash, and routing it
 * through here to save three lines would move every one of them.
 */
export function craterLayerSeed(seedHi: number, seedLo: number, layer: number): number {
  const base = (seedLo ^ Math.imul(seedHi, 0x9e3779b1)) | 0;
  return mix32(base ^ Math.imul(layer, 0x85ebca6b)) | 0;
}

// --- parameters --------------------------------------------------------------

/**
 * Everything the crater pass needs from the world, as primitives.
 *
 * Primitives rather than `spec.craters`, because `kernel/` may not import from
 * outside itself and the boundary at primitive values is what let WP9 grow
 * `PhysicalWorldSpec` without touching a hashed line.
 */
export interface CraterParams {
  /** Planetary radius in metres. Converts unit-sphere lengths to elevation. */
  readonly radiusM: number;
  /** Crater density relative to a saturated airless surface, in `[0, 1]`. */
  readonly densityScale: number;
  /** Simple→complex transition *radius*, as a fraction of the planetary radius. */
  readonly transitionRadius: number;
  /** Maturity of the impact-gardened surface layer, in `[0, 1]`. */
  readonly regolithMaturity: number;
}

/**
 * Assemble {@link CraterParams} from the spec's own units.
 *
 * Shared by both evaluation paths on purpose: a unit conversion done twice is a
 * unit conversion that can be done differently twice.
 */
export function craterParams(
  radiusKm: number,
  densityScale: number,
  transitionDiameterKm: number,
  regolithMaturity: number,
): CraterParams {
  // radiusKm is bounded below by the Size table's smallest body, so this is not
  // a division that can produce an infinity on any valid world; the guard is for
  // synthetic specs written in tests.
  const safeRadiusKm = radiusKm > 0 ? radiusKm : 1;
  return {
    radiusM: safeRadiusKm * 1000,
    densityScale: clamp(densityScale, 0, 1),
    transitionRadius: transitionDiameterKm / 2 / safeRadiusKm,
    regolithMaturity: clamp(regolithMaturity, 0, 1),
  };
}

// --- tier 1: global basins ---------------------------------------------------

/**
 * Hard cap on basins per world.
 *
 * Small enough that every sample can test every basin in a bounded loop, which
 * is what makes tier 1 a bucket-(b) global pass rather than something needing
 * spatial addressing at a scale where addressing stops working.
 */
export const MAX_BASINS = 24;

/** Smallest basin radius: exactly where tier 2 stops. */
export const BASIN_MIN_RADIUS = LARGEST_BAND_RADIUS;
/** Largest basin radius, as a fraction of the planetary radius. */
export const BASIN_MAX_RADIUS = 0.3;

/** Attempts allowed when rejection-sampling a point in the unit ball. */
const BASIN_PLACEMENT_ATTEMPTS = 32;

/** Values stored per basin: x, y, z, radius, age. */
const BASIN_STRIDE = 5;

/** The tier-1 basins of one world, placed once at load. */
export interface BasinField {
  /** How many of the {@link MAX_BASINS} slots are occupied. */
  readonly count: number;
  /** `count · 5` values: x, y, z, radius, age. */
  readonly data: Float64Array;
  /** `count` age hashes, the primary key of the canonical compositing order. */
  readonly ages: Int32Array;
}

/**
 * Place the world's basins (plan §5.1).
 *
 * Sizes come from a power-law size-frequency distribution and positions from
 * rejection sampling in the unit ball — a uniform sphere point without a `cos`
 * or an `acos`, which the whitelist would not have. The retry loop is bounded
 * and its exhaustion is handled rather than assumed: the probability of 32
 * consecutive misses is about 5×10⁻¹¹, and "about" is not a basis for an
 * unbounded loop in code that must terminate identically everywhere.
 */
export function buildBasins(
  seedHi: number,
  seedLo: number,
  densityScale: number,
): BasinField {
  const seed = craterLayerSeed(seedHi, seedLo, LAYER_BASINS);
  const data = new Float64Array(MAX_BASINS * BASIN_STRIDE);
  const ages = new Int32Array(MAX_BASINS);
  const accept = clamp(densityScale, 0, 1);

  // `1 − (min/max)²`, the span of the inverse size CDF below. Named because the
  // expression is the only thing standing between `u → 1` and a divide by zero.
  const span = 1 - (BASIN_MIN_RADIUS * BASIN_MIN_RADIUS) / (BASIN_MAX_RADIUS * BASIN_MAX_RADIUS);

  let count = 0;
  for (let i = 0; i < MAX_BASINS; i++) {
    const h = hash3(i, 0, 0, seed);
    if (hashToUnit(h) >= accept) {
      continue;
    }

    let px = 1;
    let py = 0;
    let pz = 0;
    let placed = false;
    let w = h;
    for (let attempt = 0; attempt < BASIN_PLACEMENT_ATTEMPTS; attempt++) {
      w = mix32(w);
      const x = hashToSigned(w);
      w = mix32(w);
      const y = hashToSigned(w);
      w = mix32(w);
      const z = hashToSigned(w);
      const d2 = x * x + y * y + z * z;
      // Rejecting the corners of the cube is what makes the direction uniform;
      // rejecting the origin is what makes the normalisation safe.
      if (d2 > 1e-12 && d2 <= 1) {
        const inv = 1 / Math.sqrt(d2);
        px = x * inv;
        py = y * inv;
        pz = z * inv;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Deterministic fallback rather than a skipped basin, so the count does
      // not depend on how lucky the seed was.
      px = 1;
      py = 0;
      pz = 0;
    }

    w = mix32(w);
    const u = hashToUnit(w);
    // Inverse CDF of p(r) ∝ r⁻³ on [min, max]. The denominator is bounded below
    // by `min/max` (0.0667 here) because `u < 1` strictly, so no NaN and no
    // infinity can leave this line.
    const radius = BASIN_MIN_RADIUS / Math.sqrt(1 - span * u);

    w = mix32(w);
    ages[count] = w | 0;
    const at = count * BASIN_STRIDE;
    data[at] = px;
    data[at + 1] = py;
    data[at + 2] = pz;
    data[at + 3] = radius;
    data[at + 4] = hashToUnit(w);
    count++;
  }

  return { count, data, ages };
}

// --- the per-sample candidate list -------------------------------------------

/**
 * Capacity of {@link CraterCandidates}.
 *
 * Bounded by construction rather than by observation: a sample examines exactly
 * 27 lattice cells per band, each cell holds at most
 * {@link CANDIDATES_PER_CELL} craters, and every basin is tested. Overflow is
 * therefore impossible, and {@link CraterCandidates.add} throws rather than
 * truncating if that reasoning is ever wrong — a silent truncation would be a
 * determinism bug that depended on enumeration order.
 */
export const MAX_CANDIDATES = 27 * CANDIDATES_PER_CELL * MAX_BANDS + MAX_BASINS;

/**
 * The craters affecting one sample, in canonical compositing order.
 *
 * Slots hold the *evaluated* geometry — normalised radial coordinate, radius,
 * age — rather than positions, because nothing downstream of the support test
 * needs a position again.
 *
 * The sort key is `(band, age hash, ix, iy, iz)` compared lexicographically, and
 * it is total: one candidate slot per cell per band, so no two entries can tie
 * on all five. Age alone would not be — two craters can share an age hash, and
 * falling back to enumeration order there is exactly what plan §5.3 forbids.
 *
 * **Scale comes before age, which is a departure from the plan**, and
 * {@link compositeCraters} has the argument. The short version: age-first
 * replacement lets a 700 m crater erase an 8 km basin, and a band that arrives
 * one LOD level later then changes the elevation by the whole basin depth. That
 * is an LOD boundary you can see.
 */
export class CraterCandidates {
  /** Normalised radial coordinate, `distance / radius`, per slot. */
  readonly t = new Float64Array(MAX_CANDIDATES);
  /** Crater radius as a fraction of the planetary radius. */
  readonly radius = new Float64Array(MAX_CANDIDATES);
  /** Age in `[0, 1)`; 0 is oldest. */
  readonly age = new Float64Array(MAX_CANDIDATES);

  /**
   * Sort key word 0: the scale bucket.
   *
   * Band index for a tier-2 crater, so ascending is largest-first; basins take
   * {@link basinScale}, which is always negative and so always sorts ahead.
   */
  readonly keyBand = new Int32Array(MAX_CANDIDATES);
  /** Sort key word 1: the age hash. */
  readonly keyAge = new Int32Array(MAX_CANDIDATES);
  /** Sort key words 2–4: lattice cell, or the basin index in the first of them. */
  readonly keyX = new Int32Array(MAX_CANDIDATES);
  readonly keyY = new Int32Array(MAX_CANDIDATES);
  readonly keyZ = new Int32Array(MAX_CANDIDATES);

  /** Slot indices, oldest first. Only the first {@link count} entries are meaningful. */
  readonly order = new Int32Array(MAX_CANDIDATES);

  count = 0;

  reset(): void {
    this.count = 0;
  }

  /**
   * Record one contributing crater, keeping {@link order} sorted.
   *
   * Fixed-capacity insertion sort over the index array: each insertion moves
   * `Int32Array` entries rather than the nine parallel fields, and the typical
   * contributor count is in the tens.
   */
  add(
    t: number,
    radius: number,
    age: number,
    keyBand: number,
    keyAge: number,
    keyX: number,
    keyY: number,
    keyZ: number,
  ): void {
    const slot = this.count;
    if (slot >= MAX_CANDIDATES) {
      throw new RangeError(
        `crater candidate capacity ${String(MAX_CANDIDATES)} exceeded; the 27-cells-per-band ` +
          'bound in MAX_CANDIDATES no longer holds',
      );
    }

    this.t[slot] = t;
    this.radius[slot] = radius;
    this.age[slot] = age;
    this.keyBand[slot] = keyBand;
    this.keyAge[slot] = keyAge;
    this.keyX[slot] = keyX;
    this.keyY[slot] = keyY;
    this.keyZ[slot] = keyZ;

    let i = slot;
    while (i > 0 && this.precedes(slot, this.order[i - 1]!)) {
      this.order[i] = this.order[i - 1]!;
      i--;
    }
    this.order[i] = slot;
    this.count = slot + 1;
  }

  /** Lexicographic order on `(band, age, x, y, z)`. Total: no two slots can tie on all five. */
  private precedes(a: number, b: number): boolean {
    if (this.keyBand[a] !== this.keyBand[b]) return this.keyBand[a]! < this.keyBand[b]!;
    // Age hashes are compared unsigned: they are 32-bit hash words, and reading
    // the top bit as a sign would order them by a bit with no meaning.
    const aa = this.keyAge[a]! >>> 0;
    const ab = this.keyAge[b]! >>> 0;
    if (aa !== ab) return aa < ab;
    if (this.keyX[a] !== this.keyX[b]) return this.keyX[a]! < this.keyX[b]!;
    if (this.keyY[a] !== this.keyY[b]) return this.keyY[a]! < this.keyY[b]!;
    return this.keyZ[a]! < this.keyZ[b]!;
  }
}

// --- candidate derivation ----------------------------------------------------

/**
 * Decode candidate slot `m` of lattice cell `(ix, iy, iz)` in `band`.
 *
 * Returns the crater radius, or 0 when the slot is empty — which is the common
 * case, since most cells sit well inside or well outside the sphere shell.
 * Position and age are written to `out`, a five-element scratch array, so that
 * the common rejection path allocates nothing and returns after a single
 * `hash3`.
 *
 * @param out `[x, y, z, age, ageHash]`.
 */
function cellCandidate(
  ix: number,
  iy: number,
  iz: number,
  m: number,
  cell: number,
  minRadius: number,
  accept: number,
  seed: number,
  out: Float64Array,
): number {
  const h = hash3(ix, iy, iz, seed);
  // One hash3 per cell, then a cheap re-mix per slot: the slot loop must not
  // pay for a fresh 3D hash it does not need.
  let w = mix32(h ^ Math.imul(m + 1, 0x27d4eb2d));
  if (hashToUnit(w) >= accept) {
    return 0;
  }

  w = mix32(w);
  const jx = hashToUnit(w);
  w = mix32(w);
  const jy = hashToUnit(w);
  w = mix32(w);
  const jz = hashToUnit(w);

  const qx = (ix + jx) * cell;
  const qy = (iy + jy) * cell;
  const qz = (iz + jz) * cell;
  const d2 = qx * qx + qy * qy + qz * qz;

  // The shell test: keep only the one cell along each radial line that straddles
  // the sphere. Without it every cell between the origin and the surface would
  // project onto nearly the same spot, and density would climb without limit
  // toward the poles of the lattice rather than staying areal.
  const half = 0.5 * cell;
  const lo = 1 - half;
  const hi = 1 + half;
  if (d2 < lo * lo || d2 > hi * hi) {
    return 0;
  }

  // `lo` is at least 1 − c/2, and c is at most CELL_RATIO · LARGEST_BAND_RADIUS
  // (0.088), so the divisor here cannot approach zero.
  const inv = 1 / Math.sqrt(d2);

  w = mix32(w);
  const u = hashToUnit(w);
  // Inverse CDF of p(r) ∝ r⁻³ over the band's `[r, 2r)`. `u < 1` strictly, so
  // the radicand is bounded below by 1/4 and the divisor by 1/2.
  const radius = minRadius / Math.sqrt(1 - 0.75 * u);

  w = mix32(w);
  out[0] = qx * inv;
  out[1] = qy * inv;
  out[2] = qz * inv;
  out[3] = hashToUnit(w);
  out[4] = w | 0;
  return radius;
}

/** Scratch for {@link cellCandidate}. Module-level: the kernel is single-threaded per worker. */
const CANDIDATE_OUT = new Float64Array(5);

/**
 * Collect the band candidates affecting one sample by hashing the lattice
 * directly — **the point-sample path** (WP13).
 *
 * This is the reference implementation. {@link collectFromCells} is the same
 * enumeration with the hashing amortised across a tile, and the two are held to
 * bit-exact equality by test.
 */
export function collectFromLattice(
  into: CraterCandidates,
  px: number,
  py: number,
  pz: number,
  bandCount: number,
  accept: number,
  seed: number,
): void {
  for (let band = 0; band < bandCount; band++) {
    const cell = bandCellSize(band);
    const minRadius = bandMinRadius(band);
    const bandSeed = mix32(seed ^ Math.imul(band + 1, 0x9e3779b1)) | 0;

    const cx = Math.floor(px / cell);
    const cy = Math.floor(py / cell);
    const cz = Math.floor(pz / cell);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ix = cx + dx;
          const iy = cy + dy;
          const iz = cz + dz;
          for (let m = 0; m < CANDIDATES_PER_CELL; m++) {
            const radius = cellCandidate(
              ix, iy, iz, m, cell, minRadius, accept, bandSeed, CANDIDATE_OUT,
            );
            if (radius <= 0) {
              continue;
            }
            addIfInSupport(
              into,
              px, py, pz,
              CANDIDATE_OUT[0]!, CANDIDATE_OUT[1]!, CANDIDATE_OUT[2]!,
              radius,
              CANDIDATE_OUT[3]!,
              CANDIDATE_OUT[4]!,
              band, ix, iy, iz,
            );
          }
        }
      }
    }
  }
}

/**
 * The exact early-out plan §5.3 rule 1 asks for.
 *
 * A candidate outside its support contributes **no arithmetic at all** — the
 * comparison is on squared distance and the function returns. Multiplying a
 * profile by a zero weight instead would look equivalent and is not: the
 * accumulator would see a `+ 0`, whose result depends on the accumulator's sign
 * of zero, and the two paths could then differ on a value nobody could point at.
 */
function addIfInSupport(
  into: CraterCandidates,
  px: number,
  py: number,
  pz: number,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  age: number,
  ageHash: number,
  band: number,
  ix: number,
  iy: number,
  iz: number,
): void {
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  const reach = SUPPORT_RATIO * radius;
  if (d2 >= reach * reach) {
    return;
  }
  into.add(Math.sqrt(d2) / radius, radius, age, band, ageHash, ix, iy, iz);
}

/**
 * Scale bucket of a basin, as a negative pseudo-band.
 *
 * Basins span a 15× radius range in one tier, so they need bucketing among
 * themselves for the same reason tier 2 has bands at all: a 400 km basin must
 * not be able to erase a 6 000 km one. Octaves below {@link BASIN_MAX_RADIUS},
 * offset so that every basin sorts ahead of every band crater.
 */
function basinScale(radius: number): number {
  let octave = 0;
  let edge = BASIN_MAX_RADIUS * 0.5;
  while (octave < BASIN_SCALE_BUCKETS - 1 && radius < edge) {
    edge = edge * 0.5;
    octave++;
  }
  return octave - BASIN_SCALE_BUCKETS;
}

/** Octaves the basin size range is split into. `0.3 / 2⁵ < 0.02`, so five covers it. */
const BASIN_SCALE_BUCKETS = 5;

/**
 * Collect the tier-1 basins affecting one sample.
 *
 * A fixed loop over every basin in the world, which is what the cap on
 * {@link MAX_BASINS} buys. Basins enter the same candidate list as band craters
 * and take the same canonical order, so a basin and a small crater interleave by
 * age rather than by tier — without that, a young crater inside an old basin
 * would be composited first and erased by it.
 */
export function collectBasins(
  into: CraterCandidates,
  px: number,
  py: number,
  pz: number,
  basins: BasinField,
): void {
  for (let i = 0; i < basins.count; i++) {
    const at = i * BASIN_STRIDE;
    addIfInSupport(
      into,
      px, py, pz,
      basins.data[at]!, basins.data[at + 1]!, basins.data[at + 2]!,
      basins.data[at + 3]!,
      basins.data[at + 4]!,
      basins.ages[i]!,
      basinScale(basins.data[at + 3]!),
      i, 0, 0,
    );
  }
}

// --- the per-tile lattice cache ----------------------------------------------

/** Values cached per candidate slot: x, y, z, radius, age. */
const CACHE_STRIDE = 5;

/**
 * The band lattice, pre-hashed over one tile's bounding box — **the per-tile
 * path**.
 *
 * Plan §5.3's optimisation, and the reason the equality test is not a
 * tautology. The saving is that a lattice cell shared by hundreds of samples is
 * hashed once instead of hundreds of times; the risk it introduces is index
 * arithmetic, which is what the test is aimed at.
 *
 * Buffers grow to fit and are then reused, so a worker generating tile after
 * tile allocates once.
 */
export class CraterCells {
  private bandCount = 0;
  /** Per band: cell origin (3), cell counts (3), offset into {@link slots} (1). */
  private meta = new Int32Array(MAX_BANDS * 7);
  /** Per cell slot: crater radius, 0 when empty. */
  private radii = new Float64Array(0);
  /** Per cell slot: x, y, z, radius, age — see {@link CACHE_STRIDE}. */
  private slots = new Float64Array(0);
  /** Per cell slot: age hash. */
  private ages = new Int32Array(0);

  /**
   * Hash every lattice cell the tile can reach, for every gated band.
   *
   * The box is the tile's own sample bounding box expanded by one cell, which is
   * exactly the neighbourhood every sample in the tile will look at — so a
   * lookup can never fall outside it, and {@link collectFromCells} treats one
   * that does as a defect rather than falling back to hashing, which would hide
   * the bug it exists to catch.
   */
  build(
    bandCount: number,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    accept: number,
    seed: number,
  ): void {
    this.bandCount = bandCount;

    let total = 0;
    for (let band = 0; band < bandCount; band++) {
      const cell = bandCellSize(band);
      const i0 = Math.floor(minX / cell) - 1;
      const j0 = Math.floor(minY / cell) - 1;
      const k0 = Math.floor(minZ / cell) - 1;
      const ni = Math.floor(maxX / cell) + 1 - i0 + 1;
      const nj = Math.floor(maxY / cell) + 1 - j0 + 1;
      const nk = Math.floor(maxZ / cell) + 1 - k0 + 1;

      const at = band * 7;
      this.meta[at] = i0;
      this.meta[at + 1] = j0;
      this.meta[at + 2] = k0;
      this.meta[at + 3] = ni;
      this.meta[at + 4] = nj;
      this.meta[at + 5] = nk;
      this.meta[at + 6] = total;
      total += ni * nj * nk * CANDIDATES_PER_CELL;
    }

    if (this.radii.length < total) {
      this.radii = new Float64Array(total);
      this.slots = new Float64Array(total * CACHE_STRIDE);
      this.ages = new Int32Array(total);
    }

    for (let band = 0; band < bandCount; band++) {
      const cell = bandCellSize(band);
      const minRadius = bandMinRadius(band);
      const bandSeed = mix32(seed ^ Math.imul(band + 1, 0x9e3779b1)) | 0;

      const at = band * 7;
      const i0 = this.meta[at]!;
      const j0 = this.meta[at + 1]!;
      const k0 = this.meta[at + 2]!;
      const ni = this.meta[at + 3]!;
      const nj = this.meta[at + 4]!;
      const nk = this.meta[at + 5]!;
      const base = this.meta[at + 6]!;

      for (let k = 0; k < nk; k++) {
        for (let j = 0; j < nj; j++) {
          for (let i = 0; i < ni; i++) {
            const cellBase = base + ((k * nj + j) * ni + i) * CANDIDATES_PER_CELL;
            for (let m = 0; m < CANDIDATES_PER_CELL; m++) {
              const radius = cellCandidate(
                i0 + i, j0 + j, k0 + k, m, cell, minRadius, accept, bandSeed, CANDIDATE_OUT,
              );
              const slot = cellBase + m;
              this.radii[slot] = radius;
              if (radius > 0) {
                const to = slot * CACHE_STRIDE;
                this.slots[to] = CANDIDATE_OUT[0]!;
                this.slots[to + 1] = CANDIDATE_OUT[1]!;
                this.slots[to + 2] = CANDIDATE_OUT[2]!;
                this.slots[to + 3] = radius;
                this.slots[to + 4] = CANDIDATE_OUT[3]!;
                this.ages[slot] = CANDIDATE_OUT[4]!;
              }
            }
          }
        }
      }
    }
  }

  /** Collect this sample's band candidates out of the cache. */
  collect(into: CraterCandidates, px: number, py: number, pz: number): void {
    for (let band = 0; band < this.bandCount; band++) {
      const cell = bandCellSize(band);
      const at = band * 7;
      const i0 = this.meta[at]!;
      const j0 = this.meta[at + 1]!;
      const k0 = this.meta[at + 2]!;
      const ni = this.meta[at + 3]!;
      const nj = this.meta[at + 4]!;
      const nk = this.meta[at + 5]!;
      const base = this.meta[at + 6]!;

      const cx = Math.floor(px / cell);
      const cy = Math.floor(py / cell);
      const cz = Math.floor(pz / cell);

      for (let dz = -1; dz <= 1; dz++) {
        const k = cz + dz - k0;
        for (let dy = -1; dy <= 1; dy++) {
          const j = cy + dy - j0;
          for (let dx = -1; dx <= 1; dx++) {
            const i = cx + dx - i0;
            if (i < 0 || i >= ni || j < 0 || j >= nj || k < 0 || k >= nk) {
              throw new RangeError(
                `crater cell (${String(cx + dx)}, ${String(cy + dy)}, ${String(cz + dz)}) in band ` +
                  `${String(band)} is outside the tile's cached box; the box no longer covers the ` +
                  'neighbourhood every sample looks at',
              );
            }
            const cellBase = base + ((k * nj + j) * ni + i) * CANDIDATES_PER_CELL;
            for (let m = 0; m < CANDIDATES_PER_CELL; m++) {
              const slot = cellBase + m;
              const radius = this.radii[slot]!;
              if (radius <= 0) {
                continue;
              }
              const from = slot * CACHE_STRIDE;
              addIfInSupport(
                into,
                px, py, pz,
                this.slots[from]!, this.slots[from + 1]!, this.slots[from + 2]!,
                radius,
                this.slots[from + 4]!,
                this.ages[slot]!,
                band, cx + dx, cy + dy, cz + dz,
              );
            }
          }
        }
      }
    }
  }
}

// --- profiles ----------------------------------------------------------------

/** Depth-to-diameter ratio of a fresh simple crater. */
const SIMPLE_DEPTH_RATIO = 0.2;
/**
 * Rim crest height above the ambient surface, as a fraction of the crater's own
 * depth.
 *
 * Expressed against depth rather than diameter on purpose. For a simple crater
 * the two are the same statement — depth is `0.2 · D`, so this is the textbook
 * `rim ≈ 0.04 · D` — but for a complex one they are not, and a rim tied to
 * diameter does not shrink as the floor rebounds. The first version of this file
 * tied it to diameter and gave an Earth-sized world a 150 km rim around a 900 m
 * basin: a mean surface 20 km above the datum, and a fixture whose elevations
 * were dominated by ejecta.
 */
const RIM_TO_DEPTH = 0.2;
/** How fast depth/diameter falls above the transition. See {@link craterDepthRatio}. */
const COMPLEX_DEPTH_FALLOFF = 0.7;
/** Radius of a complex crater's flat floor, in crater radii. */
const COMPLEX_FLOOR = 0.45;
/** Central peak width, in crater radii. */
const COMPLEX_PEAK_WIDTH = 0.22;
/** Central peak height, as a fraction of the crater's depth. */
const COMPLEX_PEAK_HEIGHT = 0.35;
/** Terrace amplitude, as a fraction of the crater's depth. */
const COMPLEX_TERRACE = 0.1;
/** Terraces between floor and rim. */
const COMPLEX_TERRACE_STEPS = 3;
/** Radius inside which a crater fully replaces earlier relief. */
const COVERAGE_FLAT = 0.5;

/**
 * Depth as a fraction of diameter.
 *
 * Simple craters hold a constant ratio; above the transition the floor rebounds
 * and the ratio falls. Real complex craters follow `d ∝ D⁰·³`, so `d/D ∝ D⁻⁰·⁷`
 * — which needs a `pow` this kernel does not have. The rational form below is
 * monotone, exact at the transition, and tracks the power law to within about a
 * third over the first decade beyond it, erring shallow. That is the right
 * direction to err: an over-deep basin reads as a hole punched through the
 * planet, and an under-deep one reads as an old basin.
 */
function craterDepthRatio(diameter: number, transitionDiameter: number): number {
  const over = diameter / transitionDiameter;
  return SIMPLE_DEPTH_RATIO / (1 + COMPLEX_DEPTH_FALLOFF * Math.max(0, over - 1));
}

/**
 * How fresh a crater looks, in `[0, 1]`.
 *
 * Freshness scales both depth and rim height, so old craters are shallow and
 * soft without needing a second profile. A mature regolith subdues them further:
 * a thoroughly gardened surface has buried its own history, which is why Luna's
 * highlands read as rounded where a young ray crater reads as sharp.
 *
 * Phase 4 couples this to the erosion regime. Phase 1 keeps every airless world
 * near-saturated and crisp, which is what {@link CraterParams.regolithMaturity}
 * being the only modifier means in practice.
 */
function freshness(age: number, regolithMaturity: number): number {
  const floor = 0.35 * (1 - 0.5 * regolithMaturity);
  return lerp(floor, 1, age);
}

/**
 * The crater profile, in units of the planetary radius.
 *
 * Rational and polynomial throughout — Phase 0 open question 2 closes here, in
 * the affirmative. `t` is the normalised radial coordinate `distance / radius`
 * and is always below {@link SUPPORT_RATIO}, because the caller's early-out has
 * already run.
 */
function craterProfile(
  t: number,
  radius: number,
  age: number,
  params: CraterParams,
): number {
  const diameter = 2 * radius;
  const transitionDiameter = 2 * params.transitionRadius;
  const fresh = freshness(age, params.regolithMaturity);
  const depth = craterDepthRatio(diameter, transitionDiameter) * diameter * fresh;
  const rim = RIM_TO_DEPTH * depth;

  // Beyond the rim both shapes are the same ejecta blanket, so the complex
  // branch is not evaluated at all out here.
  if (t >= 1) {
    return rim * compactFalloff((t - 1) / (SUPPORT_RATIO - 1));
  }

  const simple = depth * (t * t - 1) + rim * powi(t, 4);

  // Blend to the complex form over the octave above the transition, so a crater
  // that straddles it does not change shape discontinuously with a hash.
  const blend = smoothstep(clamp(diameter / transitionDiameter - 1, 0, 1));
  if (blend <= 0) {
    return simple;
  }
  const complex = complexProfile(t, depth, rim);
  return blend >= 1 ? complex : lerp(simple, complex, blend);
}

/**
 * A complex crater: flat floor, central peak, terraced walls.
 *
 * These are the features that make a large crater read as large. Without them a
 * 300 km basin is a 300 km version of a 3 km bowl, which is the single most
 * common way a procedural planet looks synthetic.
 */
function complexProfile(t: number, depth: number, rim: number): number {
  if (t < COMPLEX_FLOOR) {
    return -depth + COMPLEX_PEAK_HEIGHT * depth * compactFalloff(t / COMPLEX_PEAK_WIDTH);
  }

  const a = (t - COMPLEX_FLOOR) / (1 - COMPLEX_FLOOR);
  const wall = lerp(-depth, rim, smootherstep(a));

  // Terraces are scarps, so the sawtooth's discontinuity is the feature rather
  // than an artefact. The `a·(1−a)` envelope takes them to zero at the floor and
  // at the rim crest, where a step would be a break in the profile instead.
  const step = a * COMPLEX_TERRACE_STEPS;
  const frac = step - Math.floor(step);
  return wall + COMPLEX_TERRACE * depth * a * (1 - a) * (1 - smoothstep(frac));
}

/**
 * How completely a crater replaces whatever relief was there before.
 *
 * Full inside the floor, falling to nothing at the rim crest, and exactly zero
 * beyond it — so ejecta adds to the surface it lands on while a bowl excavates
 * the surface it is cut into. This is plan §5.4's `h = lerp(h, floor, coverage)`
 * and it is the single biggest contributor to whether the result reads as Luna
 * or as a lumpy sum.
 */
function craterCoverage(t: number): number {
  if (t >= 1) {
    return 0;
  }
  if (t <= COVERAGE_FLAT) {
    return 1;
  }
  return 1 - smootherstep((t - COVERAGE_FLAT) / (1 - COVERAGE_FLAT));
}

/**
 * Composite the collected craters into a relief, in metres.
 *
 * Largest scale first, and within a scale oldest first, with each younger crater
 * erasing earlier crater relief inside its own bowl. What it erases is *crater*
 * relief and not the base terrain: a real crater is cut into the surface it
 * lands on and follows its slope, so the fBm field underneath is left alone and
 * only the impact record is overwritten.
 *
 * ## Why replacement is bucketed by scale, and not simply age-ordered
 *
 * Plan §5.4 asks for age-ordered replacement — `h = lerp(h, floor, coverage)`,
 * oldest first — and it is right about why: overlapping craters that merely
 * *add* read as lumpy noise rather than as a cratered surface. What it does not
 * say is what happens when the craters are wildly different sizes.
 *
 * A 700 m crater landing inside an 8 km basin has `coverage = 1` at its centre,
 * so a single accumulator would replace the basin's whole depth with the small
 * crater's shape. The surface would be right — but the *band* carrying that
 * small crater is gated in one LOD level later than the basin, so a tile at
 * depth `d+1` and its parent at `d` would disagree by eight kilometres at a
 * shared vertex. That is not a hairline crack a skirt can hide; it is a cliff,
 * and it was measured at 1 811 m against a derived bound of 1 473 m before this
 * was fixed.
 *
 * So relief accumulates in two registers. `fine` holds the current scale bucket
 * and takes the replacement; when the walk reaches a smaller bucket, `fine` is
 * folded into `coarse` and can no longer be erased. A small crater then
 * excavates *into* the basin floor — which is what a small crater does — instead
 * of erasing it, and adding a band changes the total by that band's own
 * contribution and nothing else. That last property is what makes the LOD bound
 * in {@link BAND_SAMPLES_ACROSS} hold rather than merely usually hold.
 *
 * The cost is that a young large crater no longer wipes out the old small ones
 * on its floor. Real crater floors are pocked, so this is close to free at Phase
 * 1; if a very fresh basin ever needs a clean floor, that is a freshness
 * question for Phase 4's erosion regime and not a compositing one.
 */
export function compositeCraters(
  candidates: CraterCandidates,
  params: CraterParams,
): number {
  let coarse = 0;
  let fine = 0;
  let bucket = 0;
  let started = false;

  for (let i = 0; i < candidates.count; i++) {
    const slot = candidates.order[i]!;
    const band = candidates.keyBand[slot]!;
    if (!started || band !== bucket) {
      coarse = coarse + fine;
      fine = 0;
      bucket = band;
      started = true;
    }

    const t = candidates.t[slot]!;
    const shape = craterProfile(t, candidates.radius[slot]!, candidates.age[slot]!, params);
    const coverage = craterCoverage(t);
    fine = fine * (1 - coverage) + shape;
  }

  return (coarse + fine) * params.radiusM;
}

/**
 * Crater relief at one position, in metres — **the point-sample path**.
 *
 * Everything WP13's exporter needs: give it a direction and a detail depth and
 * it returns the same number `generateTile` wrote at that vertex. That equality
 * is asserted rather than assumed, and it is what makes PRD §9.4 ("the exported
 * map matches the 3D view") a property rather than a coincidence.
 */
export function craterReliefAt(
  px: number,
  py: number,
  pz: number,
  depth: number,
  basins: BasinField,
  params: CraterParams,
  seed: number,
  scratch: CraterCandidates,
): number {
  scratch.reset();
  collectBasins(scratch, px, py, pz, basins);
  collectFromLattice(scratch, px, py, pz, bandsForDepth(depth), params.densityScale, seed);
  return compositeCraters(scratch, params);
}
