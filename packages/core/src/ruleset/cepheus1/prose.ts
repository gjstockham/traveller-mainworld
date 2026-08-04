/**
 * Cepheus Engine — plain-English interpretation of every position (Phase 1
 * plan §4.4, feeding PRD R21).
 *
 * **OPEN GAME CONTENT.** The meanings below are derived from the Cepheus
 * Engine System Reference Document and are used under the Open Game License
 * 1.0a. See `LICENSE-OGL.txt`.
 *
 * ## Why this covers all eight positions and not digits 2–4
 *
 * The MVP generates from Size, Atmosphere and Hydrographics alone (PRD §5), so
 * the temptation is to describe only those. But the info panel is where a GM
 * actually reads the world, and a panel that explains the Size code and leaves
 * `Government: 6` unglossed is a panel that sends them to a rulebook. The text
 * is cheap, it is open content, and Population through Tech Level drive
 * generation from Phase 6 anyway.
 *
 * ## Why prose is outside the ruleset hash
 *
 * `serialiseRuleset` covers the numeric tables only. Fixing a typo below does
 * not change one generated pixel, and should not oblige anyone to mint
 * `cepheus-2` — the identity rule is about output, not about English. What
 * this file gets instead is a coverage test: every code the numeric tables
 * accept must have an entry here, so prose cannot silently go missing for a
 * code a user can still type.
 *
 * `label` is the rules' own short name, for a compact readout. `text` is a
 * sentence or two for the panel.
 */
import type { StarportClass } from '../../input/upp.js';
import type { ProseEntry, ProseTables } from '../ruleset.js';

const STARPORT: Record<StarportClass, ProseEntry> = {
  A: {
    label: 'Excellent',
    text: 'Refined fuel, annual maintenance, and a shipyard capable of building both starships and non-starships.',
  },
  B: {
    label: 'Good',
    text: 'Refined fuel, annual maintenance, and a shipyard capable of building non-starships.',
  },
  C: {
    label: 'Routine',
    text: 'Unrefined fuel and reasonable repair facilities. No shipyard.',
  },
  D: {
    label: 'Poor',
    text: 'Unrefined fuel and a landing area. No repair facilities worth the name.',
  },
  E: {
    label: 'Frontier',
    text: 'A marked landing area and nothing else — no fuel, no facilities, no staff.',
  },
  X: {
    label: 'None',
    text: 'No starport. Usually a hazard-marked or interdicted zone; a landing here is unsupervised and on your own account.',
  },
};

const SIZE: readonly ProseEntry[] = [
  {
    label: 'Belt',
    text: 'An asteroid or planetoid belt rather than a single world. Not supported by this tool — a belt is a system-level feature and would need a generator of its own.',
  },
  {
    label: '1,600 km',
    text: 'A rockball at 0.05g. Anything volatile escaped long ago; the surface is whatever impacts have left of it.',
  },
  { label: '3,200 km', text: 'About Luna\'s size, at 0.15g. Heavily cratered and geologically long dead.' },
  { label: '4,800 km', text: 'About Mercury\'s size, at 0.25g. Large enough for basins, too small to hold much air.' },
  { label: '6,400 km', text: 'About Mars\'s size, at 0.35g. The largest world that can still read as unambiguously dead.' },
  { label: '8,000 km', text: '0.45g. Between Mars and Venus, where the solar system happens to have nothing.' },
  { label: '9,600 km', text: '0.70g. Heavy enough to hold a real atmosphere if it ever had one.' },
  { label: '11,200 km', text: '0.90g. Near-Earth gravity; a comfortable world for most purposes.' },
  { label: '12,800 km', text: 'Earth\'s size, at 1.00g. The reference world these codes are calibrated against.' },
  { label: '14,400 km', text: '1.25g. Noticeably heavy; relief is small next to the radius and the surface reads as nearly smooth.' },
  { label: '16,000 km', text: 'The largest world these rules describe, at 1.40g. Sustained effort here is hard work.' },
];

