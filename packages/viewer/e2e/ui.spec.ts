import { expect, test } from '@playwright/test';

/**
 * WP12: the input UI, the info panel, the badge and the share URL.
 *
 * These are the half of WP12 that a browser can check without a GPU. Nothing
 * here reads a frame time or a pixel — headless Chromium rasterises in software
 * and neither would mean anything — and nothing here needs a streamed globe, so
 * unlike `renders a recognisable globe` and `keeps rendering while the camera
 * orbits` these specs are a real signal under WSL2 as well as on the Windows
 * side.
 *
 * What they cannot check is whether the planet looks right. That stays a human
 * check, recorded in `docs/evidence/wp12-viewer.md`.
 */

const PANEL = '#app [data-panel="controls"]';
const UPP = '#tmw-upp';
const SEED = '#tmw-seed';
const ERROR = '#app [data-role="upp-error"]';
const BADGE = '#app [data-role="fidelity-badge"]';
const IDENTITY = '#app [data-role="identity"]';

/** The panel is built synchronously with the shell, before any tile arrives. */
async function awaitPanel(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
}

test('shows the UPP it is actually rendering', async ({ page }) => {
  // The reason the default route stopped being a hand-overridden stand-in: a
  // field showing a UPP beside a planet built from three overrides is a lie the
  // user has no way to catch.
  await page.goto('/');
  await awaitPanel(page);

  await expect(page.locator(UPP)).toHaveValue('F20076C-F');
  await expect(page.locator(SEED)).toHaveValue('42');

  const identity = await page.locator(IDENTITY).innerText();
  expect(identity).toContain('F20076C-F');
  expect(identity).toContain('cepheus-1');
  expect(identity).toMatch(/generator\s+\d+\.\d+\.\d+/);
});

test('interprets the UPP in plain English (R21)', async ({ page }) => {
  await page.goto('/?upp=C867A69-8');
  await awaitPanel(page);

  const interpretation = page.locator('#app [data-role="interpretation"]');
  // All eight positions, not the three the MVP generates from: the panel is
  // where a GM reads the world.
  await expect(interpretation).toContainText('Starport');
  await expect(interpretation).toContainText('Size');
  await expect(interpretation).toContainText('Atmosphere');
  await expect(interpretation).toContainText('Hydrographics');
  await expect(interpretation).toContainText('Tech Level');
  await expect(interpretation).toContainText('cepheus-1');
});

test('badges a world Phase 1 cannot render in full, and only that world', async ({ page }) => {
  await page.goto('/?upp=C867A69-8');
  await awaitPanel(page);
  await expect(page.locator(BADGE)).toBeVisible();
  await expect(page.locator(BADGE)).toContainText('Atmosphere 6');
  await expect(page.locator(BADGE)).toContainText('Hydrographics 7');
  // And says why it is not a defect: nothing ships before Phase 5.
  await expect(page.locator(BADGE)).toContainText('Phase 5');

  await page.goto('/?upp=X100000-0');
  await awaitPanel(page);
  await expect(page.locator(BADGE)).toBeHidden();
});

test('shows a parser error inline and keeps the world on screen', async ({ page }) => {
  // The behaviour change WP12 makes: before it, a bad UPP replaced the whole
  // page with red text, which is right when the only way to supply one is the
  // address bar and wrong the moment there is a field to mistype into.
  await page.goto('/');
  await awaitPanel(page);
  await expect(page.locator(ERROR)).toBeHidden();

  await page.locator(UPP).fill('X8Z7A69-8');
  await page.locator('#app button[data-role="generate"]').click();

  await expect(page.locator(ERROR)).toBeVisible();
  await expect(page.locator(ERROR)).toContainText('Position 3 (Atmosphere)');
  // The planet is still there, and it is still the one that was there before.
  await expect(page.locator('#app canvas')).toBeVisible();
  await expect(page.locator(IDENTITY)).toContainText('F20076C-F');
});

test('refuses Size 0 with the reason, not a broken planet', async ({ page }) => {
  await page.goto('/');
  await awaitPanel(page);
  await page.locator(UPP).fill('X000000-0');
  await page.locator('#app button[data-role="generate"]').click();

  await expect(page.locator(ERROR)).toContainText('Size 0');
  await expect(page.locator(ERROR)).toContainText('belt');
  // A permanent non-goal (PRD §3), so it gets the refusal rather than a badge.
  await expect(page.locator(BADGE)).toBeHidden();
});

