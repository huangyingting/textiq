import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "@/lib/presentation/render-tree";

import {
  createSelectionState,
  isSelectable,
  getSelectableNodes,
  selectNode,
  deselectNode,
  toggleNode,
  clearSelection,
  setSelection,
  setSelectionMode,
  isSelected,
  hasSelection,
  selectionSize,
  selectedNodeIds,
} from "./selection-model";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userNode(id: string): ResolvedRenderNode {
  return {
    id,
    type: "shape",
    layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 0 },
    style: {},
    content: { type: "shape", content: { shape: "rect" } },
    source: "user",
  };
}

function decorationNode(id: string): ResolvedRenderNode {
  return {
    id,
    type: "shape",
    role: "themeDecoration",
    layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: -1 },
    style: {},
    content: { type: "shape", content: { shape: "rect" } },
    source: "themeDecoration",
  };
}

function chromeNode(id: string): ResolvedRenderNode {
  return {
    ...decorationNode(id),
    role: "background",
    source: "deckChrome",
    chromeKind: "watermark",
  };
}

function mockSlide(
  userNodes: ResolvedRenderNode[],
  decorations: ResolvedRenderNode[] = [],
  chrome: ResolvedRenderNode[] = [],
): ResolvedSlideRenderTree {
  return {
    id: "slide-1",
    background: { fill: undefined, decorationLevel: "default" },
    decorations,
    chrome,
    nodes: userNodes,
  };
}

// ---------------------------------------------------------------------------
// isSelectable
// ---------------------------------------------------------------------------

test("isSelectable returns true for user nodes in normal mode", () => {
  assert.equal(isSelectable(userNode("n1"), "normal"), true);
});

test("isSelectable returns false for themeDecoration nodes in normal mode", () => {
  assert.equal(isSelectable(decorationNode("d1"), "normal"), false);
});

test("isSelectable returns true for themeDecoration nodes in layers mode", () => {
  assert.equal(isSelectable(decorationNode("d1"), "layers"), true);
});

test("isSelectable returns false for deckChrome nodes in normal mode", () => {
  assert.equal(isSelectable(chromeNode("c1"), "normal"), false);
  assert.equal(isSelectable(chromeNode("c1"), "layers"), true);
});

test("isSelectable defaults to normal mode when mode is omitted", () => {
  assert.equal(isSelectable(decorationNode("d1")), false);
  assert.equal(isSelectable(userNode("n1")), true);
});

// ---------------------------------------------------------------------------
// getSelectableNodes
// ---------------------------------------------------------------------------

test("getSelectableNodes returns only user nodes in normal mode", () => {
  const slide = mockSlide(
    [userNode("n1"), userNode("n2")],
    [decorationNode("d1")],
  );
  const nodes = getSelectableNodes(slide, "normal");
  assert.deepEqual(
    nodes.map((n) => n.id),
    ["n1", "n2"],
  );
});

test("getSelectableNodes returns user nodes, decorations, and chrome in layers mode", () => {
  const slide = mockSlide(
    [userNode("n1")],
    [decorationNode("d1")],
    [chromeNode("c1")],
  );
  const nodes = getSelectableNodes(slide, "layers");
  assert.deepEqual(
    nodes.map((n) => n.id),
    ["n1", "d1", "c1"],
  );
});

test("getSelectableNodes defaults to normal mode when mode is omitted", () => {
  const slide = mockSlide([userNode("n1")], [decorationNode("d1")]);
  const nodes = getSelectableNodes(slide);
  assert.deepEqual(
    nodes.map((n) => n.id),
    ["n1"],
  );
});

// ---------------------------------------------------------------------------
// createSelectionState
// ---------------------------------------------------------------------------

test("createSelectionState returns empty state in normal mode by default", () => {
  const state = createSelectionState();
  assert.equal(state.mode, "normal");
  assert.equal(state.nodeIds.size, 0);
});

