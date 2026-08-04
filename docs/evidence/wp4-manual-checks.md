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
**Fixture set:** `3ed32303b19de99ab3d80f17f46488579c78f3846c3928772f1aa511713dba50`
**Fixture digest:** `9843cdd31cf52ced1862d927638ff5e1eaf338c4cdcfa9757cca0c61bee5033d`

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
digests throughout. What remains unmeasured is what it always was: real Safari,
real iOS, real Android — M1–M3 below.

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
NOT RUN — iOS Safari. Not tested; expected to pass, on the reasoning that it is
the same JavaScriptCore family as M1 and that no divergence has been seen
anywhere. That expectation is not evidence, and this file does not record it as
any.
```

<!-- M3 -->
```
result          PASS
generator       0.1.0
manifest        0.1.0 (digest 0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7)
battery         full — 21 cases
battery digest  0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7
fixture set     3ed32303b19de99ab3d80f17f46488579c78f3846c3928772f1aa511713dba50 (manifest 3ed32303b19de99ab3d80f17f46488579c78f3846c3928772f1aa511713dba50)
fixtures        full — 10 worlds
fixture digest  9843cdd31cf52ced1862d927638ff5e1eaf338c4cdcfa9757cca0c61bee5033d (expected 9843cdd31cf52ced1862d927638ff5e1eaf338c4cdcfa9757cca0c61bee5033d)
duration        28.0 s across 4 worker(s)
user agent      Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36
hardware        cores 8, memory 8 GB
screen          412×915 @ 2.625
run at          2026-08-04T09:14:34.937Z
build           d65a07a85629aa0b1295bff91cc0bd09d025841f
```

| # | Device | OS | Browser | Digest | Result | Date |
|---|---|---|---|---|---|---|
| M1 | — | macOS | Safari | — | **not run** — no Mac available | — |
| M2 | — | iOS | Safari | — | **not run** — untested by choice | — |
| M3 | 412×915 @2.625, 8 cores / 8 GB | Android 10 | Chrome 150.0.0.0 | `0c6181a0…` / `9843cdd3…` | **PASS** (28.0 s) | 2026-08-04 |

### What M3 adds, and what M1 and M2 leaving empty costs

**M3 adds real hardware and a real mobile thermal profile on Arm**, from a build
whose commit it names (`d65a07a…`). That is the first result from an actual
device rather than a CI runner, and the first from an Arm CPU.

It does **not** broaden engine coverage. Android Chrome is V8, and V8 was
already the best-covered engine here — the Node reference leg on three OSes plus
three chromium cells. M3 says V8 on Arm agrees with V8 on x86-64, which is worth
knowing and is not the question M1–M3 were written to answer.

**The question they were written to answer is still open.** M1 and M2 are both
JavaScriptCore, and with both unrun **no real JavaScriptCore has ever executed
this battery**. The only WebKit results anywhere in this file come from
Playwright's build, and the whole reason these three rows exist is that
Playwright's WebKit is not Safari: different build configuration, different JIT
tiers, different release cadence, and Apple ships the only WebKit anyone
actually browses with. The engine with the weakest stand-in is the engine with
no real-hardware coverage at all.

So the position is: eleven of twelve automated cells' worth of confidence, one
real device, and a deliberate, recorded gap over Safari. Development continues
on that basis. **ADR-0001 stays Provisional** — its R1 is not discharged, and
promoting it would mean citing evidence that does not exist, which is the
specific failure that ADR was written to avoid.

Closing it later is cheap and needs no code: the page is live at
<https://gjstockham.github.io/traveller-mainworld/verify.html>, so M2 is about a
minute on any iPhone and M1 a minute on any borrowed Mac. Paste the block, fill
the row, and R1 is discharged.

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
