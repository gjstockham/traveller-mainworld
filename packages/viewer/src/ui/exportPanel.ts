/**
 * The export controls (R23–R26), as a collapsed section under the info panel.
 *
 * DOM only. Everything that decides *what* an export is — the projection, the
 * detail depth, the title block's wording — is `packages/export`, tested in
 * Node; everything that decides how it is *asked for* is here, and Playwright
 * covers it. That is the same split `panelText.ts` makes from `controlPanel.ts`,
 * and it matters more here because an export runs for tens of seconds and a
 * control that silently does the wrong thing costs a minute each time.
 *
 * ## Collapsed by default
 *
 * The panel already carries nine controls and the export adds five. An export is
 * an occasional act — session prep, a wiki page — and not part of the U1 loop,
 * so it goes behind a `<details>` rather than competing with the UPP field for
 * the first thing a user sees.
 *
 * ## Everything clickable carries `data-role`
 *
 * WP12's trap, hit on the "Copy link" button: a Playwright locator that names a
 * label breaks when the label is what changed, and an export button's label
 * changes to "Cancel" mid-render by design.
 */
import {
  type ExportJob,
  type RenderProgress,
  ExportAborted,
  buildExportJob,
  detailDepthFor,
  drawOverlays,
  encodePng,
  parseSize,
  projectionIds,
  renderWithPool,
  requireProjection,
  titleMetadata,
} from '@traveller-mainworld/export';
import { fidelitySummary } from '@traveller-mainworld/core';

import { spawnExportPool } from '../workers/exportPool.js';
import type { WorldChoice } from '../world/choice.js';

/** The two R24 reference sizes, plus a quick one for looking at something. */
const SIZES = ['1024x512', '2048x1024', '4096x2048'];

const BUTTON = [
  'padding:4px 9px',
  'background:rgba(5,7,13,0.72)',
  'color:#9fb3d0',
  'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid rgba(120,150,190,0.35)',
  'border-radius:4px',
  'cursor:pointer',
].join(';');

const SELECT = [
  'flex:1',
  'min-width:0',
  'padding:3px 4px',
  'background:rgba(0,0,0,0.45)',
  'color:#dce6f5',
  'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid rgba(120,150,190,0.35)',
  'border-radius:3px',
].join(';');

export class ExportPanel {
  private readonly details: HTMLDetailsElement;
  private readonly projection: HTMLSelectElement;
  private readonly size: HTMLSelectElement;
  private readonly graticule: HTMLInputElement;
  private readonly titleBlock: HTMLInputElement;
  private readonly button: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;

  private choice: WorldChoice | undefined;
  /** Set while a render is in flight; the cancel button flips `aborted`. */
  private signal: { aborted: boolean } | undefined;

  constructor(parent: HTMLElement) {
    this.details = document.createElement('details');
    this.details.setAttribute('data-role', 'export');
    this.details.style.cssText = 'margin-top:8px';

    const summary = document.createElement('summary');
    summary.textContent = 'Export a map';
    summary.style.cssText = 'cursor:pointer;color:#c7d6ea';
    this.details.appendChild(summary);

    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-top:6px';

    this.projection = select('export-projection', projectionIds(), 'equirectangular');
    this.size = select('export-size', SIZES, '2048x1024');
    body.append(row('Projection', this.projection), row('Size', this.size));

    this.graticule = checkbox('export-graticule', 'Graticule (15/30 deg)', true);
    this.titleBlock = checkbox('export-title', 'Title block', true);
    body.append(this.graticule.parentElement!, this.titleBlock.parentElement!);

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.setAttribute('data-role', 'export-run');
    this.button.textContent = 'Export PNG';
    this.button.style.cssText = BUTTON;
    this.button.addEventListener('click', () => {
      void this.run();
    });
    body.appendChild(this.button);

    this.status = document.createElement('p');
    this.status.setAttribute('data-role', 'export-status');
    this.status.style.cssText = 'margin:0;color:#8fa6c2;min-height:1.4em';
    body.appendChild(this.status);

    // Both controls change the derived detail depth, which the title block
    // prints — so it is shown before the render rather than discovered in the
    // finished file.
    for (const control of [this.projection, this.size]) {
      control.addEventListener('change', () => {
        this.describe();
      });
    }

    this.details.appendChild(body);
    parent.appendChild(this.details);
    this.describe();
  }

