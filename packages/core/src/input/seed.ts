/**
 * Seed handling (PRD R2, R3).
 *
 * A seed is any string, hashed to 64 bits by `hashSeedString`. This module adds
 * the two things the input layer needs on top of that: a random seed when the
 * field is left blank, and enough provenance for the viewer to tell the user
 * where the seed came from.
 *
 * ## Why the randomness here is not a whitelist violation
 *
 * `crypto.getRandomValues` is nondeterministic, and `Math.random` is banned
 * outright inside `packages/core/src/kernel`. Nothing here is inside the kernel,
 * and the distinction is not merely one of directory:
 *
 * > **The seed is an *input* to generation, not generated output.**
 *
 * Rolling a seed is the same kind of act as typing one. Once rolled it is a
 * fixed string, and everything downstream of it — the hash, the noise, the
 * tiles — is perfectly deterministic and perfectly reproducible from the
 * displayed value. Making *this* function deterministic would not strengthen
 * the determinism guarantee by one bit; it would break re-rolling (PRD U4),
 * because "re-roll" would return the same world every time.
 *
 * If you are here to remove the nondeterminism: don't. If you need a
 * reproducible seed for a test, pass your own `RandomWords` — that is what the
 * parameter is for.
 */
import { hashSeedString } from '../kernel/rng.js';

/** Where a seed came from, which is what the re-roll control needs (PRD R3). */
export type SeedSource = 'user' | 'random';

export interface ResolvedSeed {
  /**
   * The seed to display, share and put in a URL. Never blank — R2 exists
   * because a seed you cannot read off the screen cannot be written down.
   */
  readonly text: string;
  readonly source: SeedSource;
  /** High 32 bits of the 64-bit world seed. */
  readonly hi: number;
  /** Low 32 bits of the 64-bit world seed. */
  readonly lo: number;
}

/**
 * A source of random 32-bit words: fills the array in place.
 *
 * Injectable so tests can pin the output without pinning the clock or the
 * platform. Production passes nothing and gets `defaultRandomWords`.
 */
export type RandomWords = (out: Uint32Array) => void;

/** Structural shape of the Web Crypto API, so this file needs no DOM or Node lib. */
interface CryptoLike {
  getRandomValues(array: Uint32Array): Uint32Array;
}

/**
 * The production source: Web Crypto, present in browsers and in Node ≥ 19.
 *
 * Resolved off `globalThis` at call time rather than at module load, so that
 * importing `core` in an exotic host that lacks it fails only if a seed is
 * actually rolled — and fails with a sentence rather than a `TypeError`.
 */
export function defaultRandomWords(out: Uint32Array): void {
  const source = (globalThis as { crypto?: CryptoLike }).crypto;
  if (source === undefined || typeof source.getRandomValues !== 'function') {
    throw new Error(
      'No crypto.getRandomValues available to roll a seed. Pass an explicit ' +
        'RandomWords source, or supply a seed string.',
    );
  }
  source.getRandomValues(out);
}

/**
 * How many decimal digits a rolled seed has.
 *
 * Decimal, rather than base-36 or hex, because a rolled seed's whole job is to
 * be *read off a screen and written down* (R2). Digits have no case to get
 * wrong when transcribing, and none of the 0/O, 1/l ambiguities that make a
 * mistyped seed silently produce a different world.
 */
const SEED_DIGITS = 12;

/**
 * Roll a fresh seed string.
 *
 * The leading digit is 1–9, so a rolled seed never carries a leading zero for
 * someone to drop when copying it. The rest are uniform over 0–9.
 *
 * `% 10` over a uniform `uint32` is very slightly biased, since 2³² is not a
 * multiple of 10 — about one part in 7×10⁸. That is irrelevant for a seed,
 * whose only requirements are that two rolls differ and that neither is
 * predictable enough to matter, and both survive it comfortably.
 */
export function randomSeedText(random: RandomWords = defaultRandomWords): string {
  const words = new Uint32Array(SEED_DIGITS);
  random(words);

  let text = String(1 + ((words[0] ?? 0) % 9));
  for (let i = 1; i < SEED_DIGITS; i++) {
    text += String((words[i] ?? 0) % 10);
  }
  return text;
}

/**
 * Resolve the seed field into something displayable and hashable (R2).
 *
 * A blank or whitespace-only field rolls a random seed and returns it, so the
 * caller can show it. Anything else is used as given, after trimming.
 *
 * Trimming is deliberate and slightly opinionated: `hashSeedString` is faithful
 * to every character, so an untrimmed `'42 '` would be a different world from
 * `'42'` while looking identical in the field. Trimming makes what is displayed
 * exactly what is hashed, which is the property share URLs depend on.
 */
export function resolveSeed(
  text: string | null | undefined,
  random: RandomWords = defaultRandomWords,
): ResolvedSeed {
  const trimmed = (text ?? '').trim();
  const source: SeedSource = trimmed.length === 0 ? 'random' : 'user';
  const seedText = source === 'random' ? randomSeedText(random) : trimmed;

  const hashed = hashSeedString(seedText);
  return { text: seedText, source, hi: hashed[0] ?? 0, lo: hashed[1] ?? 0 };
}

/**
 * The "re-roll seed" control (PRD R3): a fresh seed, with the UPP untouched.
 *
 * A named function rather than a bare `resolveSeed('')` call because the two
 * are different intentions — one is "the field was blank", the other is "the
 * user asked for a different world" — and R3 is easier to trace to a function
 * that says so.
 */
export function rerollSeed(random: RandomWords = defaultRandomWords): ResolvedSeed {
  return resolveSeed('', random);
}
