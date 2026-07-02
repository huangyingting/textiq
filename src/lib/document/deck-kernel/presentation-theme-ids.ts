/**
 * Canonical visual/presentation theme ID catalog — single source of truth shared
 * between the presentation layer ({@link PRESENTATION_THEME_IDS} in deck-core.ts) and
 * the visual layer (STYLE_THEMES in lib/visual/themes.ts).
 *
 * Kept in lib/presentation rather than lib/visual to avoid an import cycle:
 * lib/visual already imports from lib/presentation; the reverse would form a
 * strongly-connected component that the import-graph checker forbids.
 */

/** IDs of all named visual-content style themes (mirrors STYLE_THEMES ids). */
/* node:coverage ignore next -- tsx maps the const assertion close to the preceding documentation line. */
export const STYLE_THEME_IDS = [
  "indigo",
  "ocean",
  "forest",
  "sunset",
  "grape",
  "rose",
  "amber",
  "slate",
] as const;

export type StyleThemeId = (typeof STYLE_THEME_IDS)[number];
