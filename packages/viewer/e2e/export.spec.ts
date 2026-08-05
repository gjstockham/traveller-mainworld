import { expect, test } from '@playwright/test';

/**
 * WP13: the export controls, and one real export end to end.
 *
 * The half of WP13 that only a browser can check. Everything the exporter
 * *decides* — the projection maths, the detail depth, the palette application,
 * the graticule, the title block, the PNG container — is `packages/export` and
 * is asserted in Node, where about two thousand lines of it live. What is left
 * here is the wiring: that the controls exist, that a click starts a render,
 * that the worker pool comes back, and that a file arrives.
 *
 * **The download and the pool are the parts that cannot be tested any other
 * way.** `Worker`, `Blob`, `URL.createObjectURL` and the anchor click have no
 * Node counterpart, and `pool.test.ts` covers the scheduling around them with a
 * `LocalBandWorker` precisely because this leg does not run under WSL2.
 *
 * Nothing here reads a frame time or a pixel — headless Chromium rasterises in
 * software — and nothing here needs a streamed globe, so unlike `renders a
 * recognisable globe` these are a real signal on either side.
 */

const PANEL = '#app [data-panel="controls"]';
const SECTION = '#app [data-role="export"]';
const RUN = '#app [data-role="export-run"]';
const STATUS = '#app [data-role="export-status"]';
const PROJECTION = '#app [data-role="export-projection"]';
const SIZE = '#app [data-role="export-size"]';

async function openExport(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
  // Collapsed by default: an export is an occasional act, not part of the U1
  // loop, so it should not compete with the UPP field for attention.
  await expect(page.locator(SECTION)).toHaveJSProperty('open', false);
  await page.locator(`${SECTION} summary`).click();
  await expect(page.locator(RUN)).toBeVisible();
}

test('offers both MVP projections and the two R24 reference sizes', async ({ page }) => {
  await page.goto('/');
  await openExport(page);

  const projections = await page.locator(`${PROJECTION} option`).allTextContents();
  expect(projections).toEqual(['equirectangular', 'mercator']);

  const sizes = await page.locator(`${SIZE} option`).allTextContents();
  expect(sizes).toContain('2048x1024');
  expect(sizes).toContain('4096x2048');
});

test('shows the derived detail depth before committing minutes to a render', async ({ page }) => {
  // The number is on the finished map either way; showing it first is what stops
  // a user discovering an unintended setting after a two-minute render.
  await page.goto('/');
  await openExport(page);

  await page.locator(SIZE).selectOption('1024x512');
  await expect(page.locator(STATUS)).toHaveText(/524288 samples, detail depth 2/);

  await page.locator(SIZE).selectOption('4096x2048');
  await expect(page.locator(STATUS)).toHaveText(/8388608 samples, detail depth 4/);
});

test('renders a map across the worker pool and downloads it', async ({ page }) => {
  // The end-to-end check, at the smallest offered size so the leg stays quick.
  // What it proves that Node cannot: the module workers spawn, the job survives
  // the structured clone, the bands come back, and a PNG reaches the browser.
  await page.goto('/');
  await openExport(page);
  await page.locator(SIZE).selectOption('1024x512');

  const download = page.waitForEvent('download', { timeout: 180_000 });
  await page.locator(RUN).click();

  // The button becomes a cancel button while a render is in flight, which is
  // why every locator here is a `data-role` and not a label — WP12's trap.
  await expect(page.locator(RUN)).toHaveText('Cancel');
  await expect(page.locator(STATUS)).toHaveText(/rendering \d+%/);

  const file = await download;
  expect(file.suggestedFilename()).toBe('F20076C-F-seed-42-equirectangular-1024.png');

  await expect(page.locator(STATUS)).toHaveText(/done in [\d.]+ s, \d+ kB/, { timeout: 30_000 });
  await expect(page.locator(RUN)).toHaveText('Export PNG');

  // A real PNG, by its signature. Anything more is `png.test.ts`'s job.
  const stream = await file.createReadStream();
  const head: Buffer[] = [];
  for await (const chunk of stream) {
    head.push(chunk as Buffer);
    if (Buffer.concat(head).length >= 8) {
      break;
    }
  }
  expect(Buffer.concat(head).subarray(0, 8).toString('latin1')).toBe(
    '\x89PNG\r\n\x1a\n',
  );
});

test('cancels a render rather than making somebody wait it out', async ({ page }) => {
  // An export somebody has walked away from should stop costing them every
  // core. Started at the largest size so there is time to press cancel.
  await page.goto('/');
  await openExport(page);
  await page.locator(SIZE).selectOption('4096x2048');

  await page.locator(RUN).click();
  await expect(page.locator(RUN)).toHaveText('Cancel');
  await page.locator(RUN).click();

  await expect(page.locator(STATUS)).toHaveText('cancelled', { timeout: 60_000 });
  await expect(page.locator(RUN)).toHaveText('Export PNG');
});

test('names the fixture rather than a UPP on the fixture route', async ({ page }) => {
  await page.goto('/?fixture=size4-luna');
  await openExport(page);
  await page.locator(SIZE).selectOption('1024x512');

  const download = page.waitForEvent('download', { timeout: 180_000 });
  await page.locator(RUN).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('size4-luna-equirectangular-1024.png');
});
