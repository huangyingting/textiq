/**
 * Pure, DOM-free alignment, distribution, and size-matching math for the
 * free-form slide stage (issue #237, #328).
 *
 * {@link alignBoxes} repositions boxes so they share a common edge or center,
 * computed from the selection's bounding box.
 *
 * {@link distributeBoxes} spaces boxes evenly along the horizontal or vertical
 * axis, anchoring the first and last elements and repositioning the rest.
 *
 * {@link matchSizeBoxes} resizes all boxes to match the first element's
 * width, height, or both.
 *
 * All functions are percentage-based (0–100), resolution-independent, and
 * never mutate the input array or its boxes.
 */

import type { ElementBox } from "./deck-elements";

/** The six alignment modes: three on the x-axis, three on the y-axis. */
export type AlignMode =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vmiddle"
  | "bottom";

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Computes the tight bounding box (in percent) enclosing every box. */
function boundsOf(boxes: readonly ElementBox[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Aligns `boxes` to the shared edge/center of their selection bounding box.
 *
 * Returns a brand-new array of new box objects; the input is never mutated. A
 * single-box selection is a no-op (its bounding box is itself, so every mode
 * leaves it where it is). An empty selection returns an empty array.
 */
export function alignBoxes(
  boxes: readonly ElementBox[],
  mode: AlignMode,
): ElementBox[] {
  if (boxes.length === 0) {
    return [];
  }
  const { minX, minY, maxX, maxY } = boundsOf(boxes);
  const hCenter = (minX + maxX) / 2;
  const vMiddle = (minY + maxY) / 2;

  return boxes.map((box) => {
    switch (mode) {
      case "left":
        return { ...box, x: minX };
      case "hcenter":
        return { ...box, x: hCenter - box.w / 2 };
      case "right":
        return { ...box, x: maxX - box.w };
      case "top":
        return { ...box, y: minY };
      case "vmiddle":
        return { ...box, y: vMiddle - box.h / 2 };
      case "bottom":
        return { ...box, y: maxY - box.h };
    }
  });
}

/** The two distribution axes. */
export type DistributeMode = "horizontal" | "vertical";

/** The three size-matching modes. */
export type MatchSizeMode = "width" | "height" | "both";

/**
 * Distributes `boxes` with equal spacing between their bounding boxes along
 * the given axis.  The first and last elements (by position on the axis) are
 * used as anchors and are never moved; the intermediate elements are
 * repositioned to achieve equal gap sizes.  Only the relevant coordinate is
 * touched — `distributeBoxes([a,b,c], "horizontal")` never changes any box's
 * `y` or `h`.
 *
 * Returns the input array unchanged when `boxes.length < 3` (no redistribution
 * is possible or necessary). The input is never mutated.
 */
export function distributeBoxes(
  boxes: readonly ElementBox[],
  mode: DistributeMode,
): ElementBox[] {
  if (boxes.length < 3) {
    return boxes as ElementBox[];
  }

  if (mode === "horizontal") {
    // Sort by left edge.
    const sorted = [...boxes].sort((a, b) => a.x - b.x);
    const leftAnchor = sorted[0]!.x;
    const rightAnchor =
      sorted[sorted.length - 1]!.x + sorted[sorted.length - 1]!.w;
    const totalWidth = sorted.reduce((sum, b) => sum + b.w, 0);
    const gap = (rightAnchor - leftAnchor - totalWidth) / (sorted.length - 1);

    let cursor = leftAnchor;
    const newXById = new Map<ElementBox, number>();
    for (const box of sorted) {
      newXById.set(box, cursor);
      cursor += box.w + gap;
    }

    return (boxes as ElementBox[]).map((box) => {
      const newX = newXById.get(box);
      return newX !== undefined ? { ...box, x: newX } : { ...box };
    });
  } else {
    // Sort by top edge.
    const sorted = [...boxes].sort((a, b) => a.y - b.y);
    const topAnchor = sorted[0]!.y;
    const bottomAnchor =
      sorted[sorted.length - 1]!.y + sorted[sorted.length - 1]!.h;
    const totalHeight = sorted.reduce((sum, b) => sum + b.h, 0);
    const gap = (bottomAnchor - topAnchor - totalHeight) / (sorted.length - 1);

    let cursor = topAnchor;
    const newYById = new Map<ElementBox, number>();
    for (const box of sorted) {
      newYById.set(box, cursor);
      cursor += box.h + gap;
    }

    return (boxes as ElementBox[]).map((box) => {
      const newY = newYById.get(box);
      return newY !== undefined ? { ...box, y: newY } : { ...box };
    });
  }
}

/**
 * Resizes every box in `boxes` to match the first element's `w`, `h`, or both,
 * depending on `mode`. Positions are never changed. The first element is
 * returned as a new object too (its size already matches, so coordinates are
 * identical). An empty selection returns an empty array. The input is never
 * mutated.
 */
export function matchSizeBoxes(
  boxes: readonly ElementBox[],
  mode: MatchSizeMode,
): ElementBox[] {
  if (boxes.length === 0) return [];
  const first = boxes[0]!;
  return (boxes as ElementBox[]).map((box) => {
    if (mode === "width") return { ...box, w: first.w };
    if (mode === "height") return { ...box, h: first.h };
    // "both"
    return { ...box, w: first.w, h: first.h };
  });
}
