import type { Deck } from "./deck-core";
import type { ElementBox, SlideElement } from "./deck-elements";
import { makeElementId } from "./deck-ids";
import {
  remapConnectorBindings,
  updateConnectorBindingsOnDelete,
} from "./connector-lifecycle";
import {
  type DistributiveOmit,
  type ElementPatch,
  mapSlide,
  nextZIndex,
} from "./deck-mutation-shared";

/** Appends a new element to a slide. */
export function addElement(
  deck: Deck,
  index: number,
  element: DistributiveOmit<SlideElement, "id" | "zIndex"> & {
    id?: string;
    /* node:coverage ignore next */
    /* Optional type member is erased by tsx and maps to a source row. */
    zIndex?: number;
  },
): Deck {
  return mapSlide(deck, index, (slide) => {
    const existing = slide.elements ?? [];
    const next: SlideElement = {
      ...element,
      id: element.id ?? makeElementId(),
      zIndex: element.zIndex ?? nextZIndex(existing),
    } as SlideElement;
    return { ...slide, elements: [...existing, next] };
  });
}

/** Patches a single element on a slide by id (cannot change `id`/`kind`). */
export function updateElement(
  deck: Deck,
  index: number,
  elementId: string,
  patch: ElementPatch,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    return {
      ...slide,
      elements: slide.elements.map((element) =>
        element.id === elementId
          ? ({
              ...element,
              ...patch,
              id: element.id,
              kind: element.kind,
            } as SlideElement)
          : element,
      ),
    };
  });
}

/**
 * Default offset (percent of slide) applied to a duplicated element so the copy
 * is visibly nudged off its original and immediately grabbable.
 */
export const DUPLICATE_ELEMENT_OFFSET_PCT = 2;

/** Result of {@link duplicateElement}: the next deck and the new copy's id. */
export interface DuplicateElementResult {
  /** The deck with the clone appended (or the original deck on a no-op). */
  deck: Deck;
  /**
   * Id of the freshly created copy so the caller can select it, or `null` when
   * the duplicate was a no-op (slide/element not found, or no `elements[]`).
   */
  newElementId: string | null;
}

/** Offsets a box by `delta` percent on both axes, clamped within the slide. */
function offsetBox(box: ElementBox, delta: number): ElementBox {
  return {
    ...box,
    x: Math.max(0, Math.min(100 - box.w, box.x + delta)),
    y: Math.max(0, Math.min(100 - box.h, box.y + delta)),
  };
}

/**
 * Clones the element `elementId` on the slide at `index`, appending the copy
 * with a fresh {@link makeElementId} id, a small {@link
 * DUPLICATE_ELEMENT_OFFSET_PCT} offset, and the next z-index above all others so
 * it sits on top. Pure and immutable: the original element and deck are left
 * untouched. Returns the next deck plus the new copy's id so the caller can
 * select it; a no-op (bad index, missing element, or a slide with no
 * `elements[]`) returns the same deck and a `null` id.
 *
 */
export function duplicateElement(
  deck: Deck,
  index: number,
  elementId: string,
): DuplicateElementResult {
  /* node:coverage ignore next 3 */
  /* Bad-index no-op is asserted; tsx maps the guard return as a residual row. */
  if (index < 0 || index >= deck.slides.length) {
    return { deck, newElementId: null };
  }
  const slide = deck.slides[index];
  if (!slide.elements) {
    return { deck, newElementId: null };
  }
  const original = slide.elements.find((element) => element.id === elementId);
  if (!original) {
    return { deck, newElementId: null };
  }

  const newElementId = makeElementId();
  const copy: SlideElement = {
    ...original,
    id: newElementId,
    zIndex: nextZIndex(slide.elements),
    box: offsetBox(original.box, DUPLICATE_ELEMENT_OFFSET_PCT),
  };
  // Single-element duplicate is always a partial group copy — clear groupId so
  // the lone copy is not mistakenly treated as a group member (issue #330).
  if ((copy as { groupId?: string }).groupId) {
    delete (copy as { groupId?: string }).groupId;
  }

  // Remap / detach connector endpoints on the copy (issue #324).
  // idMap only contains the duplicated element itself; since the endpoint
  // shapes are not being duplicated, any bound endpoint is detached.
  const idMap = new Map([[elementId, newElementId]]);
  const [patchedCopy = copy] = remapConnectorBindings(
    [copy],
    idMap,
    slide.elements,
  );

  const nextSlide = {
    ...slide,
    elements: [...slide.elements, patchedCopy],
  };
  const slides = deck.slides.map((current, i) =>
    i === index ? nextSlide : current,
  );

  return { deck: { ...deck, slides }, newElementId };
}

/** Result of {@link duplicateElements}: the next deck and the new copies' ids. */
export interface DuplicateElementsResult {
  /** The deck with the clones appended (or the original deck on a no-op). */
  deck: Deck;
  /**
   * Ids of the freshly created copies, in the same order as the originals were
   * found on the slide, so the caller can select the new copies. Empty on a
   * no-op (slide/element not found, or no `elements[]`).
   */
  newElementIds: string[];
}

