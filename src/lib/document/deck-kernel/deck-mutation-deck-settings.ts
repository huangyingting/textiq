import type { Deck } from "./deck-core";
import type { SlideFormat } from "@/lib/presentation-shared/slide-format";

/**
 * Changes the presentation theme id.
 *
 * The style cascade resolves deck tokens exclusively through the deck-level
 * theme resolver. Applying a built-in theme also clears a theme override token set so
 * the built-in token set is visible immediately.
 */
export function setPresentationTheme(deck: Deck, themeId: string): Deck {
  const design = { ...((deck as any).design ?? {}), themeId };
  delete (design as { themeOverrides?: unknown }).themeOverrides;
  return { ...deck, design } as Deck;
}

/** Changes the deck-wide slide format. */
export function setDeckSlideFormat(deck: Deck, slideFormat: SlideFormat): Deck {
  const current = (deck as any).canvas?.format;
  return current === slideFormat
    ? deck
    : ({
        ...deck,
        canvas: { ...((deck as any).canvas ?? {}), format: slideFormat },
      } as Deck);
}
