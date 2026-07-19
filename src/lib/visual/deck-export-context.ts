import { looksLikeDeck, openDeckFromJson } from "@/lib/presentation/open-deck";
import type { Deck } from "@/lib/presentation/schema";

export interface PresentationDeckExportContext {
  kind: "presentation";
  deck: Deck;
}

export interface DeckExportErrorContext {
  kind: "error";
  message: string;
}

export type DeckExportContext =
  PresentationDeckExportContext | DeckExportErrorContext;

function pickFreshestDeck(
  freshestDeckJson: unknown,
  initialDeckJson: unknown,
):
  | { kind: "presentation"; deck: Deck }
  | { kind: "error"; message: string }
  | null {
  const candidates = [
    { source: "saved", raw: freshestDeckJson },
    { source: "initial", raw: initialDeckJson },
  ] as const;
  let firstInvalidDeckError: string | null = null;
  for (const candidate of candidates) {
    if (!looksLikeDeck(candidate.raw)) continue;
    const opened = openDeckFromJson(candidate.raw);
    if (opened.ok) {
      return { kind: "presentation", deck: opened.deck };
    }
    if (!firstInvalidDeckError) {
      firstInvalidDeckError = `The ${candidate.source} Deck could not be exported: ${opened.error}`;
    }
  }
  return firstInvalidDeckError
    ? { kind: "error", message: firstInvalidDeckError }
    : null;
}

export function resolveDeckExportContext(
  freshestDeckJson: unknown,
  initialDeckJson: unknown,
): DeckExportContext {
  const deck = pickFreshestDeck(freshestDeckJson, initialDeckJson);
  if (deck?.kind === "presentation") {
    return deck;
  }
  if (deck?.kind === "error") {
    return deck;
  }
  return {
    kind: "error",
    message: "PPTX export requires a current Deck presentation.",
  };
}