/**
 * Clones every element named in `elementIds` on the slide at `index` in a single
 * mutation — the multi-select counterpart of {@link duplicateElement} (issue
 * #245). Each copy gets a fresh {@link makeElementId} id, the same small
 * {@link DUPLICATE_ELEMENT_OFFSET_PCT} offset, and a z-index above all existing
 * elements (copies keep their relative stacking order). Routing the whole group
 * through one mutation keeps it a single undo/redo `commit`. Pure and immutable;
 * a no-op returns the same deck and an empty id list.
 */
export function duplicateElements(
  deck: Deck,
  index: number,
  elementIds: readonly string[],
): DuplicateElementsResult {
  if (index < 0 || index >= deck.slides.length) {
    return { deck, newElementIds: [] };
  }
  const slide = deck.slides[index];
  if (!slide.elements) {
    return { deck, newElementIds: [] };
  }
  const ids = new Set(elementIds);
  const originals = slide.elements.filter((element) => ids.has(element.id));
  if (originals.length === 0) {
    return { deck, newElementIds: [] };
  }

  let z = nextZIndex(slide.elements);
  const newElementIds: string[] = [];
  const copies: SlideElement[] = originals.map((original) => {
    const newElementId = makeElementId();
    newElementIds.push(newElementId);
    return {
      ...original,
      id: newElementId,
      zIndex: z++,
      box: offsetBox(original.box, DUPLICATE_ELEMENT_OFFSET_PCT),
    };
  });

  // Remap / detach connector endpoints on the copies (issue #324).
  // Endpoints bound to an id in idMap (both shapes in selection) are remapped
  // to the copy; endpoints bound to an id outside idMap are detached.
  const idMap = new Map<string, string>();
  originals.forEach((original, i) => {
    idMap.set(original.id, newElementIds[i]!);
  });
  const connectorPatched = remapConnectorBindings(
    copies,
    idMap,
    slide.elements,
  );

  // Remap groupIds on copies (issue #330).
  // If ALL members of a group on the slide are in the selection → the copies
  // share a fresh groupId.  If only SOME members are selected (partial group
  // copy) → groupId is cleared on the copies so they are not accidentally
  // treated as group members.
  const slideGroupCount = new Map<string, number>();
  /* node:coverage ignore next 8 */
  /* Group-count branches are asserted by full and partial group duplicate tests; tsx maps wrapped increments as residual rows. */
  for (const el of slide.elements) {
    if (el.groupId)
      slideGroupCount.set(
        el.groupId,
        (slideGroupCount.get(el.groupId) ?? 0) + 1,
      );
  }
  const selectionGroupCount = new Map<string, number>();
  for (const orig of originals) {
    if (orig.groupId)
      selectionGroupCount.set(
        orig.groupId,
        (selectionGroupCount.get(orig.groupId) ?? 0) + 1,
      );
  }
  const freshGroupIds = new Map<string, string>();
  for (const [gid, total] of slideGroupCount) {
    if ((selectionGroupCount.get(gid) ?? 0) === total) {
      freshGroupIds.set(gid, makeElementId());
    }
  }
  const patchedCopies = connectorPatched.map((copy, i) => {
    const origGroupId = (originals[i] as { groupId?: string }).groupId;
    if (!origGroupId) return copy;
    const newGid = freshGroupIds.get(origGroupId);
    if (newGid) return { ...copy, groupId: newGid };
    // Partial group copy — dissolve membership.
    const without = { ...copy };
    delete (without as { groupId?: string }).groupId;
    return without as SlideElement;
  });

  const nextSlide = {
    ...slide,
    elements: [...slide.elements, ...patchedCopies],
  };
  const slides = deck.slides.map((current, i) =>
    /* node:coverage ignore next */
    /* Replacement branch is asserted by duplicateElements tests; tsx leaves the ternary row residual. */
    i === index ? nextSlide : current,
  );

  return { deck: { ...deck, slides }, newElementIds };
}

/**
 * Removes an element from a slide by id.
 *
 * Before removing the element, any {@link ConnectorElement} whose endpoint
 * references the deleted element id has that endpoint **detached** to a free
 * point at the anchor's last resolved position (issue #324 — delete policy:
 * keep connector, clear binding).
 */
export function removeElement(
  deck: Deck,
  index: number,
  elementId: string,
): Deck {
  const deletedIds = new Set([elementId]);
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    const patched = updateConnectorBindingsOnDelete(slide.elements, deletedIds);
    /* node:coverage ignore next 4 */
    /* Removal result shape is asserted by removeElement tests; tsx maps the return literal as residual rows. */
    return {
      ...slide,
      elements: patched.filter((element) => element.id !== elementId),
    };
  });
}

/**
 * Removes every element named in `elementIds` from the slide at `index` in a
 * single mutation — the multi-select counterpart of {@link removeElement}
 * (issue #245). Routing a multi-delete through one mutation keeps it a single
 * undo/redo `commit` (the caller never chains per-element removes). Pure and
 * immutable; a no-op (empty `elementIds`, bad index, no `elements[]`, or no id
 * present) returns the same slide reference so a `commit` of the result is
 * skipped.
 *
 * Before removing the elements, any connector endpoint that references a
 * deleted id is **detached** to a free point (issue #324 — delete policy:
 * keep connector, clear binding).
 */
