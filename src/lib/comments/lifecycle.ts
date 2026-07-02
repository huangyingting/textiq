import {
  floatAnchorToDeck,
  floatAnchorToSlide,
  resolveAnchorState,
  type SlideCommentAnchor,
} from "@/lib/comments/slide-comment-anchors";
import type { Deck } from "@/lib/presentation/schema";

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
