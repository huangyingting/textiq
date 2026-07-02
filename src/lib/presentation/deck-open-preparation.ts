import type { DeckFetchPort } from "@/lib/action-ports";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import { decideDeckOpen } from "@/lib/presentation/open-deck";
import type { Deck } from "@/lib/presentation/schema";

export const DECK_OPEN_FETCH_REJECTED_MESSAGE_ =
  "Couldn't load the latest deck. Check your connection and retry.";

export type DeckOpenFetchFailureReason = "result_error" | "rejected";

export type DeckOpenFetchFailure = {
  reason: DeckOpenFetchFailureReason;
  error: string;
};

export type PreparedDeckForOpen =
  | {
      ok: true;
      deck: Deck;
      diagnostics: PresentationDiagnostic[];
      revisionToken: string | null;
    }
  | {
      ok: false;
      error: string;
      diagnostics: PresentationDiagnostic[];
      validationErrors?: string[];
    };

export type DeckOpenFallback =
  | Deck
  | { deck: Deck; diagnostics?: PresentationDiagnostic[] };

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }
  if (typeof error === "string") {
    return error.trim();
  }
  return "";
}

export function resolveDeckOpenFetchRejectionError(error: unknown): string {
  const details = stringifyError(error);
  if (!details) {
    return DECK_OPEN_FETCH_REJECTED_MESSAGE_;
  }
  return `${DECK_OPEN_FETCH_REJECTED_MESSAGE_} (${details})`;
}

function normalizeFallbackDeck(fallback: DeckOpenFallback): {
  deck: Deck;
  diagnostics: PresentationDiagnostic[];
} {
  if ("schemaVersion" in fallback) {
    return { deck: fallback, diagnostics: [] };
  }
  return { deck: fallback.deck, diagnostics: fallback.diagnostics ?? [] };
}

export async function prepareDeckForOpen({
  documentId,
  deckPort,
  fallbackDeck,
  onFetchFailure,
}: {
  documentId: string;
  deckPort: Pick<DeckFetchPort, "fetchDeckJson">;
  fallbackDeck: () => DeckOpenFallback;
  onFetchFailure?: (failure: DeckOpenFetchFailure) => void;
}): Promise<PreparedDeckForOpen> {
  let fetchedDeck: Awaited<ReturnType<DeckFetchPort["fetchDeckJson"]>>;
  try {
    fetchedDeck = await deckPort.fetchDeckJson(documentId);
  } catch (error) {
    const resolvedError = resolveDeckOpenFetchRejectionError(error);
    onFetchFailure?.({
      reason: "rejected",
      error: resolvedError,
    });
    return {
      ok: false,
      error: resolvedError,
      diagnostics: [],
    };
  }

  if (!fetchedDeck.ok) {
    onFetchFailure?.({
      reason: "result_error",
      error: fetchedDeck.error,
    });
    return {
      ok: false,
      error: fetchedDeck.error,
      diagnostics: [],
    };
  }

  const decision = decideDeckOpen(fetchedDeck.deckJson ?? null);
  if (decision.mode === "blank") {
    const fallback = normalizeFallbackDeck(fallbackDeck());
    return {
      ok: true,
      deck: fallback.deck,
      diagnostics: fallback.diagnostics,
      revisionToken: fetchedDeck.revisionToken,
    };
  }
  if (decision.mode === "open") {
    return {
      ok: true,
      deck: decision.deck,
      diagnostics: decision.diagnostics,
      revisionToken: fetchedDeck.revisionToken,
    };
  }
  return {
    ok: false,
    error: decision.error,
    diagnostics: decision.diagnostics,
    validationErrors: decision.errors,
  };
}
