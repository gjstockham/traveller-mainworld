# kernel-wasm — the archived kernel twin

**Status: archived, not maintained** — [ADR-0001](../../docs/adr/ADR-0001-generation-kernel.md).

This crate is `packages/core/src/kernel` written again in Rust. ADR-0001 selected
the TypeScript kernel, and the spike plan's risk table says the losing kernel is
archived rather than maintained, so nothing here is on the required CI path any
more.

Archived is not deleted, and the distinction is the whole point. The twin is the
only thing in the project that shows **two independent implementations agree**
rather than one implementation being self-consistently wrong. The golden manifest
proves the TypeScript kernel is *stable*; only a second implementation proves it
is *right*, because a bug would have to be reproduced independently in two
languages to survive the comparison. Delete this and that evidence cannot be
recovered — it would have to be re-derived by writing the kernel a third time.

## Running it

```sh
pnpm check:parity   # build the twin, run its Rust tests, compare both kernels
```

Needs Rust and `rustup target add wasm32-unknown-unknown`. In CI it is the
`WASM parity (archived twin)` workflow: `workflow_dispatch`, plus a monthly
schedule so drift is found by a calendar rather than by someone who needs the
twin in a hurry.

**Run it before acting on ADR-0001's revisit trigger**, and after any change
under `packages/core/src/kernel/**`. Because this crate is unmaintained it will
drift from the TypeScript kernel eventually; a failure here means "the twin is
stale", not necessarily "the kernel is wrong". Which of the two it is has to be
read from the diff, and that is the cost the ADR accepted.

## The three rules still apply

They hold while the crate exists, archived or not, and `pnpm lint:wasm` runs on
every commit in the `gate` job to enforce them:

| Rule | Why | Enforced by |
|---|---|---|
| Never enable `relaxed-simd` | Nondeterministic **by design** — its instructions may choose between fused and unfused multiply-add per implementation. Fixed-width `simd128` is fine. | `scripts/check-wasm-flags.mjs` |
| Never call Rust's libm (`sin`, `powf`, `mul_add`, …) | Deterministic *within* WASM, which is the trap: the twin must match the **TypeScript**, which evaluates polynomials. | `scripts/check-kernel-whitelist.mjs` |
| Never recompute `OCTAVE_ROTATIONS` | A committed generated artefact. Rust's `sin` is not V8's. | `scripts/gen-wasm-rotations.mjs --check` |

No `wasm-bindgen`, no `wasm-pack`: raw `cdylib` with `#[no_mangle] pub extern "C"`
exports over linear memory, because generated glue would sit between the source
and the float operations being judged. Ask before adding either.

`src/jsnum.rs` reproduces the JavaScript semantics Rust does not share: `x | 0`
wraps where `as i32` saturates, `Math.min`/`Math.max` order signed zeros and
propagate NaN where `f64::min`/`f64::max` do neither, and `f64::round` breaks ties
away from zero where `Math.round` breaks them toward +∞.
