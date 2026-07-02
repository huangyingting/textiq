import { LEGACY_DECK_SCHEMA_VERSION, type Deck } from "./deck-core";
import type {
  DeckPatch,
  PatchOp,
  CommandResult,
} from "./slide-command-contracts";

export function findSlideIndex(deck: Deck, slideId: string): number {
  return deck.slides.findIndex((s) => s.id === slideId);
}

export function failure(deck: Deck, error: string): CommandResult {
  return {
    ok: false,
    deck,
    affectedSlideIds: [],
    affectedElementIds: [],
    error,
    patches: [],
  };
}

export function makePatch(
  op: PatchOp,
  slideIds: string[],
  elementIds: string[],
  extra?: Partial<
    Pick<
      DeckPatch,
      "deckFields" | "slideFields" | "elementFields" | "addedIds" | "removedIds"
    >
  >,
): DeckPatch {
  return {
    schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
    op,
    slideIds,
    elementIds,
    ...extra,
  };
}

export function success(
  deck: Deck,
  affectedSlideIds: string[],
  affectedElementIds: string[],
  historyKey?: string,
  patches?: DeckPatch[],
): CommandResult {
  return {
    ok: true,
    deck,
    affectedSlideIds,
    affectedElementIds,
    ...(historyKey !== undefined ? { historyKey } : {}),
    patches: patches ?? [],
  };
}
