/**
 * The pipeline (R24): projection → lat/lon → 3D direction → `sampleSurface` →
 * palette → RGB.
 *
 * Rendered from generation data rather than from screenshots, which is what
 * makes an export seam-free and viewport-independent.
 *
 * ## What is new here, and what is not
 *
 * **The sampling is not new and must not be rebuilt.** `sampleSurface` (WP11) is
 * asserted byte-identical to `generateTile`'s `albedo` and `materials` buffers
 * over every fixture world, at a face root, a mid-depth tile and the deepest
 * tile in the set, and again at 129² where the tile path's lattice cache is
 * genuinely different code — `packages/core/test/regolith.test.ts`. `bandsForDepth`
 * is the single shared gate and `sampleSurface` calls it. `worldPalette` →
 * `writeSurfaceColour` is the single shared colour map. So the export inherits
 * PRD §9.4's agreement rather than re-establishing it, and this file's tests aim
 * at the two layers that *are* new: the projection maths, and the application of
 * the palette.
 *
 * **The twelve cube edges take care of themselves.** WP12's normals are
 * extrapolated across them because the apron ring continues one face's
 * parameterisation past `u = 1`. Nothing here touches a face parameterisation —
 * the export point-samples by 3D direction — so it is seam-free across all
 * twelve by construction, which is plan §8's whole argument. Worth knowing
 * rather than re-deriving, and worth knowing in the other direction too: if
 * hillshading is ever added and takes its normals from direction-offset point
 * samples, it keeps that property, and the export would then be *better* at
 * those twelve edges than the viewer is.
 *
 * ## What is hoisted, and why it is not a style note
 *
 * `buildBasins` is a few hundred integer hashes and the field it produces is
 * tens of kilobytes. `tilegen.ts` builds it once per tile; a point-sampler that
 * built it per sample would be dominated by it. {@link BandRenderer} builds it
 * **once per renderer**, along with the candidate scratch and the basin cull,
 * and a renderer is one per worker for the life of an export.
 *
 * The `cull` is the same trick `tilegen.ts` uses per *row* rather than per tile,
 * for the same reason: a thin slab culls where a whole face does not. An
 * equirectangular row band is exactly a thin slab. The cull is rebuilt per band
 * rather than per row because a band is already thin and one pass over the basin
 * list per row would be the cost it was meant to save.
 *
 * ## The palette is derived per renderer, not cached per world
 *
 * `tileJob.ts` derives it per tile and says why: it is a handful of integer
 * mixes from the seed the sample was already taken with, so a cache would buy
 * nothing and would be a second place for the viewer and the exporter to
 * disagree about which world they are colouring. Same here.
 *
 * ## The depth this samples at is not the depth in the title block
 *
 * WP11 made the albedo field depth-invariant on purpose, so plan §8's detail
 * depth changes nothing in an albedo-only map and costs 27% of the render to
 * change nothing. {@link surfaceSampleDepth} has the measurement and the
 * argument; `render.test.ts` asserts the two depths give identical bytes, which
 * is what makes this an optimisation rather than a guess. The job's own `depth`
 * is unchanged and is what the export will sample *elevation* at on the day it
 * exports any.
 */
import {
  BasinCull,
  type BasinField,
  CraterCandidates,
  type WorldPalette,
  buildBasins,
  sampleSurface,
  surfaceAlbedo,
  surfaceMaterial,
  worldPalette,
  writeSurfaceColour,
} from '@traveller-mainworld/core';

import { surfaceSampleDepth } from './detailDepth.js';
import { directionFromGeographic } from './geography.js';
import type { ExportJob } from './job.js';
import { type Projection, requireProjection } from './projection/index.js';
import { OUTSIDE_COLOUR } from './projection/projection.js';
import { CHANNELS, type Raster, allocateRaster, writeLinearRgb } from './raster.js';

/**
 * Renders row bands of one export.
 *
 * One per worker. Everything expensive that is a property of the *world* rather
 * than of the band is built in the constructor: the basin field, the candidate
 * scratch, the palette.
 *
 * Not reentrant, for the same reason `generateTile` is not: the scratch is
 * per-instance state and two overlapping renders through one instance would
 * interleave into it.
 */