const ATMOSPHERE: readonly ProseEntry[] = [
  { label: 'None', text: 'Vacuum. A vacc suit is required, shadows are absolute, and nothing has ever eroded.' },
  { label: 'Trace', text: 'Barely measurable. A vacc suit is still required; the traces are enough to move dust and nothing more.' },
  { label: 'Very thin, tainted', text: 'Around 0.26 bar and chemically unsafe. A respirator and a filter are both required.' },
  { label: 'Very thin', text: 'Around 0.26 bar. Breathable only through a respirator.' },
  { label: 'Thin, tainted', text: 'Around 0.57 bar and chemically unsafe. Breathable through a filter mask.' },
  { label: 'Thin', text: 'Around 0.57 bar. Thin but breathable unaided, like high altitude on Earth.' },
  { label: 'Standard', text: 'Around 1.1 bar and breathable unaided. The comfortable case.' },
  { label: 'Standard, tainted', text: 'Around 1.1 bar, but carrying something harmful. Breathable through a filter mask.' },
  { label: 'Dense', text: 'Around 2 bar and breathable unaided. Heavy air, long twilights, muted horizons.' },
  { label: 'Dense, tainted', text: 'Around 2 bar and carrying something harmful. Breathable through a filter mask.' },
  { label: 'Exotic', text: 'Ordinary pressure, but not a mix anyone can breathe. Air supply required; no protective suit needed.' },
  { label: 'Corrosive', text: 'Chemically aggressive. A protective suit is required, and the surface itself shows the chemistry.' },
  { label: 'Insidious', text: 'Corrosive, and it defeats protective equipment given time. Nothing survives long exposure.' },
  { label: 'Dense, high', text: 'Dense, and breathable only in the low-lying parts of the world. The highlands are uninhabitable.' },
  { label: 'Thin, low', text: 'Thin, and breathable only in the low-lying parts of the world. The highlands are uninhabitable.' },
  { label: 'Unusual', text: 'An atmosphere that does not behave like the others — panthalassic, ellipsoidal, or stranger.' },
];

const HYDROGRAPHICS: readonly ProseEntry[] = [
  { label: '0%', text: 'No surface liquid at all. Desert world; any basins are dry.' },
  { label: '10%', text: 'Dry, with scattered seas and a great deal of desert between them.' },
  { label: '20%', text: 'Dry. Small seas, wide continental interiors.' },
  { label: '30%', text: 'Dry temperate. Land dominates.' },
  { label: '40%', text: 'Balanced toward land, with substantial oceans.' },
  { label: '50%', text: 'Half and half. Long coastlines, and a lot of them.' },
  { label: '60%', text: 'Balanced toward water. Large continents remain.' },
  { label: '70%', text: 'Earth\'s proportion. Oceans dominate; continents are distinct.' },
  { label: '80%', text: 'Water world with substantial archipelagos and a few small continents.' },
  { label: '90%', text: 'Almost entirely ocean. Land is islands.' },
  { label: '100%', text: 'A world ocean. At most a handful of island peaks break the surface.' },
];

const POPULATION: readonly ProseEntry[] = [
  { label: 'Uninhabited', text: 'Nobody lives here.' },
  { label: 'Tens', text: 'A single outpost, research station or family holding.' },
  { label: 'Hundreds', text: 'A village, or one small installation.' },
  { label: 'Thousands', text: 'A small town.' },
  { label: 'Tens of thousands', text: 'A town, or a scattering of settlements.' },
  { label: 'Hundreds of thousands', text: 'A small city and its hinterland.' },
  { label: 'Millions', text: 'A substantial city, or several.' },
  { label: 'Tens of millions', text: 'A populous world by any measure.' },
  { label: 'Hundreds of millions', text: 'Heavily settled; multiple major population centres.' },
  { label: 'Billions', text: 'Earth\'s order of magnitude. A full civilisation.' },
  { label: 'Tens of billions', text: 'Densely settled beyond anything Earth has managed.' },
  { label: 'Hundreds of billions', text: 'Arcology-scale settlement, or extensive orbital habitation.' },
  { label: 'Trillions', text: 'The theoretical ceiling. Almost certainly not a natural surface population.' },
];

