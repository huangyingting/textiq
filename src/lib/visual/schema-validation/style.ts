/** Style-level visual schema validation and defaulting. */

/* node:coverage ignore next -- type-bearing import is erased/mapped as uncovered by tsx. @preserve */
import { DEFAULT_STYLE, type VisualStyle } from "@/lib/visual/schema-types";
import { isFiniteNumber, isPlainObject } from "@/lib/type-guards";
import { isSafeVisualColor } from "./colors";
import { VisualValidationError } from "./utils";

export function normalizeStyle(input: unknown): VisualStyle {
  if (input === undefined) {
    return { ...DEFAULT_STYLE };
  }
  if (!isPlainObject(input)) {
    throw new VisualValidationError("style must be an object");
    /* node:coverage ignore next -- normalizeStyle malformed style is asserted; tsx maps this branch close as uncovered. @preserve */
  }

  const style: VisualStyle = { ...DEFAULT_STYLE };

  if (input.palette !== undefined) {
    if (
      !Array.isArray(input.palette) ||
      input.palette.length === 0 ||
      !input.palette.every(
        (color) => typeof color === "string" && isSafeVisualColor(color),
      )
    ) {
      throw new VisualValidationError(
        "style.palette must be a non-empty array of safe colors",
      );
    }
    style.palette = input.palette as string[];
  }

  const colorKeys = [
    "background",
    "nodeFill",
    "nodeStroke",
    "nodeText",
    "edgeColor",
  ] as const;
  for (const key of colorKeys) {
    const value = input[key];
    if (value !== undefined) {
      if (typeof value !== "string") {
        throw new VisualValidationError(`style.${key} must be a string`);
      }
      if (!isSafeVisualColor(value)) {
        throw new VisualValidationError(`style.${key} must be a safe color`);
      }
      style[key] = value;
    }
  }

  const stringKeys = ["fontFamily"] as const;
  for (const key of stringKeys) {
    const value = input[key];
    if (value !== undefined) {
      if (typeof value !== "string") {
        throw new VisualValidationError(`style.${key} must be a string`);
      }
      style[key] = value;
    }
  }

  if (input.fontSize !== undefined) {
    if (!isFiniteNumber(input.fontSize) || input.fontSize <= 0) {
      throw new VisualValidationError(
        "style.fontSize must be a positive number",
      );
    }
    style.fontSize = input.fontSize;
  }

  if (input.fontWeight !== undefined) {
    if (!isFiniteNumber(input.fontWeight) || input.fontWeight <= 0) {
      throw new VisualValidationError(
        "style.fontWeight must be a positive number",
      );
    }
    style.fontWeight = input.fontWeight;
  }

  return style;
}