test("createSelectionState accepts explicit mode", () => {
  const state = createSelectionState("layers");
  assert.equal(state.mode, "layers");
});

// ---------------------------------------------------------------------------
// selectNode
// ---------------------------------------------------------------------------

test("selectNode replaces selection by default", () => {
  let state = createSelectionState();
  state = selectNode(state, "n1");
  state = selectNode(state, "n2");
  assert.deepEqual(selectedNodeIds(state), ["n2"]);
});

test("selectNode is additive when additive=true", () => {
  let state = createSelectionState();
  state = selectNode(state, "n1");
  state = selectNode(state, "n2", true);
  assert.ok(isSelected(state, "n1"));
  assert.ok(isSelected(state, "n2"));
});

// ---------------------------------------------------------------------------
// deselectNode
// ---------------------------------------------------------------------------

test("deselectNode removes node from selection", () => {
  let state = createSelectionState();
  state = selectNode(state, "n1");
  state = deselectNode(state, "n1");
  assert.equal(isSelected(state, "n1"), false);
});

test("deselectNode is a no-op for absent ids", () => {
  const state = createSelectionState();
  const after = deselectNode(state, "missing");
  assert.strictEqual(after, state);
});

// ---------------------------------------------------------------------------
// toggleNode
// ---------------------------------------------------------------------------

test("toggleNode adds absent node to selection", () => {
  let state = createSelectionState();
  state = toggleNode(state, "n1");
  assert.ok(isSelected(state, "n1"));
});

test("toggleNode removes present node from selection", () => {
  let state = selectNode(createSelectionState(), "n1");
  state = toggleNode(state, "n1");
  assert.equal(isSelected(state, "n1"), false);
});

// ---------------------------------------------------------------------------
// clearSelection
// ---------------------------------------------------------------------------

test("clearSelection removes all nodes", () => {
  let state = createSelectionState();
  state = selectNode(state, "n1", true);
  state = selectNode(state, "n2", true);
  state = clearSelection(state);
  assert.equal(hasSelection(state), false);
});

test("clearSelection is identity when already empty", () => {
  const state = createSelectionState();
  assert.strictEqual(clearSelection(state), state);
});

// ---------------------------------------------------------------------------
// setSelection
// ---------------------------------------------------------------------------

test("setSelection replaces selection with provided ids", () => {
  let state = selectNode(createSelectionState(), "n1");
  state = setSelection(state, ["n2", "n3"]);
  assert.deepEqual(new Set(selectedNodeIds(state)), new Set(["n2", "n3"]));
});

// ---------------------------------------------------------------------------
// setSelectionMode
// ---------------------------------------------------------------------------

test("setSelectionMode changes mode", () => {
  let state = createSelectionState("normal");
  state = setSelectionMode(state, "layers");
  assert.equal(state.mode, "layers");
});

test("setSelectionMode is identity when mode unchanged", () => {
  const state = createSelectionState("normal");
  assert.strictEqual(setSelectionMode(state, "normal"), state);
});

test("setSelectionMode clears generated selections when leaving layers mode", () => {
  const slide = mockSlide(
    [userNode("u1")],
    [decorationNode("d1")],
    [chromeNode("c1")],
  );
  let state = setSelection(createSelectionState("layers"), ["d1", "c1"]);
  state = setSelectionMode(
    state,
    "normal",
    getSelectableNodes(slide, "normal").map((node) => node.id),
  );
  assert.equal(state.mode, "normal");
  assert.deepEqual(selectedNodeIds(state), []);
  assert.equal(selectionSize(state), 0);
});

