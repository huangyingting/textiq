"use server";

import { revalidatePath } from "next/cache";

import { requireDocumentActionContext } from "./document-context";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";
import { persistDeck } from "@/lib/document/persistence-service";
import type {
  FetchDeckResult,
  SaveDeckFailureResult,
  SaveDeckResult,
} from "@/lib/document/persistence-types";

function fail(
  error: string,
  code: SaveDeckFailureResult["failure"]["code"],
  retryable: boolean,
): SaveDeckFailureResult {
  return { ok: false, error, failure: { code, retryable } };
}

/**
 * Returns `{ deckJson, revisionToken }` for a document so the slide editor can
 * seed itself from the freshest server state rather than the stale page-load
 * prop (issue #155). `deckJson` is `null` when no deck has been saved yet;
 * `revisionToken` is `null` for documents that have not yet received a token
 * (first save). Returns a structured `{ ok: false, failure }` result for
 * missing documents and storage faults instead of throwing.
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

    return {
      ok: true,
      deckJson: document.deckJson,
      revisionToken: document.deckRevisionToken,
    };
  } catch (error) {
    logError("deck.fetch", error, { documentId: id });
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
 *   a prior successful save. When supplied the write uses an atomic CAS.
 */
export async function saveDeckJson(
  id: string,
  deckJson: unknown,
  clientToken?: string | null,
): Promise<SaveDeckResult> {
  const { user } = await requireDocumentActionContext(id, "edit");

  let result: SaveDeckResult;
  try {
    result = await persistDeck(id, deckJson, clientToken, {
      userId: user.id,
    });
  } catch (error) {
    logError("deck.save", error, { documentId: id });
    return fail(
      "Failed to save deck. Please try again.",
      "storage_unavailable",
      true,
    );
  }

  if (result.ok === true) {
    revalidatePath(`/app/documents/${id}`);
    revalidatePath(`/app/documents/${id}/slides`);
  }
  return result;
}
