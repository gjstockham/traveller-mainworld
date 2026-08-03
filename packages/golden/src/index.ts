/**
 * Golden-hash harness (PRD R16).
 *
 * WP1 provides the determinism battery and its manifest. WP4 runs it across
 * the browser/OS matrix, WP7 wires it into CI permanently with the change
 * protocol.
 */
export * from './adversarial.js';
export * from './battery.js';
export * from './manifest.js';
