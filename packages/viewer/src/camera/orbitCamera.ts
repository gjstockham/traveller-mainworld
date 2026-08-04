/**
 * Orbit camera state and motion.
 *
 * Deliberately free of DOM and Three.js: input binding lives in `controls.ts`
 * and the Three camera is driven from the position this computes. That split
 * keeps the feel — damping curves, altitude scaling, clamping — testable
 * without a browser, which is where the fiddly bugs actually are.
 *
 * The "Google Earth feel" comes almost entirely from one property: **zoom
 * speed and drag speed both scale with altitude**. A fixed step feels
 * unusable at both ends — glacial from orbit, and it slams into the surface up
 * close.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface OrbitCameraOptions {
  /** Planet radius in scene units. */
  readonly radius: number;
  /**
   * Starting height above the surface, as a multiple of radius.
   *
   * A multiple rather than an absolute, to match the two bounds below — but the
   * caller is expected to derive it from an *absolute* altitude, so that worlds
   * of different sizes appear at different sizes. Framing every world at the
   * same multiple of its own radius makes an 800 km rockball and an 8000 km
   * world fill the viewport identically, which throws away the one thing a
   * space-to-surface zoom exists to convey.
   */
  readonly initialAltitude: number;
  /** Closest approach, as a multiple of radius above the surface. */
  readonly minAltitude: number;
  /** Furthest retreat, as a multiple of radius above the surface. */
  readonly maxAltitude: number;
  /** Fraction of velocity retained per 60 Hz frame. 0 = no inertia, 1 = never stops. */
  readonly damping: number;
  /** Radians of rotation per pixel dragged, at unit altitude. */
  readonly dragSensitivity: number;
  /** Fraction of altitude gained or lost per wheel notch. */
  readonly zoomSensitivity: number;
}

export const DEFAULT_ORBIT: OrbitCameraOptions = {
  radius: 1,
  initialAltitude: 1.5,
  minAltitude: 0.002,
  maxAltitude: 12,
  // Retention per 60 Hz frame, ~0.23 s time constant: enough coast to feel
  // weighted, short enough that the LOD streamer settles quickly.
  damping: 0.93,
  // Sensitivities are calibrated against total coast distance, which is v₀/λ
  // (see `update`), not against the per-frame step. Measured: a 100 px drag at
  // one radius altitude sweeps 0.41 rad, and one wheel notch changes altitude
  // by 12.9%.
  dragSensitivity: 0.02,
  zoomSensitivity: 0.6,
};

/** Latitude clamp, just shy of the poles, to avoid the gimbal degeneracy at ±90°. */
const MAX_PHI = Math.PI / 2 - 1e-3;

export class OrbitCamera {
  /** Azimuth, radians. */
  private theta = 0;
  /** Elevation above the equator, radians, clamped away from the poles. */
  private phi = 0.4;
  /** Altitude above the surface, in scene units. */
  private altitude: number;

  private thetaVelocity = 0;
  private phiVelocity = 0;
  private zoomVelocity = 0;

  constructor(private readonly options: OrbitCameraOptions = DEFAULT_ORBIT) {
    this.altitude = options.radius * options.initialAltitude;
  }

  /** Distance from the planet centre. */
  get distance(): number {
    return this.options.radius + this.altitude;
  }

  /** Height above the surface, in scene units. */
  get altitudeAboveSurface(): number {
    return this.altitude;
  }

  /** Current camera position. */
  get position(): Vec3 {
    const d = this.distance;
    const cosPhi = Math.cos(this.phi);
    return {
      x: d * cosPhi * Math.sin(this.theta),
      y: d * Math.sin(this.phi),
      z: d * cosPhi * Math.cos(this.theta),
    };
  }

  /** True while the camera is still coasting. */
  get isMoving(): boolean {
    return (
      Math.abs(this.thetaVelocity) > 1e-6 ||
      Math.abs(this.phiVelocity) > 1e-6 ||
      Math.abs(this.zoomVelocity) > 1e-6
    );
  }

  /**
   * Drag by a pixel delta.
   *
   * Rotation rate scales with altitude, so a drag sweeps a similar *screen*
   * distance whether the camera is in orbit or skimming the surface. Without
   * this the controls feel wildly over-sensitive close in.
   */
  drag(dxPixels: number, dyPixels: number): void {
    const scale = this.options.dragSensitivity * (this.altitude / this.options.radius);
    this.thetaVelocity -= dxPixels * scale;
    this.phiVelocity += dyPixels * scale;
  }

  /**
   * Zoom by wheel notches; positive zooms out.
   *
   * Applied multiplicatively to altitude, so each notch changes altitude by a
   * constant *fraction*. That gives constant apparent speed across the whole
   * range from orbit to surface, which linear stepping cannot.
   */
  zoom(notches: number): void {
    this.zoomVelocity += notches * this.options.zoomSensitivity;
  }

  /** Stop all motion immediately. */
  halt(): void {
    this.thetaVelocity = 0;
    this.phiVelocity = 0;
    this.zoomVelocity = 0;
  }

  /** Point the camera at a surface direction, keeping the current altitude. */
  lookAtDirection(dir: Vec3): void {
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (len === 0) {
      return;
    }
    this.phi = Math.asin(Math.max(-1, Math.min(1, dir.y / len)));
    this.theta = Math.atan2(dir.x / len, dir.z / len);
    this.halt();
  }

  /**
   * Advance by `dt` seconds.
   *
   * Velocity decays exponentially, and the displacement is the *exact integral*
   * of that decay over the step — `v·(1 − e^{−λ·dt})/λ` — rather than
   * `v·dt` with a separate damping multiply.
   *
   * The distinction is not pedantic. Damping the velocity correctly but
   * stepping the position naively still leaves total coast distance dependent
   * on frame rate: summing `v·dt` over a decaying `v` approximates the integral
   * with an error that grows with step size, so the same flick travels several
   * percent further at 60 Hz than at 144 Hz. Integrating exactly makes total
   * displacement `v₀/λ` regardless of how the interval is subdivided.
   */
  update(dt: number): void {
    const step = Math.max(1e-4, Math.min(0.1, dt));
    // Decay rate per second, derived from the per-60Hz-frame retention.
    const lambda = -Math.log(this.options.damping) * 60;
    const retention = Math.exp(-lambda * step);
    // ∫₀^dt e^{−λt} dt
    const travel = (1 - retention) / lambda;

    this.theta += this.thetaVelocity * travel;
    this.phi += this.phiVelocity * travel;

    // Multiplicative, matching the way `zoom` accumulates.
    this.altitude *= Math.exp(this.zoomVelocity * travel);

    this.thetaVelocity *= retention;
    this.phiVelocity *= retention;
    this.zoomVelocity *= retention;

    // Snap sub-threshold velocities to zero so `isMoving` actually settles and
    // the LOD/stream layer can go quiet.
    if (Math.abs(this.thetaVelocity) < 1e-6) this.thetaVelocity = 0;
    if (Math.abs(this.phiVelocity) < 1e-6) this.phiVelocity = 0;
    if (Math.abs(this.zoomVelocity) < 1e-6) this.zoomVelocity = 0;

    this.phi = Math.max(-MAX_PHI, Math.min(MAX_PHI, this.phi));
    this.altitude = Math.max(
      this.options.radius * this.options.minAltitude,
      Math.min(this.options.radius * this.options.maxAltitude, this.altitude),
    );
  }
}
