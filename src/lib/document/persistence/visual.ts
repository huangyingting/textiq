/* node:coverage disable */
/**
 * Visual mirror persistence operations.
 *
 * Owns the atomic Lexical-save + Visual mirror rebuild, standalone mirror
 * rebuild, and post-mirror deck reconciliation.
 */

import { Prisma } from "@/generated/prisma/client";
import { collectVisualNodes } from "@/lib/lexical/visual-nodes";
import { prisma } from "@/lib/prisma";
import { safeParseDeck } from "@/lib/document/deck-schema";
import { reconcileDocumentDeckDependencies } from "@/lib/document/source-ref-model";
import { reportSchemaFailure } from "@/lib/diagnostics/schema-telemetry";
import { VISUAL_KIND_TO_PRISMA, safeParseVisual } from "@/lib/visual/schema";
import {
  diffVisualMirror,
  mirrorOutcomeFromDiff,
  type LiveVisualNode,
  type VisualMirrorOutcome,
} from "@/lib/visual/mirror-diff";
import { logInfo, logError } from "@/lib/log";
import { snapshotDocumentVersion } from "./helpers";

// Re-export so the barrel can surface it via `export *`
export type { VisualMirrorOutcome };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ANCHOR_BLOCK_ID_LENGTH = 200;
const MAX_VISUAL_REVISIONS = 10;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a caller-supplied anchor block id. A non-empty trimmed string
 * (clamped to a sane length) anchors the visual to that Markdown block; any
 * empty/whitespace value or non-string collapses to `null`.
 */
function normalizeAnchorBlockId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_ANCHOR_BLOCK_ID_LENGTH);
}

/**
 * Records a snapshot of a visual's current persisted state into
 * `VisualRevision`, then prunes that visual's history to the most recent
 * `MAX_VISUAL_REVISIONS` entries. Called with the *previous* row before it is
 * overwritten, so each edit is restorable (US-016).
 */
async function snapshotVisualRevision(
  tx: Prisma.TransactionClient,
  previous: {
    id: string;
    data: Prisma.JsonValue;
    type: string;
    title: string | null;
  },
): Promise<void> {
  await tx.visualRevision.create({
    data: {
      visualId: previous.id,
      data: previous.data as unknown as Prisma.InputJsonValue,
      type: previous.type,
      title: previous.title,
    },
  });

  const stale = await tx.visualRevision.findMany({
    where: { visualId: previous.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: MAX_VISUAL_REVISIONS,
    select: { id: true },
  });

  if (stale.length > 0) {
    await tx.visualRevision.deleteMany({
      where: { id: { in: stale.map((r) => r.id) } },
    });
  }
}

// ---------------------------------------------------------------------------
// Exported service operations
// ---------------------------------------------------------------------------

/**
 * Core mirror logic that runs entirely inside a caller-supplied Prisma
 * transaction client. Accepting `tx` as a parameter is what makes the
 * contentJson write + mirror atomic in a single transaction (#470): when the
 * caller passes the same `tx` as was used to write `contentJson`, Postgres /
 * SQLite sees a single atomic unit — a mirror failure rolls the whole thing
 * back so `contentJson` is never left committed with stale `Visual` rows.
 *
 * Also usable standalone (e.g. `rebuildVisualMirror`) by wrapping in its own
 * `prisma.$transaction(async tx => mirrorVisualNodesInTx(tx, ...))`.
 */
export async function mirrorVisualNodesInTx(
  tx: Prisma.TransactionClient,
  documentId: string,
  parsedState: unknown,
): Promise<VisualMirrorOutcome> {
  /* node:coverage enable */
  const nodes = collectVisualNodes(parsedState);

  const liveAnchors = new Set<string>();
  const liveNodes: Array<LiveVisualNode<Prisma.InputJsonValue>> = [];
  let invalidCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const anchor = normalizeAnchorBlockId(node.visualId);
    if (!anchor) {
      invalidCount += 1;
      continue;
    }
    liveAnchors.add(anchor);

    const result = safeParseVisual(node.visual);
    if (!result.success) {
      skippedCount += 1;
      reportSchemaFailure("content-visual-parse-failed", {
        area: "Document.contentJson:visual",
        documentId,
        anchorBlockId: anchor,
        reason: result.error,
      });
      continue;
    }
    const visual = result.data;
    liveNodes.push({
      anchorBlockId: anchor,
      orderIndex: index,
      type: VISUAL_KIND_TO_PRISMA[visual.type],
      title: visual.title ?? null,
      data: visual as unknown as Prisma.InputJsonValue,
      dataKey: JSON.stringify(visual),
    });
  }

  const existingRows = await tx.visual.findMany({
    where: { documentId },
    select: {
      id: true,
      anchorBlockId: true,
      orderIndex: true,
      data: true,
      type: true,
      title: true,
      createdAt: true,
    },
  });

  const existingById = new Map(existingRows.map((row) => [row.id, row]));

  const diff = diffVisualMirror<Prisma.InputJsonValue>({
    existingRows: existingRows.map((row) => {
      const parsed = safeParseVisual(row.data);
      if (!parsed.success) {
        reportSchemaFailure("visual-parse-failed", {
          area: "Visual.data",
          documentId,
          rowId: row.id,
          ...(row.anchorBlockId ? { anchorBlockId: row.anchorBlockId } : {}),
          reason: parsed.error,
        });
      }
      return {
        id: row.id,
        anchorBlockId: row.anchorBlockId,
        orderIndex: row.orderIndex,
        dataKey: parsed.success ? JSON.stringify(parsed.data) : null,
        createdAt: row.createdAt.getTime(),
      };
    }),
    liveNodes,
    liveAnchors,
  });

  for (const create of diff.toCreate) {
    await tx.visual.upsert({
      where: {
        documentId_anchorBlockId: {
          documentId,
          anchorBlockId: create.anchorBlockId,
        },
      },
      create: {
        documentId,
        anchorBlockId: create.anchorBlockId,
        orderIndex: create.orderIndex,
        type: create.type,
        title: create.title,
        data: create.data,
      },
      update: {
        orderIndex: create.orderIndex,
        type: create.type,
        title: create.title,
        data: create.data,
      },
    });
  }

  for (const update of diff.toUpdate) {
    if (update.payloadChanged) {
      const previous = existingById.get(update.id);
      if (previous) {
        await snapshotVisualRevision(tx, previous);
      }
      await tx.visual.update({
        where: { id: update.id },
        data: {
          type: update.type,
          title: update.title,
          data: update.data,
          orderIndex: update.orderIndex,
        },
      });
    } else {
      /* node:coverage ignore next 4 */
      await tx.visual.update({
        where: { id: update.id },
        data: { orderIndex: update.orderIndex },
      });
    }
  }

  /* node:coverage ignore next 5 */
  if (diff.toDelete.length > 0) {
    await tx.visual.deleteMany({ where: { id: { in: diff.toDelete } } });
  }

  return mirrorOutcomeFromDiff(diff, skippedCount, invalidCount);
}

