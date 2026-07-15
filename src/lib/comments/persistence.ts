import { Prisma } from "@/generated/prisma/client";
import type { Deck } from "@/lib/presentation/schema";

import { planSlideCommentAnchorRepairs } from "./lifecycle";

export type CommentAnchorPersistenceDb = Pick<
  Prisma.TransactionClient,
  "comment"
>;

export type CommentAnchorReconciliationResult = {
  floatedToDeck: number;
  floatedToSlide: number;
};

export async function reconcileSlideCommentAnchors(
  db: CommentAnchorPersistenceDb,
  documentId: string,
  deck: Deck,
): Promise<CommentAnchorReconciliationResult> {
  const anchoredComments = await db.comment.findMany({
    where: { documentId, parentId: null, slideId: { not: null } },
    select: { id: true, slideId: true, elementId: true },
  });
  const repairs = planSlideCommentAnchorRepairs(anchoredComments, deck);

  if (repairs.floatToDeckIds.length > 0) {
    await db.comment.updateMany({
      where: {
        documentId,
        parentId: null,
        id: { in: repairs.floatToDeckIds },
      },
      data: {
        slideId: null,
        elementId: null,
        anchorGeometry: Prisma.DbNull,
      },
    });
  }

  if (repairs.floatToSlideIds.length > 0) {
    await db.comment.updateMany({
      where: {
        documentId,
        parentId: null,
        id: { in: repairs.floatToSlideIds },
      },
      data: { elementId: null },
    });
  }

  return {
    floatedToDeck: repairs.floatToDeckIds.length,
    floatedToSlide: repairs.floatToSlideIds.length,
  };
}
