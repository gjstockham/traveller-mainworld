/**
 * Golden-hash harness (PRD R16).
 *
 * Two artefacts, deliberately separate (see `fixtureManifest.ts`):
 *
 * - the **determinism battery** (WP1) — kernel functions over hostile inputs,
 *   recorded in `manifest.json`, keyed on `genVersion`;
 * - the **golden fixtures** (WP7) — whole worlds through the shipping
 *   `TileGenerator`, recorded in `fixtures.json`, keyed on `genVersion` *and* a
 *   fixture-spec hash.
 *
 * WP4 runs both across the browser/OS matrix; WP7 wires them into CI
 * permanently with the change protocol.
 *
 * Everything exported here is platform-neutral. The one Node-dependent module
 * lives behind the `./node` subpath, and `scripts/check-browser-battery.mjs`
 * fails the lint if anything on the verification page's graph reaches it.
 */
export * from './adversarial.js';
export * from './battery.js';
export * from './changelog.js';
export * from './fixtureManifest.js';
export * from './fixtures.js';
export * from './kernelApi.js';
export * from './manifest.js';
export * from './parity.js';
