import type { Deck } from "./deck-core";
import type { SlideFormat } from "@/lib/document/deck-kernel/slide-format";

/**
 * Changes the presentation theme id.
 *
 * The style cascade resolves deck tokens exclusively through the deck-level
 * theme resolver. Applying a built-in theme also clears a theme override token set so
 * the built-in token set is visible immediately.
 */
export function setPresentationTheme(deck: Deck, themeId: string): Deck {
  const design = { ...(deck.design ?? {}), themeId };
  delete design.themeOverrides;
  return { ...deck, design };
}

/** Changes the deck-wide slide format. */
export function setDeckSlideFormat(deck: Deck, slideFormat: SlideFormat): Deck {
  const current = deck.canvas?.format;
  return current === slideFormat
    ? deck
    : {
        ...deck,
        canvas: { ...(deck.canvas ?? {}), format: slideFormat },
      };
}
