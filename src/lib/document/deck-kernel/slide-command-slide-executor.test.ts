import assert from "node:assert/strict";
import { test } from "node:test";

import { executeSlideFamilyCommand } from "./slide-command-slide-executor";
import { makeDeck, makeSlide } from "./deck-mutation-test-fixtures";
import type {
  AddSlideCommand,
  DuplicateSlideCommand,
  InsertTemplateSlideCommand,
  MoveSlideCommand,
  RemoveSlideCommand,
  ReorderSlideCommand,
  UpdateSlideCommand,
  UpdateSlideNotesCommand,
  UpdateSlideTitleCommand,
} from "./slide-command-contracts";
import type { Slide } from "./deck-core";

function threeSlideDeck() {
  return makeDeck([
    makeSlide({ id: "a", index: 0, title: "A" }),
    makeSlide({ id: "b", index: 1, title: "B" }),
    makeSlide({ id: "c", index: 2, title: "C" }),
  ]);
}

// ---------------------------------------------------------------------------
// ADD_SLIDE
// ---------------------------------------------------------------------------

test("ADD_SLIDE appends to the end when afterSlideId is omitted", () => {
  const deck = threeSlideDeck();
  const cmd: AddSlideCommand = { type: "ADD_SLIDE" };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides.length, 4);
  assert.equal(result.deck.slides[3]!.id, result.affectedSlideIds[0]);
  assert.equal(result.patches[0]!.op, "slide.add");
  assert.deepEqual(result.patches[0]!.addedIds, result.affectedSlideIds);
});

test("ADD_SLIDE inserts after the given slide id", () => {
  const deck = threeSlideDeck();
  const cmd: AddSlideCommand = { type: "ADD_SLIDE", afterSlideId: "a" };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides.length, 4);
  assert.equal(result.deck.slides[1]!.id, result.affectedSlideIds[0]);
});

test("ADD_SLIDE fails for a missing afterSlideId and leaves the deck untouched", () => {
  const deck = threeSlideDeck();
  const cmd: AddSlideCommand = { type: "ADD_SLIDE", afterSlideId: "missing" };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
  assert.equal(result.deck, deck);
});

// ---------------------------------------------------------------------------
// REMOVE_SLIDE
// ---------------------------------------------------------------------------

test("REMOVE_SLIDE removes the targeted slide", () => {
  const deck = threeSlideDeck();
  const cmd: RemoveSlideCommand = { type: "REMOVE_SLIDE", slideId: "b" };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.deck.slides.map((s) => s.id),
    ["a", "c"],
  );
  assert.deepEqual(result.patches[0]!.removedIds, ["b"]);
});

