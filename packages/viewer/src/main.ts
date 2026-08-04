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
import { elevationScaleFor, exaggerationFrom } from './render/exaggeration.js';
import { PlanetRenderer, createScene } from './render/planet.js';
import { TileStore } from './stream/tileStore.js';
import { chooseWorld } from './world/choice.js';

/** Planet radius in scene units. Everything else is expressed relative to this. */
const RADIUS = 1;

/** Grid resolution per tile. 65² for now; Spike B decides 65 vs 129 on measurement. */
const TILE_N = 64;

/**
 * Starting altitude above the surface, in kilometres — the same for every world.
 *
 * This is what makes size legible. The camera used to start at 1.5 radii above
 * whatever it was looking at, so an 800 km rockball and an 8000 km world filled
 * the viewport identically and the only evidence of scale was a number in the
 * overlay. Framing from a fixed absolute distance instead makes apparent size
 * track real size: across the fixture set the disc runs from about 12% of the
 * frame at Size 1 to about 80% at Size A, a ratio of ten, which is the ratio of
 * their radii.
 *
 * 15 000 km is chosen so the largest supported world is comfortably framed
 * rather than overflowing. Zoom does the rest — that is what it is for.
 */
const INITIAL_ALTITUDE_KM = 15_000;

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

  // Altitude in radii, from a fixed altitude in kilometres, so that a small
  // world starts as a small disc. The retreat bound has to clear it, or a small
  // world would be clamped straight back to a framing that hides its size.
  const initialAltitude = INITIAL_ALTITUDE_KM / world.spec.radiusKm;
  const orbit = new OrbitCamera({
    ...DEFAULT_ORBIT,
    radius: RADIUS,
    initialAltitude,
    maxAltitude: Math.max(DEFAULT_ORBIT.maxAltitude, initialAltitude * 3),
  });
  const controls = bindControls(canvas, orbit);
  const overlay = new DiagnosticsOverlay(app);

  // True scale by default: a photograph of a planet has no vertical
  // exaggeration. `?exaggeration=<n>` is the inspection override.
  let exaggeration;
  try {
    exaggeration = exaggerationFrom(params);
  } catch (error) {
    app.textContent = error instanceof Error ? error.message : String(error);
    app.style.cssText = 'padding:2rem;font:14px/1.6 ui-monospace,monospace;color:#ff8a94';
    return;
  }
  const elevationScale = elevationScaleFor(world.spec, exaggeration);

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
    const buffers = planet.bufferBytes;
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
        cacheBytes: stats.cache.bytes,
        meshLiveBytes: buffers.live,
        meshPooledBytes: buffers.pooled,
        meshSharedBytes: buffers.shared,
        pooledMeshes: planet.pooledCount,
      },
      now,
    );

    requestAnimationFrame(frame);
  };

  // Ignore the startup burst when reporting the worst frame, and take the heap
  // baseline here rather than at load: the memory criterion asks whether a long
  // session drifts, not what the page costs to open.
  window.setTimeout(() => overlay.markSettled(performance.now()), 3000);

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
