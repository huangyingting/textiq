import { PRESENTATION_THEME_IDS, type PresentationThemeId } from "../deck-core";
import type {
  ElementAlign,
  ShapeKind,
  ConnectorArrow,
  ConnectorRouting,
  TextFitMode,
} from "../deck-elements";
import {
  SLIDE_FORMATS,
  type SlideFormat,
} from "@/lib/document/deck-kernel/slide-format";
import {
  forEachUnknownKey,
  isLiteralMember,
  isValidationFiniteNumber,
} from "@/lib/validation-primitives";

export class DeckValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeckValidationError";
  }
}

export function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  context: string,
): void {
  forEachUnknownKey(input, allowedKeys, (key) => {
    throw new DeckValidationError(
      `${context}.${key} is not part of the current schema`,
    );
  });
}

export function isPresentationThemeId(
  value: unknown,
): value is PresentationThemeId {
  return isLiteralMember(value, PRESENTATION_THEME_IDS);
}

export function isSlideFormat(value: unknown): value is SlideFormat {
  return isLiteralMember(value, SLIDE_FORMATS);
}

export function validateStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) {
    throw new DeckValidationError(`${context} must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new DeckValidationError(`${context}[${index}] must be a string`);
    }
    return entry;
  });
}

export const ELEMENT_ALIGNS: readonly ElementAlign[] = [
  "left",
  "center",
  "right",
];
export const VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
export type VerticalAlign = (typeof VERTICAL_ALIGNS)[number];
export const SHAPE_KINDS: readonly ShapeKind[] = [
  "rect",
  "ellipse",
  "line",
  "triangle",
  "diamond",
  "circle",
  "square",
];
/* node:coverage ignore next 4 */
/* Literal tuple rows are asserted in schema tests; tsx keeps array member rows residual. */
export const CONNECTOR_ROUTINGS: readonly ConnectorRouting[] = [
  "straight",
  "elbow",
];
/* node:coverage ignore next 6 */
/* Literal tuple rows are asserted in schema tests; tsx keeps one array row residual. */
export const CONNECTOR_ARROWS: readonly ConnectorArrow[] = [
  "none",
  "arrow",
  "filled",
];
export const TEXT_FIT_MODES: readonly TextFitMode[] = [
  "auto-height",
  "fixed-box",
  "shrink-to-fit",
];

export function validateFiniteNumber(value: unknown, context: string): number {
  if (!isValidationFiniteNumber(value)) {
    throw new DeckValidationError(`${context} must be a finite number`);
  }
  return value;
}

/** Validates an opacity value, clamping to the `[0, 1]` range. */
export function validateOpacity(value: unknown, context: string): number {
  const n = validateFiniteNumber(value, context);
  return Math.max(0, Math.min(1, n));
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value);
}

export function validateUnitFraction(value: unknown, context: string): number {
  const n = validateFiniteNumber(value, context);
  if (n < 0 || n > 1) {
    throw new DeckValidationError(`${context} must be between 0 and 1`);
  }
  return n;
}