test('applies a new UPP and puts it in the URL (R4)', async ({ page }) => {
  await page.goto('/');
  await awaitPanel(page);

  await page.locator(UPP).fill('XA00000-0');
  await page.locator(SEED).fill('alpha');
  await page.locator('#app button[data-role="generate"]').click();

  await expect(page.locator(ERROR)).toBeHidden();
  await expect(page.locator(IDENTITY)).toContainText('XA00000-0');
  await expect(page.locator(IDENTITY)).toContainText('8000 km');

  const url = new URL(page.url());
  expect(url.searchParams.get('upp')).toBe('XA00000-0');
  expect(url.searchParams.get('seed')).toBe('alpha');
  expect(url.searchParams.get('ruleset')).toBe('cepheus-1');
  expect(url.searchParams.get('gen')).toBeTruthy();
});

test('re-rolls the seed and keeps the UPP (R3)', async ({ page }) => {
  await page.goto('/?upp=X400000-0&seed=alpha');
  await awaitPanel(page);

  await page.locator('#app button[data-role="reroll"]').click();

  await expect(page.locator(UPP)).toHaveValue('X400000-0');
  const seed = await page.locator(SEED).inputValue();
  expect(seed).not.toBe('alpha');
  // Rolled seeds are decimal digits so they can be read off a screen and
  // written down without 0/O or 1/l ambiguity (R2).
  expect(seed).toMatch(/^[1-9]\d{11}$/);
  expect(new URL(page.url()).searchParams.get('seed')).toBe(seed);
});

test('rolls a seed when the field is left blank, and shows it (R2)', async ({ page }) => {
  await page.goto('/');
  await awaitPanel(page);

  await page.locator(SEED).fill('   ');
  await page.locator('#app button[data-role="generate"]').click();

  const seed = await page.locator(SEED).inputValue();
  expect(seed).toMatch(/^[1-9]\d{11}$/);
  await expect(page.locator(IDENTITY)).toContainText(seed);
});

test('copies a share link carrying all four parameters (R27)', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?upp=X400000-0&seed=7');
  await awaitPanel(page);

  // Located by role attribute, not by name: pressing it changes the label, and
  // a name-based locator would stop matching the element it just pressed.
  const button = page.locator('#app button[data-role="share"]');
  await button.click();
  await expect(button).toHaveText('Copied', { timeout: 5_000 });

  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied.searchParams.get('upp')).toBe('X400000-0');
  expect(copied.searchParams.get('seed')).toBe('7');
  expect(copied.searchParams.get('ruleset')).toBe('cepheus-1');
  expect(copied.searchParams.get('gen')).toBeTruthy();
  // The camera is the nice-to-have half of R27, and it is a separate parameter
  // so that a URL without it still works.
  expect(copied.searchParams.get('cam')).toMatch(/^-?[\d.]+,-?[\d.]+,[\d.]+$/);
});

test('refuses a generator version it cannot produce, by name', async ({ page }) => {
  // R15 obliges the app to render older versions and WP14 builds the registry
  // that will. Until then the dangerous outcome is not an error — it is
  // rendering the link with the current generator and showing a different world.
  await page.goto('/?upp=X400000-0&gen=0.1.0');
  await expect(page.locator('#app')).toContainText('0.1.0');
  await expect(page.locator('#app')).toContainText('R15');
});

test('refuses an unknown ruleset, naming the ones it has', async ({ page }) => {
  await page.goto('/?upp=X400000-0&ruleset=cepheus-2');
  await awaitPanel(page);
  await expect(page.locator(ERROR)).toContainText("unknown ruleset 'cepheus-2'");
  await expect(page.locator(ERROR)).toContainText('cepheus-1');
});

test('disables the input fields on the fixture route, rather than hiding them', async ({ page }) => {
  // A fixture's spec is pinned by the golden manifest, so there is no UPP to
  // edit. A control that vanishes leaves a reader wondering whether the app has
  // one at all; a disabled one with the reason beside it does not.
  await page.goto('/?fixture=size4-luna');
  await awaitPanel(page);
  await expect(page.locator(UPP)).toBeDisabled();
  await expect(page.locator(SEED)).toBeDisabled();
  await expect(page.locator(IDENTITY)).toContainText('size4-luna');
  await expect(page.locator(IDENTITY)).toContainText('pinned');
});

test('opens at the camera a share URL names, and without one when it does not', async ({ page }) => {
  await page.goto('/?upp=X400000-0&cam=90,30,4000');
  await expect(page.locator('#app pre[data-role="diagnostics"]')).toContainText('altitude', {
    timeout: 20_000,
  });
  // 4000 km on a Size 4 world, which the overlay reports in megametres.
  await expect(page.locator('#app pre[data-role="diagnostics"]')).toContainText('4.0 Mm');

  await page.goto('/?upp=X400000-0');
  await expect(page.locator('#app pre[data-role="diagnostics"]')).toContainText('15.0 Mm', {
    timeout: 20_000,
  });
});

