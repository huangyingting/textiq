/**
 * Global style reference registry for the presentation system.
 *
 * The registry is the single source of truth for which style refs are valid.
 * Theme packages, templates, and nodes must reference only registered refs.
 */

import type { StyleRef } from "./style-schema";

export const STYLE_REFS: readonly StyleRef[] = [
  "slide.cover",
  "slide.content",
  "slide.section",
  "text.title",
  "text.subtitle",
  "text.body",
  "text.kicker",
  "text.caption",
  "text.quote",
  "text.metric",
  "surface.card",
  "surface.callout",
  "surface.table",
  "media.hero",
  "media.inline",
  "chart.primary",
  "connector.primary",
  "decoration.background",
] as const;

const STYLE_REF_SET = new Set<string>(STYLE_REFS);

/** Returns true when the value is a registered `StyleRef`. */
export function isStyleRef(value: unknown): value is StyleRef {
  return typeof value === "string" && STYLE_REF_SET.has(value);
}
