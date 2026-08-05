/**
 * The sun's direction (PRD R20, and R19's vacuum case).
 *
 * One directional light and no shadow maps. Across a streaming LOD tile set a
 * shadow map is a phase of its own — the cascade would have to follow the same
 * quadtree the tiles do — and Phase 1 does not need one: on an airless world
 * the terminator and self-shading carry the whole look, which is why R19's
 * answer for Atmo 0–1 is "no scattering" rather than "cheap scattering".
 *
 * Direction is held as azimuth and elevation rather than a vector, because that
 * is what a control has to move and what a URL has to carry. The convention
 * matches `OrbitCamera`'s: `+y` is the north pole, elevation is degrees above
 * the equatorial plane, azimuth is degrees around it from `+z`.
 *
 * **This is presentation.** Moving the sun cannot change a single generated
 * value, which is why it travels in the URL beside the camera rather than
 * beside the UPP: `?sun=` is part of what you are looking at, not part of what
 * the world *is*. `Math.sin` here is unremarkable for the same reason it is in
 * `core/palette` — no value in this file can reach a hash.
 */

export interface SunDirection {
  /** Degrees around the equator from `+z`, increasing toward `+x`. */
  readonly azimuthDeg: number;
  /** Degrees above the equatorial plane. Clamped to ±89 to keep a terminator. */
  readonly elevationDeg: number;
}

/**
 * A low morning sun, because that is what makes a crater legible.
 *
 * At high sun a cratered surface reads as flat albedo — which is exactly what
 * every Apollo full-moon photograph looks like, and exactly what this project
 * spent WP10 and WP11 building something better than. Low sun throws the rim
 * shadows that make relief visible, and it is the framing every published
 * image of Luna's terminator uses for the same reason.
 */
export const DEFAULT_SUN: SunDirection = { azimuthDeg: 60, elevationDeg: 15 };

/**
 * Elevation clamp.
 *
 * At exactly ±90° the sun is over a pole, the terminator degenerates to the
 * limb and half the point of the lighting model disappears. Clamping is kinder
 * than refusing: a slider dragged to its end should stop, not error.
 */
const MAX_ELEVATION = 89;

export function clampSun(dir: SunDirection): SunDirection {
  return {
    azimuthDeg: wrapDegrees(dir.azimuthDeg),
    elevationDeg: Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, dir.elevationDeg)),
  };
}

/** Azimuth into `[0, 360)`, so a control that spins past the end comes back round. */
function wrapDegrees(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Unit vector from the planet's centre toward the sun. */
export function sunVector(dir: SunDirection): { x: number; y: number; z: number } {
  const { azimuthDeg, elevationDeg } = clampSun(dir);
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return { x: cosEl * Math.sin(az), y: Math.sin(el), z: cosEl * Math.cos(az) };
}

/** The `?sun=` spelling: `azimuth,elevation` in degrees. */
export function formatSun(dir: SunDirection): string {
  const { azimuthDeg, elevationDeg } = clampSun(dir);
  return `${round1(azimuthDeg)},${round1(elevationDeg)}`;
}

function round1(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * Read `?sun=az,el`, or the default when it is absent.
 *
 * Refused rather than ignored when malformed, matching `?exaggeration=` and
 * `?fixture=`. A silently-dropped parameter is how somebody records a
 * screenshot believing the sun was where they asked for it.
 */
export function sunFrom(params: URLSearchParams): SunDirection {
  const raw = params.get('sun');
  if (raw === null) {
    return DEFAULT_SUN;
  }

  const parts = raw.split(',');
  if (parts.length !== 2) {
    throw new Error(`?sun=${raw} is not 'azimuth,elevation' in degrees, e.g. ?sun=60,15`);
  }
  const azimuthDeg = Number(parts[0]);
  const elevationDeg = Number(parts[1]);
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(elevationDeg)) {
    throw new Error(`?sun=${raw} has a non-numeric component. Expected degrees, e.g. ?sun=60,15`);
  }

  return clampSun({ azimuthDeg, elevationDeg });
}
