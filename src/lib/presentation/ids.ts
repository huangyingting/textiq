/** ID validation helpers for the presentation schema. */

/** Pattern for all stable node/asset/layout ids. */
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/;

/** Returns true when the value is a structurally valid id string. */
export function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

/** Returns true for a non-empty ASCII string (used for enum-like fields). */
export function isNonEmptyAsciiString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[\u0080-\uFFFF]/.test(value)
  );
}

/** Returns true for a finite positive number. */
export function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Returns true for a finite number (including 0 and negatives). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Returns true for a CSS hex colour string. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value);
}

/** Clamps a number to an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
