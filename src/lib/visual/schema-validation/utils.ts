/** Shared helpers for visual schema validation modules. */

import { isFiniteNumber } from "@/lib/type-guards";

export class VisualValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisualValidationError";
  }
}

export function numberField(
  source: Record<string, unknown>,
  key: string,
  context: string,
  { positive = false }: { positive?: boolean } = {},
): number | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isFiniteNumber(value)) {
    throw new VisualValidationError(
      `${context}.${key} must be a finite number`,
    );
  }
  if (positive && value <= 0) {
    throw new VisualValidationError(`${context}.${key} must be greater than 0`);
  }
  return value;
}
