/**
 * Selection model for the presentation canvas.
 *
 * Key rules:
 * - In "normal" editing mode, generated nodes (`source: "themeDecoration"` or
 *   `"deckChrome"`) are excluded from selection.
 * - In "layers" mode all resolved nodes (including decorations/chrome) are selectable,
 *   enabling explicit decoration detach/inspect workflows.
 * - Selection state is a simple set of node ids; the model is immutable —
 *   every mutating function returns a new `SelectionState`.
 */

import type {
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "@/lib/presentation/render-tree";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Editing mode that controls which nodes the user can interact with. */
export type SelectionMode = "normal" | "layers";

/** Immutable selection snapshot.  Always create via {@link createSelectionState}. */
export type SelectionState = {
  readonly nodeIds: ReadonlySet<string>;
  readonly mode: SelectionMode;
};

// ---------------------------------------------------------------------------
// Selectability predicate
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `node` may be selected in the given `mode`.
 *
 * - `"normal"`: generated decorations/chrome are never
 *   selectable.
 * - `"layers"`: every resolved node is selectable regardless of source.
 */
export function isSelectable(
  node: ResolvedRenderNode,
  mode: SelectionMode = "normal",
): boolean {
  if (
    mode === "normal" &&
    (node.source === "themeDecoration" || node.source === "deckChrome")
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Selectable node list
// ---------------------------------------------------------------------------

/**
 * Returns the ordered list of selectable nodes from a resolved slide.
 *
 * In `"normal"` mode only user nodes are returned (decoration-free).
 * In `"layers"` mode decorations and deck chrome are appended after user nodes.
 */
export function getSelectableNodes(
  slide: ResolvedSlideRenderTree,
  mode: SelectionMode = "normal",
): ResolvedRenderNode[] {
  const userNodes = slide.nodes.filter((n) => isSelectable(n, mode));
  if (mode === "layers") {
    return [...userNodes, ...slide.decorations, ...slide.chrome];
  }
  return userNodes;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates an empty selection state with the given mode. */
export function createSelectionState(
  mode: SelectionMode = "normal",
): SelectionState {
  return { nodeIds: new Set(), mode };
}

// ---------------------------------------------------------------------------
// Mutations — each returns a new SelectionState
// ---------------------------------------------------------------------------

/**
 * Selects `nodeId`.
 *
 * When `additive` is `false` (default) all previously selected nodes are
 * deselected first.  When `true`, the id is added to the existing set.
 */
export function selectNode(
  state: SelectionState,
  nodeId: string,
  additive = false,
): SelectionState {
  if (additive) {
    const next = new Set(state.nodeIds);
    next.add(nodeId);
    return { ...state, nodeIds: next };
  }
  return { ...state, nodeIds: new Set([nodeId]) };
}

/** Removes `nodeId` from the selection. No-op if not selected. */
export function deselectNode(
  state: SelectionState,
  nodeId: string,
): SelectionState {
  if (!state.nodeIds.has(nodeId)) return state;
  const next = new Set(state.nodeIds);
  next.delete(nodeId);
  return { ...state, nodeIds: next };
}

/** Toggles the selection state of `nodeId`. */
export function toggleNode(
  state: SelectionState,
  nodeId: string,
): SelectionState {
  return state.nodeIds.has(nodeId)
    ? deselectNode(state, nodeId)
    : selectNode(state, nodeId, true);
}

/** Clears all selected nodes. */
export function clearSelection(state: SelectionState): SelectionState {
  if (state.nodeIds.size === 0) return state;
  return { ...state, nodeIds: new Set() };
}

/** Replaces the entire selection with the provided node ids. */
export function setSelection(
  state: SelectionState,
  nodeIds: readonly string[],
): SelectionState {
  return { ...state, nodeIds: new Set(nodeIds) };
}

/**
 * Switches the editing mode.
 *
 * When `selectableNodeIds` is provided, selection is filtered to that allow-list
 * after the mode switch.
 */
export function setSelectionMode(
  state: SelectionState,
  mode: SelectionMode,
  selectableNodeIds?: readonly string[],
): SelectionState {
  if (state.mode === mode && !selectableNodeIds) return state;
  const nextState = state.mode === mode ? state : { ...state, mode };
  if (!selectableNodeIds) return nextState;
  const selectable = new Set(selectableNodeIds);
  const nextNodeIds = [...nextState.nodeIds].filter((id) => selectable.has(id));
  if (nextNodeIds.length === nextState.nodeIds.size) return nextState;
  return { ...nextState, nodeIds: new Set(nextNodeIds) };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Returns `true` if `nodeId` is currently selected. */
export function isSelected(state: SelectionState, nodeId: string): boolean {
  return state.nodeIds.has(nodeId);
}

/** Returns `true` if at least one node is selected. */
export function hasSelection(state: SelectionState): boolean {
  return state.nodeIds.size > 0;
}

/** Returns the number of selected nodes. */
export function selectionSize(state: SelectionState): number {
  return state.nodeIds.size;
}

/** Returns the selected node ids as a plain array. */
export function selectedNodeIds(state: SelectionState): string[] {
  return [...state.nodeIds];
}
