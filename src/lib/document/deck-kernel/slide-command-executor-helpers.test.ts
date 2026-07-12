import assert from "node:assert/strict";
import { test } from "node:test";

import { LEGACY_DECK_SCHEMA_VERSION } from "./deck-core";
import {
  failure,
  findSlideIndex,
  makePatch,
  success,
} from "./slide-command-executor-helpers";
import { makeDeck, makeSlide } from "./deck-mutation-test-fixtures";

// ---------------------------------------------------------------------------
// findSlideIndex
// ---------------------------------------------------------------------------

test("findSlideIndex returns the matching slide's position", () => {
  const deck = makeDeck([
    makeSlide({ id: "a" }),
    makeSlide({ id: "b" }),
    makeSlide({ id: "c" }),
  ]);
  assert.equal(findSlideIndex(deck, "b"), 1);
  assert.equal(findSlideIndex(deck, "c"), 2);
});

test("findSlideIndex returns -1 when the slide id is missing", () => {
  const deck = makeDeck([makeSlide({ id: "a" })]);
  assert.equal(findSlideIndex(deck, "missing"), -1);
  assert.equal(findSlideIndex(makeDeck([]), "a"), -1);
});

// ---------------------------------------------------------------------------
// failure
// ---------------------------------------------------------------------------

test("failure returns a not-ok result carrying the same deck reference and no patches", () => {
  const deck = makeDeck([makeSlide({ id: "a" })]);
  const result = failure(deck, "Slide not found: missing");
  assert.deepEqual(result, {
    ok: false,
    deck,
    affectedSlideIds: [],
    affectedElementIds: [],
    error: "Slide not found: missing",
    patches: [],
  });
  // The input deck is never mutated or copied on failure.
  assert.equal(result.deck, deck);
});

// ---------------------------------------------------------------------------
// makePatch
// ---------------------------------------------------------------------------

test("makePatch stamps the legacy schema version and required fields", () => {
  const patch = makePatch("slide.update_title", ["s1"], []);
  assert.deepEqual(patch, {
    schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
    op: "slide.update_title",
    slideIds: ["s1"],
    elementIds: [],
  });
});

test("makePatch merges optional extra payload fields", () => {
  const patch = makePatch("element.update", ["s1"], ["e1"], {
    elementFields: { e1: { locked: true } },
    addedIds: ["e2"],
  });
  assert.deepEqual(patch, {
    schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
    op: "element.update",
    slideIds: ["s1"],
    elementIds: ["e1"],
    elementFields: { e1: { locked: true } },
    addedIds: ["e2"],
  });
});

// ---------------------------------------------------------------------------
// success
// ---------------------------------------------------------------------------

test("success defaults historyKey and patches when omitted", () => {
  const deck = makeDeck([makeSlide({ id: "a" })]);
  const result = success(deck, ["a"], []);
  assert.deepEqual(result, {
    ok: true,
    deck,
    affectedSlideIds: ["a"],
    affectedElementIds: [],
    patches: [],
  });
  assert.equal("historyKey" in result, false);
});

test("success includes historyKey and patches when provided", () => {
  const deck = makeDeck([makeSlide({ id: "a" })]);
  const patch = makePatch("slide.update", ["a"], []);
  const result = success(deck, ["a"], [], "coalesce-key", [patch]);
  assert.deepEqual(result, {
    ok: true,
    deck,
    affectedSlideIds: ["a"],
    affectedElementIds: [],
    historyKey: "coalesce-key",
    patches: [patch],
  });
});
