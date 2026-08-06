/**
 * Viewer entry point.
 *
 * ## The shell and the session
 *
 * Two lifetimes, and separating them is what WP12 needed from this file. The
 * **shell** — canvas, scene, camera, controls, panel, frame loop — is built
 * once and lives as long as the page. A **session** is everything that belongs
 * to one world: the tile store and its worker pool, the planet renderer, the
 * diagnostics overlay and its evidence stamp. Applying a UPP disposes one
 * session and builds another.
 *
 * The alternative was to set `location.search` and let the page reload, which
 * is a third of the code and was rejected on the acceptance criterion: §9.2
 * gives paste-to-globe ten seconds, and a reload spends part of that budget
 * re-acquiring a WebGL context and recompiling shaders to arrive at a scene it
 * already had. It would also throw away the camera on every re-roll, which is
 * precisely the case U4 exists for — auditioning seeds against each other is
 * hard when the viewpoint moves between them.
 *
 * ## Failure is not fatal to the shell
 *
 * A bad UPP in the address bar used to replace the whole page with red text.
 * That was right when the only way to supply one was to edit the URL. With an
 * input field it is wrong: the shell comes up, the panel shows the error beside
 * the field, and the world simply is not there yet. Everything downstream
 * therefore has to tolerate `session === undefined`, which is one `if` in the
 * frame loop and the reason the whole arrangement stays honest.
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
import { MESH_PROBE_COLOUR, PlanetRenderer, aimSun, createScene } from './render/planet.js';
import { type SunDirection, sunFrom } from './render/sun.js';
import { type CameraPose, cameraFrom, checkGenVersion, rulesetIdFrom } from './share/url.js';
import { TileStore } from './stream/tileStore.js';
import { ControlPanel } from './ui/controlPanel.js';
import { ExportPanel } from './ui/exportPanel.js';
import { DEFAULT_SEED, DEFAULT_UPP, type WorldChoice, chooseWorld, uppWorld } from './world/choice.js';

/** Planet radius in scene units. Everything else is expressed relative to this. */
const RADIUS = 1;

/**
 * Grid resolution per tile — a 65² vertex mesh.
 *
 * **Open question 1, closed at 65² in WP15** and no longer provisional. The
 * measurement is `bench/results/phase1.md` §Grid size; the two facts it turns on
 * are both about code rather than about milliseconds. {@link screenSpaceError}
 * does not read this constant, so raising it would draw the *same* tiles with
 * four times the vertices rather than replacing four tiles with one; and
 * `bandsForDepth` gates crater bands on `BAND_GATE_N = 64`, so a finer mesh
 * samples an identical field. 129² measured 3.8× the generation cost for no
 * extra detail, and was the only one of the two to exceed the R13 budget.
 *
 * The golden fixtures moved to match this in the same work package — before
 * WP15 they hashed at 129², so the shipped path was not the hashed path.
 * Raising it now means raising `BAND_GATE_N` with it, which is a kernel change
 * under the full change protocol, not a viewer tuning knob.
 */
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

/**
 * The commit this bundle was built from, injected by the Pages workflow.
 *
 * Same reasoning as `verify.html`, and the same fallback: a Spike C session
 * block that cannot be tied back to a commit says what the numbers were and
 * nothing about which code produced them. `local build` when served from a
 * working tree, which is information rather than a gap.
 */
const BUILD_COMMIT: string = import.meta.env['VITE_COMMIT'] ?? 'local build';

/** Everything that belongs to one world and dies with it. */
interface WorldSession {
  readonly choice: WorldChoice;
  readonly store: TileStore;
  readonly planet: PlanetRenderer;
  readonly overlay: DiagnosticsOverlay;
  dispose(): void;
}

/**
 * The root element, non-null.
 *
 * A function rather than an inline null check because `openSession` closes over
 * it, and a narrowing that holds at the top of `main` is not one the compiler
 * carries into a nested function declaration.
 */
function requireApp(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>('#app');
  if (element === null) {
    throw new Error('#app not found');
  }
  return element;
}