test("setSelectionMode preserves selected user nodes when leaving layers mode", () => {
  const slide = mockSlide(
    [userNode("u1"), userNode("u2")],
    [decorationNode("d1")],
    [chromeNode("c1")],
  );
  let state = setSelection(createSelectionState("layers"), ["u1", "d1", "u2"]);
  state = setSelectionMode(
    state,
    "normal",
    getSelectableNodes(slide, "normal").map((node) => node.id),
  );
  assert.equal(state.mode, "normal");
  assert.deepEqual(selectedNodeIds(state), ["u1", "u2"]);
  assert.equal(selectionSize(state), 2);
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

test("hasSelection returns false for empty state", () => {
  assert.equal(hasSelection(createSelectionState()), false);
});

test("hasSelection returns true when nodes are selected", () => {
  assert.equal(hasSelection(selectNode(createSelectionState(), "n1")), true);
});

test("selectionSize returns correct count", () => {
  let state = createSelectionState();
  state = selectNode(state, "n1");
  state = selectNode(state, "n2", true);
  assert.equal(selectionSize(state), 2);
});

test("selectedNodeIds returns array of selected ids", () => {
  let state = createSelectionState();
  state = selectNode(state, "n1");
  assert.deepEqual(selectedNodeIds(state), ["n1"]);
});

// ---------------------------------------------------------------------------
// UI context: context toolbar visibility (from slide editor UI spec §Context
// Toolbar States)
// ---------------------------------------------------------------------------

test("context toolbar is hidden when no nodes are selected (hasSelection=false)", () => {
  const state = createSelectionState();
  assert.equal(
    hasSelection(state),
    false,
    "Toolbar should be hidden — nothing selected",
  );
});

test("context toolbar is visible when exactly one node is selected", () => {
  const state = selectNode(createSelectionState(), "n1");
  assert.equal(
    hasSelection(state),
    true,
    "Toolbar should be visible — node selected",
  );
  assert.equal(selectionSize(state), 1);
});

test("context toolbar shows multi-select group when 2+ nodes are selected", () => {
  let state = createSelectionState();
  state = selectNode(state, "n1");
  state = selectNode(state, "n2", true);
  assert.ok(
    selectionSize(state) >= 2,
    "Multi-select group should trigger at 2+ nodes",
  );
});

test("clearing selection hides context toolbar", () => {
  let state = selectNode(createSelectionState(), "n1");
  assert.equal(hasSelection(state), true);
  state = clearSelection(state);
  assert.equal(hasSelection(state), false, "Toolbar should hide after clear");
});

// ---------------------------------------------------------------------------
// UI context: locked/hidden nodes not excluded from selection state
// (hiding/locking is enforced at dispatch time, not in selection model)
// ---------------------------------------------------------------------------

test("isSelectable returns true for a locked user node in normal mode", () => {
  const locked = { ...userNode("n-locked"), locked: true } as ReturnType<
    typeof userNode
  >;
  assert.equal(isSelectable(locked, "normal"), true);
});

test("isSelectable returns true for a hidden user node in normal mode", () => {
  const hidden = { ...userNode("n-hidden"), hidden: true } as ReturnType<
    typeof userNode
  >;
  assert.equal(isSelectable(hidden, "normal"), true);
});

// ---------------------------------------------------------------------------
// UI context: layers mode unlocks theme decorations for the Layers panel
// ---------------------------------------------------------------------------

test("in layers mode selectable nodes include decorations appended after user nodes", () => {
  const slide = mockSlide(
    [userNode("u1"), userNode("u2")],
    [decorationNode("d1"), decorationNode("d2")],
  );
  const nodes = getSelectableNodes(slide, "layers");
  const ids = nodes.map((n) => n.id);
  assert.deepEqual(ids.slice(0, 2), ["u1", "u2"], "user nodes first");
  assert.deepEqual(ids.slice(2), ["d1", "d2"], "decorations appended after");
});

test("switching from normal to layers mode preserves existing selection", () => {
  let state = selectNode(createSelectionState("normal"), "u1");
  state = setSelectionMode(state, "layers");
  assert.equal(state.mode, "layers");
  assert.ok(isSelected(state, "u1"), "selection preserved after mode switch");
});
