import type { DeckFetchPort } from "@/lib/action-ports";
import { openDeckFromJson } from "@/lib/presentation/open-deck";
import type { Deck } from "@/lib/presentation/schema";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import { resolveThemePackageForDeck } from "@/lib/presentation/theme-package-registry";

export const CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE =
  "Couldn't load the server version. Check your connection and retry.";

export type ConflictReloadFailureReason =
  | "fetch_failed"
  | "invalid_server_deck"
  | "theme_hydration_failed";

export type ConflictReloadServerResult =
  | {
      ok: true;
      deck: Deck;
      deckJson: unknown;
      diagnostics: PresentationDiagnostic[];
      revisionToken: string | null;
      activeCustomThemePackage?: ThemePackageV1;
    }
  | {
      ok: false;
      reason: ConflictReloadFailureReason;
      error: string;
      diagnostics: PresentationDiagnostic[];
      validationErrors?: string[];
    };

export async function reloadConflictServerDeck({
  deckPort,
  documentId,
}: {
  deckPort: Pick<DeckFetchPort, "fetchDeckJson">;
  documentId: string;
}): Promise<ConflictReloadServerResult> {
  let fetchedDeck: Awaited<ReturnType<DeckFetchPort["fetchDeckJson"]>>;
  try {
    fetchedDeck = await deckPort.fetchDeckJson(documentId);
  } catch {
    return {
      ok: false,
      reason: "fetch_failed",
      error: CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE,
      diagnostics: [],
    };
  }

  if (!fetchedDeck.ok) {
    return {
      ok: false,
      reason: "fetch_failed",
      error: CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE,
      diagnostics: [],
    };
  }

  const openResult = openDeckFromJson(fetchedDeck.deckJson);
  if (!openResult.ok) {
    return {
      ok: false,
      reason: "invalid_server_deck",
      error: openResult.error,
      diagnostics: openResult.diagnostics,
      validationErrors: openResult.errors,
    };
  }

  const themeResolution = resolveThemePackageForDeck(openResult.deck, {
    activePackages: fetchedDeck.activeCustomThemePackage
      ? [fetchedDeck.activeCustomThemePackage]
      : [],
  });
  const diagnostics = [
    ...openResult.diagnostics,
    ...fetchedDeck.themeDiagnostics,
    ...themeResolution.diagnostics,
  ];
  if (themeResolution.fallback) {
    return {
      ok: false,
      reason: "theme_hydration_failed",
      error: CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE,
      diagnostics,
    };
  }

  return {
    ok: true,
    deck: openResult.deck,
    deckJson: fetchedDeck.deckJson,
    diagnostics,
    revisionToken: fetchedDeck.revisionToken,
    ...(fetchedDeck.activeCustomThemePackage
      ? { activeCustomThemePackage: fetchedDeck.activeCustomThemePackage }
      : {}),
  };
}
