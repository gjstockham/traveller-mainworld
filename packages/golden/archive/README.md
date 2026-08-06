# Archived manifests

What earlier generator versions produced, kept as a labelled artefact rather
than deleted (Phase 1 plan §9.5).

| File | `genVersion` | Fixture set | Digest | Taken from |
|---|---|---|---|---|
| `manifest-0.1.0.json` | `0.1.0` | — | `0c6181a006c94e61…` | `8464827`, the last commit before the Phase 1 prereleases |
| `fixtures-0.1.0.json` | `0.1.0` | `289a78e59ada7f5b…` | `9c0f860316158247…` | the same commit |

## Why these are here and the code path is not

PRD R15 obliges the app to render worlds from every generator version it has
ever emitted. Nothing has been released — §7's release policy is that nothing
ships before Phase 5 — so **no user can be holding a `0.1.0` share URL**, and
retaining `0.1.0`'s implementation would mean carrying a second kernel to serve
nobody. WP14 built the *seam* instead: `generatorFor(version)` in
`packages/core/src/generators.ts`, with one entry and a test that an unknown
version fails loudly rather than silently rendering the current one.

These two files cost nothing and are the only surviving record of what Phase 0
produced. They are **not** verified by CI and cannot be: `golden:verify` runs
the code in this tree, which is `0.2.0`, and comparing it against a `0.1.0`
manifest is the mismatch the preflight check exists to refuse. Reading a hash
here as evidence about this build would be reading it backwards.

The fixture set they pin (`289a78e5…`) is the hand-written Phase 0 one, whose
specs were written out by hand and whose fBm columns were overridden after
interpretation. WP14 replaced it with ten worlds interpreted wholly from UPPs;
see `CHANGELOG.md` under `0.2.0`.
