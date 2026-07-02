import { buildDeckFromBlocks, type Deck } from "@/lib/document/deck-model";
import { pickFreshestDeck } from "@/lib/visual/fresh-deck";
import {
  looksLikeDeckV7,
  openDeckFromJson,
} from "@/lib/presentation-vnext/open-deck";
import type { DeckV7 } from "@/lib/presentation-vnext/schema";
import type { DocumentBlock } from "@/lib/content";
import type { Visual } from "@/lib/visual/schema";

export interface LegacyDeckExportContext {
  kind: "legacy";
  deck: Deck;
  visuals: Map<string, Visual>;
}

export interface DeckV7ExportContext {
  kind: "v7";
  deck: DeckV7;
}

export interface DeckExportErrorContext {
  kind: "error";
  message: string;
}

export type DeckExportContext =
  | LegacyDeckExportContext
  | DeckV7ExportContext
  | DeckExportErrorContext;

export function buildDeckVisualMap(
  blocks: ReadonlyArray<DocumentBlock>,
): Map<string, Visual> {
  const visuals = new Map<string, Visual>();
  for (const block of blocks) {
    if (block.kind === "visual") {
      visuals.set(block.visualId, block.visual);
    }
  }
  return visuals;
}

function pickFreshestDeckV7(
  freshestDeckJson: unknown,
  initialDeckJson: unknown,
): { kind: "v7"; deck: DeckV7 } | { kind: "error"; message: string } | null {
  const candidates = [
    { source: "saved", raw: freshestDeckJson },
    { source: "initial", raw: initialDeckJson },
  ] as const;
  let firstInvalidDeckV7Error: string | null = null;
  for (const candidate of candidates) {
    if (!looksLikeDeckV7(candidate.raw)) continue;
    const opened = openDeckFromJson(candidate.raw);
    if (opened.ok) {
      return { kind: "v7", deck: opened.deck };
    }
    if (!firstInvalidDeckV7Error) {
      firstInvalidDeckV7Error = `The ${candidate.source} DeckV7 could not be exported: ${opened.error}`;
    }
  }
  return firstInvalidDeckV7Error
    ? { kind: "error", message: firstInvalidDeckV7Error }
    : null;
}

export function resolveDeckExportContext(
  blocks: ReadonlyArray<DocumentBlock>,
  freshestDeckJson: unknown,
  initialDeckJson: unknown,
): DeckExportContext {
  const deckV7 = pickFreshestDeckV7(freshestDeckJson, initialDeckJson);
  if (deckV7?.kind === "v7") {
    return deckV7;
  }
  if (deckV7?.kind === "error") {
    return deckV7;
  }
  const baseDeck = buildDeckFromBlocks([...blocks]);
  return {
    kind: "legacy",
    deck: pickFreshestDeck(freshestDeckJson, initialDeckJson, baseDeck),
    visuals: buildDeckVisualMap(blocks),
  };
}
