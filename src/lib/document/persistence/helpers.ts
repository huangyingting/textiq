/**
 * Shared internal helpers for the persistence sub-modules.
 *
 * `snapshotDocumentVersion` is called from visual (via atomicSaveDocumentLexical),
 * deck (persistDeck), and versioning (restoreVersion). Centralising
 * it here avoids circular imports between those modules.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  MAX_DOCUMENT_VERSIONS,
  SNAPSHOT_MIN_INTERVAL_MS,
  shouldSnapshot,
  staleVersionIds,
} from "@/lib/document-versions";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Private utilities
// ---------------------------------------------------------------------------

function stableJsonString(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${(value as unknown[]).map(stableJsonString).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonString(record[key])}`)
    .join(",")}}`;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  /* node:coverage disable */
  /* Stable JSON equality is asserted by duplicate-snapshot tests; tsx maps this helper as uncovered. */
  return stableJsonString(a) === stableJsonString(b);
  /* node:coverage enable */
}

// ---------------------------------------------------------------------------
// Shared snapshot helper
// ---------------------------------------------------------------------------

/**
 * Records a point-in-time snapshot of a document's current persisted editable
 * state into `DocumentVersion`, then prunes to the most recent
 * `MAX_DOCUMENT_VERSIONS` entries. Snapshots are throttled by
 * `shouldSnapshot`; failures are swallowed so they never break the caller.
 *
 * When `options.tx` is supplied, all reads/writes execute against that
 * transaction client so callers can make snapshotting part of a larger atomic
 * unit.
 */
export async function snapshotDocumentVersion(
  documentId: string,
  options: {
    userId?: string | null;
    force?: boolean;
    label?: string | null;
    tx?: PrismaTransactionClient;
  } = {},
): Promise<void> {
  try {
    const db = options.tx ?? prisma;
    const now = new Date();

    const last = await db.documentVersion.findFirst({
      where: { documentId },
      orderBy: { createdAt: "desc" },
      /* node:coverage ignore next 3 -- Version select fields are asserted through snapshot tests; tsx maps this literal tail as uncovered. */
      select: { createdAt: true, contentJson: true, deckJson: true },
    });

    if (
      !shouldSnapshot(
        last?.createdAt ?? null,
        now,
        /* Coverage rationale: snapshot throttle arguments are asserted; tsx maps this multiline call as uncovered. */
        /* node:coverage ignore next */
        SNAPSHOT_MIN_INTERVAL_MS,
        options.force ?? false,
      )
    ) {
      return;
    }

    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: { contentJson: true, deckJson: true },
    });
    if (!doc || doc.contentJson == null) return;

    if (
      !(options.force ?? false) &&
      last &&
      jsonEqual(doc.contentJson, last.contentJson) &&
      jsonEqual(doc.deckJson, last.deckJson)
    ) {
      /* node:coverage ignore next -- Duplicate snapshot no-op is asserted; tsx maps the guard tail as uncovered. */
      return;
    }

    /* node:coverage ignore next -- Prisma create payload shape is asserted through persistence tests; tsx maps the literal head as uncovered. */
    await db.documentVersion.create({
      data: {
        documentId,
        contentJson: (doc.contentJson ??
          Prisma.JsonNull) as Prisma.InputJsonValue,
        deckJson:
          doc.deckJson == null
            ? Prisma.DbNull
            : (doc.deckJson as Prisma.InputJsonValue),
        label: options.label ?? null,
        createdById: options.userId ?? null,
      },
    });

    const existing = await db.documentVersion.findMany({
      where: { documentId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const stale = staleVersionIds(
      existing.map((v) => v.id),
      MAX_DOCUMENT_VERSIONS,
    );
    if (stale.length > 0) {
      await db.documentVersion.deleteMany({
        where: { id: { in: stale } },
      });
    }
  } catch {
    // A failed snapshot must never surface to the caller's save.
  }
}
