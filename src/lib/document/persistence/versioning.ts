/**
 * Version snapshot and restore persistence operations.
 *
 * Owns `sanitizeRestoredDeck` (strips orphaned visual refs from a restored
 * deck) and `restoreVersion` (the full snapshot restore flow).
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { collectVisualNodes } from "@/lib/lexical/visual-nodes";
import { safeParseDeck as safeParseLegacyDeck } from "@/lib/document/deck-schema";
import {
  DECK_SCHEMA_VERSION,
  safeParseDeck,
  type Deck,
  type SlideChildNode,
} from "@/lib/document/persistence/current-deck-schema";
import { reconcileDocumentDeckDependencies } from "@/lib/document/source-ref-model";
import { reportSchemaFailure } from "@/lib/diagnostics/schema-telemetry";
import { generateRevisionToken } from "@/lib/document/deck-revision-token";
import { updateDocumentsWithCanonicalContent } from "@/lib/document/document-write-port";
import type { RestoredDocumentVersion } from "@/lib/document/persistence-types";
import { snapshotDocumentVersion } from "./helpers";
import { mirrorVisualNodesInTx, reconcileDeckAfterMirror } from "./visual";
import { revalidateSharePaths } from "./sharing";

// Re-export so the barrel can surface it via `export *`
export type { RestoredDocumentVersion };

type RestoreVersionDeps = {
  db?: Pick<typeof prisma, "documentVersion" | "$transaction">;
  snapshot?: typeof snapshotDocumentVersion;
  reconcile?: typeof reconcileDeckAfterMirror;
  revalidate?: typeof revalidateSharePaths;
};

// ---------------------------------------------------------------------------
// Exported service operations
// ---------------------------------------------------------------------------

function toPrismaJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

/**
 * Sanitizes a restored snapshot's `deckJson` against its restored content.
 * Orphaned visual references are stripped so a restore never re-introduces
 * silently blank slides. Returns `Prisma.DbNull` when there is no deck.
 */
export function sanitizeRestoredDeck(
  rawDeckJson: Prisma.JsonValue | null,
  restoredContent: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (rawDeckJson == null) return Prisma.DbNull;

  const knownVisualIds = new Set(
    collectVisualNodes(restoredContent).map((n) => n.visualId),
  );

  if (looksLikeDeck(rawDeckJson)) {
    const parsed = safeParseDeck(rawDeckJson);
    if (!parsed.success) {
      reportSchemaFailure("deck-parse-failed", {
        area: "DocumentVersion.deckJson",
        reason: parsed.errors.join("; "),
      });
      return rawDeckJson as Prisma.InputJsonValue;
    }

    const sanitized = reconcileDeckVisualReferences(
      parsed.data,
      knownVisualIds,
    );
    return toPrismaJsonInput(sanitized);
  }

  const parsedLegacy = safeParseLegacyDeck(rawDeckJson);
  if (!parsedLegacy.success) {
    reportSchemaFailure("deck-parse-failed", {
      area: "DocumentVersion.deckJson",
      reason: parsedLegacy.error,
    });
    return rawDeckJson as Prisma.InputJsonValue;
  }

  const { deck: sanitizedLegacy } = reconcileDocumentDeckDependencies({
    deck: parsedLegacy.data,
    visualsById: knownVisualIds,
  });
  return toPrismaJsonInput(sanitizedLegacy);
}

function looksLikeDeck(rawDeckJson: Prisma.JsonValue): boolean {
  return (
    typeof rawDeckJson === "object" &&
    rawDeckJson !== null &&
    !Array.isArray(rawDeckJson) &&
    rawDeckJson.schemaVersion === DECK_SCHEMA_VERSION
  );
}

function reconcileDeckVisualReferences(
  deck: Deck,
  knownVisualIds: ReadonlySet<string>,
): Deck {
  return {
    ...deck,
    slides: deck.slides.map((slide) => ({
      ...slide,
      children: reconcileDeckChildren(slide.children, knownVisualIds),
    })),
  };
}

function reconcileDeckChildren(
  children: readonly SlideChildNode[],
  knownVisualIds: ReadonlySet<string>,
): SlideChildNode[] {
  const reconciled: SlideChildNode[] = [];

  for (const child of children) {
    const next = reconcileDeckChild(child, knownVisualIds);
    if (next) reconciled.push(next);
  }

  return reconciled;
}

function reconcileDeckChild(
  child: SlideChildNode,
  knownVisualIds: ReadonlySet<string>,
): SlideChildNode | null {
  if (child.type === "group") {
    const children = reconcileDeckChildren(child.children, knownVisualIds);
    if (children.length === 0) return null;
    return { ...child, children };
  }

  if (child.type !== "visual") return child;

  const rawVisualId = child.content.visualId;
  if (rawVisualId === undefined) return child;

  const visualId = rawVisualId.trim();
  if (visualId.length > 0 && knownVisualIds.has(visualId)) {
    if (visualId === rawVisualId) return child;
    return {
      ...child,
      content: { ...child.content, visualId },
    };
  }

  if (child.content.assetId !== undefined) {
    const { visualId: _ignored, ...contentWithoutVisualId } = child.content;
    return { ...child, content: contentWithoutVisualId };
  }

  return null;
}

/**
 * Restores a document to an earlier snapshot.
 *
 *  1. Snapshots the pre-restore state (forced, labelled "Before restore").
 *  2. Writes restored contentJson + deckJson (deck sanitized against restored
 *     content to strip orphaned visual refs).
 *  3. Atomically rebuilds Visual rows from the restored contentJson.
 *  4. Belt-and-suspenders deck reconciliation against actual DB Visual rows.
 *  5. Revalidates share/embed/present cache paths.
 */
export async function restoreVersion(
  documentId: string,
  versionId: string,
  userId?: string | null,
  deps: RestoreVersionDeps = {},
): Promise<RestoredDocumentVersion> {
  const db = deps.db ?? prisma;
  const snapshot = deps.snapshot ?? snapshotDocumentVersion;
  const reconcile = deps.reconcile ?? reconcileDeckAfterMirror;
  const revalidate = deps.revalidate ?? revalidateSharePaths;
  const version = await db.documentVersion.findUniqueOrThrow({
    where: { id: versionId },
    select: {
      documentId: true,
      contentJson: true,
      deckJson: true,
      createdAt: true,
    },
  });

  // Verify the version belongs to the expected document.
  if (version.documentId !== documentId) {
    throw new Error(
      `Version ${versionId} does not belong to document ${documentId}.`,
    );
  }

  /* node:coverage ignore next 5 */
  await snapshot(documentId, {
    userId,
    force: true,
    label: "Before restore",
  });

  const restoredContent = version.contentJson;
  const restoredDeck = sanitizeRestoredDeck(version.deckJson, restoredContent);
  const restoredDeckRevisionToken = generateRevisionToken();

  // Write the restored document state and its search projection, then atomically
  // rebuild the Visual mirror.
  await db.$transaction(async (tx) => {
    await updateDocumentsWithCanonicalContent(tx, {
      where: { id: documentId },
      contentSnapshot: restoredContent,
      data: {
        deckJson: restoredDeck,
        deckRevisionToken: restoredDeckRevisionToken,
      },
    });

    await mirrorVisualNodesInTx(tx, documentId, restoredContent);
  });

  await reconcile(documentId);
  await revalidate(documentId);

  return { documentId, contentJson: restoredContent };
}
