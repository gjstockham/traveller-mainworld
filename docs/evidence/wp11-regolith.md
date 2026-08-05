# WP11 — regolith and materials: what was checked

**Work package:** WP11 (Phase 1 plan §6)
**Consumed by:** Phase 1 exit evidence (WP16), and WP13's §9.4 claim

**Generator version:** `0.2.0-alpha.4`
**Battery digest:** `0de00475871de831…`
**Fixture set:** `4f23f0304c09635f…` (unmoved — the regolith pass reads only spec
fields WP10 had already put in the serialiser)
**Fixture digest:** `f6239e925cd1f16f…`

Plan §6's acceptance is three claims, two of which are visual. This file records
which of them have been checked, how, and — the half that matters most — which
have not.

## 1. Viewer and exporter produce the same colours — **checked, asserted**

Not a visual check at all, and deliberately so: §6 asks for it *asserted, not
eyeballed*.

There is one palette module (`packages/core/src/palette`) and one sampling path,
so the two consumers cannot drift by construction. What is asserted on top of
that is the layer below it: `packages/core/test/regolith.test.ts` compares
`sampleSurface` — the point path WP13 will export through — against
`generateTile`'s `albedo` and `materials` buffers, **byte for byte**, over every
fixture world at a face root, a mid-depth tile and the deepest tile in the set,
and again at 129² where the tile path's lattice cache is genuinely different code
from the point path's direct hashing.

`packages/core/test/palette.test.ts` covers the rest: that the palette imports
nothing from the kernel, that it covers every material class the kernel can emit,
and that its two entry points agree.

## 2. Five airless UPPs across Size 1–A are visually distinct — **checked**

**And it failed the first time**, which is the finding worth recording.

Rendered `X100000-0`, `X300000-0`, `X500000-0`, `X800000-0` and `XA00000-0` at
one fixed seed (`0x0badf00d` / `0xcafebabe`) as 512×256 equirectangular maps,
sampled through `sampleSurface` and coloured through `surfaceColour` — the same
two functions the exporter will use. The five came out **bit-identical**.

The cause is in WP10, not in the palette: every radius in `craters.ts` is a
fraction of the planetary radius and placement is on the unit sphere, so the
crater field is scale-invariant. The first version of the regolith model read
only scale-free quantities, so nothing about body size reached the colour at all.
The fixture set cannot see this — each of its ten worlds has its own seed, so
they differ for a reason that says nothing about Size.

Two size-dependent terms were added (flooded-basin fraction rising with radius,
ejecta prominence falling with it) and the five are now clearly distinct: Size 1
reads as bright, uniformly cratered highland with long rays; Size A as darker
plains with subdued ones, monotonically in between.
`regolith.test.ts > MAKES SIZE 1 TO A DISTINCT AT ONE SEED` pins both the
distinctness and the direction, so this cannot silently regress.

**Two caveats on this row.** The check is of the *generator*, through an offline
sampler, not of the viewer — see §4. And the underlying crater *geometry* is
still scale-invariant; only the colour now varies with size. Making the impact
record itself size-dependent is a WP10 question (real impactor populations are
absolute-sized, not radius-fraction-sized) and is not attempted here.

## 3. Re-rolling the seed changes the world without changing its character — **checked**

Rendered `X400000-0` at four seeds by the same method. All four are plainly
different worlds — different mare layout, different province balance, different
overall brightness and a distinguishable colour cast — and all four read as the
same *kind* of place: a cratered airless body.

`regolith.test.ts` holds the numeric half: four seeds give four different albedo
fields, and every one of them lands in the same broad brightness regime rather
than one coming out black and the next white.

## 4. What has **not** been checked

- **Nothing has been flown.** Every visual check above went through an offline
  equirectangular sampler, not the viewer's mesh path. Browser work does not
  happen under WSL2 (the repo's standing note), and the two Playwright smoke
  tests that need a streamed globe — `renders a recognisable globe` and `keeps
  rendering while the camera orbits` — fail here on the unmodified tree as well
  as on this one, so they say nothing either way. **Flying the five sizes and a
  re-roll at orbit framing on the Windows side is outstanding**, and so is
  looking for a colour seam at a tile boundary. The model makes the last of those
  seam-free by construction — albedo is independent of LOD depth, asserted — but
  construction and a screenshot are different kinds of evidence.

- **Nothing has been timed.** The regolith pass adds a second walk over the
  candidate list, a four-octave fBm and a gradient-noise call per fresh
  contributor to every interior sample. That lands on ADR-0001 R4 and on WP15,
  which the handoff already flagged as the more urgent for it. No figure is
  quoted here because none was measured through the bench harness on the target
  machine, and a number from Node under WSL2 is not evidence.

- **The archived WASM twin no longer agrees on colours**, and cannot be made to.
  It writes neither `albedo` nor `materials`, and unlike the crater pass this
  cannot be worked around by zeroing `densityScale` — the province field is there
  on a crater-free world too. `tileJob.test.ts` compares positions and says so.
