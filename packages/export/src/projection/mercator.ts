/**
 * Mercator (R23), with the clip latitude as a parameter rather than a constant.
 *
 * ## `Math.log` and `Math.tan` are fine here, and this is the paragraph that says so
 *
 * Mercator's inverse is `lat = 2·atan(exp(y)) − π/2` and its forward is
 * `y = ln(tan(π/4 + lat/2))`. Both are transcendental, and the kernel op
 * whitelist bans transcendentals outright.
 *
 * **The whitelist does not govern this file.** It governs
 * `packages/core/src/kernel`, because everything that comes out of there reaches
 * a golden hash and a transcendental is not bit-identical across JS engines. A
 * projection reaches no hash: it decides *which directions to sample*, and the
 * sampling that follows goes through `sampleSurface` and comes back identical
 * whichever route asked for it. If `Math.exp` differs in the last bit between
 * two browsers, this file picks a sample a picometre away from the one the other
 * browser picked — which is a different question from whether the world is the
 * same world, and the answer to that one is still yes.
 *
 * So: `Math.log`, `Math.exp`, `Math.tan` and `Math.atan` directly, and **do not
 * add an approximation of them to `kernel/approx.ts` on this file's account.**
 * That is the expensive version of the mistake: it puts a new approximation, a
 * new accuracy fixture and a new WASM-parity obligation into the hashed zone to
 * satisfy a rule that never applied out here. `core/palette` carries the same
 * paragraph for the same reason, and the README has the general form of it.
 *
 * ## The clip
 *
 * Mercator's `y` runs to infinity at the poles, so every Mercator map clips. The
 * default is the Web Mercator convention, `±85.0511287798°`, which is the
 * latitude at which `y` reaches exactly `±π` and the world becomes a square.
 * That is a *convention*, not a fact about the projection, so it is a parameter
 * and it is printed in the title block — a map that silently loses the poles is
 * a map somebody will misread, and a map that loses them at a latitude nobody
 * wrote down is worse.
 *
 * A clip below the convention leaves the polar caps outside the projected world,
 * and {@link Projection.pixelToGeographic} says so by returning `false` rather
 * than clamping. Clamping would paint the clip latitude's terrain across the
 * whole cap and present it as the pole, which is the failure the clip exists to
 * avoid, dressed as a feature.
 */
import { DEG, HALF_PI, TWO_PI, latitudeBandBounds } from '../geography.js';
import type { ImageSize } from '../size.js';
import type { Projection } from './projection.js';

/** The registry id. */
export const MERCATOR_ID = 'mercator';

/**
 * The Web Mercator clip, in degrees: the latitude at which `y` reaches `±π`.
 *
 * `2·atan(e^π) − π/2`, which is where a Mercator world becomes exactly square.
 * Written out rather than computed so the number in the title block is the
 * number in the source.
 */
export const WEB_MERCATOR_CLIP_DEG = 85.0511287798066;

/** Beyond this the projected height per degree of latitude is absurd and `y` overflows meaning. */
const MAX_CLIP_DEG = 89.9;
/** Below this there is not enough map left to be a map. */
const MIN_CLIP_DEG = 5;

/** Mercator's forward vertical coordinate: `ln(tan(π/4 + lat/2))`. */
export function mercatorY(latRad: number): number {
  return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

/** Mercator's inverse vertical coordinate: `2·atan(e^y) − π/2`. */
export function mercatorLatitude(y: number): number {
  return 2 * Math.atan(Math.exp(y)) - HALF_PI;
}

class Mercator implements Projection {
  readonly id = MERCATOR_ID;
  readonly name = 'Mercator';

  /** `mercatorY` of the clip latitude: the half-height of the projected world. */
  private readonly yMax: number;

  constructor(readonly clipDeg: number) {
    if (!(clipDeg >= MIN_CLIP_DEG && clipDeg <= MAX_CLIP_DEG)) {
      throw new RangeError(
        `Mercator clip ${String(clipDeg)}° is outside ${String(MIN_CLIP_DEG)}..` +
          `${String(MAX_CLIP_DEG)}°. The default is the Web Mercator convention, ` +
          `${String(WEB_MERCATOR_CLIP_DEG)}°, where the world becomes square.`,
      );
    }
    this.yMax = mercatorY(clipDeg * DEG);
  }

  parameterLines(): readonly string[] {
    const note =
      this.clipDeg === WEB_MERCATOR_CLIP_DEG ? ' (Web Mercator convention)' : ' (non-default)';
    return [`clipped at +/-${this.clipDeg.toFixed(4)} deg${note}; the poles are not on this map`];
  }

  finestSpacingRad(size: ImageSize): number {
    // Mercator is conformal, so at any point its two axes have the same scale;
    // the scale is finest at the equator, where a horizontal texel is 2π/width
    // of arc and a vertical one is (2·yMax/height) — `y` and latitude share a
    // derivative of 1 there.
    return Math.min(TWO_PI / size.width, (2 * this.yMax) / size.height);
  }

  pixelToGeographic(size: ImageSize, px: number, py: number, out: Float64Array): boolean {
    const y = this.yMax - ((py + 0.5) / size.height) * (2 * this.yMax);
    // The pixel-centre grid puts every row strictly inside the clip, so this
    // guard fires only for a caller passing a row outside the image. Kept
    // because "outside the projected world" is a state the interface promises
    // and an unreachable state that is nonetheless checked is cheaper than a
    // silently wrapped latitude.
    if (y > this.yMax || y < -this.yMax) {
      return false;
    }
    out[0] = mercatorLatitude(y);
    out[1] = ((px + 0.5) / size.width) * TWO_PI - Math.PI;
    return true;
  }

  rowBandBounds(size: ImageSize, row0: number, rows: number, out: Float64Array): void {
    const edge = (py: number): number =>
      mercatorLatitude(this.yMax - (py / size.height) * (2 * this.yMax));
    latitudeBandBounds(edge(row0 + rows), edge(row0), out);
  }
}

/**
 * The Mercator projection at a given clip latitude.
 *
 * @param clipDeg Latitude beyond which the map is not drawn. Defaults to
 *                {@link WEB_MERCATOR_CLIP_DEG}.
 */
export function mercator(clipDeg: number = WEB_MERCATOR_CLIP_DEG): Projection {
  return new Mercator(clipDeg);
}
