/**
 * Canonical shared type-guard primitives.
 *
 * Zero external dependencies. Import directly; do not re-export from barrels.
 *
 * Guards kept local (not here):
 *   - serializable.ts  isPlainObject — strict Object.prototype / null-prototype check
 *   - clipboard/node-payload.ts  isNonEmptyString — whitespace-preserving (no trim)
 */

/**
 * Returns true for plain objects: non-null, non-array objects.
 * Class instances whose prototype is not Object.prototype are accepted.
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns true for non-empty strings after trimming whitespace.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Returns true for finite numbers (excludes NaN, Infinity, and -Infinity).
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
