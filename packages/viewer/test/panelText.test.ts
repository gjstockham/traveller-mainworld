/**
 * WP12: what the info panel and the badge say (PRD R21, §7).
 *
 * The DOM around these strings is Playwright's business; the strings are this
 * file's, for the same reason the diagnostics overlay splits `memoryLines` out
 * of its own panel — there is no jsdom on the unit-test path, and a panel whose
 * content is only reachable through a browser is content that is only checked
 * when somebody looks at it.
 */
import { CEPHEUS_1, type ParsedUpp, isUppError, parseUpp } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { BADGE_FOOTNOTE, badgeDetail, badgeSummary, identityLines } from '../src/ui/panelText.js';
import { fidelityFor } from '../src/world/choice.js';

function asUpp(text: string): ParsedUpp {
  const parsed = parseUpp(text);
  if (isUppError(parsed)) {
    throw new Error(parsed.message);
  }
  return parsed;
}

const LUNA = {
  upp: 'F20076C-F',
  fixtureId: undefined,
  seedText: '42',
  seedRolled: false,
  genVersion: '0.2.0-alpha.4',
  rulesetId: 'cepheus-1',
  rulesetName: 'Cepheus Engine',
  radiusKm: 1600,
  terrainAmplitudeM: 17_000,
  octaves: 8,
};

describe('the identity block (R21)', () => {
  it('states all four things R21 asks for', () => {
    // Parsed UPP, seed, generator version — and the ruleset, which R27 makes
    // part of the world's identity rather than a detail of how it was read.
    const text = identityLines(LUNA).join('\n');
    expect(text).toContain('F20076C-F');
    expect(text).toContain('42');
    expect(text).toContain('0.2.0-alpha.4');
    expect(text).toContain('cepheus-1');
    expect(text).toContain('Cepheus Engine');
  });

  it('says when a seed was rolled rather than typed', () => {
    // R2 exists so a rolled seed can be written down. A rolled seed that is not
    // visibly rolled is one nobody thinks to record.
    expect(identityLines({ ...LUNA, seedRolled: true }).join('\n')).toContain('42 (rolled)');
    expect(identityLines(LUNA).join('\n')).not.toContain('(rolled)');
  });

  it('describes a fixture as pinned, and names no ruleset for it', () => {
    // A fixture's spec is not interpreted, so claiming a ruleset would be
    // claiming an interpretation that never ran.
    const text = identityLines({
      ...LUNA,
      upp: undefined,
      fixtureId: 'size4-luna',
      seedText: undefined,
      rulesetId: undefined,
      rulesetName: undefined,
    }).join('\n');
    expect(text).toContain('size4-luna');
    expect(text).toContain('pinned');
    expect(text).not.toContain('cepheus-1');
    expect(text).not.toMatch(/^seed/m);
  });

  it('aligns its values into a column, like the overlay stamp', () => {
    // Not decoration: the two panels sit either side of the same canvas, and a
    // reader who knows one should know the other.
    const starts = identityLines(LUNA).map((line) => {
      const match = /^(\S+)( +)\S/.exec(line);
      if (match === null) {
        throw new Error(`not a label/value line: ${line}`);
      }
      return match[1]!.length + match[2]!.length;
    });
    expect(new Set(starts).size).toBe(1);
  });
});

describe('the reduced-fidelity badge (PRD §7)', () => {
  const fidelity = (upp: string): ReturnType<typeof fidelityFor> =>
    fidelityFor(asUpp(upp), CEPHEUS_1);

  it('is empty for a world Phase 1 renders in full', () => {
    expect(badgeSummary(fidelity('X100000-0'))).toBe('');
    expect(badgeDetail(fidelity('X100000-0'))).toEqual([]);
  });

  it('names the positions and codes at a glance', () => {
    // The summary has to be readable from across a table — positions and codes
    // are what tell a Cepheus-literate reader what they are not seeing.
    const summary = badgeSummary(fidelity('C867A69-8'));
    expect(summary).toContain('Atmosphere 6');
    expect(summary).toContain('Hydrographics 7');
    expect(summary).toContain('Reduced fidelity');
  });

  it('says what is drawn instead, one sentence per position', () => {
    const detail = badgeDetail(fidelity('C867A69-8'));
    expect(detail).toHaveLength(2);
    // Each sentence carries the ruleset's own label for the code, so the badge
    // cannot contradict the interpretation two rows below it in the same panel.
    expect(detail[0]).toContain('Atmosphere 6');
    expect(detail[0]).toContain('vacuum');
    expect(detail[1]).toContain('Hydrographics 7');
    expect(detail[1]).toContain('dry');
    for (const line of detail) {
      expect(line.endsWith('.')).toBe(true);
    }
  });

  it('carries the release policy, so the badge does not read as a defect', () => {
    // PRD §7: nothing ships before Phase 5, so no user ever sees this in a
    // released build. It is a development state, and the sentence saying so
    // belongs where the person reading the badge is.
    expect(BADGE_FOOTNOTE).toContain('Phase 5');
    expect(BADGE_FOOTNOTE).toContain('development state');
  });
});