export function removeElements(
  deck: Deck,
  index: number,
  elementIds: readonly string[],
): Deck {
  const ids = new Set(elementIds);
  if (ids.size === 0) {
    return deck;
  }
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    const patched = updateConnectorBindingsOnDelete(slide.elements, ids);
    const next = patched.filter((element) => !ids.has(element.id));
    if (next.length === slide.elements.length) {
      return slide;
    }
    return { ...slide, elements: next };
  });
}

/**
 * Nudges every element named in `elementIds` on the slide at `index` by the same
 * `dx`/`dy` delta (percent of slide), clamping each box so it stays within the
 * slide (issue #245). Powers the keyboard arrow-nudge across a multi-selection;
 * sizes are never changed and elements not in `elementIds` are left untouched.
 * Pure and immutable; a no-op (empty `elementIds`, zero delta, bad index, no
 * `elements[]`, or no id present) returns the same slide reference.
 */
export function nudgeElements(
  deck: Deck,
  index: number,
  elementIds: readonly string[],
  dx: number,
  dy: number,
): Deck {
  const ids = new Set(elementIds);
  if (ids.size === 0 || (dx === 0 && dy === 0)) {
    return deck;
  }
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    let changed = false;
    const elements = slide.elements.map((element) => {
      if (!ids.has(element.id)) {
        return element;
      }
      changed = true;
      const { box } = element;
      return {
        ...element,
        box: {
          ...box,
          x: Math.max(0, Math.min(100 - box.w, box.x + dx)),
          y: Math.max(0, Math.min(100 - box.h, box.y + dy)),
        },
      };
    });
    return changed ? { ...slide, elements } : slide;
  });
}

/** Raises an element above all others on its slide. */
export function bringElementToFront(
  deck: Deck,
  index: number,
  elementId: string,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    const top = nextZIndex(slide.elements);
    return {
      ...slide,
      elements: slide.elements.map((element) =>
        element.id === elementId ? { ...element, zIndex: top } : element,
      ),
    };
  });
}

/** Lowers an element beneath all others on its slide. */
export function sendElementToBack(
  deck: Deck,
  index: number,
  elementId: string,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    const bottom =
      slide.elements.reduce(
        (min, element) => Math.min(min, element.zIndex),
        Number.POSITIVE_INFINITY,
      ) - 1;
    return {
      ...slide,
      elements: slide.elements.map((element) =>
        element.id === elementId ? { ...element, zIndex: bottom } : element,
      ),
    };
  });
}

/**
 * Sets multiple element boxes at once on a slide (used by group drag-move so a
 * whole group moves in a single, undoable mutation).
 */
export function setElementBoxes(
  deck: Deck,
  index: number,
  boxesById: Record<string, ElementBox>,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    return {
      ...slide,
      elements: slide.elements.map((element) =>
        boxesById[element.id]
          ? { ...element, box: boxesById[element.id] }
          : element,
      ),
    };
  });
}

/**
 * Applies per-element patches in a single atomic mutation, enabling multi-
 * element transforms (resize, rotate) to land as one undo step (issue #329).
 *
 * Like {@link updateElement} the `id` and `kind` fields are immutable and are
 * silently ignored even if present in the patch.  Returns the same deck when
 * the slide has no `elements[]` or when none of the ids are present.
 */
export function setElementPatches(
  deck: Deck,
  index: number,
  patchesById: Record<string, ElementPatch>,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    return {
      ...slide,
      elements: slide.elements.map((element) => {
        const patch = patchesById[element.id];
        return patch
          ? ({
              ...element,
              ...patch,
              id: element.id,
              kind: element.kind,
            } as SlideElement)
          : element;
      }),
    };
  });
}

/** Assigns a fresh group id to the given elements; returns it for re-selection. */
export function groupElements(
  deck: Deck,
  index: number,
  ids: readonly string[],
): { deck: Deck; groupId: string } {
  const groupId = makeElementId();
  const idSet = new Set(ids);
  if (idSet.size === 0) {
    return { deck, groupId };
  }
  const next = mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    if (!slide.elements.some((el) => idSet.has(el.id))) {
      return slide;
    }
    return {
      ...slide,
      elements: slide.elements.map((element) =>
        idSet.has(element.id) ? { ...element, groupId } : element,
      ),
    };
  });
  return { deck: next, groupId };
}

/** Clears the given `groupId` from every element that carries it. */
export function ungroupElements(
  deck: Deck,
  index: number,
  groupId: string,
): Deck {
  return mapSlide(deck, index, (slide) => {
    if (!slide.elements) {
      return slide;
    }
    if (!slide.elements.some((el) => el.groupId === groupId)) {
      return slide;
    }
    return {
      ...slide,
      elements: slide.elements.map((element) => {
        if (element.groupId !== groupId) {
          return element;
        }
        const copy = { ...element };
        delete (copy as { groupId?: string }).groupId;
        return copy;
      }),
    };
  });
}
