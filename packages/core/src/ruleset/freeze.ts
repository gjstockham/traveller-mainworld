/**
 * Deep freezing, and the ability to prove it.
 *
 * A ruleset is pure data that everything downstream trusts to be constant for
 * the life of its id (see `ruleset.ts` for that rule). `Object.freeze` is
 * shallow, so freezing the ruleset object alone would leave every table inside
 * it writable — and a table mutated at runtime is the one failure this design
 * cannot detect, because the id would still say `cepheus-1` while the numbers
 * behind it had moved.
 *
 * So the tables are deep-frozen, and {@link deepFrozenViolations} exists so a
 * test can assert it rather than trust it.
 */

/**
 * Recursively freeze an object and everything reachable from it.
 *
 * Returns the argument, narrowed, so it can wrap a literal in place. Cycles
 * are handled — a frozen object is not revisited — though ruleset tables have
 * none.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;

  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Every path within `value` that is reachable and not frozen.
 *
 * Returns paths rather than a boolean because "the ruleset is not deep-frozen"
 * is not an actionable failure and "`tables.size.rows[3]` is not frozen" is.
 * An empty array means the whole graph is frozen.
 */
export function deepFrozenViolations(
  value: unknown,
  path = '$',
  seen: Set<unknown> = new Set(),
): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const violations: string[] = [];
  if (!Object.isFrozen(value)) violations.push(path);

  for (const key of Object.getOwnPropertyNames(value)) {
    const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    violations.push(...deepFrozenViolations((value as Record<string, unknown>)[key], childPath, seen));
  }
  return violations;
}
