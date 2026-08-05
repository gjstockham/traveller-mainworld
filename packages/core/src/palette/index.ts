/**
 * Regolith palette: the map from a generated surface to a colour on screen.
 *
 * ## This module is outside the whitelisted zone, and that is the point
 *
 * `packages/core/src/kernel` may use only operations that are bit-identical
 * across JS engines, because everything it produces reaches a golden hash.
 * Nothing here does. The kernel emits *scalars* — an albedo byte and a material
 * class — and this file turns them into RGB, which no manifest records and no
 * share URL has to reproduce to the bit.
 *
 * The boundary is written down because it is easy to get wrong in both
 * directions. A future reader who assumes the whitelist applies here will ban
 * `Math.pow` in a file where it is harmless; a reader who assumes it does not
 * apply *anywhere* in `core` will reach for an approximation inside the kernel
 * to satisfy a rule that does not govern this file. The rule is simply: if it
 * can move a hash it is in `kernel/`, and if it cannot it is not.
 *
 * **It imports nothing from `kernel/`.** Not because a read-only import would be
 * unsafe, but because "no kernel imports" is a property a reader can check at a
 * glance where "only harmless kernel imports" is a judgement they have to make
 * every time. The cost is the four lines of {@link paletteMix} below.
 *
 * ## One palette, two consumers
 *
 * The viewer meshes tiles and WP13's exporter point-samples them, and PRD §9.4
 * asks that the exported map match the 3D view. That is a property only if there
 * is exactly one function turning a surface into a colour. If the two had a copy
 * each they would agree until the day somebody tuned one of them, and the
 * failure would be a map that is subtly not the planet — which is the same
 * failure the shared band gate exists to prevent on the geometry side. WP13 does
 * not exist yet, so today this has one consumer; it is written for two.
 *
 * Tuning anything in this file therefore costs no version bump and no manifest
 * regeneration, which is correct: it changes how a world is *displayed*, not
 * what it *is*.
 */

/**
 * Base tint per material class, as linear RGB at unit albedo.
 *
 * Near-grey on purpose. Airless silicate surfaces have very little colour —
 * Luna's strongest hue difference, mare basalt against highland anorthosite, is
 * a few percent — and a procedural planet reads as synthetic the moment its
 * regolith is brown. What separates the classes at a glance is brightness, which
 * is the albedo byte's job; these only decide *which way* each class leans.
 */
const MATERIAL_TINT: readonly (readonly [number, number, number])[] = [
  [0.92, 0.95, 1.0], // Mare — basalt, faintly blue
  [1.0, 0.99, 0.96], // Regolith — neutral
  [1.0, 0.98, 0.93], // Highland — anorthosite, faintly warm
  [1.0, 1.0, 0.99], // Ejecta — fresh, essentially colourless
  [0.35, 0.55, 1.0], // Water — Phase 2, never written in Phase 1
];

/**
 * Index of the tint an unrecognised material falls back to — `Material.Regolith`.
 *
 * Written as a number rather than imported, so this file keeps its "no kernel
 * imports" property. `palette.test.ts` asserts it against the real enum and that
 * the table covers every class, which is where that coupling belongs: a test
 * fails loudly on the day someone adds a class, where an import would merely
 * have made this file harder to reason about every other day.
 */
const FALLBACK_TINT = 1;

/**
 * How far the per-world cast can push a channel, either way.
 *
 * Small, because a world's colour identity is a *cast* and not a paint job: past
 * about a tenth the surfaces stop reading as rock. It is enough to tell two
 * re-rolls apart side by side, which is what PRD U4 ("re-roll to audition
 * variants") actually asks for.
 */
const WORLD_CAST = 0.05;

/** Darkest and brightest the albedo byte maps to, before the material tint. */
const SHADE_FLOOR = 0.05;
const SHADE_CEILING = 1.0;

/**
 * A world's colour identity: a cast and a contrast, both derived from its seed.
 *
 * Derived rather than stored, so a share URL carrying only the seed reproduces
 * the same colours — the palette is not hashed, but it is still deterministic,
 * and "not hashed" must not be allowed to slide into "not reproducible".
 */
export interface WorldPalette {
  /** Per-channel multiplier, near 1. */
  readonly castR: number;
  readonly castG: number;
  readonly castB: number;
  /** How hard the albedo range is stretched. Near 1. */
  readonly contrast: number;
}

