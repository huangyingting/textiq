/**
 * Public facade for the versioned visual schema.
 *
 * Constants and TypeScript types live in `schema-types.ts`; validation is split
 * by concern under `schema-validation/*`. Keep imports using
 * `@/lib/visual/schema` stable for callers.
 */

export {
  ASPECT_RATIO_PRESETS,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  DEFAULT_STYLE,
  NODE_SHAPES,
  PRISMA_TO_VISUAL_KIND,
  VISUAL_KINDS,
  VISUAL_KIND_TO_PRISMA,
  VISUAL_SCHEMA_VERSION,
  isVisualKind,
} from "./schema-types";
export type {
  ArrowStyle,
  /* node:coverage ignore next 16 -- exported types are erased but mapped as uncovered by tsx. */
  AspectRatioPreset,
  CanvasStyle,
  EdgeStyle,
  EffectKind,
  FillStyle,
  LineStyle,
  NodeShape,
  TextAlign,
  Visual,
  VisualEdge,
  VisualEffect,
  VisualKind,
  VisualNode,
  VisualStyle,
  VisualType,
} from "./schema-types";
export { validateVisual } from "./schema-validation/core";

import { validateVisual } from "./schema-validation/core";
import { VisualValidationError } from "./schema-validation/utils";
import type { Visual } from "./schema-types";

export type VisualParseResult =
  { success: true; data: Visual } | { success: false; error: string };

/** Non-throwing wrapper around {@link validateVisual}. */
export function safeParseVisual(input: unknown): VisualParseResult {
  try {
    return { success: true, data: validateVisual(input) };
  } catch (error) {
    /* node:coverage ignore next 3 -- error wrapper is asserted; tsx maps the conditional as uncovered. */
    const message =
      error instanceof VisualValidationError ? error.message : "Invalid visual";
    return { success: false, error: message };
  }
}

/**
 * FNV-1a 32-bit hash of a UTF-16 text string, returned as a zero-padded
 * lowercase hex string. Pure and environment-agnostic (no Web Crypto / Node
 * crypto required). Used to detect when a visual's source text has changed
 * since generation.
 */
export function hashSourceText(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
