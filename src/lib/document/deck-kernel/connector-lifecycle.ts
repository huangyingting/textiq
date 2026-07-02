/**
 * Pure helpers for maintaining {@link ConnectorElement} endpoint bindings
 * across element lifecycle operations: delete, duplicate, and copy/paste.
 *
 * Design goals:
 *  - Pure and headless — no DOM, no React, no browser APIs.  Fully testable
 *    under `node --test`.
 *  - All functions are immutable: inputs are never mutated.  Object identity
 *    is preserved when nothing actually changes so callers can cheap-compare
 *    results.
 *
 * **Delete policy** — when a shape that a connector endpoint is bound to is
 * deleted, the endpoint is *detached*: converted from a
 * {@link ConnectorEndpoint} to a {@link ConnectorPointFree} at the
 * anchor's last resolved position.  The connector itself is kept, not
 * deleted, so users do not accidentally lose a connector when they meant to
 * delete a shape.
 *
 * **Duplicate / paste policy** — when both endpoint shapes are included in
 * the copied / duplicated selection, connector bindings are remapped to the
 * new copy IDs (preserving the connection between the duplicates).  When only
 * one endpoint shape is included, the unmatched endpoint is detached.
 */

import type {
  ConnectorEndpoint,
  ConnectorElement,
  ConnectorPoint,
  ConnectorPointFree,
  SlideElement,
} from "./deck-elements";
import { anchorPoint } from "./connector-geometry";

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `ep` is a {@link ConnectorEndpoint}
 * (`{elementId, anchor}` discriminant).
 */
function isBound(ep: ConnectorPoint): ep is ConnectorEndpoint {
  return "elementId" in ep;
}

function connectorContent(element: ConnectorElement): {
  start: ConnectorPoint;
  end: ConnectorPoint;
  routing?: string;
} {
  return (element as any).content;
}

function connectorStart(element: ConnectorElement): ConnectorPoint {
  return connectorContent(element).start;
}

function connectorEnd(element: ConnectorElement): ConnectorPoint {
  return connectorContent(element).end;
}

function withConnectorEndpoints(
  element: ConnectorElement,
  start: ConnectorPoint,
  end: ConnectorPoint,
): ConnectorElement {
  const content = connectorContent(element);
  return {
    ...(element as any),
    content: {
      ...content,
      start,
      end,
    },
  } as ConnectorElement;
}

// ---------------------------------------------------------------------------
// detachConnectorEndpoint
// ---------------------------------------------------------------------------

/**
 * Converts a {@link ConnectorEndpoint} into a {@link ConnectorPointFree}
 * at the anchor's currently-resolved position.
 *
 * The position is looked up in `elements` (the full slide element list
 * **before** any deletion so the shape's geometry is still available).
 * Returns `{ x: 50, y: 50 }` as a safe centred fallback when the target
 * element cannot be found (e.g. it was already removed).
 *
 * @param endpoint - The bound endpoint to detach.
 * @param elements - The slide element list that still contains the target.
 */
export function detachConnectorEndpoint(
  endpoint: ConnectorEndpoint,
  elements: readonly SlideElement[],
): ConnectorPointFree {
  const target = elements.find((el) => el.id === endpoint.elementId);
  if (!target) {
    // Target is already gone — fall back to slide centre.
    return { x: 50, y: 50 };
  }
  const pt = anchorPoint(target.box, endpoint.anchor);
  return { x: pt.x, y: pt.y };
}

// ---------------------------------------------------------------------------
// updateConnectorBindingsOnDelete
// ---------------------------------------------------------------------------

/**
 * Given the full slide element list **before** a deletion and the set of
 * element ids that are about to be removed, returns a new element list where
 * every connector endpoint that referenced a deleted id has been detached to
 * a free point at its last anchor position.
 *
 * - {@link ConnectorElement}: `start` and/or `end` are converted to free
 *   points when they are bound to a deleted id.
 * - All other element types are passed through with the same object identity.
 *
 * Returns the same array reference (cast to `SlideElement[]`) when
 * `deletedIds` is empty or no element is actually affected — callers can use
 * reference equality as a cheap no-op signal.
 *
 * **Call this BEFORE filtering out the deleted elements** so that the shapes'
 * position data is still available for anchor resolution.
 *
 * @param elements   The full slide element list (still contains the shapes
 *                   that are about to be deleted).
 * @param deletedIds The ids of elements that will be removed.
 */
