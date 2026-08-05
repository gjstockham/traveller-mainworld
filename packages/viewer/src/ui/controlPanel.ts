/**
 * The input UI and info panel (PRD R1–R3, R21, R27).
 *
 * One panel, top right, opposite the diagnostics overlay. It follows the
 * overlay's idiom deliberately rather than introducing a second one: the same
 * translucent dark plate, the same monospace, the same border and radius. Two
 * visual languages on one canvas is how a tool starts looking like two tools.
 *
 * ## What is here and what is not
 *
 * Element assembly only. Every string this panel shows is built in
 * `panelText.ts` or comes from `core` — `describeUpp` for the interpretation,
 * the parser's own message for a validation error, `buildShareUrl` for the
 * link. That is what lets the content be tested in Node, where there is no DOM;
 * what Playwright checks is that the elements exist and the wiring runs.
 *
 * ## The error path is the feature
 *
 * R1 asks for a clear inline error naming the offending position. The parser
 * already produces exactly that sentence, so this panel's whole job is to put
 * it next to the field and **not** replace the world that is already on screen.
 * Before WP12 a bad UPP replaced the entire page with red text, which was right
 * when the only way to supply one was to edit the address bar and wrong the
 * moment there is a field to mistype into: the fix for a typo is to see the
 * typo, not to lose the planet you were looking at.
 */
import { GEN_VERSION, type UppDescription, describeUpp, randomSeedText, resolveSeed } from '@traveller-mainworld/core';

import { type SunDirection, clampSun } from '../render/sun.js';
import { type CameraPose, buildShareUrl } from '../share/url.js';
import type { WorldChoice } from '../world/choice.js';

import { BADGE_FOOTNOTE, badgeDetail, badgeSummary, identityLines } from './panelText.js';

export interface ControlPanelCallbacks {
  /**
   * Apply a UPP and seed.
   *
   * Returns an error message to show inline, or `undefined` on success. A
   * return value rather than a thrown error because "the UPP is malformed" is
   * an ordinary outcome of this control, not an exception.
   */
  readonly onApply: (uppText: string, seedText: string) => string | undefined;
  /** The sun moved. Presentation only; never rebuilds a world. */
  readonly onSun: (dir: SunDirection) => void;
  /** Current camera pose, for the share link. Read at click time, not held. */
  readonly cameraPose: () => CameraPose;
  /**
   * Vertical exaggeration in force.
   *
   * Carried because the share link has to reproduce what is on screen, and an
   * inspection override that did not travel would hand someone a link to a
   * visibly different planet. Omitted from the URL when it is 1.
   */
  readonly exaggeration: number;
}

/** Shared plate styling, so the panel and the overlay cannot drift apart. */
const PLATE = [
  'background:rgba(5,7,13,0.78)',
  'color:#9fb3d0',
  'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid rgba(120,150,190,0.25)',
  'border-radius:4px',
].join(';');

const FIELD = [
  'width:100%',
  'box-sizing:border-box',
  'padding:4px 6px',
  'background:rgba(0,0,0,0.45)',
  'color:#dce6f5',
  'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid rgba(120,150,190,0.35)',
  'border-radius:3px',
].join(';');

const BUTTON = [
  'padding:4px 9px',
  'background:rgba(5,7,13,0.72)',
  'color:#9fb3d0',
  'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid rgba(120,150,190,0.35)',
  'border-radius:4px',
  'cursor:pointer',
].join(';');

export class ControlPanel {
  private readonly container: HTMLDivElement;
  private readonly uppField: HTMLInputElement;
  private readonly seedField: HTMLInputElement;
  private readonly error: HTMLParagraphElement;
  private readonly badge: HTMLDivElement;
  private readonly identity: HTMLPreElement;
  private readonly interpretation: HTMLDivElement;
  private readonly shareButton: HTMLButtonElement;
  private readonly shareField: HTMLInputElement;
  private readonly azimuth: HTMLInputElement;
  private readonly elevation: HTMLInputElement;
  private readonly sunReadout: HTMLSpanElement;

  private sun: SunDirection;
  private choice: WorldChoice | undefined;
  private shareTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Whether the seed about to be shown was rolled rather than typed.
   *
   * Set immediately before `onApply`, which reaches `show` synchronously. R2
   * exists so a rolled seed can be written down, and one that is not visibly
   * rolled is one nobody thinks to record.
   */
  private seedRolled = false;

