/**
 * Share URLs (PRD R4, R27).
 *
 * `?upp=C867A69-8&seed=42&gen=0.2.0-alpha.4&ruleset=cepheus-1`. Opening one
 * reproduces the exact world; the camera is a separate optional parameter, so a
 * URL without it still works, which is what "nice-to-have" in R27 has to mean in
 * practice — a link pasted into campaign notes should not carry a viewpoint
 * somebody happened to be at.
 *
 * Every function here is pure and takes a `URLSearchParams`, so the whole of
 * R27 is testable without a browser. That matters more than usual: success
 * criterion §9.5 is *a share URL opened on a second machine reproduces the
 * identical world*, and the part of that which can be checked here is that the
 * URL says everything the world depends on.
 *
 * ## The four parameters are not four of a kind
 *
 * - **`upp`** and **`seed`** are the world. Between them they decide every
 *   generated value.
 * - **`ruleset`** decides how the UPP is read. It is a promise to a URL somebody
 *   else is holding, which is why a table change mints `cepheus-2` rather than
 *   editing `cepheus-1` in place — see the README. An unknown id fails loudly.
 * - **`gen`** decides which generator produced it, and is resolved through
 *   `core`'s `generatorFor(version)` registry (R15). That registry has one
 *   entry, deliberately: nothing has been released, so no user can be holding a
 *   0.1.0 URL and 0.1.0's implementation was archived rather than retained. A
 *   `gen` the registry does not know is **refused by name** rather than
 *   silently rendered with the current generator, which is the failure R15
 *   exists to prevent and the more dangerous half of it: a world that looks
 *   plausible and is not the one the link promised.
 *
 * `camera`, `sun` and `exaggeration` are presentation. They cannot move a
 * generated value, and a URL missing all three is complete.
 */
import {
  DEFAULT_RULESET,
  GEN_VERSION,
  knownGeneratorVersions,
  requireRuleset,
} from '@traveller-mainworld/core';

import { type SunDirection, formatSun } from '../render/sun.js';

/** Where the camera is, in the same units the UI shows. */
export interface CameraPose {
  /** Degrees around the equator from `+z`, increasing toward `+x`. */
  readonly azimuthDeg: number;
  /** Degrees above the equatorial plane. */
  readonly elevationDeg: number;
  /** Height above the surface, in kilometres — an absolute, so it survives a world change. */
  readonly altitudeKm: number;
}

/**
 * Everything a share URL carries.
 *
 * A discriminated pair rather than an optional-everything bag: a fixture world
 * has no UPP and no seed of its own to share (the seed is part of what the
 * golden manifest pins, which is why `?fixture=` refuses `?seed=`), and a UPP
 * world has no fixture id. Modelling that here means `buildShareUrl` cannot
 * emit the combination the loader would refuse.
 */
export type ShareWorld =
  | { readonly kind: 'upp'; readonly upp: string; readonly seedText: string; readonly rulesetId: string }
  | { readonly kind: 'fixture'; readonly fixtureId: string };

export interface ShareState {
  readonly world: ShareWorld;
  readonly genVersion: string;
  /** Omitted from the URL when absent, which is the point of it being optional. */
  readonly camera?: CameraPose;
  readonly sun?: SunDirection;
  /** Emitted only when it is not 1, so an ordinary link stays short and true-scale. */
  readonly exaggeration?: number;
}

/**
 * Build the query string for a state, in a fixed parameter order.
 *
 * Fixed order so two links to the same world are the same string — which is
 * what makes "I already have this one" answerable by eye, and what stops a
 * `history.replaceState` from churning the address bar on every frame.
 */
export function buildShareQuery(state: ShareState): string {
  const params = new URLSearchParams();

  if (state.world.kind === 'upp') {
    params.set('upp', state.world.upp);
    params.set('seed', state.world.seedText);
    params.set('gen', state.genVersion);
    params.set('ruleset', state.world.rulesetId);
  } else {
    params.set('fixture', state.world.fixtureId);
    params.set('gen', state.genVersion);
  }

  if (state.camera !== undefined) {
    params.set('cam', formatCamera(state.camera));
  }
  if (state.sun !== undefined) {
    params.set('sun', formatSun(state.sun));
  }
  if (state.exaggeration !== undefined && state.exaggeration !== 1) {
    params.set('exaggeration', String(state.exaggeration));
  }

  return `?${params.toString()}`;
}

