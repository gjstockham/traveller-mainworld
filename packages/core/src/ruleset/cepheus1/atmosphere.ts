/**
 * Cepheus Engine — the Atmosphere table.
 *
 * **OPEN GAME CONTENT.** The Atmosphere codes, their names and their pressure
 * ranges are derived from the Cepheus Engine System Reference Document and are
 * used under the Open Game License 1.0a. See `LICENSE-OGL.txt`.
 *
 * ## The rules' columns
 *
 * Cepheus gives sixteen codes and, for the ordinary ones, a pressure range:
 * very thin 0.10–0.42, thin 0.43–0.70, standard 0.71–1.49, dense 1.50–2.49.
 * `pressureBar` is the midpoint of that range, because everything that will
 * consume it — haze density, scattering strength, ablation of small impactors
 * — wants a scalar and not an interval. Codes A–C and F have no range in the
 * rules ("varies"), and take the standard midpoint.
 *
 * Note that `pressureBand` is *not* one-to-one with the code. Codes 2 and 3
 * are the same pressure and differ only in taint; A, B and C are three
 * different hazards at ordinary pressure; D is dense at low altitude and E is
 * thin at low altitude. Splitting band from composition is what lets the
 * renderer draw the right sky without a sixteen-way switch.
 *
 * ## The two columns that are ours
 *
 * `craterPreservation` and `baseTemperature` are not in any ruleset.
 *
 * **Preservation** is how much of an impact record survives, in `[0, 1]`, and
 * it does two jobs at once: a thicker atmosphere ablates more of the incoming
 * body before it lands, and erodes more of the crater afterwards. A vacuum is
 * 1.0 by definition — it is the saturated airless surface everything else is
 * measured against. A standard atmosphere is an order of magnitude worse. The
 * corrosive and insidious codes sit slightly below their pressure would
 * suggest, because chemical attack is erosion too.
 *
 * **Base temperature** is a *hint*, and a weak one, because a UPP does not
 * encode orbital distance and temperature is mostly a function of orbital
 * distance. Two things it does encode are real, and this column carries only
 * those two: a body with no atmosphere has no heat transport, so no single
 * band describes a surface whose day and night sides are hundreds of kelvin
 * apart (`extreme`); and a dense or exotic atmosphere implies a greenhouse
 * (`hot`). Everything in between is thin-and-cold or standard-and-temperate,
 * which is a guess, and it is labelled as one on the type. Phase 4 replaces
 * the whole column with a real classifier.
 */
import type { AtmosphereRow } from '../ruleset.js';

/** Rows in code order; `rowFor` asserts that ordering rather than assuming it. */
export const ATMOSPHERE_ROWS: readonly AtmosphereRow[] = [
  { code: 0, pressureBand: 'none', pressureBar: 0, composition: 'none', craterPreservation: 1, baseTemperature: 'extreme' },
  { code: 1, pressureBand: 'trace', pressureBar: 0.05, composition: 'standard', craterPreservation: 0.95, baseTemperature: 'extreme' },
  { code: 2, pressureBand: 'very-thin', pressureBar: 0.26, composition: 'tainted', craterPreservation: 0.8, baseTemperature: 'cold' },
  { code: 3, pressureBand: 'very-thin', pressureBar: 0.26, composition: 'standard', craterPreservation: 0.8, baseTemperature: 'cold' },
  { code: 4, pressureBand: 'thin', pressureBar: 0.57, composition: 'tainted', craterPreservation: 0.55, baseTemperature: 'cold' },
  { code: 5, pressureBand: 'thin', pressureBar: 0.57, composition: 'standard', craterPreservation: 0.55, baseTemperature: 'cold' },
  { code: 6, pressureBand: 'standard', pressureBar: 1.1, composition: 'standard', craterPreservation: 0.2, baseTemperature: 'temperate' },
  { code: 7, pressureBand: 'standard', pressureBar: 1.1, composition: 'tainted', craterPreservation: 0.2, baseTemperature: 'temperate' },
  { code: 8, pressureBand: 'dense', pressureBar: 2, composition: 'standard', craterPreservation: 0.1, baseTemperature: 'temperate' },
  { code: 9, pressureBand: 'dense', pressureBar: 2, composition: 'tainted', craterPreservation: 0.1, baseTemperature: 'temperate' },
  { code: 10, pressureBand: 'standard', pressureBar: 1.1, composition: 'exotic', craterPreservation: 0.2, baseTemperature: 'hot' },
  { code: 11, pressureBand: 'standard', pressureBar: 1.1, composition: 'corrosive', craterPreservation: 0.15, baseTemperature: 'hot' },
  { code: 12, pressureBand: 'standard', pressureBar: 1.1, composition: 'insidious', craterPreservation: 0.15, baseTemperature: 'hot' },
  { code: 13, pressureBand: 'dense', pressureBar: 2, composition: 'standard', craterPreservation: 0.1, baseTemperature: 'hot' },
  { code: 14, pressureBand: 'thin', pressureBar: 0.57, composition: 'standard', craterPreservation: 0.55, baseTemperature: 'cold' },
  { code: 15, pressureBand: 'unusual', pressureBar: 1.1, composition: 'unusual', craterPreservation: 0.3, baseTemperature: 'temperate' },
];
