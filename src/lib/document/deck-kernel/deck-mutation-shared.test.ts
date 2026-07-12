import assert from "node:assert/strict";
import { test } from "node:test";

import {
  freshBlankSlide,
  mapSlide,
  nextZIndex,
  reindex,
} from "./deck-mutation-shared";
import { makeDeck, makeShape, makeSlide } from "./deck-mutation-test-fixtures";

// ---------------------------------------------------------------------------
// reindex
// ---------------------------------------------------------------------------

test("reindex re-stamps each slide's index to match its array position", () => {
  const slides = [
    makeSlide({ id: "a", index: 5 }),
    makeSlide({ id: "b", index: 5 }),
  ];
  const result = reindex(slides);
  assert.deepEqual(
    result.map((s) => s.index),
    [0, 1],
  );
});

test("reindex preserves object identity for a slide already at the correct index", () => {
  const correct = makeSlide({ id: "a", index: 0 });
  const wrong = makeSlide({ id: "b", index: 9 });
  const [resultA, resultB] = reindex([correct, wrong]);
  assert.equal(resultA, correct);
  assert.notEqual(resultB, wrong);
  assert.equal(resultB!.index, 1);
});

test("reindex on an empty array returns an empty array", () => {
  assert.deepEqual(reindex([]), []);
});

// ---------------------------------------------------------------------------
// freshBlankSlide
// ---------------------------------------------------------------------------

test("freshBlankSlide creates a blank slide with placeholder index 0", () => {
  const slide = freshBlankSlide();
  assert.equal(slide.index, 0);
  assert.equal(slide.title, "");
  assert.equal(slide.notes, "");
  assert.deepEqual(slide.elements, []);
  assert.ok(slide.id.length > 0);
});

test("freshBlankSlide produces a distinct id on every call", () => {
  const a = freshBlankSlide();
  const b = freshBlankSlide();
  assert.notEqual(a.id, b.id);
});

// ---------------------------------------------------------------------------
// mapSlide
// ---------------------------------------------------------------------------

test("mapSlide applies fn only to the slide at the given index", () => {
  const deck = makeDeck([
    makeSlide({ id: "a", index: 0, title: "A" }),
    makeSlide({ id: "b", index: 1, title: "B" }),
  ]);
  const result = mapSlide(deck, 1, (slide) => ({ ...slide, title: "changed" }));
  assert.equal(result.slides[0]!.title, "A");
  assert.equal(result.slides[1]!.title, "changed");
});

test("mapSlide returns the same deck reference for a negative index", () => {
  const deck = makeDeck();
  assert.equal(
    mapSlide(deck, -1, (s) => ({ ...s, title: "x" })),
    deck,
  );
});

test("mapSlide returns the same deck reference for an index past the end", () => {
  const deck = makeDeck([makeSlide()]);
  assert.equal(
    mapSlide(deck, 1, (s) => ({ ...s, title: "x" })),
    deck,
  );
});

// ---------------------------------------------------------------------------
// nextZIndex
// ---------------------------------------------------------------------------

test("nextZIndex returns 0 for an empty element list", () => {
  assert.equal(nextZIndex([]), 0);
});

test("nextZIndex returns one above the current maximum zIndex", () => {
  const elements = [
    makeShape("a", { zIndex: 2 }),
    makeShape("b", { zIndex: 7 }),
    makeShape("c", { zIndex: 4 }),
  ];
  assert.equal(nextZIndex(elements), 8);
});

test("nextZIndex floors at 0 when every zIndex is negative (below the -1 seed)", () => {
  assert.equal(nextZIndex([makeShape("a", { zIndex: -3 })]), 0);
});
