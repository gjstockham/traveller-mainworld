/**
 * The title block (R25): what this map is, on the map.
 *
 * R25 asks for UPP, seed, generator version and projection name. Plan §8 adds
 * the ruleset version and the detail depth. This adds two more:
 *
 * - **The reduced-fidelity summary.** `WorldChoice` already carries a
 *   `FidelityReport` and the viewer already shows a badge from it. An exported
 *   map of a Hydro-7 world with no ocean and nothing on it to say why is a map
 *   whose missing ocean gets filed as a bug against the exporter — and it will
 *   be filed by someone holding the PNG, not the app.
 * - **The projection's own parameters**, which today means Mercator's clip. A
 *   map that silently loses the poles is a map somebody will misread.
 *
 * ## The text is composed here and rendered here, and both are testable
 *
 * {@link titleLines} is pure and returns strings, so what the block *says* is a
 * Node test. {@link drawTitleBlock} blits those strings, so what it *looks like*
 * is also a Node test — there is no canvas and no font in the loop (see
 * `font.ts`). That is the same split `panelText.ts` makes from `controlPanel.ts`
 * and it goes one step further, because here even the rasterisation is ours.
 *
 * ## ASCII only
 *
 * The 5×7 font covers ASCII 32–126 and substitutes `?` for anything else. Rather
 * than let a stray `°` reach the map as a question mark beside a number,
 * {@link titleLines} runs `assertPrintable` over every line it composes. So the
 * block writes `deg` and `+/-`, which is a small ugliness in exchange for never
 * shipping a map with a mystery glyph on it.
 */
import { GEN_VERSION } from '@traveller-mainworld/core';

import { detailDepthLine } from '../detailDepth.js';
import type { ExportIdentity, ExportJob } from '../job.js';
import type { Projection } from '../projection/projection.js';
import type { Raster } from '../raster.js';
import { formatSize } from '../size.js';
import { type Ink, drawText, fillBox, textBlockHeight } from './draw.js';
import { GLYPH_ADVANCE, GLYPH_HEIGHT, assertPrintable, textWidth } from './font.js';

/** Panel background. Near-black, so pale text reads over any terrain. */
const PANEL_INK: Ink = [10, 12, 16];
/** Panel opacity. Not 1: a reader should be able to see that terrain continues under it. */
const PANEL_ALPHA = 0.82;
/** Body text. */
const TEXT_INK: Ink = [226, 232, 240];
/** The first line, which names the world. */
const TITLE_INK: Ink = [255, 255, 255];
/** The fidelity line, which is a caveat rather than a fact. */
const CAVEAT_INK: Ink = [252, 211, 130];

/** Gap between text lines, in scaled pixels. */
const LINE_GAP_RATIO = 4;
/** Panel padding, in scaled pixels. */
const PADDING_RATIO = 8;
/** Panel inset from the image corner, in scaled pixels. */
const INSET_RATIO = 10;

/**
 * Text scale for an image of this width.
 *
 * The block should occupy about the same *fraction* of any map, so a 4096-wide
 * export is not annotated in text a reader has to zoom to. One scale step per
 * doubling of width from 1024.
 */
export function titleScale(width: number): number {
  return Math.max(1, Math.min(6, Math.round(width / 1024)));
}

/** Which line of {@link titleLines} is the fidelity caveat, if any. */
export interface TitleText {
  readonly lines: readonly string[];
  /** Index into {@link lines} of the reduced-fidelity line, or `-1`. */
  readonly caveatLine: number;
}

/**
 * Compose the block's text.
 *
 * Pure, and the reason `titleBlock.test.ts` can assert what a map claims without
 * rendering one.
 */
