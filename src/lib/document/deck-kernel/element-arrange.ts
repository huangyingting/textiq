/**
 * Pure, DOM-free z-order manipulation for free-form slide elements (issue #328).
 *
 * {@link arrangeElements} reorders elements within the slide's z-stack based on
 * the four classical arrange modes (front / back / forward / backward), then
 * stamps fresh, contiguous `zIndex` values onto every element so the stack is
 * always represented by a clean integer sequence.
 *
 * Locked elements are included in the z-order calculation (they occupy their
 * position in the stack) but are never moved even if their id appears in
 * `selectedIds`.  The input array and its elements are never mutated.
 */

import type { SlideElement } from "./deck-elements";

/** The four arrange modes. */
export type ArrangeMode = "front" | "back" | "forward" | "backward";

/**
 * Returns a new copy of `elements` with updated `zIndex` values reflecting the
 * requested arrange operation.
 *
 * @param elements     All elements on the slide (order is irrelevant on input —
 *                     positions are determined by each element's `zIndex`).
 * @param selectedIds  The ids of elements to move. Locked elements (those with
 *                     `locked: true`) are silently skipped even if included.
 * @param mode         The arrange operation to perform.
 */
export function arrangeElements(
  elements: SlideElement[],
  selectedIds: Set<string>,
  mode: ArrangeMode,
): SlideElement[] {
  if (elements.length === 0) return [];

  // Build a working set: locked elements are excluded from the move set.
  const movableSelected = new Set<string>(
    [...selectedIds].filter(
      (id) => !elements.find((el) => el.id === id)?.locked,
    ),
  );

  if (movableSelected.size === 0) {
    // Nothing to move — return fresh copies so the function is always pure.
    return elements.map((el) => ({ ...el }));
  }

  // Sort by current zIndex to get the canonical bottom-to-top order.
  const sorted: SlideElement[] = [...elements].sort(
    (a, b) => a.zIndex - b.zIndex,
  );

  let reordered: SlideElement[];

  switch (mode) {
    case "front": {
      const nonSelected = sorted.filter((el) => !movableSelected.has(el.id));
      const selected = sorted.filter((el) => movableSelected.has(el.id));
      reordered = [...nonSelected, ...selected];
      break;
    }

    case "back": {
      const nonSelected = sorted.filter((el) => !movableSelected.has(el.id));
      const selected = sorted.filter((el) => movableSelected.has(el.id));
      reordered = [...selected, ...nonSelected];
      break;
    }

    case "forward": {
      // Process from the top down so earlier swaps don't cascade into later ones.
      reordered = [...sorted];
      for (let i = reordered.length - 1; i >= 0; i--) {
        const el = reordered[i]!;
        if (!movableSelected.has(el.id)) continue;
        const above = i + 1;
        if (
          above < reordered.length &&
          !movableSelected.has(reordered[above]!.id)
        ) {
          // Swap with the nearest non-selected element above.
          [reordered[i], reordered[above]] = [reordered[above]!, reordered[i]!];
        }
      }
      break;
    }

    case "backward": {
      // Process from the bottom up so earlier swaps don't cascade into later ones.
      reordered = [...sorted];
      for (let i = 0; i < reordered.length; i++) {
        const el = reordered[i]!;
        if (!movableSelected.has(el.id)) continue;
        const below = i - 1;
        if (below >= 0 && !movableSelected.has(reordered[below]!.id)) {
          // Swap with the nearest non-selected element below.
          [reordered[i], reordered[below]] = [reordered[below]!, reordered[i]!];
        }
      }
      break;
    }
  }

  // Stamp fresh sequential zIndex values (starting from the current minimum)
  // so the stack is always a clean integer sequence.
  const minZ = sorted.reduce(
    (min, el) => Math.min(min, el.zIndex),
    Number.POSITIVE_INFINITY,
  );
  const idToNewZ = new Map<string, number>(
    reordered.map((el, i) => [el.id, minZ + i]),
  );

  // Return elements in their original input order with updated zIndex values.
  return elements.map((el) => {
    const newZ = idToNewZ.get(el.id);
    return newZ !== undefined ? { ...el, zIndex: newZ } : { ...el };
  });
}