test("REMOVE_SLIDE fails for a missing slide id", () => {
  const deck = threeSlideDeck();
  const result = executeSlideFamilyCommand(deck, {
    type: "REMOVE_SLIDE",
    slideId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

test("REMOVE_SLIDE refuses to remove the last remaining slide", () => {
  const deck = makeDeck([makeSlide({ id: "only" })]);
  const cmd: RemoveSlideCommand = { type: "REMOVE_SLIDE", slideId: "only" };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Cannot remove the last slide");
  assert.equal(result.deck, deck);
});

// ---------------------------------------------------------------------------
// DUPLICATE_SLIDE
// ---------------------------------------------------------------------------

test("DUPLICATE_SLIDE inserts a copy right after the source and reports both ids", () => {
  const deck = threeSlideDeck();
  const cmd: DuplicateSlideCommand = { type: "DUPLICATE_SLIDE", slideId: "b" };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides.length, 4);
  assert.equal(result.affectedSlideIds[0], "b");
  assert.equal(result.deck.slides[2]!.id, result.affectedSlideIds[1]);
  assert.deepEqual(result.patches[0]!.addedIds, [result.affectedSlideIds[1]]);
});

test("DUPLICATE_SLIDE fails for a missing slide id", () => {
  const deck = threeSlideDeck();
  const result = executeSlideFamilyCommand(deck, {
    type: "DUPLICATE_SLIDE",
    slideId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

// ---------------------------------------------------------------------------
// REORDER_SLIDE
// ---------------------------------------------------------------------------

test("REORDER_SLIDE moves a slide to a new index and reports the affected range", () => {
  const deck = threeSlideDeck();
  const cmd: ReorderSlideCommand = {
    type: "REORDER_SLIDE",
    slideId: "a",
    toIndex: 2,
  };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.deck.slides.map((s) => s.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(result.affectedSlideIds, ["a", "b", "c"]);
});

test("REORDER_SLIDE fails for a missing slide id", () => {
  const deck = threeSlideDeck();
  const result = executeSlideFamilyCommand(deck, {
    type: "REORDER_SLIDE",
    slideId: "missing",
    toIndex: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

test("REORDER_SLIDE fails for an out-of-range target index", () => {
  const deck = threeSlideDeck();
  const result = executeSlideFamilyCommand(deck, {
    type: "REORDER_SLIDE",
    slideId: "a",
    toIndex: 9,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Invalid target index: 9");
  assert.equal(result.deck, deck);
});

// ---------------------------------------------------------------------------
// UPDATE_SLIDE
// ---------------------------------------------------------------------------

test("UPDATE_SLIDE applies the patch and forwards the coalesce key", () => {
  const deck = threeSlideDeck();
  const cmd: UpdateSlideCommand = {
    type: "UPDATE_SLIDE",
    slideId: "a",
    patch: { title: "Updated A", notes: "New notes" },
    coalesceKey: "update:a",
  };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.title, "Updated A");
  assert.equal(result.deck.slides[0]!.notes, "New notes");
  assert.equal(result.historyKey, "update:a");
  assert.deepEqual(result.patches[0]!.slideFields, {
    a: { title: "Updated A", notes: "New notes" },
  });
});

test("UPDATE_SLIDE strips an id key smuggled into the patch via an unsafe cast", () => {
  const deck = threeSlideDeck();
  const unsafePatch = { id: "hijacked-id", title: "Still updated" } as Partial<
    Omit<Slide, "id" | "index" | "theme">
  >;
  const cmd: UpdateSlideCommand = {
    type: "UPDATE_SLIDE",
    slideId: "a",
    patch: unsafePatch,
  };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.id, "a");
  assert.equal(result.deck.slides[0]!.title, "Still updated");
  assert.equal("id" in (result.patches[0]!.slideFields?.a ?? {}), false);
});

test("UPDATE_SLIDE fails for a missing slide id", () => {
  const deck = threeSlideDeck();
  const result = executeSlideFamilyCommand(deck, {
    type: "UPDATE_SLIDE",
    slideId: "missing",
    patch: { title: "x" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

// ---------------------------------------------------------------------------
// MOVE_SLIDE
// ---------------------------------------------------------------------------

test("MOVE_SLIDE swaps a slide with its forward neighbor", () => {
  const deck = threeSlideDeck();
  const cmd: MoveSlideCommand = {
    type: "MOVE_SLIDE",
    slideIndex: 0,
    direction: 1,
  };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.deck.slides.map((s) => s.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(result.affectedSlideIds, ["a", "b"]);
});

test("MOVE_SLIDE fails for an out-of-range index or a zero direction", () => {
  const deck = threeSlideDeck();
  const outOfRange = executeSlideFamilyCommand(deck, {
    type: "MOVE_SLIDE",
    slideIndex: 9,
    direction: 1,
  });
  assert.equal(outOfRange.ok, false);
  assert.match(outOfRange.error!, /^Invalid move:/);

  const zeroDirection = executeSlideFamilyCommand(deck, {
    type: "MOVE_SLIDE",
    slideIndex: 0,
    direction: 0,
  });
  assert.equal(zeroDirection.ok, false);
  assert.match(zeroDirection.error!, /^Invalid move:/);
});

test("MOVE_SLIDE fails when the move would exceed deck bounds", () => {
  const deck = threeSlideDeck();
  const result = executeSlideFamilyCommand(deck, {
    type: "MOVE_SLIDE",
    slideIndex: 0,
    direction: -1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Move would exceed deck bounds");
});

// ---------------------------------------------------------------------------
// INSERT_TEMPLATE_SLIDE
// ---------------------------------------------------------------------------

test("INSERT_TEMPLATE_SLIDE inserts the given slide after afterIndex", () => {
  const deck = threeSlideDeck();
  const slide = makeSlide({ id: "template-1", title: "From template" });
  const cmd: InsertTemplateSlideCommand = {
    type: "INSERT_TEMPLATE_SLIDE",
    afterIndex: 0,
    slide,
  };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[1]!.id, "template-1");
  assert.deepEqual(result.affectedSlideIds, ["template-1"]);
  assert.deepEqual(result.patches[0]!.addedIds, ["template-1"]);
});

test("INSERT_TEMPLATE_SLIDE defaults afterIndex to the end of the deck", () => {
  const deck = threeSlideDeck();
  const slide = makeSlide({ id: "template-2" });
  const result = executeSlideFamilyCommand(deck, {
    type: "INSERT_TEMPLATE_SLIDE",
    slide,
  });
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[3]!.id, "template-2");
});

test("INSERT_TEMPLATE_SLIDE disambiguates a slide id that already exists in the deck", () => {
  const deck = threeSlideDeck();
  const slide = makeSlide({ id: "a", title: "Collides with existing id" });
  const result = executeSlideFamilyCommand(deck, {
    type: "INSERT_TEMPLATE_SLIDE",
    afterIndex: 0,
    slide,
  });
  assert.equal(result.ok, true);
  assert.notEqual(result.deck.slides[1]!.id, "a");
  assert.equal(result.deck.slides[1]!.title, "Collides with existing id");
});

test("INSERT_TEMPLATE_SLIDE fails for an out-of-range afterIndex", () => {
  const deck = threeSlideDeck();
  const result = executeSlideFamilyCommand(deck, {
    type: "INSERT_TEMPLATE_SLIDE",
    afterIndex: 99,
    slide: makeSlide({ id: "x" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Invalid afterIndex: 99");
});

// ---------------------------------------------------------------------------
// UPDATE_SLIDE_TITLE / UPDATE_SLIDE_NOTES
// ---------------------------------------------------------------------------

test("UPDATE_SLIDE_TITLE updates the title and forwards the coalesce key", () => {
  const deck = threeSlideDeck();
  const cmd: UpdateSlideTitleCommand = {
    type: "UPDATE_SLIDE_TITLE",
    slideId: "b",
    title: "New title",
    coalesceKey: "title:b",
  };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[1]!.title, "New title");
  assert.equal(result.historyKey, "title:b");
  assert.equal(result.patches[0]!.op, "slide.update_title");
});

test("UPDATE_SLIDE_TITLE fails for a missing slide id", () => {
  const deck = threeSlideDeck();
  const result = executeSlideFamilyCommand(deck, {
    type: "UPDATE_SLIDE_TITLE",
    slideId: "missing",
    title: "x",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

test("UPDATE_SLIDE_NOTES updates the notes and forwards the coalesce key", () => {
  const deck = threeSlideDeck();
  const cmd: UpdateSlideNotesCommand = {
    type: "UPDATE_SLIDE_NOTES",
    slideId: "c",
    notes: "New notes",
    coalesceKey: "notes:c",
  };
  const result = executeSlideFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[2]!.notes, "New notes");
  assert.equal(result.historyKey, "notes:c");
  assert.equal(result.patches[0]!.op, "slide.update_notes");
});

test("UPDATE_SLIDE_NOTES fails for a missing slide id", () => {
  const deck = threeSlideDeck();
  const result = executeSlideFamilyCommand(deck, {
    type: "UPDATE_SLIDE_NOTES",
    slideId: "missing",
    notes: "x",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});
