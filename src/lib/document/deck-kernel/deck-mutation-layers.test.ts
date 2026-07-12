import assert from "node:assert/strict";
import { test } from "node:test";

import {
  moveElementZOrder,
  renameElement,
  reorderElement,
  setElementHidden,
  setElementLocked,
} from "./deck-mutation-layers";
import { makeDeck, makeShape, makeSlide } from "./deck-mutation-test-fixtures";

// ---------------------------------------------------------------------------
// setElementHidden
// ---------------------------------------------------------------------------

test("setElementHidden sets hidden: true on the matching element", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = setElementHidden(deck, 0, "el-1", true);
  assert.equal(result.slides[0]!.elements![0]!.hidden, true);
});

test("setElementHidden clears the hidden flag entirely when set to false", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("el-1", { hidden: true })] }),
  ]);
  const result = setElementHidden(deck, 0, "el-1", false);
  assert.ok(!("hidden" in result.slides[0]!.elements![0]!));
});

test("setElementHidden is a no-op when the slide has no elements array", () => {
  const deck = makeDeck([makeSlide({ elements: undefined })]);
  const result = setElementHidden(deck, 0, "el-1", true);
  assert.equal(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// setElementLocked
// ---------------------------------------------------------------------------

test("setElementLocked sets locked: true on the matching element", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = setElementLocked(deck, 0, "el-1", true);
  assert.equal(result.slides[0]!.elements![0]!.locked, true);
});

test("setElementLocked clears the locked flag entirely when set to false", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("el-1", { locked: true })] }),
  ]);
  const result = setElementLocked(deck, 0, "el-1", false);
  assert.ok(!("locked" in result.slides[0]!.elements![0]!));
});

// ---------------------------------------------------------------------------
// moveElementZOrder
// ---------------------------------------------------------------------------

test("moveElementZOrder swaps zIndex with the neighbor above when moving up", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("bottom", { zIndex: 0 }),
        makeShape("middle", { zIndex: 1 }),
        makeShape("top", { zIndex: 2 }),
      ],
    }),
  ]);
  const result = moveElementZOrder(deck, 0, "middle", "up");
  const byId = new Map(
    result.slides[0]!.elements!.map((e) => [e.id, e.zIndex]),
  );
  assert.equal(byId.get("middle"), 2);
  assert.equal(byId.get("top"), 1);
  assert.equal(byId.get("bottom"), 0);
});

test("moveElementZOrder swaps zIndex with the neighbor below when moving down", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("bottom", { zIndex: 0 }),
        makeShape("middle", { zIndex: 1 }),
        makeShape("top", { zIndex: 2 }),
      ],
    }),
  ]);
  const result = moveElementZOrder(deck, 0, "middle", "down");
  const byId = new Map(
    result.slides[0]!.elements!.map((e) => [e.id, e.zIndex]),
  );
  assert.equal(byId.get("middle"), 0);
  assert.equal(byId.get("bottom"), 1);
});

test("moveElementZOrder is a no-op when already at the top and moving up", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("bottom", { zIndex: 0 }),
        makeShape("top", { zIndex: 1 }),
      ],
    }),
  ]);
  const result = moveElementZOrder(deck, 0, "top", "up");
  assert.equal(result.slides[0], deck.slides[0]);
});

test("moveElementZOrder is a no-op when already at the bottom and moving down", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("bottom", { zIndex: 0 }),
        makeShape("top", { zIndex: 1 }),
      ],
    }),
  ]);
  const result = moveElementZOrder(deck, 0, "bottom", "down");
  assert.equal(result.slides[0], deck.slides[0]);
});

test("moveElementZOrder is a no-op when the element id is missing", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = moveElementZOrder(deck, 0, "missing", "up");
  assert.equal(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// renameElement
// ---------------------------------------------------------------------------

test("renameElement sets and trims the display name", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = renameElement(deck, 0, "el-1", "  My Shape  ");
  assert.equal(result.slides[0]!.elements![0]!.name, "My Shape");
});

test("renameElement clears the name when given an empty string", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("el-1", { name: "Old" })] }),
  ]);
  const result = renameElement(deck, 0, "el-1", "");
  assert.ok(!("name" in result.slides[0]!.elements![0]!));
});

test("renameElement clears the name when given only whitespace", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("el-1", { name: "Old" })] }),
  ]);
  const result = renameElement(deck, 0, "el-1", "   ");
  assert.ok(!("name" in result.slides[0]!.elements![0]!));
});

// ---------------------------------------------------------------------------
// reorderElement
// ---------------------------------------------------------------------------

test("reorderElement moves an element to a target's z-position and re-indexes sequentially", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("a", { zIndex: 0 }),
        makeShape("b", { zIndex: 1 }),
        makeShape("c", { zIndex: 2 }),
      ],
    }),
  ]);
  const result = reorderElement(deck, 0, "a", "c");
  const byId = new Map(
    result.slides[0]!.elements!.map((e) => [e.id, e.zIndex]),
  );
  // Moving "a" to "c"'s position: order becomes b, c, a.
  assert.equal(byId.get("b"), 0);
  assert.equal(byId.get("c"), 1);
  assert.equal(byId.get("a"), 2);
});

test("reorderElement is a no-op when elementId equals targetElementId", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = reorderElement(deck, 0, "el-1", "el-1");
  assert.equal(result.slides[0], deck.slides[0]);
});

test("reorderElement is a no-op when either id is missing", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("a"), makeShape("b")] }),
  ]);
  assert.equal(
    reorderElement(deck, 0, "missing", "a").slides[0],
    deck.slides[0],
  );
  assert.equal(
    reorderElement(deck, 0, "a", "missing").slides[0],
    deck.slides[0],
  );
});

test("reorderElement is a no-op when the slide has no elements array", () => {
  const deck = makeDeck([makeSlide({ elements: undefined })]);
  const result = reorderElement(deck, 0, "a", "b");
  assert.equal(result.slides[0], deck.slides[0]);
});
