# WP12 — the viewer: what was checked

**Work package:** WP12 (Phase 1 plan §7)
**Consumed by:** Phase 1 exit evidence (WP16)

**Generator version:** `0.2.0-alpha.4` — **unmoved**
**Battery digest:** `0de00475871de831…` — unmoved
**Fixture set:** `4f23f0304c09635f…` — unmoved
**Fixture digest:** `f6239e925cd1f16f…` — unmoved

Nothing in this work package touches `packages/core`, so no identity moved and
none should have. Both golden artefacts verify green against the committed
manifests, which is the check that says so rather than the claim.

Plan §7's acceptance is four criteria. Two are asserted, one is asserted in the
half a single machine can reach, and one has **not been measured**. This file
says which is which.

---

## 1. No normal seam at any tile boundary — **asserted, exactly, and bounded where it is not exact**

The one part of WP12 that can produce a seam, and the same class of problem WP10
and WP11 spent their care on.

**Within a cube face it is bit-identical.** `packages/viewer/test/tileNormals.test.ts`
compares the normals two same-depth neighbours produce at every vertex they
share — along a shared column, along a shared row, and at the corner where four
tiles meet — and asserts exact equality of the Float32 components, at 9², 65² and
129². The last is there because the golden fixtures hash at 129² while the viewer
meshes at 65² (Phase 1 open question 1), so demonstrating it at one resolution
would be demonstrating it for half the shipped path. Not a tolerance: the repo's
rule is that a seam guarantee asserted approximately is a guarantee about the
tolerance.

Three things make it true, and the test would go red if any of them stopped
holding:

1. the apron ring is the neighbouring tile's own interior elevation bit-for-bit,
   which `craters.test.ts` asserts against the real field;
2. face UVs are computed exactly as `tilegen.ts` computes them (`u0 + (i/n)·size`
   over dyadic rationals), so tile A's ring column `i = n+1` and tile B's
   interior column `i = 1` land on the same *double* rather than merely the same
   real number;
3. one estimator at every vertex, border included — no special case means nothing
   to disagree about.

**Across the twelve cube edges it is an extrapolation, accepted, with a number
against it.** The handoff named two honest options. This is the first —
"extrapolate and accept it, as the skirts already do" — and the reason is now
measured rather than asserted.

| Configuration (`X400000-0`, 65², true scale) | mean | max |
|---|---|---|
| Cross-face, depth 1 | 0.62° | 2.64° |
| Cross-face, depth 3 | 0.67° | 3.26° |
| Cross-face, depth 5 | 2.00° | 11.13° |
| Cross-face, relief switched off | — | < 0.03° |
| *No apron* (one-sided difference), depth 2 | 0.93° | 5.99° |
| *No apron*, depth 4 | 1.95° | 13.81° |
| *No apron*, depth 6 | 2.26° | 15.92° |
| *No apron*, depth 8 | 5.83° | 22.72° |

Three readings of that table:

- It is a **relief** effect, not a geometry bug. With the elevation scale at zero
  the same comparison is under 0.03°, so the cube-sphere mapping is not what is
  disagreeing — the two tiles are sampling the height field at two slightly
  different places.
- It **rises with depth**, as finer crater bands steepen the local slope. Depth 5
  is the deepest measured; deeper tiles will be worse.
- It is the same size of step as the artefact the apron removes, confined to
  twelve edges instead of spread over the entire quadtree. That is the trade, and
  it is a good one, but it is not "solved".

The second option — flattening the normal toward the geometric one near a face
boundary — was rejected: it trades a step bounded by one sample of gradient for
a band of visibly wrong shading whose width is a free parameter. Worse in the
place it is meant to help.

**The fix is the cross-face rotation table**, which is the same thing the skirts
already want for the same twelve edges (README, *Skirts and seams*). It belongs
in `tilegen.ts`, where the ring is generated. A work package, not a constant.

**And the seam tests were mutated before being believed.** Four mutations, each
caught, because a normal function that returned the radial direction everywhere
would satisfy a naive seam test perfectly:

| Mutation | Caught by |
|---|---|
| Clamp the east neighbour (a one-sided difference at the edge) | all three within-face seam tests, and the cross-face one |
| Emit the radial direction at every vertex | "actually varies", and both apron mutation tests |
| Reverse the cross-product order | "points outward on all six faces" |
| Leave skirt normals zeroed | "is a unit vector at every vertex", and the skirt-copy test |

## 2. Keyboard navigation fallbacks (R18) — **checked, in a browser**