const GOVERNMENT: readonly ProseEntry[] = [
  { label: 'None', text: 'No government structure. Family or clan authority, where there is any at all.' },
  { label: 'Company/corporation', text: 'Ruled by a company, which holds the charter and the law alike.' },
  { label: 'Participating democracy', text: 'Citizens vote directly on matters of government.' },
  { label: 'Self-perpetuating oligarchy', text: 'A ruling class that selects its own successors.' },
  { label: 'Representative democracy', text: 'Citizens elect representatives who govern on their behalf.' },
  { label: 'Feudal technocracy', text: 'Authority follows technical expertise, held and inherited as a fief.' },
  { label: 'Captive government', text: 'A colony or occupied territory, governed from elsewhere.' },
  { label: 'Balkanisation', text: 'Several rival governments, none of which speaks for the world.' },
  { label: 'Civil service bureaucracy', text: 'Run by an appointed civil service; ministers come and go.' },
  { label: 'Impersonal bureaucracy', text: 'Run by procedure. No individual is accountable and none can be found.' },
  { label: 'Charismatic dictator', text: 'One popular leader with genuine personal authority.' },
  { label: 'Non-charismatic leader', text: 'A successor to a charismatic ruler, governing on inherited legitimacy.' },
  { label: 'Charismatic oligarchy', text: 'A small ruling group that governs with popular support.' },
  { label: 'Religious dictatorship', text: 'Governed by a religious body, for religious ends.' },
  { label: 'Religious autocracy', text: 'One religious leader rules absolutely.' },
  { label: 'Totalitarian oligarchy', text: 'A small group holds total control over every aspect of life.' },
];

const LAW_LEVEL: readonly ProseEntry[] = [
  { label: 'No restrictions', text: 'No weapon or contraband restrictions whatsoever.' },
  { label: 'Very low', text: 'Poison gas, explosives, undetectable weapons and weapons of mass destruction are banned.' },
  { label: 'Low', text: 'Portable energy weapons are banned in addition.' },
  { label: 'Low', text: 'Military weapons are banned.' },
  { label: 'Moderate', text: 'Light assault weapons are banned.' },
  { label: 'Moderate', text: 'Personal concealable weapons are banned.' },
  { label: 'Moderate', text: 'All firearms except shotguns are banned; carrying a weapon is frowned upon.' },
  { label: 'High', text: 'Shotguns are banned.' },
  { label: 'High', text: 'Blade weapons are controlled, and openly carrying one is an offence.' },
  { label: 'High', text: 'Weapon possession outside the home is banned.' },
  { label: 'Extreme', text: 'Weapon possession is banned outright, and civilian movement is tightly controlled.' },
  { label: 'Extreme', text: 'Unrestricted invasion of privacy by the authorities.' },
  { label: 'Extreme', text: 'Paramilitary law enforcement as a matter of routine.' },
  { label: 'Extreme', text: 'A full police state.' },
  { label: 'Extreme', text: 'All citizens are monitored continuously.' },
  { label: 'Extreme', text: 'Everyday activity requires official permission; a certificate exists for almost everything.' },
];

const TECH_LEVEL: readonly ProseEntry[] = [
  { label: 'Pre-industrial', text: 'Stone age. No metalworking beyond the incidental.' },
  { label: 'Bronze/iron age', text: 'Metalworking and organised agriculture. Roughly Earth to 1400.' },
  { label: 'Renaissance', text: 'Printing, gunpowder, ocean navigation. Roughly Earth to 1700.' },
  { label: 'Industrial', text: 'Steam power and mass production. Roughly Earth 1700–1860.' },
  { label: 'Mechanised', text: 'Internal combustion, telegraphy, early electricity. Roughly Earth 1860–1900.' },
  { label: 'Broadcast', text: 'Radio, flight, mass manufacturing. Roughly Earth 1900–1939.' },
  { label: 'Atomic', text: 'Fission power and early computing. Roughly Earth 1940–1969.' },
  { label: 'Electronic', text: 'Miniaturised electronics and orbital flight. Roughly Earth 1970–1979.' },
  { label: 'Information', text: 'Widespread computing and global networks. Roughly Earth 1980–1999.' },
  { label: 'Gravitic', text: 'Gravity manipulation. Routine travel within a star system.' },
  { label: 'Interstellar', text: 'Basic jump drive. Interstellar travel becomes possible.' },
  { label: 'Interstellar', text: 'Improved jump drive and practical fusion power.' },
  { label: 'Interstellar', text: 'Advanced jump drive; synthetics and automation are everywhere.' },
  { label: 'Advanced', text: 'Very advanced technology; jump-4 travel.' },
  { label: 'Advanced', text: 'Anti-matter power; jump-5 travel.' },
  { label: 'Advanced', text: 'The practical ceiling of these rules; jump-6 travel.' },
];

/** Every position's prose, indexed the way `ProseTables` documents. */
export const CEPHEUS_1_PROSE: ProseTables = {
  starport: STARPORT,
  size: SIZE,
  atmosphere: ATMOSPHERE,
  hydrographics: HYDROGRAPHICS,
  population: POPULATION,
  government: GOVERNMENT,
  lawLevel: LAW_LEVEL,
  techLevel: TECH_LEVEL,
};
