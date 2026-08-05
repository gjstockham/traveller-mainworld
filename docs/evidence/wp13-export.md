# WP13 — `packages/export`: what was checked

**Work package:** WP13 (Phase 1 plan §8)
**Consumed by:** Phase 1 exit evidence (WP16), specifically PRD §9.4

**Generator version:** `0.2.0-alpha.4` — **unmoved**
**Battery digest:** `0de00475871de831…` — unmoved
**Fixture set:** `4f23f0304c09635f…` — unmoved
**Fixture digest:** `f6239e925cd1f16f…` — unmoved
**Ruleset `cepheus-1`:** `1aee16af5a72464b…` — unmoved

WP13 changes no generation arithmetic. The exporter reads `sampleSurface` and
`worldPalette`, both of which existed before it; the one change inside
`packages/core` is `ruleset/fidelity.ts`, which moved out of the viewer and
computes a caption. All four golden artefacts verify green against the committed
manifests, which is the check that says so rather than the claim.

**728 tests green across 42 files**, up from 618 across 36.

---

## 0. The claim being made, before anything is asserted

WP12 gave the viewer smooth per-vertex normals and a directional sun, so a viewer
*pixel* is albedo × a lighting term. **An export has no lighting term.**

PRD §9.4's acceptance is worded as "a spot-check of pixel values against the
viewer's **tile data** agrees exactly" — the vertex colour buffer, not the
framebuffer — and **that is the claim this file makes**. It is asserted on
*linear* RGB, before the sRGB transfer function, because once a pixel is an
8-bit sRGB byte it has been through a transfer and a quantiser and comparing it
to anything requires saying which.

So: put a 4096×2048 export beside a low-sun screenshot and the map will look
flatter, and that is not a failure of this equality. It is §5.

---

## 1. A pixel agrees exactly with the viewer's tile data — **asserted, exactly**

`packages/export/test/render.test.ts` generates a tile through `TsTileGenerator`
at 65², builds the viewer's own vertex colour buffer through the viewer's own
`buildTileColours`, and compares it against the exporter's pipeline at the same
3D direction. **Exact `Float32` equality**, over four fixture worlds × three
tiles (a face root, a mid-depth tile, a deep one) × ~113 vertices each.

The cross-package import of `buildTileColours` is deliberate. Comparing the
exporter against `writeSurfaceColour` alone would prove only that both call the
same function; comparing it against the viewer's buffer also proves the exporter
reads `materials` and `albedo` the right way round and indexes the triple
correctly. **The mutation that swaps those two arguments is caught here and
nowhere else** — see §6.

**Most of the agreement is inherited, not established here**, and it is worth
being clear which is which:

| Layer | Where it is asserted | New in WP13 |
|---|---|---|
| `sampleSurface` = `generateTile`'s buffers, byte for byte | `core/test/regolith.test.ts` (WP11), over every fixture at 65² and 129² | no |
| One shared band gate, `bandsForDepth` | `craters.ts`; `sampleSurface` calls it | no |
| One shared colour map, `worldPalette` → `writeSurfaceColour` | `core/palette` | no |
| Projection → direction | `projection.test.ts`, `geography.test.ts` | **yes** |
| Direction → colour, end to end | the table above | **yes** |

## 2. Seam-free, including all twelve cube edges and both poles

### The twelve cube edges — **by construction, and measured anyway**

The export never touches a face parameterisation: it point-samples by 3D
direction. So the extrapolation WP12's normals make across the twelve edges has
no counterpart here, which is plan §8's whole argument.

Measured on the acceptance artefact (`F20076C-F`, seed 42, 4096×2048), adjacent-
pixel differences along the equator row, green channel, in sRGB bytes:

| | value |
|---|---|
| median adjacent difference | 0 |
| 99th percentile | 18 |
| maximum | 41 |
| **at the four cube edges the equator crosses** (lon ±45°, ±135°) | **3, 7, 7, 8** |

Every cube edge is inside the ordinary distribution and well under the 99th
percentile. `render.test.ts` asserts the same property over a full great circle
at 720 samples, against the distribution rather than against a constant.

### Both poles — **decided, then measured, and the answer is not what was expected**

The decision is in two independent halves.

**`equirectangular.ts` samples pixel centres.** Pixel row `py` covers latitudes
`[90° − (py+1)·180/H, 90° − py·180/H]` and is sampled at its centre. So no row is
ever at a pole: at 4096×2048 the top row sits at 89.956°, `cos` of that is
7.7e-4, and there is no limit to take. This is area registration — the convention
every equirectangular raster in circulation uses — and it puts the poles on the
outer edges of the first and last rows, which is where a 180°-tall image should
put them. Grid registration would instead give the map `H − 1` bands of latitude
in `H` rows, so the first and last would be half-height: a subtly wrong map, in
exchange for one uniform row.