export class BandRenderer {
  readonly projection: Projection;

  private readonly basins: BasinField;
  private readonly palette: WorldPalette;
  private readonly candidates = new CraterCandidates();
  private readonly cull = new BasinCull();
  private readonly geo = new Float64Array(2);
  private readonly dir = new Float64Array(3);
  private readonly rgb = new Float32Array(3);
  private readonly box = new Float64Array(6);

  /**
   * The depth the surface is sampled at — see {@link surfaceSampleDepth}, which
   * is not `job.depth` and explains at length why not.
   */
  readonly surfaceDepth: number;

  constructor(readonly job: ExportJob) {
    this.projection = requireProjection(job.projectionId, job.projectionOptions);
    this.basins = buildBasins(job.seedHi, job.seedLo, job.input.craterDensityScale);
    this.palette = worldPalette(job.seedHi, job.seedLo);
    this.surfaceDepth = surfaceSampleDepth(job.depth);
  }

  /**
   * Render rows `[row0, row0 + rows)` into `into`, which holds `rows` full image
   * rows of RGB bytes starting at index 0.
   *
   * A band-local buffer rather than an offset into the whole image, because that
   * is what a worker can transfer back without sending the rest of the map with
   * it.
   */
  render(row0: number, rows: number, into: Uint8Array): void {
    const { size, input } = this.job;
    const needed = rows * size.width * CHANNELS;
    if (into.length < needed) {
      throw new RangeError(
        `band buffer holds ${String(into.length)} bytes, needs ${String(needed)} for ` +
          `${String(rows)} rows of ${String(size.width)}`,
      );
    }
    if (row0 < 0 || rows < 0 || row0 + rows > size.height) {
      throw new RangeError(
        `rows ${String(row0)}..${String(row0 + rows)} fall outside a ${String(size.height)}-row image`,
      );
    }
    if (rows === 0) {
      return;
    }

    // One cull for the whole band. The box comes from the projection and is a
    // superset by contract — see `latitudeBandBounds`.
    this.projection.rowBandBounds(size, row0, rows, this.box);
    this.cull.build(
      this.basins,
      this.box[0]!, this.box[1]!, this.box[2]!,
      this.box[3]!, this.box[4]!, this.box[5]!,
    );

    let at = 0;
    for (let r = 0; r < rows; r++) {
      const py = row0 + r;
      for (let px = 0; px < size.width; px++) {
        if (!this.projection.pixelToGeographic(size, px, py, this.geo)) {
          writeLinearRgb(into, at, OUTSIDE_COLOUR[0], OUTSIDE_COLOUR[1], OUTSIDE_COLOUR[2]);
          at += CHANNELS;
          continue;
        }

        directionFromGeographic(this.geo[0]!, this.geo[1]!, this.dir);
        const code = sampleSurface(
          this.dir[0]!,
          this.dir[1]!,
          this.dir[2]!,
          this.surfaceDepth,
          input,
          this.basins,
          this.candidates,
          this.cull,
        );
        writeSurfaceColour(
          this.palette,
          surfaceMaterial(code),
          surfaceAlbedo(code),
          this.rgb,
          0,
        );
        writeLinearRgb(into, at, this.rgb[0]!, this.rgb[1]!, this.rgb[2]!);
        at += CHANNELS;
      }
    }
  }

  /**
   * The **linear** colour at one direction, before {@link encodeChannel}.
   *
   * The comparison surface for PRD §9.4: this is the number the viewer's vertex
   * colour buffer holds at the same direction, not the byte the PNG holds. Once
   * a pixel is an sRGB byte it has been through a transfer function and an 8-bit
   * quantiser, and comparing that to anything requires saying which — see
   * `raster.ts`.
   *
   * Takes a direction rather than a pixel so a test can ask about a *tile
   * vertex*, which is where the viewer's numbers are, rather than about the
   * nearest pixel to one, which is a different position and would turn an exact
   * equality into a tolerance.
   *
   * **No basin cull.** This is for probes, and testing every basin in the world
   * is the reference behaviour the culled render path is asserted equal to.
   */
  colourAtDirection(x: number, y: number, z: number, out: Float32Array): void {
    const code = sampleSurface(
      x, y, z,
      this.surfaceDepth,
      this.job.input,
      this.basins,
      this.candidates,
    );
    writeSurfaceColour(this.palette, surfaceMaterial(code), surfaceAlbedo(code), out, 0);
  }

