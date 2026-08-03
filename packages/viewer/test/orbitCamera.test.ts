import { describe, expect, it } from 'vitest';

import { DEFAULT_ORBIT, OrbitCamera } from '../src/camera/orbitCamera.js';

const OPTS = { ...DEFAULT_ORBIT, radius: 1 };

/** Run the camera for `seconds` at 60 Hz. */
function settle(cam: OrbitCamera, seconds = 5): void {
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    cam.update(dt);
  }
}

describe('OrbitCamera', () => {
  it('starts outside the planet', () => {
    const cam = new OrbitCamera(OPTS);
    expect(cam.distance).toBeGreaterThan(OPTS.radius);
    const p = cam.position;
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(cam.distance, 10);
  });

  it('clamps altitude to its limits', () => {
    const cam = new OrbitCamera(OPTS);
    cam.zoom(-500);
    settle(cam, 10);
    expect(cam.altitudeAboveSurface).toBeGreaterThanOrEqual(OPTS.radius * OPTS.minAltitude - 1e-12);

    cam.zoom(500);
    settle(cam, 10);
    expect(cam.altitudeAboveSurface).toBeLessThanOrEqual(OPTS.radius * OPTS.maxAltitude + 1e-12);
  });

  it('never puts the camera inside the planet', () => {
    const cam = new OrbitCamera(OPTS);
    for (let i = 0; i < 400; i++) {
      cam.zoom(-3);
      cam.update(1 / 60);
      expect(cam.distance).toBeGreaterThan(OPTS.radius);
    }
  });

  it('clamps latitude short of the poles', () => {
    const cam = new OrbitCamera(OPTS);
    for (let i = 0; i < 200; i++) {
      cam.drag(0, 400);
      cam.update(1 / 60);
    }
    const p = cam.position;
    // Never exactly on the axis, where the orbit frame degenerates.
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(1e-6);
  });

  it('coasts and then stops', () => {
    const cam = new OrbitCamera(OPTS);
    cam.drag(100, 0);
    expect(cam.isMoving).toBe(true);
    settle(cam, 5);
    expect(cam.isMoving).toBe(false);
  });

  it('halt stops motion immediately', () => {
    const cam = new OrbitCamera(OPTS);
    cam.drag(100, 50);
    cam.zoom(3);
    cam.halt();
    expect(cam.isMoving).toBe(false);
  });

  it('SCALES ZOOM WITH ALTITUDE, so approach speed is constant in feel', () => {
    // The Google-Earth property. One notch must change altitude by the same
    // *fraction* whether in orbit or near the surface — a fixed step is
    // glacial from orbit and lethal up close.
    const fractionAt = (startAltitude: number): number => {
      const cam = new OrbitCamera(OPTS);
      while (cam.altitudeAboveSurface > startAltitude) {
        cam.zoom(-1);
        cam.update(1 / 60);
      }
      cam.halt();
      const before = cam.altitudeAboveSurface;
      cam.zoom(-1);
      cam.update(1 / 60);
      return (before - cam.altitudeAboveSurface) / before;
    };

    const high = fractionAt(5);
    const low = fractionAt(0.02);
    expect(high).toBeGreaterThan(0);
    // Same proportional change at both ends.
    expect(low).toBeCloseTo(high, 6);
  });

  it('scales drag with altitude too', () => {
    const angleMovedAt = (altitude: number): number => {
      const cam = new OrbitCamera(OPTS);
      while (cam.altitudeAboveSurface > altitude) {
        cam.zoom(-1);
        cam.update(1 / 60);
      }
      cam.halt();
      const before = cam.position;
      cam.drag(50, 0);
      cam.update(1 / 60);
      const after = cam.position;
      const dot =
        (before.x * after.x + before.y * after.y + before.z * after.z) /
        (Math.hypot(before.x, before.y, before.z) * Math.hypot(after.x, after.y, after.z));
      return Math.acos(Math.max(-1, Math.min(1, dot)));
    };
    // Closer in, the same pixel drag should sweep a smaller angle.
    expect(angleMovedAt(0.05)).toBeLessThan(angleMovedAt(2));
  });

  it('IS FRAME-RATE INDEPENDENT', () => {
    // A raw per-frame damping multiply makes the camera coast further on a
    // 144 Hz display than a 60 Hz one — the same gesture gives a different
    // result on every machine.
    const finalPosition = (hz: number): { x: number; y: number; z: number } => {
      const cam = new OrbitCamera(OPTS);
      cam.drag(120, 0);
      const dt = 1 / hz;
      for (let i = 0; i < hz * 3; i++) {
        cam.update(dt);
      }
      return cam.position;
    };
    const at60 = finalPosition(60);
    const at144 = finalPosition(144);
    const dot =
      (at60.x * at144.x + at60.y * at144.y + at60.z * at144.z) /
      (Math.hypot(at60.x, at60.y, at60.z) * Math.hypot(at144.x, at144.y, at144.z));
    expect(Math.acos(Math.max(-1, Math.min(1, dot)))).toBeLessThan(0.02);
  });

  it('tolerates a stalled frame without flinging the camera', () => {
    // A long dt (tab backgrounded, GC pause) must not integrate into a huge jump.
    const cam = new OrbitCamera(OPTS);
    cam.drag(100, 100);
    cam.update(5); // five-second frame
    expect(Number.isFinite(cam.distance)).toBe(true);
    expect(cam.distance).toBeGreaterThan(OPTS.radius);
    const p = cam.position;
    expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
  });

  it('lookAtDirection points at the given direction', () => {
    const cam = new OrbitCamera(OPTS);
    for (const dir of [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0.3, y: 0.5, z: -0.8 },
    ]) {
      cam.lookAtDirection(dir);
      cam.update(1 / 60);
      const p = cam.position;
      const pl = Math.hypot(p.x, p.y, p.z);
      const dl = Math.hypot(dir.x, dir.y, dir.z);
      const dot = (p.x * dir.x + p.y * dir.y + p.z * dir.z) / (pl * dl);
      expect(dot).toBeGreaterThan(0.999);
    }
  });

  it('ignores a zero direction rather than producing NaN', () => {
    const cam = new OrbitCamera(OPTS);
    const before = cam.position;
    cam.lookAtDirection({ x: 0, y: 0, z: 0 });
    expect(cam.position).toEqual(before);
  });
});
