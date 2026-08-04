/**
 * Viewer entry point: the Spike C walking skeleton.
 *
 * A navigable, streaming, flat-shaded noise sphere. Proves the geometry, tile
 * addressing, worker pipeline and renderer integration hang together — which
 * is the whole point of the spike. No textures, no atmosphere, no craters:
 * those are Phase 1 and 2.
 */
import { GEN_VERSION, tileDepth } from '@traveller-mainworld/core';
import * as THREE from 'three';

import { bindControls } from './camera/controls.js';
import { DEFAULT_ORBIT, OrbitCamera } from './camera/orbitCamera.js';
import { DiagnosticsOverlay } from './diagnostics/overlay.js';
import { skirtMaskFor } from './lod/neighbours.js';
import { DEFAULT_LOD, type LodParams, selectTiles } from './lod/quadtree.js';
import { skirtDepthFor } from './mesh/tileMesh.js';
import { elevationScaleFor } from './render/exaggeration.js';
import { PlanetRenderer, createScene } from './render/planet.js';
import { TileStore } from './stream/tileStore.js';
import { chooseWorld } from './world/choice.js';

/** Planet radius in scene units. Everything else is expressed relative to this. */
const RADIUS = 1;

/** Grid resolution per tile. 65² for now; Spike B decides 65 vs 129 on measurement. */
const TILE_N = 64;

function main(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app === null) {
    throw new Error('#app not found');
  }
  app.style.position = 'relative';

  const params = new URLSearchParams(window.location.search);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none';
  app.appendChild(canvas);

  let choice;
  try {
    choice = chooseWorld(params);
  } catch (error) {
    // A bad ?fixture= is a typo, not a crash to read out of the console. Say
    // what was asked for and what exists, on the page.
    app.textContent = error instanceof Error ? error.message : String(error);
    app.style.cssText = 'padding:2rem;font:14px/1.6 ui-monospace,monospace;color:#ff8a94';
    return;
  }
  const { label, world } = choice;

  const { scene, camera, renderer, sun } = createScene(canvas, {
    preserveDrawingBuffer: params.has('debug'),
  });
  const planet = new PlanetRenderer({ n: TILE_N });
  scene.add(planet.group);

  const orbit = new OrbitCamera({ ...DEFAULT_ORBIT, radius: RADIUS });
  const controls = bindControls(canvas, orbit);
  const overlay = new DiagnosticsOverlay(app);

  // Compressed rather than flat: see render/exaggeration.ts for why a single
  // multiplier turned the small end of the fixture set into potatoes.
  const elevationScale = elevationScaleFor(world.spec);

  const store = new TileStore({
    world,
    genVersion: GEN_VERSION,
    n: TILE_N,
    radius: RADIUS,
    elevationScale,
    skirtDepthFor: (depth) =>
      skirtDepthFor(depth, RADIUS, world.spec.terrainAmplitudeM, elevationScale, TILE_N),
  });

  let lodState = new Set<number>();
  let lastFrameAt = performance.now();

  const resize = (): void => {
    const width = app.clientWidth;
    const height = app.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const frame = (now: number): void => {
    const frameMs = now - lastFrameAt;
    lastFrameAt = now;

    orbit.update(frameMs / 1000);

    const position = orbit.position;
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(0, 0, 0);
    // Near/far track altitude: a fixed near plane either z-fights at the
    // surface or clips the planet from orbit.
    camera.near = Math.max(1e-5, orbit.altitudeAboveSurface * 0.05);
    camera.far = orbit.distance + RADIUS * 2;
    camera.updateProjectionMatrix();

    const lod: LodParams = {
      ...DEFAULT_LOD,
      radius: RADIUS,
      viewportHeight: renderer.domElement.height,
      fovY: (camera.fov * Math.PI) / 180,
    };
    const selection = selectTiles(position, lod, lodState);
    lodState = selection.state;

    // Priority is the error inverted: the tile whose absence is most visible
    // is generated first.
    store.request(selection.tiles, (tileId) => -(selection.errors.get(tileId) ?? 0));

    // Drain finished work first, so a tile that arrived this frame is drawable
    // immediately rather than waiting a frame.
    store.take();

    // Draw what is both selected and already generated. Tiles still streaming
    // simply do not appear yet; their parent stays drawn because the cut only
    // advances when the renderer has the finer tiles.
    const drawable = new Set<number>();
    let maxDepth = 0;
    for (const tileId of selection.tiles) {
      if (store.has(tileId)) {
        drawable.add(tileId);
        maxDepth = Math.max(maxDepth, tileDepth(tileId));
      }
    }

    // Skirt masks depend on which tiles are actually drawn, so they can only be
    // computed once `drawable` is complete.
    for (const tileId of drawable) {
      const cached = store.get(tileId);
      if (cached !== undefined) {
        planet.upsert(cached, skirtMaskFor(tileId, drawable));
      }
    }
    planet.retainOnly(drawable);

    renderer.render(scene, camera);

    const stats = store.stats();
    overlay.update(
      {
        frameMs,
        visibleTiles: planet.visibleCount,
        triangles: planet.triangleCount,
        queued: stats.queued,
        inFlight: stats.inFlight,
        workers: stats.workers,
        cacheSize: stats.cache.size,
        cacheCapacity: stats.cache.capacity,
        cacheHits: stats.cache.hits,
        cacheMisses: stats.cache.misses,
        generated: stats.generated,
        cancelled: stats.cancelled,
        meanGenerateMs: stats.meanGenerateMs,
        bytesTransferred: stats.bytesTransferred,
        altitudeKm: orbit.altitudeAboveSurface * world.spec.radiusKm,
        maxDepth,
      },
      now,
    );

    requestAnimationFrame(frame);
  };

  // Ignore the startup burst when reporting the worst frame.
  window.setTimeout(() => overlay.resetWorst(), 3000);

  document.title = `Traveller Mainworld — ${label}`;
  requestAnimationFrame(frame);

  // Keep the sun fixed relative to the world rather than the camera, so the
  // terminator stays put as the camera orbits.
  sun.target.position.set(0, 0, 0);
  scene.add(sun.target);

  window.addEventListener('beforeunload', () => {
    controls.dispose();
    store.dispose();
    planet.dispose();
    overlay.dispose();
    renderer.dispose();
  });
}

function fail(message: string): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app !== null) {
    app.textContent = message;
    app.style.cssText = 'padding:24px;color:#c8d0e0';
  }
}

// WebGL capability detection (PRD R22).
if (typeof WebGL2RenderingContext === 'undefined') {
  fail('This browser does not support WebGL 2, which Traveller Mainworld requires.');
} else {
  try {
    main();
  } catch (error) {
    fail(`Failed to start: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export { THREE };