`e2e/ui.spec.ts` focuses the canvas, zooms in with twelve `+` presses, reads the
altitude off the diagnostics overlay and asserts it fell; then presses `Home` and
asserts it came back to the framing altitude. `Home` is new in WP12: controls
that can reach a state they cannot leave are not keyboard fallbacks, and a
keyboard user has no equivalent of throwing the mouse wheel.

A second spec asserts that arrow keys and `+` typed into the **UPP field** do not
move the camera. Worth its own test because the failure is silent and
infuriating.

The canvas also gained a `:focus-visible` outline. It was in the tab order with
`outline:none`, which is the combination that makes a control reachable by
keyboard and invisible once reached.

## 3. Share URL reproduces the world — **asserted on one machine; §9.5 needs two**

`packages/viewer/test/shareUrl.test.ts` asserts the half that is checkable here:
what `buildShareQuery` emits is what `chooseWorld` reads, and it lands on the same
`PhysicalWorldSpec` and the same seed lanes. `e2e/ui.spec.ts` asserts the button
puts all four of R27's parameters on the clipboard, plus the camera.

**§9.5 is "opened on a second machine, hash-verified", and that has not been
done.** It is a WP16 row and needs two machines. Nothing here should be cited as
having closed it.

What *is* closed is the failure mode underneath it. `?gen=` naming a version this
build does not produce is now **refused by name** rather than rendered with the
current generator, which would have produced a plausible-looking world that was
not the one the link promised — the quiet version of an R15 violation, and the
dangerous one. `?ruleset=` fails the same way through `requireRuleset`.

## 4. Paste-to-globe under 10 s (§9.2) — **NOT MEASURED**

No figure is quoted because none was taken on hardware that could produce one.
Headless Chromium rasterises in software and browser measurements do not happen
under WSL2, so a number from here would be a number about SwiftShader.

What was done instead is to remove the obvious way to lose the budget: applying a
UPP **rebuilds the session in place** rather than setting `location.search` and
reloading. A reload spends part of ten seconds re-acquiring a WebGL context and
recompiling shaders to arrive at a scene it already had, and throws away the
camera on every re-roll — which is exactly the case U4 exists for.

This row belongs to WP16, on the minimum-target laptop, on mains power, in a real
browser.

---

## 5. What has **not** been checked

- **Nothing has been flown.** No screenshot in this work package. Browser
  measurements do not happen under WSL2 (the repo's standing note), and the
  smoke spec `renders a recognisable globe` fails here **identically on a clean
  tree** — checked by stashing, not assumed: 16 visible tiles against a
  threshold of 20, before it ever reaches the pixel assertion. So it says nothing
  either way about WP12.

  Outstanding on the Windows side, and now larger than it was:

  - **that a crater rim reads as a curve rather than a ring of facets**, which is
    the whole reason WP12 computed normals;
  - **whether the cross-face normal step in §1 is visible**, and at what depth.
    A number under 3° at shallow depths is one thing; 11° at depth 5 is another,
    and only a screenshot can say whether it reads as a line;
  - **WP11's visual acceptance, still never flown** — five sizes and a re-roll at
    orbit framing. WP12 changed the lighting under it (ambient 0.35 → 0.03) and
    the shading model, so the check is now *more* worth doing and its earlier
    offline results say less about what the viewer shows;
  - **whether the ambient at 0.03 is low enough to be right and high enough to
    tell an unlit tile from a missing one**, which is the only justification for
    it not being zero;
  - **`?meshprobe=1`, still never run.** Carried forward for a third work
    package. WP12 was in the mesh path and did not run it.

- **Nothing has been timed.** The normals add a `(n+3)²` position pass and a
  `(n+1)²` cross-product pass per tile, plus a third Float32 buffer across the
  worker boundary — mesh bytes per tile are up by half, from two attributes to
  three. That lands on ADR-0001 R4 and WP15 along with WP10's and WP11's
  additions, and no figure is quoted here because none was measured through the
  bench harness on the target machine.

- **The two `pre` elements changed the e2e locators.** `#app pre` and
  `#app button` stopped naming one thing when the panel landed, so the overlay's
  elements carry `data-role` attributes now and the specs use them. Worth knowing
  because a locator that silently matches the wrong element is a test that has
  stopped testing what it says.

- **Double-click fly-to (R18) is not implemented.** `OrbitCamera.lookAtDirection`
  exists and nothing calls it. R18 names it alongside the keyboard fallbacks; §7's
  acceptance names only the fallbacks, which is why it was left. It needs an
  unprojection against the sphere and is half a session.