**`geography.ts` returns the pole axis exactly** for `|lat| ≥ π/2`, an exact
comparison and not a tolerance. `Math.cos(Math.PI/2)` is 6.12e-17 rather than
zero, so without the snap a row of samples across a pole would come back as a
ring of points 6e-17 apart, each hashing into a different lattice cell in the
deepest crater bands — and whether that showed as one colour or several would
depend on nothing more principled than how the arithmetic was arranged.

The handoff asked for "the whole top row must be one colour, exactly". **Checked,
and the honest answer is "nearly, and for a better reason".** At 4096×2048 a
polar row's 4096 samples lie on a circle 1.3 km across on a Luna-sized world, so
it is a real, continuous, heavily oversampled traverse. Measured, green-channel
spread across the row in sRGB bytes:

| World / seed | north row | south row | equator row |
|---|---:|---:|---:|
| `F20076C-F` / `9644f1a3` | **0** | **0** | 137 |
| `X400000-0` / `badf00d` | **0** | 32 | 141 |
| `X100000-0` / `badf00d` | **0** | 34 | 127 |
| `XA00000-0` / `badf00d` | **0** | 23 | 127 |
| `X400000-0` / `1` | 5 | **0** | 133 |
| `X700000-0` / `7` | 1 | 3 | 120 |

Four of the twelve polar rows are exactly one colour. The rest span up to 34 of
255, and that is a sharp albedo edge — a ray boundary — genuinely crossing the
1.3 km circle. **It is the map showing a feature, not a seam.**

So the equality is not the property to assert, and asserting it would have pinned
whichever world happened to be tried first. What `render.test.ts` asserts is the
two things true of every world: a polar row varies less than a third as much as
an equatorial one, and **no adjacent pair in it jumps further than adjacent pairs
do at the equator** — which is what "not a seam" means. The exact-equality claim
is asserted where it does hold: on `geography.ts`'s snap, for the grid-registered
projection that would reach it.

**Zero pure-black pixels** in the 8 388 608 of the acceptance artefact.

## 3. The detail depth changes nothing, and that is the finding of this work package

Plan §8 makes the detail depth a centrepiece: "pick the tile depth whose sample
spacing matches the export's texel spacing, from a stated formula". The formula
is built, it is written against `referenceSpacing` rather than against a literal
64 or 65 (so Phase 1 open question 1 is not baked in), and it gives **depth 4 at
4096×2048 and depth 3 at 2048×1024** — plan §8's own two values, arrived at
rather than assumed, and landing on exactly the same double at both.

**And it changes nothing in the picture.**

WP11 made the albedo field depth-invariant *on purpose*. `regolith.ts` skips
every candidate whose scale bucket is at or beyond `ALWAYS_ON_BANDS`, on a line
commented "the depth-independence filter", because a colour that changed with
depth would draw a visible line along every LOD boundary in the viewer.
`sampleSurface`'s own doc comment says its `depth` is taken "for symmetry, **not
because the answer depends on it**". Plan §8 was written before WP11 made that
choice.

Measured on `X400000-0` at 256×128 — byte-identical images throughout:

| depth | bands evaluated | render | image |
|---:|---:|---:|---|
| 0 | 2 | 632 ms | reference |
| 2 | 2 | 664 ms | identical |
| 4 | 3 | 801 ms | identical |
| 6 | 5 | 1179 ms | identical |
| 8 | 7 | 1578 ms | identical |

At plan §8's depth 4 that is **27% of the render spent collecting candidates
nothing reads**.

**What was done about it.** The full depth is still computed, still printed,
still overridable — it is the correct number for the map's resolution and it
becomes load-bearing the moment anything derived from *elevation* is exported.
But the surface is sampled at `surfaceSampleDepth(depth)` instead, and **the
equality is asserted rather than assumed**, which is the same shape as
`BasinCull`'s superset argument: an optimisation is allowed here only if a test
says the unoptimised path gives identical bytes. On the day the export renders
relief, that test is what names what changed.

The title block says `detail depth 4 - albedo is depth-invariant; relief is not
exported`, because a bare number on a map is a number a reader will take to have
shaped the picture.

## 4. Everything else that was asserted

- **Bands are independent.** The pooled render is byte-identical to the
  single-threaded one at pool sizes 1, 2, 3 and 5 × band heights 1, 5, 16 and
  full. That is what makes the parallelism free rather than a source of
  nondeterminism.
