import { describe, expect, it } from 'vitest';

import { STARPORT_CLASSES, UPP_POSITIONS, isUppError, parseUpp } from '../src/input/upp.js';
import { CEPHEUS_1 } from '../src/ruleset/cepheus1/index.js';
import { describeUpp, missingProse } from '../src/ruleset/describe.js';

const EHEX = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function parsed(text: string) {
  const result = parseUpp(text);
  if (isUppError(result)) throw new Error(`${text}: ${result.message}`);
  return result;
}

describe('describeUpp', () => {
  const description = describeUpp(parsed('C867A69-8'));

  it('describes every position, in UPP order', () => {
    expect(description.positions.map((p) => p.position)).toEqual(
      UPP_POSITIONS.map((p) => p.position),
    );
    expect(description.positions.map((p) => p.name)).toEqual(UPP_POSITIONS.map((p) => p.name));
  });

  it('reports the character each position occupies in the canonical spelling', () => {
    // Position 8 sits at index 8, not 7 — the hyphen occupies index 7, and
    // getting that wrong would show the Law Level code against the Tech Level
    // name without anything else going visibly wrong.
    expect(description.positions.map((p) => p.code).join('')).toBe('C867A698');
    expect(description.canonical).toBe('C867A69-8');
  });

  it('carries the decoded value for every numeric position and none for the starport', () => {
    const byName = new Map(description.positions.map((p) => [p.name, p]));
    expect(byName.get('Starport')!.value).toBeUndefined();
    expect(byName.get('Size')!.value).toBe(8);
    expect(byName.get('Population')!.value).toBe(10);
    expect(byName.get('Tech Level')!.value).toBe(8);
  });

  it('names the ruleset that supplied the prose', () => {
    expect(description.rulesetId).toBe(CEPHEUS_1.id);
    expect(description.rulesetName).toBe(CEPHEUS_1.name);
  });

  it('covers the whole UPP, not just the digits the MVP generates from', () => {
    // The temptation is to gloss Size, Atmosphere and Hydrographics only. A
    // panel that explains those three and leaves "Government: 6" bare is a
    // panel that sends a GM to a rulebook.
    for (const entry of description.positions) {
      expect(entry.label).not.toBe('');
      expect(entry.text.length).toBeGreaterThan(10);
      expect(entry.label).not.toBe('Undescribed');
    }
  });
});

describe('prose coverage', () => {
  it('leaves no code undescribed in cepheus-1', () => {
    // Prose is deliberately outside the ruleset hash, so nothing about the
    // identity rules would notice a numeric table gaining a code the panel has
    // nothing to say about. This test is the only thing that would.
    expect(missingProse(CEPHEUS_1)).toEqual([]);
  });

  it('has an entry for every starport class the parser accepts', () => {
    // WP9's open question, answered the other way round: the *set* of classes
    // stays an encoding fact in the parser (see input/upp.ts), so the ruleset's
    // obligation is to describe whatever the parser lets through.
    for (const cls of STARPORT_CLASSES) {
      expect(CEPHEUS_1.tables.prose.starport[cls]).toBeDefined();
    }
    expect(Object.keys(CEPHEUS_1.tables.prose.starport).sort()).toEqual(
      [...STARPORT_CLASSES].sort(),
    );
  });

  it('detects a gap when one is introduced', () => {
    // The discrimination check: a full table and a broken detector look
    // identical from the passing side.
    const holed = structuredClone(CEPHEUS_1);
    (holed.tables.prose.atmosphere as unknown as { text: string }[])[12]!.text = '';
    expect(missingProse(holed)).toContain('atmosphere.12');
  });

  it('produces a placeholder rather than throwing when prose is missing', () => {
    // A missing sentence is not a reason to blank the whole panel.
    const holed = structuredClone(CEPHEUS_1);
    (holed.tables.prose as unknown as { size: unknown[] }).size = [];
    const entry = describeUpp(parsed('C867A69-8'), holed).positions[1]!;
    expect(entry.label).toBe('Undescribed');
    expect(entry.text).toContain('cepheus-1');
  });
});

describe('describeUpp is total', () => {
  it('describes every value of every position without throwing', () => {
    const c = (v: number): string => EHEX[v]!;
    for (const pos of UPP_POSITIONS) {
      if (pos.key === 'starport') continue;
      for (let value = 0; value <= pos.max!; value++) {
        const digits = [0, 0, 0, 0, 0, 0, 0];
        digits[UPP_POSITIONS.findIndex((p) => p.key === pos.key) - 1] = value;
        const text = `X${digits.slice(0, 6).map(c).join('')}-${c(digits[6]!)}`;
        expect(() => describeUpp(parsed(text))).not.toThrow();
      }
    }
    for (const cls of STARPORT_CLASSES) {
      expect(() => describeUpp(parsed(`${cls}000000-0`))).not.toThrow();
    }
  });
});
