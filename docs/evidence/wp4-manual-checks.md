# WP4 — cross-platform hash evidence

**Work package:** WP4 (implementation plan §3), Spike A §A.2.7
**Consumed by:** ADR-0001 (kernel decision, WP6) and PRD §9.1

Spike A asks one question: does the pure-TypeScript kernel produce bit-identical
`Float64` output on every target engine and OS? This file is where the answer is
recorded — both halves of it.

The bar is exact equality against the two committed manifests. Every cell runs
the **full** determinism battery (21 cases, ≥10⁶ hostile inputs each) *and* the
**full** golden fixture set (10 worlds × 90 tiles at 129², WP7), and compares
every hash plus both overall digests.

**Generator version:** 0.1.0
**Battery digest:** `0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7`
**Fixture set:** `289a78e59ada7f5bab4a7c26c99ae5af580b9e95fbcdca033dd02f499e0c701c`
**Fixture digest:** `9c0f860316158247bfd1d58523cb8212b3b0faef6cd8cbb4f46265c9f9217387`

> The battery digest is unchanged by WP7 and remains what it always was: the
> identity of the *kernel arithmetic*. The fixture set is keyed separately —
> `genVersion` covers `packages/core` only — so a future fixture edit moves the
> two fixture hashes above and leaves the battery digest, and the ADR-0001
> evidence resting on it, exactly where they are. See the README, "Why two files
> rather than more rows in one".

> **This file gates ADR-0001.** [ADR-0001](../adr/ADR-0001-generation-kernel.md)
> selected the TypeScript kernel **provisionally**, because when it was written
> only the three local Ubuntu cells had run and the three manual rows below were
> empty. Its revisit trigger R1 is precisely this file: filling in the nine CI
> cells and M1–M3 all green promotes that ADR from Provisional to Accepted, and
> any divergence rewrites it as a WASM decision on correctness grounds. Phase 0
> cannot exit until these rows are filled.

> A divergence is a finding, not a bug to be worked around. Per spike plan §A.3
> it selects the WASM kernel on **correctness** grounds regardless of
> performance. Record it here in full — engine, version, OS, which case, both
> hashes — and do not loosen a comparison to make a cell green.

## Scope: what is under test

The matrix carries the **TypeScript** kernel across platforms, because that is
the kernel whose cross-engine behaviour is in question. The WASM twin is checked
against the TypeScript kernel on one platform (`wasm-parity` in CI), which is
the comparison that catches bugs — two independent implementations agreeing.

Running the twin across the full matrix as well would be cheap extra evidence
rather than a gap: the WASM spec pins every float operation, so a WASM
divergence would be a browser bug, not a design risk. It is deliberately *not*
done here — a scope choice recorded in this file and nowhere else. **ADR-0001
must say which evidence it relied on** — one-platform TS↔WASM parity, plus a
nine-cell TS matrix.

It does, in its §"What the evidence does not cover — and which of it this
decision relied on", including the fact that three of the nine cells had run
when it was written.

*(This paragraph previously cited "open question 5 in the implementation plan
§10". It was a dangling reference: §10 item 5 is the generator-version scheme,
settled by WP7. Corrected here rather than carried forward, and ADR-0001's note
about the discrepancy updated to match.)*

## Automated: CI matrix

`browser-matrix` in `.github/workflows/ci.yml` — chromium, firefox and webkit ×
ubuntu, macos and windows, plus the Node reference run in the `test` job on the
same three OSes, all gated by a single fast `golden` job that runs the identical
comparison on ubuntu/Node first. Each cell prints its evidence block to the log
and uploads it as an artifact (`battery-<os>-<browser>`).

A twelfth cell, `build-invariance`, is not part of this table: it holds one
engine to the same manifests across three *bundler* configurations, which is a
different question from which engines agree. See the README, "Build invariance".

Run one cell locally:

```sh
pnpm golden:matrix                                    # all three engines
pnpm --filter @traveller-mainworld/golden e2e --project=webkit
```

Note when reading evidence blocks: Playwright's WebKit build reports a macOS
user agent whatever host it runs on, so the OS of a cell comes from the cell
name, never from the user-agent string in the block.

| Date | Where | Engines | Result |
|---|---|---|---|
| 2026-08-03 | Local, Ubuntu 24.04 on WSL2 (kernel 6.18) | Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5 | **PASS** — battery digest `0c6181a0…` in all three. *Battery only: this run predates WP7, so it is not evidence about the fixture worlds.* |
| 2026-08-04 | Local, Ubuntu 24.04 on WSL2 (kernel 6.18) | Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5 | **PASS** — both artefacts. Battery `0c6181a0…`, fixture set `3ed32303…`, fixture digest `9843cdd3…` in all three. Still one OS, and still not real Safari. |
| 2026-08-04 | Local, `build-invariance` cell (chromium) | unminified and Vite-default bundles | **PASS** — both digests identical to the `matrix` bundle and to the committed manifests |
| 2026-08-04 | GitHub Actions, ubuntu-latest | Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5 | **PASS** — `0c6181a0…` / `9843cdd3…` in all three |
| 2026-08-04 | GitHub Actions, macos-latest | Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5 | **PASS** — `0c6181a0…` / `9843cdd3…` in all three |
| 2026-08-04 | GitHub Actions, windows-latest | Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5 | **PASS** — `0c6181a0…` / `9843cdd3…` in all three |

