/**
 * Generator version, embedded in share URLs, exports and golden hashes (PRD R14).
 *
 * Any change that alters generated output for any input must bump this in the
 * same commit as the regenerated golden manifest — see the change protocol in
 * `CHANGELOG.md`, which is the copy of it that is in version control.
 *
 * ## Why this is its own module
 *
 * It was a `const` at the top of `index.ts` until WP14, and `generators.ts`
 * needs it: a registry keyed on the version, imported by the barrel that
 * defines the version, is a cycle. One module holding one string breaks it,
 * and puts the identity somewhere that can be imported without pulling in the
 * kernel.
 *
 * ## What the prerelease was, and why it is gone
 *
 * WP10 through WP13 ran on `0.2.0-alpha.1` … `-alpha.4`. Phase 1's plan assigns
 * `0.2.0` to WP14, at the end, and that was right for the final state and wrong
 * for the six sessions in between: those work packages changed generated output
 * many times over, `golden:update` refuses to regenerate a manifest while this
 * string is unchanged (which is the gate working), and bumping
 * `0.2.0 → 0.2.1 → 0.2.2` per commit would have minted a string of versions that
 * never existed for anyone. Prerelease identifiers instead, bumped once per
 * re-pin rather than once per commit, with a tag that says plainly the version
 * was never emitted to a user.
 *
 * `0.2.0` is that sequence landing. It is not a fifth alpha with a shorter
 * name: **it is the first version that will be treated as immutable**, because
 * from here `generatorFor` is what an old share URL resolves through, and a
 * version that gets re-cut under the same name is the failure R15 exists to
 * prevent. Between here and the next release, output changes cost a real
 * version number.
 */
export const GEN_VERSION = '0.2.0';
