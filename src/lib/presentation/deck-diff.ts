/**
 * Structural diff helpers used to restore focus after an undo/redo.
 *
 * Undo/redo in the presentation editor swaps the committed `Deck` snapshot, but the user
 * also expects selection/focus to follow the change back to the node they (un)did
 * — not to stay on whatever was transiently selected. These pure helpers compare
 * two committed deck snapshots and pick the node (or slide) the editor should
 * re-focus, with no DOM or React dependency so they can be unit-tested directly.
 */

import type { Deck, SlideChildNode, SlideNode } from "./schema";

/** A node flattened out of the deck tree, tagged with its owning slide. */
interface FlatNode {
  id: string;
  slideId: string;
  /** Stable serialization used to detect content changes. */
  serialized: string;
}

/** The ids that differ between two committed deck snapshots. */
export interface DeckNodeDiff {
  /** Node ids present in `after` but not in `before` (in `after` order). */
  added: string[];
  /** Node ids present in `before` but not in `after` (in `before` order). */
  removed: string[];
  /** Node ids in both whose serialized content differs (in `after` order). */
  changed: string[];
  /** Slide ids present in `after` but not in `before` (in `after` order). */
  addedSlides: string[];
  /** Slide ids present in `before` but not in `after` (in `before` order). */
  removedSlides: string[];
}

function flattenChildren(
  children: readonly SlideChildNode[],
  slideId: string,
  out: FlatNode[],
): void {
  for (const child of children) {
    out.push({ id: child.id, slideId, serialized: JSON.stringify(child) });
    if (child.type === "group") {
      flattenChildren(child.children, slideId, out);
    }
  }
}

function flattenDeck(deck: Deck): FlatNode[] {
  const out: FlatNode[] = [];
  for (const slide of deck.slides) {
    flattenChildren(slide.children, slide.id, out);
  }
  return out;
}

function slideIds(deck: Deck): string[] {
  return deck.slides.map((slide: SlideNode) => slide.id);
}

/**
 * Computes the added / removed / changed node and slide ids between two
 * committed deck snapshots. Order is deterministic (document order within
 * `after` for added/changed, within `before` for removed) so callers get a
 * stable focus target.
 */
export function diffDeckNodes(before: Deck, after: Deck): DeckNodeDiff {
  const beforeNodes = new Map<string, FlatNode>();
  for (const node of flattenDeck(before)) {
    beforeNodes.set(node.id, node);
  }
  const afterNodes = new Map<string, FlatNode>();
  for (const node of flattenDeck(after)) {
    afterNodes.set(node.id, node);
  }

  const added: string[] = [];
  const changed: string[] = [];
  for (const node of flattenDeck(after)) {
    const previous = beforeNodes.get(node.id);
    if (!previous) {
      added.push(node.id);
    } else if (previous.serialized !== node.serialized) {
      changed.push(node.id);
    }
  }

  const removed: string[] = [];
  for (const node of flattenDeck(before)) {
    if (!afterNodes.has(node.id)) {
      removed.push(node.id);
    }
  }

  const beforeSlides = new Set(slideIds(before));
  const afterSlides = new Set(slideIds(after));
  const addedSlides = slideIds(after).filter((id) => !beforeSlides.has(id));
  const removedSlides = slideIds(before).filter((id) => !afterSlides.has(id));

  return { added, removed, changed, addedSlides, removedSlides };
}

/**
 * Picks the node (or slide) id the editor should focus after moving from
 * `before` to `after` (an undo or a redo).
 *
 * Preference order keeps focus on something the user can actually see in the
 * `after` snapshot: a changed node, then a newly (re)introduced node, then the
 * slide that lost a node (so a deletion still moves focus somewhere sensible),
 * then any added/removed slide. Returns `null` when the snapshots are
 * node-and-slide identical (nothing meaningful to focus).
 */
export function pickUndoFocusTarget(before: Deck, after: Deck): string | null {
  const diff = diffDeckNodes(before, after);

  if (diff.changed.length > 0) {
    return diff.changed[0];
  }
  if (diff.added.length > 0) {
    return diff.added[0];
  }

  if (diff.removed.length > 0) {
    const afterSlideIds = new Set(slideIds(after));
    for (const node of flattenDeck(before)) {
      if (node.id === diff.removed[0]) {
        if (afterSlideIds.has(node.slideId)) {
          return node.slideId;
        }
        break;
      }
    }
  }

  if (diff.addedSlides.length > 0) {
    return diff.addedSlides[0];
  }
  if (diff.removedSlides.length > 0) {
    const firstAfterSlide = slideIds(after)[0];
    return firstAfterSlide ?? null;
  }

  return null;
}