/** Absolute share link, given the page's own origin and path. */
export function buildShareUrl(base: string, state: ShareState): string {
  const url = new URL(base);
  url.search = buildShareQuery(state);
  url.hash = '';
  return url.toString();
}

/** The `?cam=` spelling: `azimuth,elevation,altitudeKm`. */
export function formatCamera(pose: CameraPose): string {
  return `${round(pose.azimuthDeg, 1)},${round(pose.elevationDeg, 1)},${round(pose.altitudeKm, 1)}`;
}

function round(n: number, places: number): string {
  const scale = Math.pow(10, places);
  return String(Math.round(n * scale) / scale);
}

/**
 * Read `?cam=`, or `undefined` when it is absent.
 *
 * Refused rather than ignored when malformed, matching every other parameter in
 * this viewer. It is presentation, so refusing costs a reload — but a camera
 * parameter that is quietly dropped is indistinguishable from one that worked,
 * and the person who notices is the one comparing two screenshots.
 */
export function cameraFrom(params: URLSearchParams): CameraPose | undefined {
  const raw = params.get('cam');
  if (raw === null) {
    return undefined;
  }

  const parts = raw.split(',');
  if (parts.length !== 3) {
    throw new Error(
      `?cam=${raw} is not 'azimuth,elevation,altitudeKm', e.g. ?cam=45,20,15000`,
    );
  }
  const [azimuthDeg, elevationDeg, altitudeKm] = parts.map(Number) as [number, number, number];
  if (![azimuthDeg, elevationDeg, altitudeKm].every((n) => Number.isFinite(n))) {
    throw new Error(`?cam=${raw} has a non-numeric component, e.g. ?cam=45,20,15000`);
  }
  if (altitudeKm <= 0) {
    throw new Error(`?cam=${raw} has altitude ${String(altitudeKm)} km; it must be above the surface`);
  }

  return { azimuthDeg, elevationDeg, altitudeKm };
}

/**
 * Resolve `?gen=` against the versions this build can render.
 *
 * A **lookup** since WP14, where it used to be an equality test against
 * `GEN_VERSION` with a comment saying the registry was coming. The registry is
 * `generatorFor` in `core`, and this is the call site that makes it a seam that
 * is exercised rather than one that is merely present — ADR-0001's lesson, and
 * the reason the refusal below now names every version the build has rather
 * than only the current one.
 *
 * What did not change is the refusal itself. There is one entry, so an unknown
 * `?gen=` is still an error rather than a fallback, and it must stay one: a
 * link that opens and renders *a different world at the same address* is the
 * failure R15 exists to prevent, and it is far worse than a link that says it
 * cannot be opened. When a second entry lands, this function starts returning
 * something other than the current version and the caller has to resolve it
 * through `generatorFor` rather than assuming — which is why it returns the
 * version rather than a boolean.
 *
 * @param known Defaults to the registry. Passed explicitly by the tests, so
 *              they do not go quiet the moment the version is bumped — a
 *              version check whose test pins the same constant it checks is a
 *              test of one string against itself.
 */
export function checkGenVersion(
  params: URLSearchParams,
  known: readonly string[] = knownGeneratorVersions(),
): string {
  const current = known[0] ?? GEN_VERSION;
  const asked = params.get('gen');
  if (asked === null) {
    return current;
  }
  if (known.includes(asked)) {
    return asked;
  }
  throw new Error(
    `?gen=${asked} asks for generator version ${asked}, and this build produces: ` +
      `${known.join(', ')}. Rendering it with a different generator would show a world that is ` +
      'not the one the link promised, so it is refused instead. Nothing has been released ' +
      '(PRD §7), so no share URL of an earlier version should exist — see PRD R15 and ' +
      '`packages/golden/archive/` for what earlier versions produced.',
  );
}

/**
 * Resolve `?ruleset=`, defaulting to `cepheus-1`.
 *
 * `requireRuleset` already fails loudly on an unknown id and names the ones
 * that exist; this wrapper is here so the default lives in one place rather
 * than at every call site.
 */
export function rulesetIdFrom(params: URLSearchParams): string {
  const asked = params.get('ruleset');
  if (asked === null) {
    return DEFAULT_RULESET.id;
  }
  return requireRuleset(asked).id;
}