test('refuses a malformed camera rather than ignoring it', async ({ page }) => {
  await page.goto('/?upp=X400000-0&cam=90,30');
  await expect(page.locator('#app')).toContainText('azimuth,elevation,altitudeKm');
});

test('navigates by keyboard, and can get back (R18)', async ({ page }) => {
  const overlay = page.locator('#app pre[data-role="diagnostics"]');
  await page.goto('/?upp=X400000-0');
  await expect(overlay).toContainText('altitude', { timeout: 20_000 });

  const altitude = async (): Promise<number> => {
    const line = (await overlay.innerText()).split('\n').find((l) => l.startsWith('altitude'))!;
    const value = Number(/-?\d+(\.\d+)?/.exec(line)![0]);
    return line.includes('Mm') ? value * 1000 : value;
  };
  const framed = await altitude();

  // The canvas is a control and is in the tab order, so a keyboard user can
  // reach it at all.
  await page.locator('#app canvas').focus();
  await expect(page.locator('#app canvas')).toBeFocused();

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('+');
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(500);
  expect(await altitude()).toBeLessThan(framed * 0.9);

  // ...and back. Controls that can reach a state they cannot leave are not
  // keyboard fallbacks.
  await page.keyboard.press('Home');
  await page.waitForTimeout(500);
  expect(await altitude()).toBeCloseTo(framed, 0);
});

test('typing in the UPP field does not move the camera', async ({ page }) => {
  // The camera's arrow keys live on the canvas, so a field that shares them
  // would either steal the caret or spin the planet. Worth a test because the
  // failure is silent and infuriating.
  const overlay = page.locator('#app pre[data-role="diagnostics"]');
  await page.goto('/?upp=X400000-0');
  await expect(overlay).toContainText('altitude', { timeout: 20_000 });
  await page.waitForTimeout(500);

  const before = await overlay.innerText();
  const field = page.locator(UPP);
  await field.focus();
  await field.press('ArrowLeft');
  await field.press('ArrowRight');
  await field.press('+');
  await page.waitForTimeout(500);

  const altitudeOf = (text: string): string =>
    text.split('\n').find((l) => l.startsWith('altitude'))!;
  expect(altitudeOf(await overlay.innerText())).toBe(altitudeOf(before));
});

test('keeps an inspection override in the URL across a Generate (R4)', async ({ page }) => {
  // The address bar is edited in place rather than rebuilt from the canonical
  // share form, and this is why: `?exaggeration=` is still being applied by the
  // renderer, so a URL that dropped it would no longer reload to what is on
  // screen. That is the one failure a round-trippable URL must not have.
  await page.goto('/?upp=X400000-0&exaggeration=20&debug=1');
  await awaitPanel(page);

  await page.locator(UPP).fill('X600000-0');
  await page.locator('#app button[data-role="generate"]').click();
  await expect(page.locator(IDENTITY)).toContainText('X600000-0');

  const url = new URL(page.url());
  expect(url.searchParams.get('exaggeration')).toBe('20');
  expect(url.searchParams.get('debug')).toBe('1');
  // ...and the override is stamped where evidence is read from, so a session
  // flown through it is never mistaken for one flown at true scale.
  await expect(page.locator('#app pre[data-role="diagnostics"]')).toBeVisible();
});

test('marks a rolled seed as rolled, so it gets written down (R2)', async ({ page }) => {
  await page.goto('/?upp=X400000-0&seed=alpha');
  await awaitPanel(page);
  await expect(page.locator(IDENTITY)).not.toContainText('(rolled)');

  await page.locator('#app button[data-role="reroll"]').click();
  await expect(page.locator(IDENTITY)).toContainText('(rolled)');
});

test('shows the UPP a refused URL asked for, so it can be fixed', async ({ page }) => {
  // No world at all on this path. The fields would otherwise come up empty, and
  // the fix for a bad URL is to see and edit the thing that was wrong with it.
  await page.goto('/?upp=X000000-0');
  await awaitPanel(page);
  await expect(page.locator(ERROR)).toContainText('Size 0');
  await expect(page.locator(UPP)).toHaveValue('X000000-0');

  await page.locator(UPP).fill('X400000-0');
  await page.locator('#app button[data-role="generate"]').click();
  await expect(page.locator(ERROR)).toBeHidden();
  await expect(page.locator(IDENTITY)).toContainText('X400000-0');
});