/**
 * A 32-bit avalanche, deliberately a private copy of the kernel's `mix32`.
 *
 * See the module header: this file imports nothing from `kernel/` so that the
 * separation is checkable by eye. Four lines is a cheap price for that, and this
 * one is free to change without a thought for any hash, which the kernel's is
 * emphatically not.
 */
function paletteMix(x: number): number {
  let z = x | 0;
  z = z ^ (z >>> 16);
  z = Math.imul(z, 0x21f0aaad);
  z = z ^ (z >>> 15);
  z = Math.imul(z, 0x735a2d97);
  z = z ^ (z >>> 15);
  return z >>> 0;
}

/** A hash word as a fraction in `[0, 1)`. */
function unit(h: number): number {
  return (h >>> 0) / 4294967296;
}

/** Derive a world's palette from its seed. */
export function worldPalette(seedHi: number, seedLo: number): WorldPalette {
  const base = paletteMix((seedLo ^ Math.imul(seedHi, 0x9e3779b1)) | 0);
  const r = paletteMix(base ^ 0x01);
  const g = paletteMix(base ^ 0x02);
  const b = paletteMix(base ^ 0x03);
  const c = paletteMix(base ^ 0x04);
  return {
    castR: 1 + (unit(r) - 0.5) * 2 * WORLD_CAST,
    castG: 1 + (unit(g) - 0.5) * 2 * WORLD_CAST,
    castB: 1 + (unit(b) - 0.5) * 2 * WORLD_CAST,
    // 0.85 to 1.15: enough that one re-roll reads as a washed-out dust ball and
    // another as a stark high-contrast one, without either leaving the range
    // where relief is legible.
    contrast: 0.85 + unit(c) * 0.3,
  };
}

/** The palette a world with no seed variation would get. Handy for tests and for docs. */
export const NEUTRAL_PALETTE: WorldPalette = Object.freeze({
  castR: 1,
  castG: 1,
  castB: 1,
  contrast: 1,
});

/**
 * Colour for one generated vertex, written into `out` at `at` as three floats.
 *
 * @param material One of the generator's `Material` classes. An unknown class
 *                 falls back to `Regolith` rather than throwing: this runs per
 *                 vertex inside a worker, where a throw would lose a whole tile
 *                 over one byte.
 * @param albedo   The generator's albedo byte, 0–255.
 */
export function writeSurfaceColour(
  palette: WorldPalette,
  material: number,
  albedo: number,
  out: Float32Array,
  at: number,
): void {
  const tint = MATERIAL_TINT[material] ?? MATERIAL_TINT[FALLBACK_TINT]!;

  // Centre the contrast on mid-grey so stretching it brightens the bright end
  // and darkens the dark one, instead of scaling the whole world up.
  const t = albedo / 255;
  const stretched = 0.5 + (t - 0.5) * palette.contrast;
  const shade =
    SHADE_FLOOR + (SHADE_CEILING - SHADE_FLOOR) * (stretched < 0 ? 0 : stretched > 1 ? 1 : stretched);

  // Clamped, because the three factors can each reach 1 and their product then
  // leaves the range a vertex colour is allowed to occupy. A channel above 1
  // does not error anywhere — it blows out in the renderer and quietly loses the
  // hue it was carrying, which is the kind of thing that gets diagnosed as a
  // lighting problem.
  out[at] = channel(tint[0]! * shade * palette.castR);
  out[at + 1] = channel(tint[1]! * shade * palette.castG);
  out[at + 2] = channel(tint[2]! * shade * palette.castB);
}

/** Constrain one channel to `[0, 1]`. */
function channel(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Colour for one generated vertex, as a triple.
 *
 * Allocating, so it is for tests, for tools and for anything that colours a
 * handful of samples. Anything colouring a tile's worth should use
 * {@link writeSurfaceColour}, which writes straight into the buffer it is
 * building.
 */
export function surfaceColour(
  palette: WorldPalette,
  material: number,
  albedo: number,
): readonly [number, number, number] {
  const out = new Float32Array(3);
  writeSurfaceColour(palette, material, albedo, out, 0);
  return [out[0]!, out[1]!, out[2]!];
}