export function titleLines(job: ExportJob, projection: Projection): TitleText {
  const id: ExportIdentity = job.identity;
  const lines: string[] = [];

  const name = id.upp ?? (id.fixtureId === undefined ? 'unknown world' : `fixture ${id.fixtureId}`);
  lines.push(`${name}  -  ${String(id.radiusKm)} km radius`);

  const pairs: [string, string][] = [];
  if (id.seedText !== undefined) {
    pairs.push(['seed', id.seedText]);
  }
  pairs.push(['projection', projection.name]);
  for (const line of projection.parameterLines()) {
    pairs.push(['', line]);
  }
  pairs.push(['size', `${formatSize(job.size)} px`]);
  pairs.push(['detail depth', detailDepthLine(job.depth, job.depthChosen)]);
  pairs.push(['generator', id.genVersion]);
  pairs.push([
    'ruleset',
    id.rulesetId === undefined
      ? 'none - a fixture spec is pinned rather than interpreted'
      : `${id.rulesetId}${id.rulesetName === undefined ? '' : ` (${id.rulesetName})`}`,
  ]);

  // Padded into columns, the same shape as `panelText.ts`'s identity block and
  // the diagnostics overlay's stamp, so a reader who knows one knows this.
  const width = Math.max(...pairs.map(([label]) => label.length));
  for (const [label, value] of pairs) {
    lines.push(`${label.padEnd(width)}  ${value}`);
  }

  let caveatLine = -1;
  if (id.fidelity !== undefined) {
    caveatLine = lines.length;
    lines.push(id.fidelity);
  }

  for (const line of lines) {
    assertPrintable(line, 'title block line');
  }
  return { lines, caveatLine };
}

/**
 * The panel's pixel size at `scale`, so a caller can lay a map out around it.
 */
export function titleBlockSize(
  text: TitleText,
  scale: number,
): { width: number; height: number } {
  const lineGap = LINE_GAP_RATIO * scale;
  const padding = PADDING_RATIO * scale;
  const widest = Math.max(...text.lines.map((line) => textWidth(line, scale)));
  return {
    width: widest + 2 * padding,
    height: textBlockHeight(text.lines.length, scale, lineGap) + 2 * padding,
  };
}

/**
 * Draw the block into the bottom-left corner of a rendered raster.
 *
 * Bottom-left because that is where the least of an equirectangular world is:
 * the bottom rows are the south polar cap, stretched across the full width by
 * the projection, so the block covers the most heavily oversampled and least
 * informative part of the map. On Mercator the same corner is the clipped
 * southern edge, for the same reason.
 */
export function drawTitleBlock(raster: Raster, job: ExportJob, projection: Projection): void {
  const text = titleLines(job, projection);
  const scale = titleScale(raster.width);
  const lineGap = LINE_GAP_RATIO * scale;
  const padding = PADDING_RATIO * scale;
  const inset = INSET_RATIO * scale;
  const box = titleBlockSize(text, scale);

  const x0 = inset;
  const y0 = raster.height - inset - box.height;

  fillBox(
    raster.data, raster.width, raster.height,
    x0, y0, box.width, box.height,
    PANEL_INK, PANEL_ALPHA,
  );

  let y = y0 + padding;
  for (let i = 0; i < text.lines.length; i++) {
    const ink = i === 0 ? TITLE_INK : i === text.caveatLine ? CAVEAT_INK : TEXT_INK;
    drawText(
      raster.data, raster.width, raster.height,
      x0 + padding, y, text.lines[i]!, ink, scale,
    );
    y += GLYPH_HEIGHT * scale + lineGap;
  }
}

/**
 * The block's text as PNG metadata, so the identity survives a crop.
 *
 * A map pasted into a wiki gets cropped, resized and re-encoded, and the title
 * block is the first thing to go. A `tEXt` chunk costs a few hundred bytes and
 * is the only copy that survives — which matters most for `generator`, since
 * PRD R15's obligation to re-render an old version is worth nothing if nobody
 * can tell which version made the file.
 */
export function titleMetadata(job: ExportJob, projection: Projection): [string, string][] {
  const text = titleLines(job, projection);
  return [
    ['Software', `traveller-mainworld ${GEN_VERSION}`],
    ['Description', text.lines.join('; ')],
  ];
}

/** The advance width of one character at scale 1. Re-exported for layout callers. */
export { GLYPH_ADVANCE };