- **The row-band basin cull changes nothing.** Identical bytes at band heights 1,
  3, 7, 16 and 48 — the export's own check of the superset property
  `craters.test.ts` asserts, in the one place it could go wrong: the box the
  projection reports. A box that was too *tight* would silently drop basins from
  the export and from nothing else.
- **Two projections agree where they overlap.** Equirectangular at 256×128 and
  Mercator at 256×256 give exactly the same colour at the same lat/lon, over a
  grid of probes. The strongest available evidence that a projection only chooses
  directions.
- **The PNG round-trips byte for byte** through a decoder written for the test.
  A structural check — signature present, CRCs right — passes on a file whose
  filters were applied against the already-*filtered* previous row, which is the
  classic way to write a PNG that decodes to noise; only decoding catches it.
  Every chunk CRC is checked, and `crc32` is checked against the published
  `0xCBF43926`.
- **The title block says what it claims to say**, including the reduced-fidelity
  line for a badged world — which is not in plan §8's list and belongs there.
- **The graticule is drawn from the inverse projection alone**, by crossing
  detection, so Mercator's parallels come out unevenly spaced without a line of
  Mercator-specific code. 23 meridians and 11 parallels at 15°, the equator among
  them, majors at 30° drawn stronger.
- **The 5×7 font decodes back into the right shapes** for four glyphs, and all 94
  printable characters are distinct — `I` against `l` against `1` against `|` is
  where a duplicated table row would hide, and a seed rendering `l1` as `11` is a
  seed nobody can type back in.

## 5. The thing that is *not* a bug and needs deciding — **hillshading, deferred**

An unshaded albedo map of a cratered airless world looks considerably less like
the viewer than §9.4's wording implies, because on Luna most of what the eye
reads as a crater is **shadow**. On the acceptance artefact the craters read as
bright rings — WP11's fresh-ejecta and ray brightening — rather than as bowls.

**§8 does not ask for hillshading and it was not added.** The decision, and the
reasons for it in both directions:

- Adding it would make the depth meaningful, would make the map read like the
  viewer, and — because normals from direction-offset point samples touch no face
  parameterisation — would make the **export better at the twelve cube edges than
  the viewer is**.
- Against: it makes §9.4's "agrees exactly" harder to state, because a shaded
  pixel is not tile data; it is a product decision about what an exported map is
  *for*; and it is scope §8 did not ask for.

**Deferred, and it is in the open register.** It should not be found by WP16 while
writing the exit evidence.

## 6. Mutation — twenty run, and two tests were not load-bearing

The repo's rule is to mutate before believing a green. Twenty mutations against
the WP13 tests:

| Mutation | Caught by |
|---|---|
| Remove the pole snap in `directionFromGeographic` | four `geography.test.ts` assertions |
| Tighten the row-band box at the equator | the band-bounds test, and the cull-invariance test |
| Swap `material` and `albedo` into the palette | the §9.4 pixel agreement, on every fixture |
| Derive the palette from the wrong seed lane | the §9.4 pixel agreement |
| Sample the pixel corner rather than its centre | "never asks for ±90 degrees", and two more |
| Let Mercator clamp its clipped caps | "reports a row outside the projected world" |
| Ignore the Mercator clip parameter | "moves the visible latitude range when the clip moves" |
| `round` rather than `floor` the graticule cell | all four graticule count/placement tests |
| Skip the sRGB encode | "mid-grey lands at 188 and not at 128" |
| Clamp a NaN channel to 0 rather than throwing | the NaN guard test |
| Filter PNG rows against the already-filtered previous row | the byte-for-byte round trip |
| Emit `deflate-raw` instead of `deflate` | the round trip, and the zlib-header test |
| Paste pool bands at the wrong offset | pooled-vs-single equality |
| Drop the pool's byte-count check | "refuses a worker that returns the wrong number of bytes" |
| Stop the title block refusing unprintable characters | "refuses a line the font cannot draw" |

**Two escaped, and both were the test's fault rather than a gap in the code:**

- **"Read the filter heuristic's byte as unsigned."** The test asserted the PNG
  was under an eighth of the raw bytes, and the mutation passed it — deflate mops
  up enough of the redundancy that the file is small either way. Rewritten to
  assert the *chosen filter types* (Sub on the first row, Up on the rest, never
  None), which discriminates by construction. Re-run: caught.
