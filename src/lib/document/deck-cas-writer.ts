import { Prisma } from "@/generated/prisma/client";
import { reportSchemaFailure } from "@/lib/diagnostics/schema-telemetry";
import type { SaveDeckResult } from "@/lib/document/persistence-types";
import { MAX_DECK_JSON_BYTES, formatDeckTooLargeError } from "@/lib/limits";
import { logError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { generateRevisionToken } from "@/lib/document/deck-revision-token";
import { updateDocumentsMetadata } from "@/lib/document/document-write-port";
import { safeParseDeck } from "@/lib/document/persistence/current-deck-schema";

export type DeckCasDb = {
  document: {
    findUnique(args: {
      where: { id: string };
      select: { deckRevisionToken: true };
    }): Promise<{ deckRevisionToken: string | null } | null>;
  };
};

export type DeckCasWriteOptions = {
  documentId: string;
  deckJson: unknown;
  clientToken?: string | null;
  telemetryArea: string;
  db?: DeckCasDb;
  throwOnStorageError?: boolean;
};

function fail(
  error: string,
  code:
    | "invalid_deck"
    | "deck_too_large"
    | "document_not_found"
    | "storage_unavailable",
  retryable: boolean,
): SaveDeckResult {
  return { ok: false, error, failure: { code, retryable } };
}

function toPrismaJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

export async function writeDeckWithCas({
  documentId,
  deckJson,
  clientToken,
  telemetryArea,
  db = prisma,
  throwOnStorageError = false,
}: DeckCasWriteOptions): Promise<SaveDeckResult> {
  const presentationResult = safeParseDeck(deckJson);
  if (!presentationResult.success) {
    const reason = presentationResult.errors.join("; ");
    reportSchemaFailure("deck-parse-failed", {
      area: telemetryArea,
      documentId,
      reason,
    });
    return fail(`Invalid deck: ${reason}`, "invalid_deck", false);
  }

  const parsedData = presentationResult.data;
  const serialized = JSON.stringify(parsedData);
  const serializedBytes = Buffer.byteLength(serialized, "utf8");
  if (serializedBytes > MAX_DECK_JSON_BYTES) {
    return fail(formatDeckTooLargeError(), "deck_too_large", false);
  }

  const newToken = generateRevisionToken();
  let count: number;
  try {
    const update = await updateDocumentsMetadata(db, {
      where:
        /* Coverage rationale: CAS/no-CAS update predicates are asserted; tsx maps ternary rows as uncovered. */
        /* node:coverage ignore next 3 */
        clientToken != null
          ? { id: documentId, deckRevisionToken: clientToken }
          : { id: documentId },
      data: {
        deckJson: toPrismaJsonInput(parsedData),
        deckRevisionToken: newToken,
      },
    });
    count = update.count;
  } catch (error) {
    if (throwOnStorageError) {
      throw error;
    }
    logError("deck.cas", error, {
      documentId,
      operation: "updateMany",
      telemetryArea,
    });
    return fail(
      "Failed to save deck. Please try again.",
      "storage_unavailable",
      true,
    );
  }

  if (count === 0) {
    let latest: { deckRevisionToken: string | null } | null;
    try {
      latest = await db.document.findUnique({
        where: { id: documentId },
        select: { deckRevisionToken: true },
      });
    } catch (error) {
      if (throwOnStorageError) {
        throw error;
      }
      logError("deck.cas", error, {
        documentId,
        operation: "findUnique",
        telemetryArea,
      });
      return fail(
        "Failed to verify deck conflict. Please try again.",
        "storage_unavailable",
        true,
      );
    }
    if (!latest)
      return fail("Document not found.", "document_not_found", false);
    return {
      ok: "conflict",
      serverRevisionToken: latest.deckRevisionToken,
    };
  }

  /* node:coverage ignore next -- CAS success return is asserted; tsx maps the tail as uncovered. */
  return { ok: true, revisionToken: newToken };
}
