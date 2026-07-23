"use server";

import { revalidatePath } from "next/cache";

import { requireDocumentActionContext } from "./document-context";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";
import { persistDeck } from "@/lib/document/persistence-service";
import { loadCustomThemePackagesForDeckJson } from "@/lib/presentation/brand-kit/persistence";
import type {
  FetchDeckResult,
  SaveDeckFailureResult,
  SaveDeckResult,
} from "@/lib/document/persistence-types";

const DECK_FETCH_LOG_ERROR = new Error("Deck fetch failed");
const DECK_SAVE_LOG_ERROR = new Error("Deck save failed");

function fail(
  error: string,
  code: SaveDeckFailureResult["failure"]["code"],
  retryable: boolean,
): SaveDeckFailureResult {
  return { ok: false, error, failure: { code, retryable } };
}

/**
 * Returns the freshest deck, revision token, and exact active custom-theme
 * snapshot derived from that authorized deck. The snapshot is render-only;
 * browseable catalog entries are intentionally excluded. `deckJson` is `null`
 * when no deck has been saved yet; `revisionToken` is `null` for documents
 * that have not yet received a token (first save). Returns a structured
 * `{ ok: false, failure }` result for missing documents and storage faults
 * instead of throwing.
 */
export async function fetchDeckJson(id: string): Promise<FetchDeckResult> {
  await requireDocumentActionContext(id, "view");

  try {
    const document = await prisma.document.findUnique({
      where: { id },
      select: { deckJson: true, deckRevisionToken: true },
    });
    if (!document) {
      return {
        ok: false,
        deckJson: null,
        revisionToken: null,
        error: "Document not found.",
        failure: { code: "document_not_found", retryable: false },
      };
    }

    const customThemes =
      document.deckJson === null
        ? { activePackage: undefined, diagnostics: [] }
        : await loadCustomThemePackagesForDeckJson(document.deckJson);

    return {
      ok: true,
      deckJson: document.deckJson,
      revisionToken: document.deckRevisionToken,
      ...(customThemes.activePackage
        ? { activeCustomThemePackage: customThemes.activePackage }
        : {}),
      themeDiagnostics: customThemes.diagnostics,
    };
  } catch {
    logError("deck.fetch", DECK_FETCH_LOG_ERROR, {
      code: "storage_unavailable",
      documentId: id,
      operation: "fetch",
      outcome: "failed",
    });
    return {
      ok: false,
      deckJson: null,
      revisionToken: null,
      error: "Failed to load deck. Please try again.",
      failure: { code: "storage_unavailable", retryable: true },
    };
  }
}

/**
 * Persists an edited Deck for a document. Requires edit access (owner or
 * workspace editor), authorized via `requireDocumentCapability` so a viewer or
 * unrelated user is rejected with a clear error (issue #89).
 *
 * Delegates persistence orchestration to {@link persistDeck} in the persistence
 * service (#474).
 *
 * ## Mutation entry-point boundaries (Epic #494)
 *
 * The deck has one active write entry point: {@link saveDeckJson}, which
 * accepts a **full deck JSON** snapshot and uses optimistic revision-token CAS
 * (`clientToken`). Patch replay is intentionally not exposed as a server action
 * for the presentation runtime.
 *
 * @param clientToken - The revision token last received from `fetchDeckJson` or
 *   a prior successful save. `null` is the first-save CAS predicate.
 */
export async function saveDeckJson(
  id: string,
  deckJson: unknown,
  clientToken: string | null,
): Promise<SaveDeckResult> {
  const { user } = await requireDocumentActionContext(id, "edit");
  if (clientToken === undefined) {
    return fail(
      "A deck revision token is required.",
      "invalid_revision_token",
      false,
    );
  }

  let result: SaveDeckResult;
  try {
    result = await persistDeck(id, deckJson, clientToken, {
      userId: user.id,
    });
  } catch {
    logError("deck.save", DECK_SAVE_LOG_ERROR, {
      code: "storage_unavailable",
      documentId: id,
      operation: "persist",
      outcome: "failed",
    });
    return fail(
      "Failed to save deck. Please try again.",
      "storage_unavailable",
      true,
    );
  }

  if (result.ok === true) {
    revalidatePath(`/app/documents/${id}`);
    // Intentionally not revalidating /slides: the live editor manages its own
    // state after each successful save. Revalidating the route would cause
    // Next.js to refresh the slides page with updated initialDeckRevisionToken
    // props, which re-runs the controller-creation effect and disposes the
    // active controller — silently dropping any in-flight debounce work such
    // as an undo or redo save scheduled immediately after the preceding write.
  }
  return result;
}
