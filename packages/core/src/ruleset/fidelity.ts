/**
 * Which UPP positions this phase cannot honour, and what is drawn instead.
 *
 * PRD §7 requires every valid UPP (Size 1+) to load at every phase, with codes
 * whose subsystem is not built yet rendering at reduced fidelity behind a badge.
 * This is that badge's content.
 *
 * ## Why it lives in `core` rather than in the viewer
 *
 * It was the viewer's, and correctly so while the viewer was the only thing that
 * drew a world. WP13 added a second: an exported map of a Hydro-7 world with no
 * ocean and nothing on it to say why is a map whose missing ocean gets filed as
 * a bug against the exporter, by someone holding the PNG rather than the app.
 *
 * That made the scope fence — Atmo 0–1, Hydro 0 — a thing two packages needed to
 * agree about, and a scope fence stated twice is a scope fence that moves once.
 * It is rules knowledge about what the interpreter's output does and does not
 * yet reach, so it belongs beside the interpreter.
 *
 * **This is not the whitelisted zone** and it has no arithmetic in it at all. It
 * reaches no hash: it decides what a caption says.
 *
 * ## Reduced fidelity is data, not a sentence
 *
 * Returned as structure so each consumer decides its own wording — the viewer's
 * badge has room for a paragraph per position and a map's title block has one
 * line — and so a test can assert the *set of positions*. A badge asserted by
 * regex over prose stops testing anything the first time the prose is edited.
 *
 * **Size 0 is not a fidelity note.** It is a refusal, because PRD §3 makes belts
 * a permanent non-goal rather than a pending phase, and a badge saying "not yet"
 * about something that will never come is the worst of both. The refusal belongs
 * to the app, not here: `parseUpp` accepts Size 0 by design and `interpret` is
 * total over it by design, because product scope is neither the parser's job nor
 * the interpreter's.
 */
import { UPP_POSITIONS } from '../input/upp.js';
import type { ParsedUpp } from '../input/upp.js';
import { describeUpp } from './describe.js';
import type { Ruleset } from './ruleset.js';

/** One UPP position this phase does not honour. */
export interface FidelityNote {
  /** The ruleset's display name for the position — "Atmosphere". */
  readonly position: string;
  /** The character as it appears in the canonical spelling. */
  readonly code: string;
  /** The ruleset's own short name for that code. */
  readonly label: string;
  /** What is drawn instead, and which phase changes it. */
  readonly rendered: string;
}

export interface FidelityReport {
  readonly reduced: boolean;
  readonly notes: readonly FidelityNote[];
}

/** The report for a world this phase renders in full. */
export const FULL_FIDELITY: FidelityReport = Object.freeze({ reduced: false, notes: [] });

/** The half of a {@link FidelityNote} that comes straight from the ruleset. */
type DescribedFields = Pick<FidelityNote, 'position' | 'code' | 'label'>;

/**
 * Which positions Phase 1 cannot honour, and what it draws instead.
 *
 * Phase 1 is airless rocky worlds: Atmo 0–1, Hydro 0 (PRD §7). Everything else
 * still renders — that is the requirement — as the rocky world underneath.
 *
 * Population, Government, Law Level and Tech Level are deliberately **not**
 * here. They are not physical and the interpreter never reads them, so there is
 * nothing about the planet they could be said to be degrading; they arrive in
 * Phase 6 as settlement placement, which is an addition rather than a fidelity
 * debt. A badge listing them would be listing four positions the renderer is not
 * wrong about.
 */
export function fidelityFor(upp: ParsedUpp, ruleset: Ruleset): FidelityReport {
  const described = describeUpp(upp, ruleset);

  // Keyed off `UPP_POSITIONS` rather than off a display name, for the reason
  // `describe.ts` gives for doing the same: two copies of "Hydrographics" drift,
  // and the copy that drifts is the one the badge is read from.
  const at = (key: 'atmosphere' | 'hydrographics'): DescribedFields => {
    const index = UPP_POSITIONS.find((p) => p.key === key)?.position;
    const found = described.positions.find((p) => p.position === index);
    if (found === undefined) {
      throw new Error(`ruleset ${ruleset.id} described no ${key} position`);
    }
    return { position: found.name, code: found.code, label: found.label };
  };

  const notes: FidelityNote[] = [];

  if (upp.atmosphere > 1) {
    notes.push({
      ...at('atmosphere'),
      rendered:
        'drawn as a vacuum — sky colour, haze and scattering are Phase 2, and the surface ' +
        'tinting an atmosphere implies is Phase 4',
    });
  }

  if (upp.hydrographics > 0) {
    notes.push({
      ...at('hydrographics'),
      rendered:
        'drawn dry — the sea-level solve against terrain (R8), coastlines and ice caps are ' +
        'Phase 2',
    });
  }

  return notes.length === 0 ? FULL_FIDELITY : { reduced: true, notes };
}

/**
 * The one-line summary: which positions are not honoured.
 *
 * Positions and codes only. It has to be readable at a glance — from across a
 * table on the viewer's badge, or in a title block on an exported map — and
 * "Atmosphere 6, Hydrographics 7" is what tells a Cepheus-literate reader
 * immediately what they are not seeing. The reasons go underneath, wherever
 * there is room for them.
 *
 * **ASCII only**, because `packages/export`'s 5×7 font is, and a summary that
 * renders as a question mark beside a code is worse than a plain one.
 */
export function fidelitySummary(report: FidelityReport): string {
  if (!report.reduced) {
    return '';
  }
  const codes = report.notes.map((note) => `${note.position} ${note.code}`).join(', ');
  return `Reduced fidelity - ${codes}`;
}
