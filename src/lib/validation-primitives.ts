export type KnownKeys = ReadonlySet<string> | readonly string[];

export type StringContentMode = "trimmed" | "exact";

function isKnownKeyList(knownKeys: KnownKeys): knownKeys is readonly string[] {
  return Array.isArray(knownKeys);
}

function hasKnownKey(knownKeys: KnownKeys, key: string): boolean {
  if (isKnownKeyList(knownKeys)) {
    return knownKeys.includes(key);
  }
  return knownKeys.has(key);
}

export function isValidationPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function forEachUnknownKey(
  input: Record<string, unknown>,
  knownKeys: KnownKeys,
  onUnknownKey: (key: string) => void,
): void {
  for (const key of Object.keys(input)) {
    if (!hasKnownKey(knownKeys, key)) {
      onUnknownKey(key);
    }
  }
}

export function isLiteralMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" &&
    allowed.some((candidate) => candidate === value)
  );
}

export function isValidationFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isValidationNonEmptyString(
  value: unknown,
  mode: StringContentMode = "trimmed",
): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return mode === "trimmed" ? value.trim().length > 0 : value.length > 0;
}
