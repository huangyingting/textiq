import { Prisma } from "@/generated/prisma/client";
import { reportSchemaFailure } from "@/lib/diagnostics/schema-telemetry";
import { classifyValidationDiagnostics } from "@/lib/diagnostics/validation-classification";
import type {
  SaveDeckFailureResult,
  SaveDeckResult,
} from "@/lib/document/persistence-types";
import { MAX_DECK_JSON_BYTES, formatDeckTooLargeError } from "@/lib/limits";
import { logError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { generateRevisionToken } from "@/lib/document/deck-revision-token";
import { updateDocumentsMetadata } from "@/lib/document/document-write-port";
import {
  DECK_SCHEMA_VERSION,
  safeParseDeck,
} from "@/lib/document/persistence/current-deck-schema";

const DECK_CAS_UPDATE_LOG_ERROR = new Error("Deck CAS update failed");
const DECK_CAS_VERIFY_LOG_ERROR = new Error(
  "Deck CAS conflict verification failed",
);

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
  clientToken: string | null;
  telemetryArea: string;
  db?: DeckCasDb;
  throwOnStorageError?: boolean;
};

function fail(
  error: string,
  code: SaveDeckFailureResult["failure"]["code"],
  retryable: boolean,
): SaveDeckFailureResult {
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
  if (clientToken === undefined) {
    return fail(
      "A deck revision token is required.",
      "invalid_revision_token",
      false,
    );
  }

  const presentationResult = safeParseDeck(deckJson);
  if (!presentationResult.success) {
    reportSchemaFailure("deck-parse-failed", {
      area: telemetryArea,
      code: classifyValidationDiagnostics(presentationResult.errors),
      issueCount: presentationResult.errors.length,
      schemaVersion: DECK_SCHEMA_VERSION,
    });
    return fail("Invalid deck.", "invalid_deck", false);
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
      where: { id: documentId, deckRevisionToken: clientToken },
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
    logError("deck.cas", DECK_CAS_UPDATE_LOG_ERROR, {
      code: "storage_unavailable",
      documentId,
      operation: "updateMany",
      outcome: "failed",
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
      logError("deck.cas", DECK_CAS_VERIFY_LOG_ERROR, {
        code: "storage_unavailable",
        documentId,
        operation: "findUnique",
        outcome: "failed",
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
