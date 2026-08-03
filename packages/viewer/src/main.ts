/**
 * Viewer entry point. The cube-sphere scene, LOD quadtree, worker pool and
 * camera controls land in WP2; WP0 only proves the Vite + Three.js + core
 * wiring builds and runs.
 */
import { GEN_VERSION } from '@traveller-mainworld/core';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.textContent = `Traveller Mainworld — generator ${GEN_VERSION} — scaffolding only (WP0)`;
}
