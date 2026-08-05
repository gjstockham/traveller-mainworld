/**
 * The text the info panel shows (PRD R21), separated from the DOM that shows it.
 *
 * The same split the diagnostics overlay makes, for the same reason: these
 * tests run in Node, there is no jsdom on the test path, and a panel whose
 * content is only reachable through a browser is a panel whose content is only
 * checked when somebody looks at it. What is left in `controlPanel.ts` is
 * element assembly, which Playwright covers.
 *
 * R21 asks for four things — the parsed UPP, its plain-English interpretation,
 * the seed, and the generator version. The interpretation comes from
 * `describeUpp` in `core/ruleset` and is not restated here; what this file adds
 * is the identity block and the reduced-fidelity wording, both of which are the
 * viewer's own business.
 */
import type { FidelityReport } from '../world/choice.js';

/** Everything the identity block states. */
export interface WorldIdentity {
  /** Canonical UPP, or undefined on the fixture route. */
  readonly upp: string | undefined;
  /** Fixture id, or undefined on the UPP route. */
  readonly fixtureId: string | undefined;
  readonly seedText: string | undefined;
  /**
   * Whether the seed was typed or rolled (PRD R2/R3).
   *
   * Stated because a rolled seed that is not obviously rolled is a seed nobody
   * writes down — and R2 exists precisely so it can be.
   */
  readonly seedRolled: boolean;
  readonly genVersion: string;
  readonly rulesetId: string | undefined;
  readonly rulesetName: string | undefined;
  readonly radiusKm: number;
  readonly terrainAmplitudeM: number;
  readonly octaves: number;
}

/**
 * The identity block, as label/value pairs already padded into columns.
 *
 * Deliberately the same shape as the overlay's `stampLines`, so the two panels
 * read alike and a reader who knows one knows the other.
 */
export function identityLines(id: WorldIdentity): string[] {
  const pairs: [string, string][] = [];

  if (id.upp !== undefined) {
    pairs.push(['UPP', id.upp]);
  }
  if (id.fixtureId !== undefined) {
    pairs.push(['fixture', `${id.fixtureId} (spec pinned by the golden manifest)`]);
  }
  if (id.seedText !== undefined) {
    pairs.push(['seed', id.seedRolled ? `${id.seedText} (rolled)` : id.seedText]);
  }

  pairs.push(['radius', `${String(id.radiusKm)} km`]);
  pairs.push(['relief', `${String(id.terrainAmplitudeM)} m peak-to-trough`]);
  pairs.push(['octaves', String(id.octaves)]);
  pairs.push(['generator', id.genVersion]);
  pairs.push([
    'ruleset',
    id.rulesetId === undefined
      ? 'none — a fixture spec is pinned rather than interpreted'
      : `${id.rulesetId}${id.rulesetName === undefined ? '' : ` (${id.rulesetName})`}`,
  ]);

  const width = Math.max(...pairs.map(([label]) => label.length));
  return pairs.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
}

/**
 * The badge's one-line summary: which positions are not honoured.
 *
 * Positions and codes only. The badge has to be readable at a glance from
 * across a table, and "Atmosphere 6, Hydrographics 7" is what tells a
 * Cepheus-literate reader immediately what they are not seeing; the reasons go
 * underneath it, where there is room for them.
 */
export function badgeSummary(report: FidelityReport): string {
  if (!report.reduced) {
    return '';
  }
  const codes = report.notes.map((note) => `${note.position} ${note.code}`).join(', ');
  return `Reduced fidelity — ${codes}`;
}

/** One sentence per unhonoured position, for the badge's body. */
export function badgeDetail(report: FidelityReport): string[] {
  return report.notes.map(
    (note) => `${note.position} ${note.code} (${note.label}): ${note.rendered}.`,
  );
}

/**
 * Why the badge is not an apology.
 *
 * PRD §7's release policy is that nothing ships before Phase 5, so no user ever
 * sees a reduced-fidelity world in a released build. Saying so on the badge is
 * what stops it reading as a defect — it is a development state, and the
 * sentence is here rather than in a comment because the person reading the
 * badge is the person who needs to know it.
 */
export const BADGE_FOOTNOTE =
  'Every valid UPP loads at every phase (PRD §7); codes whose subsystem is not built yet ' +
  'render as the rocky world underneath. Nothing is released before Phase 5, so this is a ' +
  'development state rather than a shipped compromise.';
