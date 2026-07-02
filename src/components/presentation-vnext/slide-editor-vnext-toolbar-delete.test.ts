import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDeckV7, buildSlideV7 } from "@/test/builders/deck-v7";
import { deleteActiveSlideFromToolbar } from "./slide-editor-toolbar-actions";

test("deleteActiveSlideFromToolbar ignores missing active slide selection", () => {
  const deck = buildDeckV7([buildSlideV7("content", [], { id: "slide-a" })]);

  const result = deleteActiveSlideFromToolbar(deck, undefined);

  assert.deepEqual(result, { deleted: false, nextDeck: deck, nextIndex: 0 });
});

test("deleteActiveSlideFromToolbar blocks deleting the final slide", () => {
  const deck = buildDeckV7([buildSlideV7("content", [], { id: "slide-a" })]);

  const result = deleteActiveSlideFromToolbar(deck, "slide-a");

  assert.equal(result.deleted, false);
  assert.equal(result.nextDeck, deck);
  assert.equal(result.nextIndex, 0);
  assert.equal(result.statusMessage, "A deck must keep at least one slide.");
});

test("deleteActiveSlideFromToolbar removes an active slide and selects its neighbor", () => {
  const deck = buildDeckV7([
    buildSlideV7("content", [], { id: "slide-a" }),
    buildSlideV7("content", [], { id: "slide-b" }),
    buildSlideV7("content", [], { id: "slide-c" }),
  ]);

  const result = deleteActiveSlideFromToolbar(deck, "slide-b");

  assert.equal(result.deleted, true);
  assert.notEqual(result.nextDeck, deck);
  assert.deepEqual(
    result.nextDeck.slides.map((slide) => slide.id),
    ["slide-a", "slide-c"],
  );
  assert.equal(result.nextIndex, 1);
});
