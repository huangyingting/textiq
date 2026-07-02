/**
 * Validation facade for persisted deck JSON.
 *
 * `safeParseDeck` remains the public parse boundary while validators live in
 * schema-area modules under `deck-validation/`.
 */

import type { Deck } from "../presentation/deck-core";
import { validateDeck } from "../presentation/deck-validation/core";
import { DeckValidationError } from "../presentation/deck-validation/shared";

export { validateElement } from "../presentation/deck-validation/elements";
export {
  validateImageCrop,
  validateImageFitMode,
  validateImageMaskShape,
} from "../presentation/deck-validation/media";
export { validateSourceRef } from "../presentation/deck-validation/source-refs";

export type DeckParseResult =
  | { success: true; data: Deck }
  | { success: false; error: string };

/**
 * Non-throwing wrapper around the current deck schema validator.
 *
 * Only the current schema version is accepted.
 */
export function safeParseDeck(input: unknown): DeckParseResult {
  try {
    return { success: true, data: validateDeck(input) };
  } catch (error) {
    const message =
      error instanceof DeckValidationError ? error.message : "Invalid deck";
    return { success: false, error: message };
  }
}
