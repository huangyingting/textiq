import { MIN_DECK_SLIDES_MESSAGE, deleteSlide } from "@/lib/presentation";
import type { Deck } from "@/lib/presentation/schema";

export function deleteActiveSlideFromToolbar(
  deck: Deck,
  activeSlideId: string | undefined,
): {
  deleted: boolean;
  nextDeck: Deck;
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