- **"Let a glyph wrap round the right edge."** The test checked column 0, and an
  overrun of `k` columns lands at column `k`. Rewritten to check the row *below*
  the text, which is where wrapped ink actually goes. Re-run: caught.

**Two more were expected not to be caught, and are recorded so the count is not
read as fifteen out of seventeen:**

- **Dropping the basin cull entirely.** Correct: the cull is a superset filter,
  so removing it *must* give identical bytes. That is the property, not a bug.
  The mutation that matters is a cull that is too tight, and that one is caught.
- **`surfaceSampleDepth` returning a constant 0.** Behaviourally identical today,
  because `bandsForDepth(0)` already equals `ALWAYS_ON_BANDS`. The derivation
  exists so that raising `ALWAYS_ON_BANDS` moves it; what is asserted instead is
  that identity, which is the fact making 0 correct.

## 7. Two traps hit, both on the first render this package ever did

- **Non-ASCII reaching the map.** `assertPrintable` fired twice on the very first
  export: once on `plate carrée` in the projection's display name, once on an
  em-dash in the detail-depth line. Both would have rendered as `?` beside a
  number. The guard is why they were found in a stack trace rather than in a
  4096×2048 PNG, and it is why the title block writes `deg` and `+/-`.
- **`Uint8Array` turns a NaN into a plausible 0.** The same exposure
  `quantiseAlbedo` guards in the kernel, with none of the kernel's guards — and
  `writeSurfaceColour`'s clamp is *not* one, because `v < 0 ? 0 : v > 1 ? 1 : v`
  passes NaN through both comparisons untouched. `encodeChannel` throws.

---

## 8. What has **not** been checked

- **Nothing has been flown, and nothing in the browser has been run.** Browser
  measurements do not happen under WSL2 (the repo's standing note). The five
  Playwright specs in `packages/viewer/e2e/export.spec.ts` — the controls, the
  derived-depth readout, an end-to-end render and download, cancel, and the
  fixture route — **have never been executed**. They are the only check of the
  module worker spawning, the structured clone of the job, the `Blob` download,
  and the pool adapter in `workers/exportPool.ts`. Everything they *do not* cover
  is in Node, deliberately: about two thousand lines of exporter, and it is the
  reason `ExportServer` and `renderWithPool` take their platform as a parameter.
- **Nothing has been timed that counts as evidence.** The CLI's `--timing` prints
  13.03 µs/sample for the 4096×2048 acceptance render (109.3 s single-threaded,
  8 388 608 samples) and prints a warning beside it saying it is not evidence.
  It is Node under WSL2, not `pnpm bench` on the minimum-target laptop, and not
  through the bench harness. **It is nonetheless the first measurement of the
  point path anyone has taken**, and it sits between plan §8's estimate of
  ~2.5 µs/sample and the 4.3–7.6 µs the handoff derived from WP10's medians —
  above both. WP15's row.
- **Three exports were looked at offline in the WP13 session, and that is all the
  looking that happened.** A 512×256 `F20076C-F`, an 8× downscale of the
  4096×2048 acceptance artefact, a 768×768 Mercator of the same world, and a
  768×384 `X100000-0`. What that is worth: the Mercator's parallels visibly bunch
  toward the equator and spread toward the clip, which is the projection showing
  through rather than a table of rows; the title block is legible at 768 px; no
  seam, band or discontinuity was apparent in any of them. What it is **not**
  worth: none of these is the acceptance size at full resolution, none was
  compared side by side with the viewer, and "no seam was apparent at 768 px" is
  a much weaker statement than the numeric checks in §2 — which is why those are
  the ones the claim rests on.
- **The graticule's readability at 4096×2048 has not been judged by eye.** At
  15°, a 4096-wide map carries a line every 170 px at one-pixel width; whether
  that reads as a grid or as noise is a screenshot question, and the 8×
  downscale used for inspection averages a one-pixel line into invisibility.
- **The lattice-density open question is still open, and the instrument now
  exists.** `X100000-0` at 768×384 showed no obvious banding, but Phase 1 open
  question 3 is about Size 1–2 at high resolution with attention, and a glance at
  a 768-wide render is not that.
- **The 27% saving in §3 has not been re-measured at the acceptance size**, only
  at 256×128.
- **Winkel tripel and azimuthal are claimed to be "cheap later" and neither has
  been attempted.** `projection/projection.ts` is honest about the shape of the
  claim: the interface is inverse-only, azimuthal projections invert in closed
  form and are a file each, and **Winkel tripel does not** — its inverse needs a
  two-dimensional Newton iteration. Cheap *behind the interface*, because nothing
  else in the package changes; not cheap in absolute terms.