  constructor(
    parent: HTMLElement,
    sun: SunDirection,
    private readonly callbacks: ControlPanelCallbacks,
  ) {
    this.sun = sun;

    this.container = document.createElement('div');
    this.container.setAttribute('data-panel', 'controls');
    this.container.style.cssText = [
      'position:absolute',
      'top:8px',
      'right:8px',
      'width:22rem',
      'max-width:calc(100vw - 16px)',
      // The panel takes pointer events; the canvas underneath keeps the rest.
      // The overlay solves the same problem the other way round, because it has
      // one button and this has nine controls.
      'pointer-events:auto',
      'max-height:calc(100vh - 16px)',
      'overflow-y:auto',
      'padding:10px',
      PLATE,
    ].join(';');

    // --- input (R1-R3) ---
    const form = document.createElement('form');
    form.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin:0';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.apply();
    });

    this.uppField = field('upp', 'UPP', 'C867A69-8');
    this.seedField = field('seed', 'Seed', 'blank rolls one');
    form.append(this.uppField.parentElement!, this.seedField.parentElement!);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';

    const apply = document.createElement('button');
    apply.type = 'submit';
    apply.setAttribute('data-role', 'generate');
    apply.textContent = 'Generate';
    apply.style.cssText = BUTTON;

    const reroll = document.createElement('button');
    reroll.type = 'button';
    reroll.setAttribute('data-role', 'reroll');
    reroll.textContent = 'Re-roll seed';
    reroll.title = 'Keep the UPP, randomise the seed (PRD R3)';
    reroll.style.cssText = BUTTON;
    reroll.addEventListener('click', () => {
      // R3 is "keep the UPP and randomise the seed", so the field is filled
      // first and applied second — the rolled value has to be on screen and in
      // the URL, or it is a world nobody can get back to.
      this.seedField.value = randomSeedText();
      this.apply(true);
    });

    this.shareButton = document.createElement('button');
    this.shareButton.type = 'button';
    // Named, not found by its label: the label is what a press changes, so a
    // name-based locator stops matching the element it just pressed. The
    // diagnostics overlay learned this the same way.
    this.shareButton.setAttribute('data-role', 'share');
    this.shareButton.textContent = 'Copy link';
    this.shareButton.title = 'A share URL for this exact world (PRD R27)';
    this.shareButton.style.cssText = BUTTON;
    this.shareButton.addEventListener('click', () => {
      this.copyShareLink();
    });

    buttons.append(apply, reroll, this.shareButton);
    form.appendChild(buttons);

    this.error = document.createElement('p');
    this.error.setAttribute('data-role', 'upp-error');
    // Announced rather than merely coloured: a message that only exists as red
    // text is a message a screen reader never delivers, and R1's "clear inline
    // error" is not a colour.
    this.error.setAttribute('role', 'alert');
    this.error.style.cssText = 'margin:0;color:#ff8a94;display:none;white-space:pre-wrap';
    form.appendChild(this.error);

    // Hidden until the clipboard refuses — same fallback the overlay carries,
    // for the same reason: `navigator.clipboard` is undefined over plain HTTP,
    // which is how this page is reached from another device on the LAN.
    this.shareField = document.createElement('input');
    this.shareField.type = 'text';
    this.shareField.readOnly = true;
    this.shareField.hidden = true;
    this.shareField.style.cssText = FIELD;
    form.appendChild(this.shareField);

    this.container.appendChild(form);

    // --- reduced-fidelity badge ---
    this.badge = document.createElement('div');
    this.badge.setAttribute('data-role', 'fidelity-badge');
    this.badge.style.cssText = [
      'display:none',
      'margin-top:10px',
      'padding:6px 8px',
      'background:rgba(90,60,10,0.55)',
      'border:1px solid rgba(220,170,80,0.45)',
      'border-radius:4px',
      'color:#f0d9a8',
    ].join(';');
    this.container.appendChild(this.badge);

    // --- info panel (R21) ---
    this.identity = document.createElement('pre');
    this.identity.setAttribute('data-role', 'identity');
    this.identity.style.cssText = 'margin:10px 0 0;white-space:pre-wrap;word-break:break-word';
    this.container.appendChild(this.identity);

    const details = document.createElement('details');
    details.style.cssText = 'margin-top:8px';
    const summary = document.createElement('summary');
    summary.textContent = 'Interpretation';
    summary.style.cssText = 'cursor:pointer;color:#cfe0f5';
    this.interpretation = document.createElement('div');
    this.interpretation.setAttribute('data-role', 'interpretation');
    this.interpretation.style.cssText = 'margin-top:6px;display:flex;flex-direction:column;gap:5px';
    details.append(summary, this.interpretation);
    this.container.appendChild(details);

    // --- sun (R20) ---
    const sunBlock = document.createElement('div');
    sunBlock.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;gap:4px';
    const sunLabel = document.createElement('div');
    sunLabel.style.cssText = 'display:flex;justify-content:space-between;color:#cfe0f5';
    this.sunReadout = document.createElement('span');
    sunLabel.append(text('Sun'), this.sunReadout);

    this.azimuth = slider('sun-azimuth', 'Sun azimuth', 0, 359, this.sun.azimuthDeg);
    this.elevation = slider('sun-elevation', 'Sun elevation', -89, 89, this.sun.elevationDeg);
    for (const control of [this.azimuth, this.elevation]) {
      control.addEventListener('input', () => {
        this.sun = clampSun({
          azimuthDeg: Number(this.azimuth.value),
          elevationDeg: Number(this.elevation.value),
        });
        this.renderSun();
        this.callbacks.onSun(this.sun);
      });
    }
    sunBlock.append(sunLabel, this.azimuth.parentElement!, this.elevation.parentElement!);
    this.container.appendChild(sunBlock);
    this.renderSun();

    parent.appendChild(this.container);
  }

  /**
   * Show a world.
   *
   * Called on load and after every successful apply, so the fields, the badge
   * and the info panel can never describe a world other than the one being
   * drawn — which is the property the whole panel exists for.
   */
  show(choice: WorldChoice): void {
    this.choice = choice;
    this.clearError();

    if (choice.upp !== undefined) {
      this.uppField.value = choice.upp.canonical;
      this.uppField.disabled = false;
      this.seedField.disabled = false;
    } else {
      // The fixture route. The fields are disabled rather than hidden: a
      // control that vanishes leaves a reader wondering whether the app has one
      // at all, and a disabled one with the reason beside it does not.
      this.uppField.value = '';
      this.uppField.disabled = true;
      this.seedField.disabled = true;
    }
    if (choice.seedText !== undefined) {
      this.seedField.value = choice.seedText;
    }

    this.renderBadge(choice);
    this.renderIdentity(choice);
    this.renderInterpretation(choice);
  }

  /**
   * Put text in the fields without claiming a world was rendered from it.
   *
   * For the one case `show` cannot cover: an initial load that was refused, where
   * there is no world at all and the fields would otherwise come up empty. The
   * fix for a bad URL is to see and edit what it asked for.
   */
  setDraft(uppText: string, seedText: string): void {
    this.uppField.value = uppText;
    this.seedField.value = seedText;
  }

  /** Show an inline validation error without disturbing the world on screen. */
  showError(message: string): void {
    this.error.textContent = message;
    this.error.style.display = 'block';
  }

  clearError(): void {
    this.error.textContent = '';
    this.error.style.display = 'none';
  }

  dispose(): void {
    if (this.shareTimer !== undefined) {
      clearTimeout(this.shareTimer);
    }
    this.container.remove();
  }

  /**
   * @param rolled Whether the seed in the field was just rolled by the re-roll
   *        control. `resolveSeed` cannot tell — by the time it sees the field
   *        the rolled value is a perfectly ordinary string — and R3 and a blank
   *        field are the same outcome to a reader either way.
   */
  private apply(rolled = false): void {
    // A blank seed rolls one and shows it (R2). Resolved here rather than in
    // the caller so the *displayed* seed is the one that was hashed — the
    // property the share URL depends on.
    const seed = resolveSeed(this.seedField.value);
    this.seedField.value = seed.text;
    this.seedRolled = rolled || seed.source === 'random';

    const failure = this.callbacks.onApply(this.uppField.value, seed.text);
    if (failure === undefined) {
      this.clearError();
    } else {
      this.showError(failure);
    }
  }

  private renderBadge(choice: WorldChoice): void {
    if (!choice.fidelity.reduced) {
      this.badge.style.display = 'none';
      this.badge.textContent = '';
      return;
    }

    this.badge.textContent = '';
    const heading = document.createElement('strong');
    heading.textContent = badgeSummary(choice.fidelity);
    heading.style.cssText = 'display:block;margin-bottom:4px';
    this.badge.appendChild(heading);

    for (const line of badgeDetail(choice.fidelity)) {
      const p = document.createElement('p');
      p.textContent = line;
      p.style.cssText = 'margin:0 0 4px';
      this.badge.appendChild(p);
    }

    const footnote = document.createElement('p');
    footnote.textContent = BADGE_FOOTNOTE;
    footnote.style.cssText = 'margin:0;opacity:0.8';
    this.badge.appendChild(footnote);

    this.badge.style.display = 'block';
  }

  private renderIdentity(choice: WorldChoice): void {
    const { spec } = choice.world;
    this.identity.textContent = identityLines({
      upp: choice.upp?.canonical,
      fixtureId: choice.fixtureId,
      seedText: choice.seedText,
      seedRolled: this.seedRolled,
      genVersion: GEN_VERSION,
      rulesetId: choice.ruleset?.id,
      rulesetName: choice.ruleset?.name,
      radiusKm: spec.radiusKm,
      terrainAmplitudeM: spec.terrainAmplitudeM,
      octaves: spec.fbm.octaves,
    }).join('\n');
  }

  private renderInterpretation(choice: WorldChoice): void {
    this.interpretation.textContent = '';

    if (choice.upp === undefined || choice.ruleset === undefined) {
      const note = document.createElement('p');
      note.style.cssText = 'margin:0';
      note.textContent =
        'A golden fixture carries a pinned PhysicalWorldSpec rather than a UPP, so there is ' +
        'nothing to interpret. Use ?upp= to see a ruleset read a world.';
      this.interpretation.appendChild(note);
      return;
    }

    const description: UppDescription = describeUpp(choice.upp, choice.ruleset);
    for (const position of description.positions) {
      const row = document.createElement('div');
      const head = document.createElement('div');
      head.style.cssText = 'color:#cfe0f5';
      head.textContent = `${position.code}  ${position.name} — ${position.label}`;
      const body = document.createElement('div');
      body.style.cssText = 'opacity:0.78';
      body.textContent = position.text;
      row.append(head, body);
      this.interpretation.appendChild(row);
    }

    const attribution = document.createElement('p');
    attribution.style.cssText = 'margin:2px 0 0;opacity:0.7';
    attribution.textContent = `Interpretation from ${description.rulesetName} (${description.rulesetId}).`;
    this.interpretation.appendChild(attribution);
  }

  private renderSun(): void {
    this.sunReadout.textContent = `az ${String(Math.round(this.sun.azimuthDeg))}° · el ${String(
      Math.round(this.sun.elevationDeg),
    )}°`;
  }

  /**
   * Build the share link from the world *currently on screen*.
   *
   * Rebuilt at click time rather than kept up to date, for the reason the
   * overlay's evidence block gives: a value held against a moving camera is
   * stale by definition, and a stale share link is one that reproduces a
   * different view from the one being pointed at.
   */
  private copyShareLink(): void {
    const choice = this.choice;
    if (choice === undefined) {
      return;
    }

    const url = buildShareUrl(window.location.href, {
      world:
        choice.fixtureId === undefined
          ? {
              kind: 'upp',
              upp: choice.upp?.canonical ?? '',
              seedText: choice.seedText ?? '',
              rulesetId: choice.ruleset?.id ?? '',
            }
          : { kind: 'fixture', fixtureId: choice.fixtureId },
      genVersion: GEN_VERSION,
      camera: this.callbacks.cameraPose(),
      sun: this.sun,
      exaggeration: this.callbacks.exaggeration,
    });

    const { clipboard } = navigator;
    if (clipboard === undefined) {
      this.offerLink(url, 'the clipboard API needs HTTPS');
      return;
    }
    void clipboard.writeText(url).then(
      () => {
        this.shareField.hidden = true;
        this.flashShare('Copied');
      },
      (error: unknown) => {
        const why =
          error instanceof Error && /focus/i.test(error.message)
            ? 'the window was not focused'
            : 'the clipboard was refused';
        this.offerLink(url, why);
      },
    );
  }

  private offerLink(url: string, why: string): void {
    this.shareField.value = url;
    this.shareField.hidden = false;
    this.shareField.focus();
    this.shareField.setSelectionRange(0, url.length);
    this.shareButton.textContent = `Select & copy (${why})`;
  }

  /** Every press acknowledges itself, for the reason the overlay's does. */
  private flashShare(message: string): void {
    this.shareButton.textContent = message;
    if (this.shareTimer !== undefined) {
      clearTimeout(this.shareTimer);
    }
    this.shareTimer = setTimeout(() => {
      this.shareButton.textContent = 'Copy link';
      this.shareTimer = undefined;
    }, 1500);
  }
}

