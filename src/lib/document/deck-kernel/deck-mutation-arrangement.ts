import type { Deck } from "./deck-core";
import type { ElementBox, SlideElement } from "./deck-elements";
import {
  type AlignMode,
  type DistributeMode,
  type MatchSizeMode,
  alignBoxes,
  distributeBoxes,
  matchSizeBoxes,
} from "./element-align";
import { type ArrangeMode, arrangeElements } from "./element-arrange";
import { mapSlide } from "./deck-mutation-shared";

/**
 * Aligns the elements named by `elementIds` on the slide at `index` to a shared
 * edge/center, computed from their selection bounding box via the pure
 * {@link alignBoxes} math (issue #237). Only the listed elements move; every
 * other element is left untouched. Pure and immutable — the input deck is never
 * mutated.
 *
 * A no-op (bad index, no `elements[]`, or none of the ids present) returns the
 * same slide.
 */
export function alignElements(
  deck: Deck,
  index: number,
  elementIds: readonly string[],
  mode: AlignMode,
): Deck {
  const ids = new Set(elementIds);
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    const targets = slide.elements.filter((element) => ids.has(element.id));
    if (targets.length === 0) {
      return slide;
    }
    const aligned = alignBoxes(
      targets.map((element) => element.box),
      mode,
    );
    const boxById = new Map<string, ElementBox>();
    targets.forEach((element, i) => boxById.set(element.id, aligned[i]));
    return {
      ...slide,
      elements: slide.elements.map((element) => {
        const box = boxById.get(element.id);
        return box ? { ...element, box } : element;
      }),
    };
  });
}

// ── Multi-select: distribute, match-size, arrange (issue #328) ──────────────

/**
 * Distributes the unlocked elements named by `elementIds` on the slide at
 * `index` with equal spacing along the given axis (issue #328). The first and
 * last elements on that axis are used as anchors; only the intermediate elements
 * are repositioned. Locked elements in the selection are silently skipped.
 * Returns the same deck unchanged when fewer than 3 unlocked elements are found
 * (no redistribution is possible). Pure and immutable.
 */
export function distributeElements(
  deck: Deck,
  index: number,
  elementIds: readonly string[],
  mode: DistributeMode,
): Deck {
  const ids = new Set(elementIds);
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) return slide;
    const targets = slide.elements.filter((el) => ids.has(el.id) && !el.locked);
    if (targets.length < 3) return slide;

    const distributed = distributeBoxes(
      targets.map((el) => el.box),
      mode,
    );
    const boxById = new Map<string, ElementBox>();
    targets.forEach((el, i) => boxById.set(el.id, distributed[i]!));

    return {
      ...slide,
      elements: slide.elements.map((el) => {
        const box = boxById.get(el.id);
        return box ? { ...el, box } : el;
      }),
    };
  });
}

/**
 * Resizes the unlocked elements named by `elementIds` on the slide at `index`
 * to match the first element's width, height, or both (issue #328). Positions
 * are never changed. Locked elements in the selection are silently skipped.
 * The "first" element is determined by z-order (lowest zIndex = bottom-most =
 * first in the array after sort). Pure and immutable.
 */
export function matchSizeElements(
  deck: Deck,
  index: number,
  elementIds: readonly string[],
  mode: MatchSizeMode,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) return slide;
    // Preserve the caller's selection order so the first element in `elementIds`
    // is used as the size reference (matching the pure helper contract).
    const targets = elementIds
      .map((id) => slide.elements!.find((el) => el.id === id))
      .filter((el): el is SlideElement => el !== undefined && !el.locked);
    if (targets.length < 2) return slide;

    const sized = matchSizeBoxes(
      targets.map((el) => el.box),
      mode,
    );
    const boxById = new Map<string, ElementBox>();
    targets.forEach((el, i) => boxById.set(el.id, sized[i]!));

    return {
      ...slide,
      elements: slide.elements.map((el) => {
        const box = boxById.get(el.id);
        return box ? { ...el, box } : el;
      }),
    };
  });
}

/**
 * Reorders the z-stack of the slide at `index` so the elements named by
 * `elementIds` are arranged according to `mode` (front / back / forward /
 * backward) relative to the rest (issue #328). Locked elements in the selection
 * are silently excluded from movement but still participate in the z-order
 * calculation. Pure and immutable. Returns the same deck unchanged when the
 * slide has no `elements[]`.
 */
export function arrangeSelectedElements(
  deck: Deck,
  index: number,
  elementIds: readonly string[],
  mode: ArrangeMode,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) return slide;
    const selectedIds = new Set(elementIds);
    const next = arrangeElements(slide.elements, selectedIds, mode);
    return { ...slide, elements: next };
  });
}
