/**
 * Document persistence boundary for the current persisted presentation deck.
 *
 * Document services import this module instead of reaching into the presentation
 * runtime directly.
 */

export {
  CURRENT_DECK_SCHEMA_VERSION as DECK_SCHEMA_VERSION,
  safeParseCurrentDeck as safeParseDeck,
} from "@/lib/document/deck-schema";
export type {
  CurrentDeck as Deck,
  CurrentDeckParseResult as DeckParseResult,
  CurrentSlideChildNode as SlideChildNode,
  CurrentSlideNode as SlideNode,
} from "@/lib/document/deck-schema";
