import type { Deck } from "./deck-core";
import type { SlideElement } from "./deck-elements";
import { mapSlide } from "./deck-mutation-shared";

// ---------------------------------------------------------------------------
// Layer-list mutations (issue #331)
// ---------------------------------------------------------------------------

/**
 * Sets or clears the `hidden` flag on a single element. Hidden elements are
 * skipped by all renderers and export — they remain in the data model so the
 * operation is undoable. Pure and immutable.
 */
export function setElementHidden(
  deck: Deck,
  index: number,
  elementId: string,
  hidden: boolean,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) return slide;
    return {
      ...slide,
      elements: slide.elements.map((element) => {
        if (element.id !== elementId) return element;
        if (hidden) return { ...element, hidden: true };
        const copy = { ...element };
        delete (copy as { hidden?: boolean }).hidden;
        return copy;
      }),
    };
  });
}

/**
 * Sets or clears the `locked` flag on a single element. Locked elements are
 * not selectable or draggable in the editor. Pure and immutable.
 */
export function setElementLocked(
  deck: Deck,
  index: number,
  elementId: string,
  locked: boolean,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) return slide;
    return {
      ...slide,
      elements: slide.elements.map((element) => {
        if (element.id !== elementId) return element;
        if (locked) return { ...element, locked: true };
        const copy = { ...element };
        delete (copy as { locked?: boolean }).locked;
        return copy;
      }),
    };
  });
}

/**
 * Moves an element one step up (`direction === "up"`, higher zIndex, rendered
 * on top) or one step down (`direction === "down"`, lower zIndex) relative to
 * its current neighbours. The element swaps zIndex values with the next
 * neighbour in the given direction. A no-op when the element is already at the
 * top or bottom of the stack. Pure and immutable.
 */
export function moveElementZOrder(
  deck: Deck,
  index: number,
  elementId: string,
  direction: "up" | "down",
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) return slide;

    // Sort by ascending zIndex so index 0 is the bottom-most element.
    const sorted = [...slide.elements].sort((a, b) => a.zIndex - b.zIndex);
    const pos = sorted.findIndex((el) => el.id === elementId);
    if (pos === -1) return slide;

    const swapPos = direction === "up" ? pos + 1 : pos - 1;
    if (swapPos < 0 || swapPos >= sorted.length) return slide;

    // Swap the zIndex values so relative order of all other elements is stable.
    const aZ = sorted[pos]!.zIndex;
    const bZ = sorted[swapPos]!.zIndex;
    const swapA = { ...sorted[pos]!, zIndex: bZ };
    const swapB = { ...sorted[swapPos]!, zIndex: aZ };

    const idMap = new Map<string, SlideElement>([
      [swapA.id, swapA],
      [swapB.id, swapB],
    ]);

    return {
      ...slide,
      elements: slide.elements.map((el) => idMap.get(el.id) ?? el),
    };
  });
}

/**
 * Sets (or clears, when `name` is an empty string or undefined) the optional
 * display name on a single element. The name is shown in the layer list and
 * used as the accessible name fallback. Pure and immutable.
 */
export function renameElement(
  deck: Deck,
  index: number,
  elementId: string,
  name: string,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) return slide;
    return {
      ...slide,
      elements: slide.elements.map((element) => {
        if (element.id !== elementId) return element;
        if (!name.trim()) {
          const copy = { ...element };
          delete (copy as { name?: string }).name;
          return copy;
        }
        return { ...element, name: name.trim() };
      }),
    };
  });
}

/**
 * Moves `elementId` to the z-order position of `targetElementId` (drag-reorder
 * in the layer panel, #639). Elements are reordered in the ascending-zIndex
 * list, then re-indexed sequentially so the new relative order is stable. A
 * no-op when either id is missing or both are the same. Pure and immutable.
 */
export function reorderElement(
  deck: Deck,
  index: number,
  elementId: string,
  targetElementId: string,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements || elementId === targetElementId) return slide;
    const sorted = [...slide.elements].sort((a, b) => a.zIndex - b.zIndex);
    const from = sorted.findIndex((el) => el.id === elementId);
    const to = sorted.findIndex((el) => el.id === targetElementId);
    if (from === -1 || to === -1) return slide;
    const [moved] = sorted.splice(from, 1);
    sorted.splice(to, 0, moved!);
    const reindexed = new Map<string, SlideElement>(
      sorted.map((el, i) => [el.id, { ...el, zIndex: i }]),
    );
    return {
      ...slide,
      elements: slide.elements.map((el) => reindexed.get(el.id) ?? el),
    };
  });
}
