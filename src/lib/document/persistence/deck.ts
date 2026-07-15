/**
 * Deck persistence operations.
 *
 * Owns full-deck save (`persistDeck`) with optimistic revision-token CAS.
 */

import { reconcileSlideCommentAnchors } from "@/lib/comments";
import { prisma } from "@/lib/prisma";
import { writeDeckWithCas } from "@/lib/document/deck-cas-writer";
import { logError } from "@/lib/log";
import { safeParseDeck } from "@/lib/document/persistence/current-deck-schema";
import type { SaveDeckResult } from "@/lib/document/persistence-types";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { snapshotDocumentVersion } from "./helpers";

// Re-export so the barrel can surface it via `export *`
export type { SaveDeckResult };

// ---------------------------------------------------------------------------
// Exported service operations
// ---------------------------------------------------------------------------

/**
 * Persists an edited Deck for a document with an optimistic revision token.
 * Returns a discriminated result:
 * - `{ ok: true, revisionToken }` — write accepted.
 * - `{ ok: "conflict", serverRevisionToken }` — token mismatch.
 * - `{ ok: false, error, failure }` — structured validation/storage failure.
 */
export async function persistDeck(
  documentId: string,
  deckJson: unknown,
  clientToken?: string | null,
  options: { userId?: string | null } = {},
): Promise<SaveDeckResult> {
  const parsedNextDeck = safeParseDeck(deckJson);
  if (!parsedNextDeck.success) {
    return writeDeckWithCas({
      documentId,
      deckJson,
      clientToken,
      telemetryArea: "persistDeck.input",
    });
  }

  let result: SaveDeckResult;
  try {
    result = await runSerializableTransaction(prisma, async (tx) => {
      const result = await writeDeckWithCas({
        documentId,
        deckJson: parsedNextDeck.data,
        clientToken,
        telemetryArea: "persistDeck.input",
        db: tx,
        throwOnStorageError: true,
      });
      if (result.ok !== true) {
        return result;
      }

      await reconcileSlideCommentAnchors(tx, documentId, parsedNextDeck.data);
      return result;
    });
  } catch (error) {
    logError("deck.persist", error, {
      documentId,
      operation: "transaction",
    });
    return {
      ok: false,
      error: "Failed to save deck. Please try again.",
      failure: { code: "storage_unavailable", retryable: true },
    };
  }

  if (result.ok === true) {
    await snapshotDocumentVersion(documentId, options);
  }
  return result;
}
