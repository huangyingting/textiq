import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alignElements,
  arrangeSelectedElements,
  distributeElements,
  matchSizeElements,
} from "./deck-mutation-arrangement";
import { makeDeck, makeShape, makeSlide } from "./deck-mutation-test-fixtures";

// ---------------------------------------------------------------------------
// alignElements
// ---------------------------------------------------------------------------

test("alignElements aligns the selected elements' left edges to the selection bounds", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("a", { box: { x: 10, y: 0, w: 10, h: 10 } }),
        makeShape("b", { box: { x: 30, y: 0, w: 10, h: 10 } }),
      ],
    }),
  ]);
  const result = alignElements(deck, 0, ["a", "b"], "left");
  const boxes = result.slides[0]!.elements!.map((e) => e.box.x);
  assert.deepEqual(boxes, [10, 10]);
});

test("alignElements only moves the selected elements", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("a", { box: { x: 10, y: 0, w: 10, h: 10 } }),
        makeShape("b", { box: { x: 30, y: 0, w: 10, h: 10 } }),
        makeShape("c", { box: { x: 50, y: 0, w: 10, h: 10 } }),
      ],
    }),
  ]);
  const result = alignElements(deck, 0, ["a", "b"], "right");
  assert.equal(result.slides[0]!.elements![2]!.box.x, 50);
});

test("alignElements is a no-op for an empty selection", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("a")] })]);
  const result = alignElements(deck, 0, [], "left");
  assert.equal(result.slides[0], deck.slides[0]);
});

test("alignElements is a no-op when no selected id is present", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("a")] })]);
  const result = alignElements(deck, 0, ["missing"], "left");
  assert.equal(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// distributeElements
// ---------------------------------------------------------------------------

test("distributeElements spaces three unlocked elements evenly along the horizontal axis", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("a", { box: { x: 0, y: 0, w: 10, h: 10 } }),
        makeShape("b", { box: { x: 20, y: 0, w: 10, h: 10 } }),
        makeShape("c", { box: { x: 90, y: 0, w: 10, h: 10 } }),
      ],
    }),
  ]);
  const result = distributeElements(deck, 0, ["a", "b", "c"], "horizontal");
  const byId = new Map(result.slides[0]!.elements!.map((e) => [e.id, e.box.x]));
  assert.equal(byId.get("a"), 0);
  assert.equal(byId.get("c"), 90);
  // Equal gap: span 100, widths 30, gap = (100-30)/2 = 35; b starts after a's
  // width (10) plus the gap (35) = 45.
  assert.equal(byId.get("b"), 45);
});

test("distributeElements skips locked elements from the selection", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("a", { box: { x: 0, y: 0, w: 10, h: 10 } }),
        makeShape("b", { box: { x: 20, y: 0, w: 10, h: 10 }, locked: true }),
        makeShape("c", { box: { x: 40, y: 0, w: 10, h: 10 } }),
        makeShape("d", { box: { x: 90, y: 0, w: 10, h: 10 } }),
      ],
    }),
  ]);
  const result = distributeElements(
    deck,
    0,
    ["a", "b", "c", "d"],
    "horizontal",
  );
  // Locked "b" is excluded so only a, c, d (3 elements) participate.
  assert.deepEqual(result.slides[0]!.elements![1]!.box, {
    x: 20,
    y: 0,
    w: 10,
    h: 10,
  });
});

test("distributeElements is a no-op when fewer than 3 unlocked elements are selected", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("a"), makeShape("b")] }),
  ]);
  const result = distributeElements(deck, 0, ["a", "b"], "horizontal");
  assert.equal(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// matchSizeElements
// ---------------------------------------------------------------------------

test("matchSizeElements resizes to the first selected element's width and height", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("a", { box: { x: 0, y: 0, w: 30, h: 40 } }),
        makeShape("b", { box: { x: 50, y: 50, w: 5, h: 5 } }),
      ],
    }),
  ]);
  const result = matchSizeElements(deck, 0, ["a", "b"], "both");
  const b = result.slides[0]!.elements![1]!.box;
  assert.deepEqual(b, { x: 50, y: 50, w: 30, h: 40 });
});

test("matchSizeElements honors selection order, not zIndex order, for the size reference", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("a", { box: { x: 0, y: 0, w: 30, h: 40 }, zIndex: 0 }),
        makeShape("b", { box: { x: 50, y: 50, w: 5, h: 5 }, zIndex: 1 }),
      ],
    }),
  ]);
  // "b" is first in the selection order, so its size becomes the reference.
  const result = matchSizeElements(deck, 0, ["b", "a"], "width");
  const a = result.slides[0]!.elements![0]!.box;
  assert.equal(a.w, 5);
});

test("matchSizeElements skips locked elements from the selection", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("a", { box: { x: 0, y: 0, w: 30, h: 40 } }),
        makeShape("b", {
          box: { x: 50, y: 50, w: 5, h: 5 },
          locked: true,
        }),
      ],
    }),
  ]);
  const result = matchSizeElements(deck, 0, ["a", "b"], "both");
  assert.equal(result.slides[0], deck.slides[0]);
});

test("matchSizeElements is a no-op when fewer than 2 unlocked elements are selected", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("a")] })]);
  const result = matchSizeElements(deck, 0, ["a"], "width");
  assert.equal(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// arrangeSelectedElements
// ---------------------------------------------------------------------------

test("arrangeSelectedElements moves the selected element to the front of the z-stack", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("a", { zIndex: 0 }),
        makeShape("b", { zIndex: 1 }),
        makeShape("c", { zIndex: 2 }),
      ],
    }),
  ]);
  const result = arrangeSelectedElements(deck, 0, ["a"], "front");
  const byId = new Map(
    result.slides[0]!.elements!.map((e) => [e.id, e.zIndex]),
  );
  assert.equal(byId.get("a"), 2);
});

test("arrangeSelectedElements excludes locked elements from the move but keeps them in the stack", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("a", { zIndex: 0, locked: true }),
        makeShape("b", { zIndex: 1 }),
      ],
    }),
  ]);
  const result = arrangeSelectedElements(deck, 0, ["a"], "front");
  const byId = new Map(
    result.slides[0]!.elements!.map((e) => [e.id, e.zIndex]),
  );
  // Locked "a" never moves even though it was selected.
  assert.equal(byId.get("a"), 0);
  assert.equal(byId.get("b"), 1);
});

test("arrangeSelectedElements is a no-op when the slide has no elements array", () => {
  const deck = makeDeck([makeSlide({ elements: undefined })]);
  const result = arrangeSelectedElements(deck, 0, ["a"], "front");
  assert.equal(result.slides[0], deck.slides[0]);
});
