"use server";

import { revalidatePath } from "next/cache";

import { requireDocumentActionContext } from "./document-context";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";
import { persistDeck, patchDeck } from "@/lib/document/persistence-service";
import type {
  FetchDeckResult,
  SaveDeckFailureResult,
  SaveDeckPatchResult,
  SaveDeckResult,
} from "@/lib/document/persistence-types";
import type { DeckPatch } from "@/lib/commands/deck-command-contracts";

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
 * The deck has two write entry points, each with a distinct input contract:
 *  - {@link saveDeckJson} — accepts a **full deck JSON** snapshot.
 *  - {@link saveDeckPatch} — accepts **`DeckPatch[]`** records but currently
 *    returns a compatibility `{ ok: "fallback" }` response for v7 runtime
 *    callers, which then use {@link saveDeckJson}.
 *
 * Active v7 writes use optimistic revision-token CAS via `saveDeckJson`
 * (`clientToken`).
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

/**
 * Compatibility patch endpoint for non-v7 callers.
 *
 * Patch replay is currently disabled for the v7 runtime. Delegates to
 * {@link patchDeck}, which validates document availability and returns
 * `{ ok: "fallback" }` for replay attempts so callers can save a full deck via
 * {@link saveDeckJson}.
 *
 * Input contract: pre-built `DeckPatch[]` (typically produced by `commitCommand`
 * on the client).
 */
export async function saveDeckPatch(
  id: string,
  patches: DeckPatch[],
  clientToken: string | null | undefined,
): Promise<SaveDeckPatchResult> {
  const { user } = await requireDocumentActionContext(id, "edit");

  let result: SaveDeckPatchResult;
  try {
    result = await patchDeck(id, patches, clientToken, { userId: user.id });
  } catch (error) {
    logError("deck.patch", error, { documentId: id });
    return fail(
      "Failed to save deck patches. Please try again.",
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