/**
 * Atomically saves the Lexical editor state and rebuilds the Visual mirror
 * projection inside a **single** Prisma transaction (#470).
 *
 * A mirror failure rolls back the `contentJson` write so downstream readers
 * can never observe a committed `contentJson` with stale/missing `Visual` rows.
 *
 * @param documentId   The document to save.
 * @param parsedState  The already-parsed (and block-id-stamped) Lexical state.
 * @param userId       Optional: author for the version snapshot.
 */
export async function atomicSaveDocumentLexical(
  documentId: string,
  parsedState: unknown,
  userId?: string | null,
): Promise<VisualMirrorOutcome> {
  let outcome: VisualMirrorOutcome;

  await prisma.$transaction(async (tx) => {
    await snapshotDocumentVersion(documentId, { userId, tx });

    await tx.document.updateMany({
      where: { id: documentId },
      data: {
        contentJson: parsedState as Prisma.InputJsonValue,
        // Document.content (the plaintext mirror) is deprecated — no longer
        // written here. Physical column drop is a follow-up migration.
      },
    });

    outcome = await mirrorVisualNodesInTx(tx, documentId, parsedState);
  });

  // TypeScript requires the assignment to flow through — outcome is set in tx.
  const finalOutcome = outcome!;

  logInfo("visual.mirror", "mirror complete", {
    documentId,
    created: finalOutcome.created,
    updated: finalOutcome.updated,
    deleted: finalOutcome.deleted,
    skipped: finalOutcome.skipped,
    invalid: finalOutcome.invalid,
  });

  return finalOutcome;
}

/**
 * Rebuilds all `Visual` rows for a document purely from its current
 * `contentJson` (repair / standalone path). Does NOT snapshot, update
 * `contentJson`, or touch other document fields. Idempotent.
 */
export async function rebuildMirror(
  documentId: string,
  parsedState: unknown,
): Promise<VisualMirrorOutcome> {
  let outcome: VisualMirrorOutcome;
  await prisma.$transaction(async (tx) => {
    outcome = await mirrorVisualNodesInTx(tx, documentId, parsedState);
  });
  const finalOutcome = outcome!;
  logInfo("visual.rebuild", "rebuild complete", {
    documentId,
    ...finalOutcome,
  });
  return finalOutcome;
}

/**
 * Belt-and-suspenders post-mirror deck reconciliation.
 *
 * Re-reads the document's `deckJson` and current Visual rows from the DB,
 * strips deck visual references that no longer have a corresponding Visual row.
 * No-ops when there is no deck or when every deck reference is still valid.
 */
export async function reconcileDeckAfterMirror(
  documentId: string,
): Promise<void> {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { deckJson: true },
    });
    if (!doc?.deckJson) return;

    const parsed = safeParseDeck(doc.deckJson);
    if (!parsed.success) {
      reportSchemaFailure("deck-parse-failed", {
        area: "Document.deckJson",
        documentId,
        reason: parsed.error,
      });
      return;
    }

    const visualRows = await prisma.visual.findMany({
      where: { documentId, anchorBlockId: { not: null } },
      select: { anchorBlockId: true },
    });
    const knownVisualIds = new Set(
      visualRows
        .map((r) => r.anchorBlockId)
        .filter((id): id is string => id !== null),
    );

    const { deck: reconciled, changed } = reconcileDocumentDeckDependencies({
      deck: parsed.data,
      visualsById: knownVisualIds,
    });

    if (!changed) return;

    await prisma.document.updateMany({
      where: { id: documentId },
      data: { deckJson: reconciled as unknown as Prisma.InputJsonValue },
    });

    logInfo("visual.reconcile", "deck reconciled after mirror", {
      documentId,
      knownVisualCount: knownVisualIds.size,
    });
  } catch (err) {
    logError(
      "visual.reconcile",
      err instanceof Error ? err : new Error(String(err)),
      { documentId },
    );
  }
}