function main(): void {
  const app = requireApp();
  app.style.position = 'relative';
  installFocusStyles();

  const params = new URLSearchParams(window.location.search);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  // The globe is a control, so it says so. `tabIndex` alone puts it in the tab
  // order without telling anyone what they have landed on, which is half an
  // accessibility affordance (PRD R18).
  canvas.setAttribute('role', 'application');
  canvas.setAttribute(
    'aria-label',
    'Planet view. Drag to rotate, scroll to zoom. Arrow keys rotate, + and - zoom, Home reframes.',
  );
  app.appendChild(canvas);

  // Presentation parameters, resolved before anything is built because the
  // exaggeration is stamped into the overlay and the sun into the scene. A
  // malformed one is fatal to the shell, which is the same treatment the world
  // parameters get and for the same reason: silently ignoring it is how a
  // screenshot ends up recorded against a setting nobody used.
  let exaggeration: number;
  let sunDirection: SunDirection;
  let initialCamera: CameraPose | undefined;
  try {
    checkGenVersion(params);
    exaggeration = exaggerationFrom(params);
    sunDirection = sunFrom(params);
    initialCamera = cameraFrom(params);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const { scene, camera, renderer, sun } = createScene(canvas, {
    preserveDrawingBuffer: params.has('debug'),
  });
  aimSun(sun, sunDirection);
  scene.add(sun.target);

  const orbit = new OrbitCamera({
    ...DEFAULT_ORBIT,
    radius: RADIUS,
    // Replaced by `reframe` the moment a world exists; the constructor needs
    // *a* value and the world's radius is not known yet.
    initialAltitude: DEFAULT_ORBIT.initialAltitude,
  });
  const controls = bindControls(canvas, orbit, {
    onReframe: () => {
      if (session !== undefined) {
        orbit.reframe(INITIAL_ALTITUDE_KM / session.choice.world.spec.radiusKm);
      }
    },
  });

  let session: WorldSession | undefined;
  let lodState = new Set<number>();

  const cameraPose = (): CameraPose => {
    const { azimuthDeg, elevationDeg } = orbit.orientationDeg;
    const radiusKm = session?.choice.world.spec.radiusKm ?? RADIUS;
    return { azimuthDeg, elevationDeg, altitudeKm: orbit.altitudeAboveSurface * radiusKm };
  };

  const panel = new ControlPanel(app, sunDirection, {
    onApply: (uppText, seedText) => applyWorld(uppText, seedText),
    onSun: (dir) => {
      sunDirection = dir;
      aimSun(sun, dir);
    },
    cameraPose,
    exaggeration,
  });

  // Its own section under the info panel rather than more rows inside it: an
  // export is an occasional act — session prep, a wiki page — and not part of
  // the U1 loop, so it should not compete with the UPP field for attention.
  const exportPanel = new ExportPanel(
    app.querySelector('[data-panel="controls"]') as HTMLElement,
  );

  /** Tear down the current session and build one for `choice`. */
  function openSession(choice: WorldChoice): void {
    session?.dispose();
    lodState = new Set<number>();

    const { spec } = choice.world;
    const elevationScale = elevationScaleFor(spec, exaggeration);

    const planet = new PlanetRenderer({
      n: TILE_N,
      // `?meshprobe=1` — see MESH_PROBE_COLOUR. Splits the three hypotheses for
      // the black-flicker finding in docs/evidence/spikec-exit.md.
      ...(params.has('meshprobe') ? { initialColour: MESH_PROBE_COLOUR } : {}),
    });
    scene.add(planet.group);

    // Built after the exaggeration is resolved, because the stamp records it: a
    // session flown through the inspection override is not evidence about the
    // frame rate of the shipped view.
    const overlay = new DiagnosticsOverlay(app, {
      world: choice.label,
      worldShort: choice.short,
      build: BUILD_COMMIT,
      tileN: TILE_N,
      exaggeration,
    });

    const store = new TileStore({
      world: choice.world,
      genVersion: GEN_VERSION,
      n: TILE_N,
      radius: RADIUS,
      elevationScale,
      skirtDepthFor: (depth) =>
        skirtDepthFor(depth, RADIUS, spec.terrainAmplitudeM, elevationScale, TILE_N, spec.radiusKm),
    });

    session = {
      choice,
      store,
      planet,
      overlay,
      dispose(): void {
        store.dispose();
        scene.remove(planet.group);
        planet.dispose();
        overlay.dispose();
      },
    };

    orbit.reframe(INITIAL_ALTITUDE_KM / spec.radiusKm);
    panel.show(choice);
    exportPanel.show(choice);
    document.title = `Traveller Mainworld — ${choice.label}`;

    // Ignore the startup burst when reporting the worst frame, and take the
    // heap baseline here rather than at load: the memory criterion asks whether
    // a long session drifts, not what the page costs to open.
    const settling = session;
    window.setTimeout(() => {
      if (session === settling) {
        overlay.markSettled(performance.now());
      }
    }, 3000);
  }

  /**
   * Apply a UPP from the input UI.
   *
   * Returns the message to show inline rather than throwing, because a
   * malformed UPP is an ordinary outcome of typing one. The world already on
   * screen is left alone: the fix for a typo is to see the typo.
   */
  function applyWorld(uppText: string, seedText: string): string | undefined {
    let choice: WorldChoice;
    try {
      choice = uppWorld(uppText, seedText, rulesetIdFrom(params));
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    openSession(choice);

    // The address bar is edited in place rather than rebuilt from
    // `buildShareQuery`, and the difference matters. A share link is canonical:
    // four parameters plus the camera and sun as they are *now*. The address bar
    // has a different job — reloading it must reproduce what is on screen — so
    // it has to keep whatever else the page was opened with, `?exaggeration=`
    // and `?debug=` and `?meshprobe=` included. Rebuilding it from the canonical
    // form would silently drop an inspection override that the render is still
    // using, which is the one failure a round-trippable URL must not have (R4).
    //
    // `?cam=` is the exception and is dropped: the new world reframes, so a pose
    // from the old one describes a viewpoint that no longer exists.
    //
    // `replaceState`, not `pushState`: every generated world is one address, and
    // stacking history entries would make the back button walk a list of worlds
    // rather than leave the page.
    params.set('upp', choice.upp?.canonical ?? uppText);
    params.set('seed', seedText);
    params.set('gen', GEN_VERSION);
    params.set('ruleset', choice.ruleset?.id ?? '');
    params.delete('fixture');
    params.delete('cam');
    window.history.replaceState(null, '', `?${params.toString()}`);
    return undefined;
  }

  // Initial load. A refusal here reaches the panel, not the whole page.
  try {
    openSession(chooseWorld(params));
    if (initialCamera !== undefined) {
      orbit.setPose(
        initialCamera.azimuthDeg,
        initialCamera.elevationDeg,
        initialCamera.altitudeKm / session!.choice.world.spec.radiusKm,
      );
    }
  } catch (error) {
    // No world, but the fields must still show what was asked for: the fix for a
    // bad URL is to see and edit the thing that was wrong with it.
    panel.setDraft(params.get('upp') ?? DEFAULT_UPP, params.get('seed') ?? DEFAULT_SEED);
    panel.showError(error instanceof Error ? error.message : String(error));
  }

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

    const active = session;
    if (active === undefined) {
      // No world: still render, so the canvas is a black sky rather than a
      // frozen frame of the last one.
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
      return;
    }

    const { store, planet, overlay } = active;

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
        altitudeKm: orbit.altitudeAboveSurface * active.choice.world.spec.radiusKm,
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

  requestAnimationFrame(frame);

  window.addEventListener('beforeunload', () => {
    controls.dispose();
    session?.dispose();
    panel.dispose();
    exportPanel.dispose();
    renderer.dispose();
  });
}

/**
 * A visible focus ring on the canvas.
 *
 * The canvas is in the tab order (PRD R18) and used to carry `outline:none`,
 * which is the combination that makes a control reachable by keyboard and
 * invisible once reached. `:focus-visible` shows the ring for keyboard focus
 * and not for a click, which is why it is a stylesheet rule rather than an
 * inline style — inline CSS cannot express a pseudo-class.
 */
function installFocusStyles(): void {
  const style = document.createElement('style');
  style.textContent = [
    '#app canvas:focus { outline: none }',
    '#app canvas:focus-visible { outline: 2px solid #7fb2ff; outline-offset: -2px }',
    '#app [data-panel="controls"] :focus-visible { outline: 2px solid #7fb2ff; outline-offset: 1px }',
  ].join('\n');
  document.head.appendChild(style);
}

function fail(message: string): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app !== null) {
    app.textContent = message;
    app.style.cssText = 'padding:24px;color:#c8d0e0;white-space:pre-wrap';
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