/** A labelled text input, returned as the input with its label as the parent. */
function field(id: string, label: string, placeholder: string): HTMLInputElement {
  const wrapper = document.createElement('label');
  wrapper.style.cssText = 'display:flex;flex-direction:column;gap:3px;color:#cfe0f5';
  wrapper.htmlFor = `tmw-${id}`;
  wrapper.appendChild(text(label));

  const input = document.createElement('input');
  input.id = `tmw-${id}`;
  input.name = id;
  input.type = 'text';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.style.cssText = FIELD;
  wrapper.appendChild(input);

  return input;
}

/** A labelled range input, same shape as {@link field}. */
function slider(
  id: string,
  label: string,
  min: number,
  max: number,
  value: number,
): HTMLInputElement {
  const wrapper = document.createElement('label');
  wrapper.style.cssText = 'display:flex;align-items:center;gap:6px';
  wrapper.htmlFor = `tmw-${id}`;
  const caption = document.createElement('span');
  caption.textContent = label;
  caption.style.cssText = 'flex:0 0 6.5rem;opacity:0.8';
  wrapper.appendChild(caption);

  const input = document.createElement('input');
  input.id = `tmw-${id}`;
  input.name = id;
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(Math.round(value));
  input.style.cssText = 'flex:1 1 auto;min-width:0';
  wrapper.appendChild(input);

  return input;
}

function text(value: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = value;
  return span;
}