**All nine cells, first run:** [run 30889635150](https://github.com/gjstockham/traveller-mainworld/actions/runs/30889635150),
commit `d974800`. Every cell reported the same two digests — battery
`0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7` and fixture
`9843cdd31cf52ced1862d927638ff5e1eaf338c4cdcfa9757cca0c61bee5033d` — against the
same fixture set `3ed32303…`. Per-cell evidence blocks are the run's
`battery-<os>-<browser>` artefacts. `build-invariance` passed in the same run.

Three engines now agree bit-for-bit across **three** operating systems, which
clears PRD §9.1's two-OS bar. Two things this does **not** clear:

- **M1–M3 below are still empty**, and ADR-0001's R1 needs them too. Playwright's
  WebKit is not Safari, so nine green cells do not close Spike A on their own.
  ADR-0001 stays **Provisional**.
- The webkit cells on ubuntu and windows both report a **macOS** user agent, as
  the note above warns. Their OS comes from the cell name. Do not read those two
  artefacts as macOS coverage — macOS coverage is the `macos-latest` column.

One cell in that run and its successor did fail: `test (windows-latest)`, on a
`SyntaxError` in two unit-test files that import a repo-root `scripts/*.mjs`.
Never a determinism finding — Vite's shebang stripper does not handle CRLF, and
Windows runners check out with `core.autocrlf` enabled. Fixed in `9ae9444` by
pinning the working tree to LF (`.gitattributes`), with
`packages/golden/test/lineEndings.test.ts` as the guard.

It mattered to this file for one reason: `pnpm golden:verify` runs *after*
`pnpm test` in that job, so while it was red the Windows step was **skipped** and
Node-on-Windows hash equality was unobserved rather than disproven.

**That gap is now closed.** In [run 30891235962](https://github.com/gjstockham/traveller-mainworld/actions/runs/30891235962)
(commit `9ae9444`) `test (windows-latest)` passed with `pnpm golden:verify`
executing and passing. The Node reference leg therefore now covers **all three
operating systems**, alongside the nine browser cells:

| Leg | ubuntu | macOS | windows |
|---|---|---|---|
| Node reference (`test`) | PASS | PASS | PASS |
| chromium | PASS | PASS | PASS |
| firefox | PASS | PASS | PASS |
| webkit (Playwright, *not* Safari) | PASS | PASS | PASS |

Twelve cells, four engines counting Node, three OSes, both artefacts, identical
digests throughout. What no CI cell can supply is a browser Apple or Google
actually ships — M1–M3 below. Two of those three are now filled: M2 on real iOS
Safari and M3 on a real Android handset. M1 is not.

## Manual: real Safari, iOS and Android

**Not optional** (spike plan risk table, implementation plan §3 WP4). Playwright's
WebKit is not Safari: different build configuration, different JIT tiers,
different release cadence, and Apple ships the only WebKit that anyone's browser
actually runs. iOS Safari and Android Chrome are likewise not their desktop
namesakes.

### Serving the page

**The deployed page is the primary route:**

> **https://gjstockham.github.io/traveller-mainworld/verify.html**

Published by `.github/workflows/pages.yml` on every push to `main`, but only
after `pnpm golden:verify` passes in the same job — so a build that already
disagrees with the manifests on the reference platform never reaches a device.
Each deploy stamps its commit into the evidence block, so a pasted block names
the build that produced it.

HTTPS matters beyond convenience: `navigator.clipboard` is secure-context only,
so over a plain-HTTP address the **Copy evidence** button falls back to
selecting the text and says so rather than doing nothing.

Local alternatives, if the deployed page is not what you want to test:

```sh
pnpm golden:page      # builds and serves packages/golden/verify.html on :4174,
                      # bound to every interface so a phone on the LAN can reach it
```

Then open `http://<this machine's LAN IP>:4174/verify.html` on the device. Note
that on **WSL2 this will not work from another device by default** — WSL2 sits
behind a NAT'd virtual NIC, so the port needs forwarding from the Windows host
(`netsh interface portproxy`) plus a firewall rule, unless mirrored networking
is enabled. That obstacle is why the deployed page exists.

The build in `packages/golden/dist-web/` is a static, self-contained page —
copying it to a USB stick works equally well, and is a reasonable route to a
borrowed Mac with no network access. A block pasted from such a build reports
`build  local build` rather than a commit, which is worth noticing when reading
the evidence later.

The run takes a minute or two, and the tab must stay in the foreground (a
backgrounded tab gets throttled, and on iOS may be discarded outright). The page
runs the battery in one worker and shards the ten fixture worlds across a small
pool — capped at four, because each worker holds its own scratch buffers — which
is what keeps a hand-check inside the window a foregrounded tab survives. Then
press **Copy evidence** and paste the block into the table below.

The evidence block carries both digests and the fixture-set hash. All three are
needed: a matching battery digest with a stale fixture-set hash means the device
ran a different set of worlds, not that it agreed about them.

### Required checks

| # | Target | Why it is here |
|---|---|---|
| M1 | Real Safari on macOS | The only JavaScriptCore anyone actually browses with |
| M2 | iOS Safari | Different hardware, different JIT policy, and every iOS browser is this engine |
| M3 | Android Chrome | Arm V8 on a mobile power/thermal profile |

### Results

Paste the evidence block verbatim — the device and version strings are the
evidence, and "it passed on my phone" is not something an ADR can rest on.

<!-- M1 -->
```
NOT RUN — real Safari on macOS. No Mac available to the author.
```

<!-- M2 -->
```
result          PASS
generator       0.1.0
manifest        0.1.0 (digest 0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7)
battery         full — 21 cases
battery digest  0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7
fixture set     289a78e59ada7f5bab4a7c26c99ae5af580b9e95fbcdca033dd02f499e0c701c (manifest 289a78e59ada7f5bab4a7c26c99ae5af580b9e95fbcdca033dd02f499e0c701c)
fixtures        full — 10 worlds
fixture digest  9c0f860316158247bfd1d58523cb8212b3b0faef6cd8cbb4f46265c9f9217387 (expected 9c0f860316158247bfd1d58523cb8212b3b0faef6cd8cbb4f46265c9f9217387)
duration        12.8 s across 4 worker(s)
user agent      Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
hardware        cores 4, memory not reported
screen          393×852 @ 3
run at          2026-08-04T13:03:25.809Z
build           59c3a6361d3eb8872886fd756ad7a0016541c1e7
```

<!-- M2, earlier run on the same device, in Chrome for iOS. Superseded by the
     block above, kept because it is a real result from a real engine build. -->
```
result          PASS
generator       0.1.0
manifest        0.1.0 (digest 0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7)
battery         full — 21 cases
battery digest  0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7
fixture set     289a78e59ada7f5bab4a7c26c99ae5af580b9e95fbcdca033dd02f499e0c701c (manifest 289a78e59ada7f5bab4a7c26c99ae5af580b9e95fbcdca033dd02f499e0c701c)
fixtures        full — 10 worlds
fixture digest  9c0f860316158247bfd1d58523cb8212b3b0faef6cd8cbb4f46265c9f9217387 (expected 9c0f860316158247bfd1d58523cb8212b3b0faef6cd8cbb4f46265c9f9217387)
duration        14.0 s across 4 worker(s)
user agent      Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/150.0.7871.113 Mobile/15E148 Safari/604.1
hardware        cores 4, memory not reported
screen          393×852 @ 3
run at          2026-08-04T12:45:41.996Z
build           0aefaa8a5dc2a42e92f2d2c5e4076f7debd47cce
```

<!-- M3 -->
```
result          PASS
generator       0.1.0
manifest        0.1.0 (digest 0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7)
battery         full — 21 cases
battery digest  0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7
fixture set     289a78e59ada7f5bab4a7c26c99ae5af580b9e95fbcdca033dd02f499e0c701c (manifest 289a78e59ada7f5bab4a7c26c99ae5af580b9e95fbcdca033dd02f499e0c701c)
fixtures        full — 10 worlds
fixture digest  9c0f860316158247bfd1d58523cb8212b3b0faef6cd8cbb4f46265c9f9217387 (expected 9c0f860316158247bfd1d58523cb8212b3b0faef6cd8cbb4f46265c9f9217387)
duration        264.6 s across 4 worker(s)
user agent      Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36
hardware        cores 8, memory 8 GB
screen          412×915 @ 2.625
run at          2026-08-04T12:46:58.228Z
build           0aefaa8a5dc2a42e92f2d2c5e4076f7debd47cce
```

| # | Device | OS | Browser | Digest | Result | Date |
|---|---|---|---|---|---|---|
| M1 | — | macOS | Safari | — | **not run** — no Mac available | — |
| M2 | iPhone, 393×852 @3, 4 cores | iOS 26.5.2 | **Safari 26.5.2** (`Version/26.5.2`, no shell token) | `0c6181a0…` / `9c0f8603…` | **PASS** (12.8 s) | 2026-08-04 |
| M2′ | the same iPhone | iOS 26.5.2 | Chrome for iOS (CriOS 150.0.7871.113) — WebKit/JSC, not Safari | `0c6181a0…` / `9c0f8603…` | **PASS** (14.0 s) | 2026-08-04 |
| M3 | 412×915 @2.625, 8 cores / 8 GB | Android 10 | Chrome 150.0.0.0 | `0c6181a0…` / `9c0f8603…` | **PASS** (264.6 s) | 2026-08-04 |

### What M2 and M3 establish, and what M1 leaving empty still costs

**M2 is the important one, and it is now genuinely Safari.** The user agent
carries `Version/26.5.2 … Safari/604.1` and no vendor shell token; the browsers
that are not Safari announce themselves in that string — `CriOS`, `FxiOS`,
`EdgiOS` — and drop the `Version/` token when they do. So this row is Apple's
own browser, Apple's own WebKit build, on Apple hardware, and it agreed with the
manifests exactly. **The requirement M2 was written to test is met.**

*Two reporting notes, neither a finding:*

- The block reports `iPhone OS 18_7` where the earlier run on this same device
  reported `26_5_2`. The device did not change — same 4 cores, same 393×852 @3
  screen, eighteen minutes apart. Safari freezes the platform token in its user
  agent; the authoritative version here is `Version/26.5.2`, and the OS version
  in the table comes from the CriOS run, which reports it honestly. Nothing about
  the platform token affects a hash.
- Both blocks are kept. The M2′ block below the main one is the earlier
  Chrome-for-iOS run, superseded as M2's evidence but left standing: two
  different browser builds over the same JavaScriptCore produced the same two
  digests, which is a small piece of evidence in its own right and costs nothing
  to keep.

**M3 adds real hardware and an Arm mobile thermal profile.** It does not broaden
engine coverage: Android Chrome is V8, already the best-covered engine here via
the Node leg on three OSes plus three chromium cells. M3 says V8-on-Arm agrees
with V8-on-x86-64.

*Timing note, not a finding:* M3 took 264.6 s against 28.0 s for the same device
on an earlier build, while the phone ran M2 in 12.8 s. Nothing between those
builds touches the verification page, so this is almost certainly thermal
throttling or background contention on the handset. The hashes matched exactly,
which is what the cell is for.

**What remains.** M1 — real Safari on macOS — is still unrun, and no Mac is
available. Its residual is now narrower than it has ever been, and it is worth
being exact about what is left rather than waving at it:

| Covered by | What it establishes |
|---|---|
| M2 | Apple's shipping Safari, Apple's WebKit build, Apple's JavaScriptCore, Apple silicon |
| `macos-latest` webkit cell | WebKit source lineage on macOS — but Playwright's build, not Apple's |
| M3, Node, chromium cells | V8 on Arm and x86-64, three OSes |

What no row covers is **desktop** Safari specifically: a different build
configuration from the iOS one, JIT tiers that are free to differ on a machine
with no thermal or memory ceiling, and a desktop-class Mac. Every ingredient of
that residual is a *tier* question rather than an *engine* question — and JIT
tiering is exactly the mechanism by which an engine could produce two different
answers for the same arithmetic, so it is not a residual to dismiss on the
grounds that the engine is now covered.

It is, though, a much smaller thing to weigh than it was before M2 ran.
**Whether ADR-0001 may be promoted on it is a judgement call, not a fact**, and
R1 as written asks for M1–M3. Amending R1 — on the record, with the reasoning
that M2 now discharges the JavaScriptCore question and desktop Safari is a
tiering residual the project accepts — is a legitimate decision. Making it
quietly, by declaring the criteria met while the row is blank, is the failure
that ADR opens by refusing to commit. Either the criterion changes on the
record, or the row gets filled.

Filling it needs no code and about a minute on any borrowed Mac:
<https://gjstockham.github.io/traveller-mainworld/verify.html>.

## If a cell fails

1. Record it here in full, including the first divergent case, its index and
   both hashes. The page and the Playwright failure both name them.
2. Do not adjust the comparison, the sample count, the battery or the fixture
   set to make it pass. `QUICK_BATTERY` and `QUICK_FIXTURES` produce hashes that
   are meaningless against the manifests; the matrix asserts neither was used,
   and the fixture comparison refuses outright when the grid size does not match
   the one the manifest was written at.
3. If the divergence is real, Spike A is answered: WASM kernel, on correctness
   grounds (spike plan §A.3), and WP6 writes it up that way.
4. If it is an artefact of the harness — a stale build, an old manifest, a
   version mismatch — the page says so explicitly rather than reporting a hash
   difference.
