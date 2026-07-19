/**
 * Document-owned deck schema facade.
 *
 * `safeParseDeck` remains the legacy v6 parse boundary while validators live in
 * schema-area modules under `deck-validation/`. Current persisted deck parsing
 * is exposed under `safeParseCurrentDeck` so document persistence does not reach
 * directly into presentation runtime paths.
 */

import type { Deck } from "./deck-kernel/deck-core";
import { validateDeck } from "./deck-kernel/deck-validation/core";
import { DeckValidationError } from "./deck-kernel/deck-validation/shared";

export {
  DECK_SCHEMA_VERSION as CURRENT_DECK_SCHEMA_VERSION,
  safeParseDeck as safeParseCurrentDeck,
} from "@/lib/deck/current-deck-schema";
export type {
  Deck as CurrentDeck,
  DeckParseResult as CurrentDeckParseResult,
  SlideChildNode as CurrentSlideChildNode,
  SlideNode as CurrentSlideNode,
} from "@/lib/deck/current-deck-schema";
export { validateElement } from "./deck-kernel/deck-validation/elements";
export {
  validateImageCrop,
  validateImageFitMode,
  validateImageMaskShape,
} from "./deck-kernel/deck-validation/media";
export { validateSourceRef } from "./deck-kernel/deck-validation/source-refs";

export type DeckParseResult =
  { success: true; data: Deck } | { success: false; error: string };

/**
 * Non-throwing wrapper around the current deck schema validator.
 *
 * Only the current schema version is accepted.
 */
export function safeParseDeck(input: unknown): DeckParseResult {
  /* node:coverage ignore next 2 */
  /* Both success and validation-error behavior are asserted; tsx maps try/call rows as residual. */
  try {
    return { success: true, data: validateDeck(input) };
  } catch (error) {
    /* node:coverage ignore next 4 */
    /* DeckValidationError and unexpected-error paths are asserted; tsx maps catch rows as residual. */
    const message =
      error instanceof DeckValidationError ? error.message : "Invalid deck";
    return { success: false, error: message };
  }
}
