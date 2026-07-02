/**
 * Pure helpers for slide comment anchor semantics (Epic #380).
 *
 * A comment may carry an optional slide-level anchor that pins it to a
 * specific location inside a {@link DeckV7}. This module resolves and
 * manipulates those anchors without any I/O or React dependencies — fully
 * testable under `node --test`.
 *
 * Anchor resolution states:
 *  - `"deck"`     — no slideId; the comment floats at deck level.
 *  - `"attached"` — the referenced slide (and node, if any) still exists.
 *  - `"orphaned"` — the referenced slide or node no longer exists in the
 *                   deck (was deleted or its id changed).
 *  - `"unknown"`  — anchor data is present but the deck is unavailable, so
 *                   live resolution is impossible.
 *
 * ## Geometry shape
 * `anchorGeometry` stores a simple `{x, y}` point.
 */

import type { DeckV7, SlideChildNode } from "@/lib/presentation-vnext/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Anchor geometry: a point expressed in percent units (0–100) relative to
 * the slide canvas, used to pin a comment indicator on-screen.
 */
export interface AnchorPoint {
  /** Horizontal position as a percent of slide width (0 = left, 100 = right). */
  x: number;
  /** Vertical position as a percent of slide height (0 = top, 100 = bottom). */
  y: number;
}

/**
 * The slide-level portion of a comment anchor. Mirrors the nullable DB
 * columns on `Comment`.
 *
 * All fields are optional — an absent/null anchor means the comment is
 * attached to the whole document (deck level).
 */
export interface SlideCommentAnchor {
  /** Slide.id from deckJson. Null → deck-level comment. */
  slideId?: string | null;
  /**
   * V7 SlideChildNode.id within the slide. The DB column is still named
   * `elementId`, but the runtime value is a v7 node id.
   */
  elementId?: string | null;
  /**
   * Optional visual pin point. Coordinates are in percent units (0–100)
   * relative to the slide canvas. Stored in anchorGeometry DB column.
   */
  geometry?: AnchorPoint | null;
}

/**
 * The resolved state of a {@link SlideCommentAnchor} against a live deck.
 *
 * | Value       | Meaning                                                      |
 * |-------------|--------------------------------------------------------------|
 * | `"deck"`    | No slide anchor — comment belongs to the whole deck.         |
 * | `"attached"`| Slide (and element if specified) exists in the deck.         |
 * | `"orphaned"`| Slide or element no longer exists (deleted / id changed).    |
 * | `"unknown"` | Anchor specifies a slideId but no deck was provided.         |
 */
export type AnchorState = "deck" | "attached" | "orphaned" | "unknown";

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the live state of `anchor` against `deck`.
 *
 * Pass `null` or `undefined` for `deck` when no deck is loaded — the result
 * will be `"unknown"` for any anchor that specifies a slideId.
 */
export function resolveAnchorState(
  anchor: SlideCommentAnchor,
  deck: DeckV7 | null | undefined,
): AnchorState {
  if (!anchor.slideId) {
    return "deck";
  }

  if (!deck) {
    return "unknown";
  }

  const slide = deck.slides.find((s) => s.id === anchor.slideId);
  if (!slide) {
    return "orphaned";
  }

  if (anchor.elementId) {
    if (!findNodeById(slide.children, anchor.elementId)) {
      return "orphaned";
    }
  }

  return "attached";
}

function findNodeById(
  nodes: readonly SlideChildNode[],
  nodeId: string,
): SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.type === "group") {
      const found = findNodeById(node.children, nodeId);
      if (found) return found;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Anchor mutations (stubs — extended in later slices)
// ---------------------------------------------------------------------------

/**
 * Returns a new anchor with `slideId` cleared to null, effectively demoting
 * it to a deck-level comment. Used when a slide is deleted and the caller
 * chooses to float the comment rather than discard it.
 *
 * Geometry is also cleared: a deck-level comment has no meaningful pin point.
 *
 * This is a pure transform: the original anchor is not mutated.
 */
export function floatAnchorToDeck(
  anchor: SlideCommentAnchor,
): SlideCommentAnchor {
  return { ...anchor, slideId: null, elementId: null, geometry: null };
}

/**
 * Returns a new anchor with `elementId` cleared to null, keeping the slide
 * attachment but removing the element pin. Used when an element is deleted.
 *
 * This is a pure transform: the original anchor is not mutated.
 */
export function floatAnchorToSlide(
  anchor: SlideCommentAnchor,
): SlideCommentAnchor {
  return { ...anchor, elementId: null };
}

/**
 * Re-targets a slide anchor to `newSlideId` (e.g. after a slide duplicate).
 * The elementId and geometry are preserved so the comment pin position is
 * maintained on the new slide.
 *
 * ⚠️ **Footgun**: only use this when you know the new slide shares the same
 * element IDs as the source slide (e.g. an exact duplicate). If `elementId`
 * may not exist in `newSlideId`, use {@link retargetAnchorToSlideOnly}
 * instead to avoid producing an orphaned anchor.
 *
 * This is a pure transform: the original anchor is not mutated.
 */
export function retargetAnchorSlide(
  anchor: SlideCommentAnchor,
  newSlideId: string,
): SlideCommentAnchor {
  return { ...anchor, slideId: newSlideId };
}

/**
 * Re-targets an anchor to `newSlideId`, clearing `elementId` so the comment
 * becomes a slide-level pin. Use this when the new slide's element IDs are
 * not guaranteed to match those of the original (e.g. a layout retarget).
 *
 * Geometry is preserved as it is expressed in slide-percent coordinates and
 * remains valid across slides.
 *
 * This is a pure transform: the original anchor is not mutated.
 */
export function retargetAnchorToSlideOnly(
  anchor: SlideCommentAnchor,
  newSlideId: string,
): SlideCommentAnchor {
  return { ...anchor, slideId: newSlideId, elementId: null };
}
