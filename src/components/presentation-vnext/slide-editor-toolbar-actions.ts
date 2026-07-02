import { MIN_DECK_SLIDES_MESSAGE, deleteSlide } from "@/lib/presentation-vnext";
import type { DeckV7 } from "@/lib/presentation-vnext/schema";

export function deleteActiveSlideFromToolbar(
  deck: DeckV7,
  activeSlideId: string | undefined,
): {
  deleted: boolean;
  nextDeck: DeckV7;
  nextIndex: number;
  statusMessage?: string;
} {
  if (!activeSlideId) {
    return { deleted: false, nextDeck: deck, nextIndex: 0 };
  }
  if (deck.slides.length <= 1) {
    return {
      deleted: false,
      nextDeck: deck,
      nextIndex: 0,
      statusMessage: MIN_DECK_SLIDES_MESSAGE,
    };
  }
  const result = deleteSlide(deck, activeSlideId);
  return {
    deleted: result.deck !== deck,
    nextDeck: result.deck,
    nextIndex: result.index,
  };
}
