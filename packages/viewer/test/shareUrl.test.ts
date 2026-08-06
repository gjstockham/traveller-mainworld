/**
 * WP12: the share URL (PRD R4, R27) and the sun that rides along with it.
 *
 * Success criterion §9.5 is *a share URL opened on a second machine reproduces
 * the identical world, hash-verified*. Half of that is a two-machine check
 * nothing in Node can perform. The other half — that the URL names everything
 * the world depends on, and that it refuses to name something this build cannot
 * honour — is exactly what these tests are for.
 */
import { DEFAULT_RULESET, GEN_VERSION, knownGeneratorVersions } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SUN, clampSun, formatSun, sunFrom, sunVector } from '../src/render/sun.js';
import {
  buildShareQuery,
  buildShareUrl,
  cameraFrom,
  checkGenVersion,
  formatCamera,
  rulesetIdFrom,
} from '../src/share/url.js';
import { chooseWorld } from '../src/world/choice.js';

const q = (search: string): URLSearchParams => new URLSearchParams(search);

describe('the share query', () => {
  it('carries all four parameters R27 names, in a fixed order', () => {
    // Fixed order so two links to the same world are the same string. A URL
    // that varies by parameter ordering cannot be compared by eye, and
    // `replaceState` would churn the address bar for no change.
    const query = buildShareQuery({
      world: { kind: 'upp', upp: 'C867A69-8', seedText: '42', rulesetId: 'cepheus-1' },
      genVersion: GEN_VERSION,
    });
    expect(query).toBe(
      `?upp=C867A69-8&seed=42&gen=${encodeURIComponent(GEN_VERSION)}&ruleset=cepheus-1`,
    );
  });

  it('round-trips through chooseWorld to the same world', () => {
    // The property §9.5 rests on, as far as one machine can check it: what the
    // builder emits is what the loader reads, and it lands on the same spec and
    // the same seed lanes.
    const original = chooseWorld(q('?upp=X400000-0&seed=alpha&ruleset=cepheus-1'));
    const query = buildShareQuery({
      world: {
        kind: 'upp',
        upp: original.upp!.canonical,
        seedText: original.seedText!,
        rulesetId: original.ruleset!.id,
      },
      genVersion: GEN_VERSION,
    });

    const reopened = chooseWorld(new URLSearchParams(query));
    expect(reopened.world).toEqual(original.world);
    expect(reopened.short).toBe(original.short);
  });

  it('emits a fixture link without a seed or a ruleset', () => {
    // Both are refused on the fixture route, so emitting them would build a URL
    // the loader rejects — which is the failure the discriminated `ShareWorld`
    // type exists to make unrepresentable.
    const query = buildShareQuery({
      world: { kind: 'fixture', fixtureId: 'size4-luna' },
      genVersion: GEN_VERSION,
    });
    expect(query).not.toContain('seed=');
    expect(query).not.toContain('ruleset=');
    expect(() => chooseWorld(new URLSearchParams(query))).not.toThrow();
  });

  it('leaves the presentation parameters out when they are not set', () => {
    // R27 calls the camera a nice-to-have, which has to mean a URL without one
    // still works. A link that always carried a viewpoint would pin whatever
    // angle the sharer happened to be at onto everyone who opened it.
    const bare = buildShareQuery({
      world: { kind: 'upp', upp: 'X400000-0', seedText: '1', rulesetId: 'cepheus-1' },
      genVersion: GEN_VERSION,
    });
    expect(bare).not.toContain('cam=');
    expect(bare).not.toContain('sun=');
    expect(bare).not.toContain('exaggeration=');

    const dressed = buildShareQuery({
      world: { kind: 'upp', upp: 'X400000-0', seedText: '1', rulesetId: 'cepheus-1' },
      genVersion: GEN_VERSION,
      camera: { azimuthDeg: 45, elevationDeg: 20, altitudeKm: 15_000 },
      sun: { azimuthDeg: 60, elevationDeg: 15 },
      exaggeration: 12,
    });
    expect(dressed).toContain('cam=45%2C20%2C15000');
    expect(dressed).toContain('sun=60%2C15');
    expect(dressed).toContain('exaggeration=12');
  });

  it('omits an exaggeration of 1, because that is the default and not a setting', () => {
    const query = buildShareQuery({
      world: { kind: 'upp', upp: 'X400000-0', seedText: '1', rulesetId: 'cepheus-1' },
      genVersion: GEN_VERSION,
      exaggeration: 1,
    });
    expect(query).not.toContain('exaggeration');
  });

  it('replaces an existing query and drops the fragment', () => {
    const url = buildShareUrl('https://example.test/viewer/?fixture=size1-rockball#frag', {
      world: { kind: 'upp', upp: 'X400000-0', seedText: '7', rulesetId: 'cepheus-1' },
      genVersion: GEN_VERSION,
    });
    expect(url).toContain('https://example.test/viewer/?upp=X400000-0');
    expect(url).not.toContain('fixture');
    expect(url).not.toContain('#');
  });
});

