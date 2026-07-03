/**
 * Shared facade for the current persisted deck contract.
 *
 * Document persistence imports this through `src/lib/document/deck-schema.ts`
 * so document-owned code does not depend directly on presentation runtime paths.
 */

export { DECK_SCHEMA_VERSION } from "@/lib/presentation/schema";
export type {
  Deck,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation/schema";
export { safeParseDeck } from "@/lib/presentation/validation";
export type { DeckParseResult } from "@/lib/presentation/validation";
