/**
 * Deck persistence operations.
 *
 * Owns full-deck save (`persistDeck`) with optimistic revision-token CAS.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { writeDeckWithCas } from "@/lib/document/deck-cas-writer";
import { logError } from "@/lib/log";
import {
  safeParseDeck,
  type Deck,
  type SlideChildNode,
  type SlideNode,
} from "@/lib/document/persistence/current-deck-schema";
import type { SaveDeckResult } from "@/lib/document/persistence-types";
import { snapshotDocumentVersion } from "./helpers";

// Re-export so the barrel can surface it via `export *`
export type { SaveDeckResult };

type SlideNodeIndex = Map<string, Set<string>>;

function collectNodeIds(nodes: readonly SlideChildNode[], out: string[]): void {
  for (const node of nodes) {
    out.push(node.id);
    if (node.type === "group") {
      collectNodeIds(node.children, out);
    }
  }
}

function listSlideNodeIds(slide: SlideNode): string[] {
  const nodeIds: string[] = [];
  collectNodeIds(slide.children, nodeIds);
  return nodeIds;
}

function buildSlideNodeIndex(deck: Deck): SlideNodeIndex {
  const index: SlideNodeIndex = new Map();
  for (const slide of deck.slides) {
    index.set(slide.id, new Set(listSlideNodeIds(slide)));
  }
  return index;
}

function diffDeletedAnchors(
  before: Deck,
  after: Deck,
): { deletedSlides: string[]; deletedNodeIdsBySlide: Map<string, string[]> } {
  const afterSlideIds = new Set(after.slides.map((slide) => slide.id));
  const afterNodeIndex = buildSlideNodeIndex(after);
  const deletedSlides: string[] = [];
  const deletedNodeIdsBySlide = new Map<string, string[]>();

  for (const slide of before.slides) {
    if (!afterSlideIds.has(slide.id)) {
      deletedSlides.push(slide.id);
      continue;
    }
    const afterNodeIds = afterNodeIndex.get(slide.id) ?? new Set<string>();
    const deletedNodeIds = listSlideNodeIds(slide).filter(
      (nodeId) => !afterNodeIds.has(nodeId),
    );
    if (deletedNodeIds.length > 0) {
      deletedNodeIdsBySlide.set(slide.id, deletedNodeIds);
    }
  }

  return { deletedSlides, deletedNodeIdsBySlide };
}

async function loadPersistedDeck(documentId: string): Promise<Deck | null> {
  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { deckJson: true },
    });
    if (!document?.deckJson) {
      return null;
    }
    const parsed = safeParseDeck(document.deckJson);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    logError("deck.reconcile", error, {
      documentId,
      operation: "loadPersistedDeck",
    });
    return null;
  }
}

async function floatOrphanedCommentAnchors(
  documentId: string,
  deck: Deck,
): Promise<void> {
  const slideNodeIndex = buildSlideNodeIndex(deck);
  const anchoredComments = await prisma.comment.findMany({
    where: { documentId, parentId: null, slideId: { not: null } },
    select: { id: true, slideId: true, elementId: true },
  });

  const orphanedIds = anchoredComments
    .filter((comment) => {
      if (!comment.slideId) {
        return false;
      }
      const slideNodeIds = slideNodeIndex.get(comment.slideId);
      if (!slideNodeIds) {
        return true;
      }
      return comment.elementId != null && !slideNodeIds.has(comment.elementId);
    })
    .map((comment) => comment.id);

  if (orphanedIds.length === 0) {
    return;
  }

  await prisma.comment.updateMany({
    where: { id: { in: orphanedIds } },
    data: { slideId: null, elementId: null, anchorGeometry: Prisma.DbNull },
  });
}

async function reconcileCommentAnchorsAfterDeckSave(
  documentId: string,
  previousDeck: Deck | null,
  nextDeck: Deck,
): Promise<void> {
  if (previousDeck) {
    const { deletedSlides, deletedNodeIdsBySlide } = diffDeletedAnchors(
      previousDeck,
      nextDeck,
    );

    for (const [slideId, deletedNodeIds] of deletedNodeIdsBySlide) {
      await prisma.comment.updateMany({
        where: { documentId, slideId, elementId: { in: deletedNodeIds } },
        data: { elementId: null },
      });
    }

    for (const slideId of deletedSlides) {
      await prisma.comment.updateMany({
        where: { documentId, slideId },
        data: { slideId: null, elementId: null, anchorGeometry: Prisma.DbNull },
      });
    }
  }

  await floatOrphanedCommentAnchors(documentId, nextDeck);
}

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
  const previousDeckPromise = parsedNextDeck.success
    ? loadPersistedDeck(documentId)
    : Promise.resolve(null);

  return writeDeckWithCas({
    documentId,
    deckJson,
    clientToken,
    telemetryArea: "persistDeck.input",
    onSuccess: async () => {
      await snapshotDocumentVersion(documentId, options);
      if (!parsedNextDeck.success) {
        return;
      }
      const previousDeck = await previousDeckPromise;
      await reconcileCommentAnchorsAfterDeckSave(
        documentId,
        previousDeck,
        parsedNextDeck.data,
      );
    },
  });
}