describe('?gen=', () => {
  it('accepts a version the registry has, and absence', () => {
    expect(checkGenVersion(q(''), ['9.9.9'])).toBe('9.9.9');
    expect(checkGenVersion(q('?gen=9.9.9'), ['9.9.9'])).toBe('9.9.9');
  });

  it('RESOLVES THROUGH THE REGISTRY RATHER THAN COMPARING TO THE CURRENT VERSION', () => {
    // The WP14 change, and the only test that can tell the two implementations
    // apart. Before the registry this was `asked === current`, so a build that
    // knew two versions would have refused the older one — the exact failure
    // R15 exists to prevent, arriving on the day the second entry landed.
    // Asserted with a *second* entry present, which the real registry does not
    // have yet and which is the whole reason the list is a parameter.
    expect(checkGenVersion(q('?gen=0.1.0'), ['0.2.0', '0.1.0'])).toBe('0.1.0');
    // And the returned version is the one asked for, not the current one, so a
    // caller resolving it through `generatorFor` gets the right generator.
    expect(checkGenVersion(q('?gen=0.2.0'), ['0.2.0', '0.1.0'])).toBe('0.2.0');
  });

  it('refuses a version this build cannot produce, and says why', () => {
    // The dangerous outcome is not an error — it is rendering a 0.1.0 link with
    // the current generator and showing a world that is not the one the link
    // promised. The message names every version the build has, because "this
    // build produces 0.2.0" stops being the whole truth at two entries.
    expect(() => checkGenVersion(q('?gen=0.1.0'), ['0.2.0'])).toThrow(/0\.1\.0/);
    expect(() => checkGenVersion(q('?gen=0.1.0'), ['0.2.0'])).toThrow(/this build produces: 0\.2\.0/);
    expect(() => checkGenVersion(q('?gen=0.1.0'), ['0.2.0', '0.3.0'])).toThrow(/0\.2\.0, 0\.3\.0/);
    expect(() => checkGenVersion(q('?gen=0.1.0'), ['0.2.0'])).toThrow(/R15/);
  });

  it('defaults to the real registry, so the check is not a test of one list against itself', () => {
    // The versions are passed explicitly above precisely so those tests do not
    // go quiet when GEN_VERSION is bumped. This is the one that pins the
    // default, and that the registry really does hold this build's version.
    expect(checkGenVersion(q(''))).toBe(GEN_VERSION);
    expect(checkGenVersion(q(`?gen=${GEN_VERSION}`))).toBe(GEN_VERSION);
    expect(knownGeneratorVersions()).toContain(GEN_VERSION);
    expect(() => checkGenVersion(q('?gen=not-a-version'))).toThrow();
  });
});

