/**
 * One call from a world to a PNG: build the job, render it, draw the overlays,
 * encode it.
 *
 * The convenience layer. Everything it does is available a step at a time — a
 * caller who wants the raster without the overlays, or the overlays without the
 * encode, composes `renderMap`, `drawGraticule` and `encodePng` directly. What
 * this adds is the *order*, which has one constraint worth stating: **overlays
 * are drawn after every band has landed, never inside a band.**
 *
 * A graticule line is found by comparing a pixel to its left and upper
 * neighbours, and the upper neighbour of a band's first row belongs to the
 * previous band. Drawing overlays per band would drop those rows — one missing
 * parallel per band boundary, in a pattern that reads exactly like a tiling
 * artefact and would be diagnosed as one. So the overlay pass owns the finished
 * image and nothing else does.
 */
import { GEN_VERSION } from '@traveller-mainworld/core';

import { detailDepthFor, requireDepth } from './detailDepth.js';
import type { ExportIdentity, ExportJob } from './job.js';
import { pointInputFor } from './job.js';
import { drawGraticule } from './overlay/graticule.js';
import { drawTitleBlock, titleMetadata } from './overlay/titleBlock.js';
import { encodePng } from './png.js';
import { type ProjectionOptions, requireProjection } from './projection/index.js';
import type { Raster } from './raster.js';
import { type RenderOptions, renderMap } from './render.js';
import type { ImageSize } from './size.js';

/** The world an export is of, in the shape `WorldChoice` already has it. */
export interface ExportWorld {
  readonly seedHi: number;
  readonly seedLo: number;
  readonly spec: Parameters<typeof pointInputFor>[0]['spec'];
}

/** What a caller chooses. Everything else is derived. */
export interface ExportRequestOptions {
  readonly size: ImageSize;
  readonly projectionId: string;
  readonly projectionOptions?: ProjectionOptions;
  /**
   * Override the detail depth.
   *
   * Plan §8 asks for the formula *and* an override. The override is for probing
   * — rendering the same map at two depths is how you see what a band gate
   * actually does — and the title block says which it was, so a map rendered at
   * a non-default depth carries that fact rather than being indistinguishable
   * from one that was not.
   */
  readonly depth?: number;
  readonly graticule?: boolean;
  readonly titleBlock?: boolean;
}

/**
 * Assemble an {@link ExportJob}.
 *
 * Separated from the render so a caller can inspect the resolved depth before
 * committing minutes of CPU to it — which is what the CLI prints and what the
 * viewer's panel shows.
 */
export function buildExportJob(
  world: ExportWorld,
  identity: Omit<ExportIdentity, 'genVersion' | 'radiusKm'>,
  options: ExportRequestOptions,
): ExportJob {
  const projection = requireProjection(options.projectionId, options.projectionOptions ?? {});
  const chosen = options.depth === undefined;
  const depth = chosen ? detailDepthFor(projection, options.size) : requireDepth(options.depth!);

  return {
    size: options.size,
    projectionId: options.projectionId,
    projectionOptions: options.projectionOptions ?? {},
    depth,
    depthChosen: chosen,
    input: pointInputFor(world),
    seedHi: world.seedHi,
    seedLo: world.seedLo,
    identity: {
      ...identity,
      genVersion: GEN_VERSION,
      radiusKm: world.spec.radiusKm,
    },
    graticule: options.graticule ?? true,
    titleBlock: options.titleBlock ?? true,
  };
}

/** Draw whichever overlays the job asked for, onto a finished raster. */
export function drawOverlays(raster: Raster, job: ExportJob): void {
  const projection = requireProjection(job.projectionId, job.projectionOptions);
  if (job.graticule) {
    drawGraticule(raster, projection);
  }
  if (job.titleBlock) {
    drawTitleBlock(raster, job, projection);
  }
}

/** Render a job to a finished raster, overlays included. */
export async function renderExport(
  job: ExportJob,
  options: RenderOptions = {},
): Promise<Raster> {
  const raster = await renderMap(job, options);
  drawOverlays(raster, job);
  return raster;
}

/** Render a job all the way to PNG bytes. */
export async function exportPng(job: ExportJob, options: RenderOptions = {}): Promise<Uint8Array> {
  const raster = await renderExport(job, options);
  const projection = requireProjection(job.projectionId, job.projectionOptions);
  return encodePng(raster, titleMetadata(job, projection));
}
