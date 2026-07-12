import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addSlide,
  duplicateSlide,
  insertSlide,
  moveSlide,
  removeSlide,
  reorderSlides,
  updateSlide,
} from "./deck-mutation-slides";
import { makeDeck, makeShape, makeSlide } from "./deck-mutation-test-fixtures";

function threeSlideDeck() {
  return makeDeck([
    makeSlide({ id: "a", index: 0, title: "A" }),
    makeSlide({ id: "b", index: 1, title: "B" }),
    makeSlide({ id: "c", index: 2, title: "C" }),
  ]);
}

// ---------------------------------------------------------------------------
// reorderSlides
// ---------------------------------------------------------------------------

test("reorderSlides moves a slide to a later position and re-indexes", () => {
  const deck = threeSlideDeck();
  const result = reorderSlides(deck, 0, 2);
  assert.deepEqual(
    result.slides.map((s) => s.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    result.slides.map((s) => s.index),
    [0, 1, 2],
  );
});

test("reorderSlides moves a slide to an earlier position", () => {
  const deck = threeSlideDeck();
  const result = reorderSlides(deck, 2, 0);
  assert.deepEqual(
    result.slides.map((s) => s.id),
    ["c", "a", "b"],
  );
});

test("reorderSlides is a no-op when fromIndex equals toIndex", () => {
  const deck = threeSlideDeck();
  assert.equal(reorderSlides(deck, 1, 1), deck);
});

test("reorderSlides is a no-op for an out-of-range fromIndex or toIndex", () => {
  const deck = threeSlideDeck();
  assert.equal(reorderSlides(deck, -1, 1), deck);
  assert.equal(reorderSlides(deck, 0, 5), deck);
});

// ---------------------------------------------------------------------------
// moveSlide
// ---------------------------------------------------------------------------

test("moveSlide moves toward the end when direction is positive", () => {
  const deck = threeSlideDeck();
  const result = moveSlide(deck, 0, 1);
  assert.deepEqual(
    result.slides.map((s) => s.id),
    ["b", "a", "c"],
  );
});

test("moveSlide moves toward the start when direction is negative", () => {
  const deck = threeSlideDeck();
  const result = moveSlide(deck, 2, -1);
  assert.deepEqual(
    result.slides.map((s) => s.id),
    ["a", "c", "b"],
  );
});

test("moveSlide is a no-op at the leading edge", () => {
  const deck = threeSlideDeck();
  assert.equal(moveSlide(deck, 0, -1), deck);
});

test("moveSlide is a no-op at the trailing edge", () => {
  const deck = threeSlideDeck();
  assert.equal(moveSlide(deck, 2, 1), deck);
});

test("moveSlide is a no-op for direction 0 or an out-of-range index", () => {
  const deck = threeSlideDeck();
  assert.equal(moveSlide(deck, 1, 0), deck);
  assert.equal(moveSlide(deck, 9, 1), deck);
  assert.equal(moveSlide(deck, -1, 1), deck);
});

// ---------------------------------------------------------------------------
// addSlide
// ---------------------------------------------------------------------------

test("addSlide inserts a blank slide right after afterIndex", () => {
  const deck = threeSlideDeck();
  const result = addSlide(deck, 0);
  assert.equal(result.slides.length, 4);
  assert.equal(result.slides[1]!.title, "");
  assert.deepEqual(
    result.slides.map((s, i) => s.index === i),
    [true, true, true, true],
  );
});

test("addSlide prepends when afterIndex is -1", () => {
  const deck = threeSlideDeck();
  const result = addSlide(deck, -1);
  assert.equal(result.slides[0]!.title, "");
  assert.equal(result.slides[1]!.id, "a");
});

test("addSlide clamps afterIndex past the end to append at the end", () => {
  const deck = threeSlideDeck();
  const result = addSlide(deck, 99);
  assert.equal(result.slides.length, 4);
  assert.equal(result.slides.at(-1)!.title, "");
});

// ---------------------------------------------------------------------------
// insertSlide
// ---------------------------------------------------------------------------

test("insertSlide inserts a fully-formed slide verbatim and re-indexes", () => {
  const deck = threeSlideDeck();
  const authored = makeSlide({
    id: "authored",
    index: 99,
    title: "Authored",
    elements: [makeShape("el-1")],
  });
  const result = insertSlide(deck, 0, authored);
  assert.equal(result.slides[1]!.id, "authored");
  assert.equal(result.slides[1]!.index, 1);
  // Elements are taken as-is (same array reference), not cloned.
  assert.equal(result.slides[1]!.elements, authored.elements);
});

test("insertSlide prepends when afterIndex is -1", () => {
  const deck = threeSlideDeck();
  const authored = makeSlide({ id: "authored" });
  const result = insertSlide(deck, -1, authored);
  assert.equal(result.slides[0]!.id, "authored");
});

// ---------------------------------------------------------------------------
// duplicateSlide
// ---------------------------------------------------------------------------

test("duplicateSlide inserts a copy with a fresh id right after the original", () => {
  const deck = makeDeck([
    makeSlide({ id: "a", elements: [makeShape("el-1")] }),
  ]);
  const result = duplicateSlide(deck, 0);
  assert.equal(result.slides.length, 2);
  assert.equal(result.slides[0]!.id, "a");
  assert.notEqual(result.slides[1]!.id, "a");
  assert.deepEqual(result.slides[1]!.elements, deck.slides[0]!.elements);
  // Deep-cloned — same shape, different object identity.
  assert.notEqual(result.slides[1]!.elements, deck.slides[0]!.elements);
  assert.notEqual(result.slides[1]!.elements![0], deck.slides[0]!.elements![0]);
});

test("duplicateSlide handles a slide with no elements array", () => {
  const deck = makeDeck([makeSlide({ id: "a", elements: undefined })]);
  const result = duplicateSlide(deck, 0);
  assert.equal(result.slides.length, 2);
  assert.equal(result.slides[1]!.elements, undefined);
});

test("duplicateSlide is a no-op for an out-of-range index", () => {
  const deck = threeSlideDeck();
  assert.equal(duplicateSlide(deck, -1), deck);
  assert.equal(duplicateSlide(deck, 3), deck);
});

// ---------------------------------------------------------------------------
// removeSlide
// ---------------------------------------------------------------------------

test("removeSlide removes the slide at index and re-indexes the rest", () => {
  const deck = threeSlideDeck();
  const result = removeSlide(deck, 1);
  assert.deepEqual(
    result.slides.map((s) => s.id),
    ["a", "c"],
  );
  assert.deepEqual(
    result.slides.map((s) => s.index),
    [0, 1],
  );
});

test("removeSlide is a no-op for an out-of-range index", () => {
  const deck = threeSlideDeck();
  assert.equal(removeSlide(deck, -1), deck);
  assert.equal(removeSlide(deck, 3), deck);
});

test("removeSlide keeps at least one slide in the deck", () => {
  const deck = makeDeck([makeSlide({ id: "only" })]);
  assert.equal(removeSlide(deck, 0), deck);
});

// ---------------------------------------------------------------------------
// updateSlide
// ---------------------------------------------------------------------------

test("updateSlide patches fields while preserving index", () => {
  const deck = threeSlideDeck();
  const result = updateSlide(deck, 1, { title: "Renamed", notes: "n" });
  assert.equal(result.slides[1]!.title, "Renamed");
  assert.equal(result.slides[1]!.notes, "n");
  assert.equal(result.slides[1]!.index, 1);
});

test("updateSlide re-indexes the whole deck after patching", () => {
  const deck = threeSlideDeck();
  const result = updateSlide(deck, 0, { title: "Renamed" });
  assert.deepEqual(
    result.slides.map((s) => s.index),
    [0, 1, 2],
  );
});

test("updateSlide is a no-op for an out-of-range index", () => {
  const deck = threeSlideDeck();
  assert.equal(updateSlide(deck, -1, { title: "x" }), deck);
  assert.equal(updateSlide(deck, 3, { title: "x" }), deck);
});