describe('?ruleset=', () => {
  it('defaults to the ruleset core says is default', () => {
    expect(rulesetIdFrom(q(''))).toBe(DEFAULT_RULESET.id);
  });

  it('refuses an id this build does not have, naming the ones it does', () => {
    expect(() => rulesetIdFrom(q('?ruleset=cepheus-2'))).toThrow(/unknown ruleset/);
    expect(() => rulesetIdFrom(q('?ruleset=cepheus-2'))).toThrow(/cepheus-1/);
  });
});

describe('?cam=', () => {
  it('is absent-tolerant, because R27 makes it optional', () => {
    expect(cameraFrom(q(''))).toBeUndefined();
  });

  it('round-trips through its own formatting', () => {
    const pose = { azimuthDeg: 45.5, elevationDeg: -20.25, altitudeKm: 1234.5 };
    const parsed = cameraFrom(q(`?cam=${formatCamera(pose)}`));
    // Rounded to a tenth on the way out; the camera is presentation, and a
    // reader who can sanity-check the number is worth more than the digits.
    // `Math.round` breaks a tie toward +infinity, so -20.25 lands on -20.2.
    expect(parsed).toEqual({ azimuthDeg: 45.5, elevationDeg: -20.2, altitudeKm: 1234.5 });
  });

  it('refuses a malformed value rather than ignoring it', () => {
    // Silently dropping it is indistinguishable from it having worked, and the
    // person who notices is the one comparing two screenshots.
    expect(() => cameraFrom(q('?cam=45,20'))).toThrow(/azimuth,elevation,altitudeKm/);
    expect(() => cameraFrom(q('?cam=45,20,north'))).toThrow(/non-numeric/);
    expect(() => cameraFrom(q('?cam=45,20,-5'))).toThrow(/above the surface/);
  });
});

describe('the sun (R20)', () => {
  it('defaults low, because a high sun flattens a crater field', () => {
    expect(DEFAULT_SUN.elevationDeg).toBeLessThan(30);
    expect(sunFrom(q(''))).toEqual(DEFAULT_SUN);
  });

  it("is a unit vector in the camera's own convention", () => {
    // Same convention as OrbitCamera: +y is the pole, azimuth runs from +z
    // toward +x. If these two disagreed the sun would move when the camera did.
    for (const dir of [DEFAULT_SUN, { azimuthDeg: 0, elevationDeg: 0 }, { azimuthDeg: 270, elevationDeg: -45 }]) {
      const v = sunVector(dir);
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 12);
    }
    expect(sunVector({ azimuthDeg: 0, elevationDeg: 0 })).toEqual({ x: 0, y: 0, z: 1 });
    expect(sunVector({ azimuthDeg: 90, elevationDeg: 0 }).x).toBeCloseTo(1, 12);
    // 90 would be clamped, which is the next test's business; 45 is not.
    expect(sunVector({ azimuthDeg: 0, elevationDeg: 45 }).y).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('wraps azimuth and clamps elevation short of the pole', () => {
    // A slider dragged past its end should stop, not error — but at exactly
    // ±90° the terminator degenerates to the limb, which is most of the point
    // of the lighting model.
    expect(clampSun({ azimuthDeg: 370, elevationDeg: 0 }).azimuthDeg).toBe(10);
    expect(clampSun({ azimuthDeg: -10, elevationDeg: 0 }).azimuthDeg).toBe(350);
    expect(clampSun({ azimuthDeg: 0, elevationDeg: 120 }).elevationDeg).toBe(89);
    expect(clampSun({ azimuthDeg: 0, elevationDeg: -120 }).elevationDeg).toBe(-89);
  });

  it('round-trips through ?sun=, and refuses a malformed one', () => {
    const dir = { azimuthDeg: 123.4, elevationDeg: -7.5 };
    expect(sunFrom(q(`?sun=${formatSun(dir)}`))).toEqual(dir);
    expect(() => sunFrom(q('?sun=60'))).toThrow(/azimuth,elevation/);
    expect(() => sunFrom(q('?sun=60,up'))).toThrow(/non-numeric/);
  });
});
