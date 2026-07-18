"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionResult } from "@/lib/action-result";
import { requireDocumentActionContext } from "./document-context";
import { requireDocumentCapability } from "@/lib/auth/document-permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { logError } from "@/lib/log";
import {
  isRestoredDeckValidationError,
  restoreVersion,
} from "@/lib/document/persistence-service";
import type {
  DocumentVersionSummary,
  RestoredDocumentVersion,
} from "@/lib/document/persistence-types";
import { DECK_SCHEMA_VERSION } from "@/lib/document/persistence/current-deck-schema";

const DOCUMENT_RESTORE_LOG_ERROR = new Error("Document version restore failed");

type VersionAuthor = { name: string | null; email: string | null } | null;

function displayName(user: VersionAuthor): string | null {
  return user ? (user.name ?? user.email ?? null) : null;
}

/**
 * Lists a document's version-history snapshots, newest first. Requires view
 * access (owner, workspace member, or otherwise permitted), authorized via
 * `requireDocumentCapability` so an unrelated user is rejected (issue #158).
 */
export async function listDocumentVersions(
  documentId: string,
): Promise<DocumentVersionSummary[]> {
  await requireDocumentActionContext(documentId, "view");

  const versions = await prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      createdAt: true,
      label: true,
      deckJson: true,
      createdBy: { select: { name: true, email: true } },
      document: { select: { owner: { select: { name: true, email: true } } } },
    },
  });

  return versions.map((version) => ({
    id: version.id,
    createdAt: version.createdAt.toISOString(),
    label: version.label,
    authorName:
      displayName(version.createdBy) ?? displayName(version.document.owner),
    hasDeck: version.deckJson != null,
  }));
}

/**
 * Restores a document to an earlier snapshot. Requires edit access.
 *
 * Delegates persistence orchestration (pre-restore checkpoint, atomic
 * contentJson+mirror write, deck sanitize+reconcile, cache revalidation) to
 * {@link restoreVersion} in the persistence service (#474).
 */
export async function restoreDocumentVersion(
  versionId: string,
): Promise<ActionResult<RestoredDocumentVersion>> {
  const user = await requireUser(redirect);

  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    select: { documentId: true },
  });
  if (!version) {
    return actionError("Version not found.");
  }

  const { documentId } = version;
  await requireDocumentCapability(user.id, documentId, "edit");

  try {
    const restored = await restoreVersion(documentId, versionId, user.id);
    revalidatePath(`/app/documents/${documentId}`);
    revalidatePath("/app");
    return actionOk(restored);
  } catch (err) {
    const invalidDeck = isRestoredDeckValidationError(err);
    logError("document.restore", DOCUMENT_RESTORE_LOG_ERROR, {
      code: invalidDeck ? "invalid_deck" : "restore_failed",
      issueCount: invalidDeck ? err.issueCount : 0,
      operation: "restore",
      outcome: "failed",
      schemaVersion: DECK_SCHEMA_VERSION,
      validationCode: invalidDeck
        ? err.diagnosticCode
        : "schema_validation_failed",
    });
    if (invalidDeck) {
      return actionError(
        "This version contains an invalid presentation deck and was not restored.",
      );
    }
    return actionError("Failed to restore document version.");
  }
}