  /** The world an export would be of. Called on every session change. */
  show(choice: WorldChoice): void {
    this.choice = choice;
    this.describe();
  }

  dispose(): void {
    if (this.signal !== undefined) {
      this.signal.aborted = true;
    }
    this.details.remove();
  }

  /** Say what the current settings would produce, before committing minutes to it. */
  private describe(): void {
    if (this.signal !== undefined) {
      return;
    }
    try {
      const size = parseSize(this.size.value);
      const projection = requireProjection(this.projection.value);
      this.status.textContent =
        `${String(size.width * size.height)} samples, detail depth ` +
        `${String(detailDepthFor(projection, size))}`;
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  /** Assemble the job for what is currently selected. */
  private job(choice: WorldChoice): ExportJob {
    return buildExportJob(
      choice.world,
      {
        upp: choice.upp?.canonical,
        fixtureId: choice.fixtureId,
        seedText: choice.seedText,
        rulesetId: choice.ruleset?.id,
        rulesetName: choice.ruleset?.name,
        // The same report the badge above is drawn from — see
        // `core/ruleset/fidelity.ts` for why it moved out of the viewer.
        fidelity: fidelitySummary(choice.fidelity) || undefined,
      },
      {
        size: parseSize(this.size.value),
        projectionId: this.projection.value,
        graticule: this.graticule.checked,
        titleBlock: this.titleBlock.checked,
      },
    );
  }

  private async run(): Promise<void> {
    if (this.signal !== undefined) {
      // The button is a cancel button while a render is in flight. An export
      // somebody has walked away from should stop costing them every core.
      this.signal.aborted = true;
      return;
    }
    const choice = this.choice;
    if (choice === undefined) {
      this.status.textContent = 'no world loaded';
      return;
    }

    const signal = { aborted: false };
    this.signal = signal;
    this.button.textContent = 'Cancel';
    const started = performance.now();

    try {
      const job = this.job(choice);
      const raster = await renderWithPool(job, spawnExportPool(job), {
        signal,
        onProgress: (progress: RenderProgress) => {
          const percent = Math.round((progress.rows / progress.total) * 100);
          this.status.textContent = `rendering ${String(percent)}%`;
        },
      });

      this.status.textContent = 'drawing overlays';
      // After every band has landed, never inside one: a graticule line is found
      // by comparing a pixel to the one above it, and that pixel belongs to the
      // previous band. Per-band overlays would drop one parallel per band
      // boundary, in a pattern that reads exactly like a tiling artefact.
      drawOverlays(raster, job);

      this.status.textContent = 'encoding';
      const projection = requireProjection(job.projectionId, job.projectionOptions);
      const png = await encodePng(raster, titleMetadata(job, projection));
      download(png, fileName(choice, job));

      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      this.status.textContent = `done in ${seconds} s, ${String(Math.round(png.length / 1024))} kB`;
    } catch (error) {
      this.status.textContent =
        error instanceof ExportAborted
          ? 'cancelled'
          : `export failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.signal = undefined;
      this.button.textContent = 'Export PNG';
    }
  }
}

/** A file name somebody can find again: the world, the seed and the projection. */
function fileName(choice: WorldChoice, job: ExportJob): string {
  const world = choice.upp?.canonical ?? choice.fixtureId ?? 'world';
  const seed = choice.seedText === undefined ? '' : `-seed-${choice.seedText}`;
  return `${world}${seed}-${job.projectionId}-${String(job.size.width)}.png`
    .replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Hand the bytes to the browser. Client-side only (R26): no round trip anywhere. */
function download(png: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoked on the next turn rather than immediately: some browsers have not
  // finished reading the blob when `click` returns.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function row(label: string, control: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;gap:6px;align-items:center';
  const text = document.createElement('span');
  text.textContent = label;
  text.style.cssText = 'flex:0 0 5.5rem';
  wrapper.append(text, control);
  return wrapper;
}

function select(role: string, options: readonly string[], initial: string): HTMLSelectElement {
  const element = document.createElement('select');
  element.setAttribute('data-role', role);
  element.style.cssText = SELECT;
  for (const value of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    element.appendChild(option);
  }
  element.value = initial;
  return element;
}

function checkbox(role: string, label: string, initial: boolean): HTMLInputElement {
  const wrapper = document.createElement('label');
  wrapper.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initial;
  input.setAttribute('data-role', role);
  const text = document.createElement('span');
  text.textContent = label;
  wrapper.append(input, text);
  return input;
}
