import {
  floatAnchorToDeck,
  floatAnchorToSlide,
  resolveAnchorState,
  type SlideCommentAnchor,
} from "@/lib/comments/slide-comment-anchors";
import type { Deck } from "@/lib/presentation/schema";

export type PersistedSlideCommentAnchor = SlideCommentAnchor & { id: string };

export type SlideCommentAnchorRepairPlan = {
  floatToDeckIds: string[];
  floatToSlideIds: string[];
};

export function applySlideDeleteToAnchors(
  records: readonly SlideCommentAnchor[],
  deletedSlideId: string,
): SlideCommentAnchor[] {
  return records.map((anchor) =>
    anchor.slideId === deletedSlideId ? floatAnchorToDeck(anchor) : anchor,
  );
}

export function applyElementDeleteToAnchors(
  records: readonly SlideCommentAnchor[],
  slideId: string,
  deletedElementId: string,
): SlideCommentAnchor[] {
  return records.map((anchor) =>
    anchor.slideId === slideId && anchor.elementId === deletedElementId
      ? floatAnchorToSlide(anchor)
      : anchor,
  );
}

export function findOrphanedAnchors(
  records: readonly SlideCommentAnchor[],
  deck: Deck,
): SlideCommentAnchor[] {
  return records.filter(
    (anchor) => resolveAnchorState(anchor, deck) === "orphaned",
  );
}

export function planSlideCommentAnchorRepairs(
  records: readonly PersistedSlideCommentAnchor[],
  deck: Deck,
): SlideCommentAnchorRepairPlan {
  const plan: SlideCommentAnchorRepairPlan = {
    floatToDeckIds: [],
    floatToSlideIds: [],
  };

  for (const record of records) {
    if (resolveAnchorState(record, deck) !== "orphaned") {
      continue;
    }
    if (deck.slides.some((slide) => slide.id === record.slideId)) {
      plan.floatToSlideIds.push(record.id);
    } else {
      plan.floatToDeckIds.push(record.id);
    }
  }

  return plan;
}