  /**
   * The linear colour of one pixel's centre.
   *
   * @param out Receives linear RGB. Left untouched, and `false` returned, for a
   *            pixel outside the projected world.
   */
  linearAt(px: number, py: number, out: Float32Array): boolean {
    if (!this.projection.pixelToGeographic(this.job.size, px, py, this.geo)) {
      return false;
    }
    directionFromGeographic(this.geo[0]!, this.geo[1]!, this.dir);
    this.colourAtDirection(this.dir[0]!, this.dir[1]!, this.dir[2]!, out);
    return true;
  }
}

/** How far one render has got. */
export interface RenderProgress {
  /** Rows finished. */
  readonly rows: number;
  /** Rows in the image. */
  readonly total: number;
}

export interface RenderOptions {
  /**
   * Rows per band.
   *
   * Bands are the unit of parallelism and of progress. Smaller bands report
   * progress more often and rebuild the basin cull more often; larger ones
   * amortise the cull but make the last worker's tail longer. The default is a
   * compromise sized so that a 2048-row map is a few dozen bands — enough that a
   * pool of four workers finishes within a band of each other, and enough that a
   * progress bar moves.
   */
  readonly bandRows?: number;
  /** Called after each band. */
  readonly onProgress?: (progress: RenderProgress) => void;
  /**
   * Yield to the host between bands.
   *
   * The single-threaded path's answer to plan §8's "a silent 30-second freeze is
   * still a bug even though exports have no R13 budget". Defaults to a
   * `setTimeout(0)`-equivalent, which is what lets a browser repaint a progress
   * bar; pass `() => Promise.resolve()` in a worker or in Node, where there is
   * nothing to repaint and the timer is pure latency.
   */
  readonly yieldToHost?: () => Promise<void>;
}

/** The default band height. See {@link RenderOptions.bandRows}. */
export const DEFAULT_BAND_ROWS = 64;

const defaultYield = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Render a whole map on this thread, yielding between bands.
 *
 * The reference implementation and the one the tests use. `pool/pool.ts` renders
 * the same bands across workers and is asserted to produce the identical image —
 * which it must, because a band's pixels depend on nothing but the band.
 */
export async function renderMap(job: ExportJob, options: RenderOptions = {}): Promise<Raster> {
  const renderer = new BandRenderer(job);
  const raster = allocateRaster(job.size);
  const bandRows = options.bandRows ?? DEFAULT_BAND_ROWS;
  const yieldToHost = options.yieldToHost ?? defaultYield;
  const rowBytes = job.size.width * CHANNELS;
  const band = new Uint8Array(bandRows * rowBytes);

  for (let row0 = 0; row0 < job.size.height; row0 += bandRows) {
    const rows = Math.min(bandRows, job.size.height - row0);
    renderer.render(row0, rows, band);
    raster.data.set(band.subarray(0, rows * rowBytes), row0 * rowBytes);
    options.onProgress?.({ rows: row0 + rows, total: job.size.height });
    if (row0 + rows < job.size.height) {
      await yieldToHost();
    }
  }

  return raster;
}

/** Render a whole map on this thread with no yielding. For tests and the CLI. */
export function renderMapSync(job: ExportJob, bandRows = DEFAULT_BAND_ROWS): Raster {
  const renderer = new BandRenderer(job);
  const raster = allocateRaster(job.size);
  const rowBytes = job.size.width * CHANNELS;
  const band = new Uint8Array(bandRows * rowBytes);

  for (let row0 = 0; row0 < job.size.height; row0 += bandRows) {
    const rows = Math.min(bandRows, job.size.height - row0);
    renderer.render(row0, rows, band);
    raster.data.set(band.subarray(0, rows * rowBytes), row0 * rowBytes);
  }
  return raster;
}
