# WP4 — cross-platform hash evidence

**Work package:** WP4 (implementation plan §3), Spike A §A.2.7
**Consumed by:** ADR-0001 (kernel decision, WP6) and PRD §9.1

Spike A asks one question: does the pure-TypeScript kernel produce bit-identical
`Float64` output on every target engine and OS? This file is where the answer is
recorded — both halves of it.

The bar is exact equality against `packages/golden/manifest.json`. Every cell
runs the **full** battery (21 cases, ≥10⁶ hostile inputs each) and compares
every case hash plus the overall digest.

**Generator version:** 0.1.0
**Manifest digest:** `0c6181a006c94e6173d93e842a77736015f7ccf49cdb6a3abf707ad47f08bdf7`

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
done here (open question 5 in the implementation plan §10). **ADR-0001 must say
which evidence it relied on** — one-platform TS↔WASM parity, plus a
nine-cell TS matrix.

It does, in its §"What the evidence does not cover — and which of it this
decision relied on", including the fact that three of the nine cells had run
when it was written.

## Automated: CI matrix

`browser-matrix` in `.github/workflows/ci.yml` — chromium, firefox and webkit ×
ubuntu, macos and windows, plus the Node reference run in the `test` job on the
same three OSes. Each cell prints its evidence block to the log and uploads it
as an artifact (`battery-<os>-<browser>`).

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
| 2026-08-03 | Local, Ubuntu 24.04 on WSL2 (kernel 6.18) | Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5 | **PASS** — digest `0c6181a0…` in all three |
| | GitHub Actions, ubuntu-latest | chromium / firefox / webkit | _pending first CI run_ |
| | GitHub Actions, macos-latest | chromium / firefox / webkit | _pending first CI run_ |
| | GitHub Actions, windows-latest | chromium / firefox / webkit | _pending first CI run_ |

## Manual: real Safari, iOS and Android

**Not optional** (spike plan risk table, implementation plan §3 WP4). Playwright's
WebKit is not Safari: different build configuration, different JIT tiers,
different release cadence, and Apple ships the only WebKit that anyone's browser
actually runs. iOS Safari and Android Chrome are likewise not their desktop
namesakes.

### Serving the page

```sh
pnpm golden:page      # builds and serves packages/golden/verify.html on :4174,
                      # bound to every interface so a phone on the LAN can reach it
```

Then open `http://<this machine's LAN IP>:4174/verify.html` on the device. The
build in `packages/golden/dist-web/` is a static, self-contained page — copying
it to any static host or a USB stick works equally well, and is the easier route
to a borrowed Mac.

The run takes a minute or two, and the tab must stay in the foreground (a
backgrounded tab gets throttled, and on iOS may be discarded outright). Then
press **Copy evidence** and paste the block into the table below.

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
(not yet run — real Safari on macOS)
```

<!-- M2 -->
```
(not yet run — iOS Safari)
```

<!-- M3 -->
```
(not yet run — Android Chrome)
```

| # | Device | OS | Browser | Digest | Result | Date |
|---|---|---|---|---|---|---|
| M1 | | | | | | |
| M2 | | | | | | |
| M3 | | | | | | |

## If a cell fails

1. Record it here in full, including the first divergent case, its index and
   both hashes. The page and the Playwright failure both name them.
2. Do not adjust the comparison, the sample count or the battery to make it
   pass. `QUICK_BATTERY` in particular produces hashes that are meaningless
   against the manifest; the matrix asserts it was not used.
3. If the divergence is real, Spike A is answered: WASM kernel, on correctness
   grounds (spike plan §A.3), and WP6 writes it up that way.
4. If it is an artefact of the harness — a stale build, an old manifest, a
   version mismatch — the page says so explicitly rather than reporting a hash
   difference.