export function updateConnectorBindingsOnDelete(
  elements: readonly SlideElement[],
  deletedIds: ReadonlySet<string>,
): SlideElement[] {
  if (deletedIds.size === 0) {
    return elements as SlideElement[];
  }

  let anyChanged = false;
  const patched = elements.map((el): SlideElement => {
    if (el.kind !== "connector") {
      return el;
    }
    const next = patchConnectorOnDelete(el, deletedIds, elements);

    if (next !== el) anyChanged = true;
    return next;
  });

  return anyChanged ? patched : (elements as SlideElement[]);
}

/** Patches a single {@link ConnectorElement} for a pending deletion batch. */
function patchConnectorOnDelete(
  el: ConnectorElement,
  deletedIds: ReadonlySet<string>,
  elements: readonly SlideElement[],
): ConnectorElement {
  const start = connectorStart(el);
  const end = connectorEnd(el);
  const startNeedsDetach = isBound(start) && deletedIds.has(start.elementId);
  const endNeedsDetach = isBound(end) && deletedIds.has(end.elementId);

  if (!startNeedsDetach && !endNeedsDetach) return el;

  return withConnectorEndpoints(
    el,
    startNeedsDetach
      ? detachConnectorEndpoint(start as ConnectorEndpoint, elements)
      : start,
    endNeedsDetach
      ? detachConnectorEndpoint(end as ConnectorEndpoint, elements)
      : end,
  );
}

// ---------------------------------------------------------------------------
// remapConnectorBindings
// ---------------------------------------------------------------------------

/**
 * Remaps or detaches bound connector endpoints in a set of duplicate / pasted
 * copies according to `idMap` (old id → new id for every element included in
 * the duplication / paste operation).
 *
 * Rules for each bound endpoint in a copied {@link ConnectorElement}:
 * - `elementId` **is** in `idMap` → the binding is updated to the copy id
 *   (both connected shapes were included — the connection is preserved).
 * - `elementId` **is not** in `idMap` → the endpoint is detached to a free
 *   point at the position resolved against `allElements` (only one connected
 *   shape was included — the dangling endpoint becomes a free point).
 *
 * Non-connector copies are returned with the same object identity.
 * The `allElements` list should be the **original** slide elements (before the
 * copies are appended) so that positions of unremapped shapes can be resolved.
 *
 * @param copies      The newly created copies (same connector endpoint ids as
 *                    the originals before remapping).
 * @param idMap       Maps each original element id to its copy id for every
 *                    element included in the duplication / paste.
 * @param allElements The original slide element list (used to resolve
 *                    positions when detaching unremapped endpoints).
 */
export function remapConnectorBindings(
  copies: SlideElement[],
  idMap: ReadonlyMap<string, string>,
  allElements: readonly SlideElement[],
): SlideElement[] {
  if (idMap.size === 0) return copies;

  let anyChanged = false;
  const result = copies.map((el): SlideElement => {
    if (el.kind !== "connector") {
      return el;
    }
    const next = remapConnectorElement(el, idMap, allElements);

    if (next !== el) anyChanged = true;
    return next;
  });

  return anyChanged ? result : copies;
}

/** Remaps (or detaches) the endpoints of a single copied connector. */
function remapConnectorElement(
  el: ConnectorElement,
  idMap: ReadonlyMap<string, string>,
  allElements: readonly SlideElement[],
): ConnectorElement {
  const start = connectorStart(el);
  const end = connectorEnd(el);
  const newStart = remapEndpoint(start, idMap, allElements);
  const newEnd = remapEndpoint(end, idMap, allElements);
  if (newStart === start && newEnd === end) return el;
  return withConnectorEndpoints(el, newStart, newEnd);
}

/**
 * Remaps a single endpoint:
 * - Free points pass through unchanged.
 * - Bound endpoints whose target is in `idMap` are remapped.
 * - Bound endpoints whose target is NOT in `idMap` are detached.
 */
function remapEndpoint(
  ep: ConnectorPoint,
  idMap: ReadonlyMap<string, string>,
  allElements: readonly SlideElement[],
): ConnectorPoint {
  if (!isBound(ep)) return ep;

  const newId = idMap.get(ep.elementId);
  if (newId !== undefined) {
    // Both endpoints included in the selection — remap to the copy.
    return { elementId: newId, anchor: ep.anchor };
  }
  // Only one endpoint included — detach to a free point.
  return detachConnectorEndpoint(ep, allElements);
}
