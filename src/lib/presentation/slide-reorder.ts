/**
 * Pure helper for pointer-based slide-thumbnail reordering.
 *
 * The slide editor reorders thumbnails with the Pointer API (so it works with
 * touch, unlike HTML5 drag-and-drop). This module isolates the one piece of
 * geometry that benefits from a DOM-free unit test: mapping a pointer position
 * along the rail axis to the thumbnail index it currently hovers.
 */

/** The extent of a thumbnail along the rail's main axis. */
export interface RailItemExtent {
  /** Leading edge (top for a vertical rail, left for a horizontal strip). */
  start: number;
  /** Trailing edge (bottom for a vertical rail, right for a horizontal strip). */
  end: number;
}

const RAIL_REORDER_CROSS_AXIS_TOLERANCE_PX = 48;

/**
 * Given a pointer coordinate along the rail's main axis and the ordered extents
 * of each thumbnail, returns the index the dragged slide should drop onto.
 *
 * An item is "hovered" once the pointer passes the midpoint of every earlier
 * item, so the drop target flips as the pointer crosses each thumbnail's centre.
 * The result is always clamped to `[0, items.length - 1]`; an empty list yields
 * `0` (defensive).
 *
 * Axis-agnostic: the caller passes `clientY`/top-bottom for a vertical rail and
 * `clientX`/left-right for a horizontal strip.
 */
export function reorderTargetIndex(
  pointer: number,
  items: readonly RailItemExtent[],
): number {
  if (items.length === 0) return 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const midpoint = (item.start + item.end) / 2;
    if (pointer < midpoint) return i;
  }
  return items.length - 1;
}

/**
 * Drag-specific target resolution. The cursor may start anywhere inside the
 * thumbnail, so using the raw pointer makes a drag that returns to the original
 * spot still flip when the pointer is on the far side of the thumbnail. Resolve
 * from the dragged thumbnail's centre instead. If the pointer is far off the
 * rail's cross-axis, return `null` so dropping outside the rail cancels instead
 * of clamping to the first/last slide.
 */
export function reorderTargetIndexForDraggedItem({
  fromIndex,
  pointerMain,
  pointerCross,
  itemMainOffset,
  itemMainSize,
  items,
  crossStart,
  crossEnd,
  crossTolerance = RAIL_REORDER_CROSS_AXIS_TOLERANCE_PX,
}: {
  fromIndex: number;
  pointerMain: number;
  pointerCross: number;
  itemMainOffset: number;
  itemMainSize: number;
  items: readonly RailItemExtent[];
  crossStart: number;
  crossEnd: number;
  crossTolerance?: number;
}): number | null {
  if (items.length === 0) return null;
  if (
    pointerCross < crossStart - crossTolerance ||
    pointerCross > crossEnd + crossTolerance
  ) {
    return null;
  }
  const draggedCenter = pointerMain - itemMainOffset + itemMainSize / 2;
  let target = 0;
  for (let i = 0; i < items.length; i += 1) {
    if (i === fromIndex) continue;
    const item = items[i];
    const midpoint = (item.start + item.end) / 2;
    if (draggedCenter <= midpoint) return target;
    target++;
  }
  return target;
}

/**
 * Keyboard reorder intent for a focused slide thumbnail (#654). Holding `Alt`
 * with the up/down arrows nudges the slide one position, giving a pointer-free
 * reorder alternative to drag-and-drop. Returns the move direction (`-1` up,
 * `+1` down) or `null` when the key combo is not a reorder gesture.
 */
export function slideReorderKeyDirection(
  key: string,
  altKey: boolean,
): -1 | 1 | null {
  if (!altKey) return null;
  if (key === "ArrowUp" || key === "ArrowLeft") return -1;
  if (key === "ArrowDown" || key === "ArrowRight") return 1;
  return null;
}
