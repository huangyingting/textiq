import {
  looksLikeDeckV7,
  openDeckFromJson,
} from "@/lib/presentation-vnext/open-deck";
import type { DeckV7 } from "@/lib/presentation-vnext/schema";

export interface DeckV7ExportContext {
  kind: "v7";
  deck: DeckV7;
}

export interface DeckExportErrorContext {
  kind: "error";
  message: string;
}

export type DeckExportContext = DeckV7ExportContext | DeckExportErrorContext;

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
  return {
    kind: "error",
    message: "PPTX export requires a current DeckV7 presentation.",
  };
}
