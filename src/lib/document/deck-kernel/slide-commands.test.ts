import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyPatch,
  coalesceCommands,
  commitCommand,
  executeCommand,
} from "./slide-commands";
import { makeDeck, makeShape, makeSlide } from "./deck-mutation-test-fixtures";
import type { SlideCommand } from "./slide-command-contracts";

function twoSlideDeck() {
  return makeDeck([
    makeSlide({ id: "s1", title: "One", elements: [makeShape("e1")] }),
    makeSlide({ id: "s2", title: "Two" }),
  ]);
}

// ---------------------------------------------------------------------------
// executeCommand — cross-executor routing
// ---------------------------------------------------------------------------

test("executeCommand routes slide-family commands to the slide executor", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "UPDATE_SLIDE_TITLE",
    slideId: "s1",
    title: "Retitled",
  });
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.title, "Retitled");
});

test("executeCommand routes element-family commands to the element executor", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "RENAME_ELEMENT",
    slideId: "s1",
    elementId: "e1",
    name: "Renamed shape",
  });
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements![0]!.name, "Renamed shape");
});

test("executeCommand routes presentation/theme-family commands to the presentation executor", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "SET_CANVAS_FORMAT",
    format: "4:3",
  });
  assert.equal(result.ok, true);
  assert.equal(result.deck.canvas?.format, "4:3");
});

test("executeCommand routes background-family commands to the background executor", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "SET_SLIDE_ACCENT",
    slideId: "s2",
    accent: "#123456",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.deck.slides[1]!.designOverrides?.accent, {
    value: "#123456",
  });
});

test("executeCommand routes source-ref-family commands to the source-ref executor", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "REMOVE_SOURCE_ELEMENT",
    slideId: "s1",
    elementId: "e1",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.deck.slides[0]!.elements, []);
});

test("executeCommand propagates missing-target failures unchanged across families", () => {
  const deck = twoSlideDeck();
  const cases: SlideCommand[] = [
    { type: "UPDATE_SLIDE_TITLE", slideId: "missing", title: "x" },
    { type: "RENAME_ELEMENT", slideId: "s1", elementId: "missing", name: "x" },
    { type: "SET_SLIDE_MASTER", slideId: "missing", masterId: undefined },
    { type: "SET_SLIDE_ACCENT", slideId: "missing", accent: "#000" },
    { type: "REMOVE_SOURCE_ELEMENT", slideId: "missing", elementId: "e1" },
  ];
  for (const cmd of cases) {
    const result = executeCommand(deck, cmd);
    assert.equal(result.ok, false, `${cmd.type} should fail`);
    assert.equal(result.deck, deck, `${cmd.type} should not mutate the deck`);
  }
});

// ---------------------------------------------------------------------------
// coalesceCommands
// ---------------------------------------------------------------------------

test("coalesceCommands returns the input unchanged when empty", () => {
  const history: SlideCommand[] = [];
  assert.equal(coalesceCommands(history), history);
});

test("coalesceCommands merges adjacent commands sharing type, slideId, and coalesceKey", () => {
  const history: SlideCommand[] = [
    { type: "UPDATE_SLIDE_TITLE", slideId: "s1", title: "A", coalesceKey: "k" },
    { type: "UPDATE_SLIDE_TITLE", slideId: "s1", title: "B", coalesceKey: "k" },
    { type: "UPDATE_SLIDE_TITLE", slideId: "s1", title: "C", coalesceKey: "k" },
  ];
  const merged = coalesceCommands(history);
  assert.equal(merged.length, 1);
  assert.equal((merged[0] as { title: string }).title, "C");
});

test("coalesceCommands does not merge commands with different coalesceKeys or slide ids", () => {
  const history: SlideCommand[] = [
    {
      type: "UPDATE_SLIDE_TITLE",
      slideId: "s1",
      title: "A",
      coalesceKey: "k1",
    },
    {
      type: "UPDATE_SLIDE_TITLE",
      slideId: "s1",
      title: "B",
      coalesceKey: "k2",
    },
    {
      type: "UPDATE_SLIDE_TITLE",
      slideId: "s2",
      title: "C",
      coalesceKey: "k2",
    },
  ];
  const merged = coalesceCommands(history);
  assert.equal(merged.length, 3);
});

test("coalesceCommands passes through commands without a coalesceKey unchanged", () => {
  const history: SlideCommand[] = [
    { type: "REMOVE_SLIDE", slideId: "s1" },
    { type: "REMOVE_SLIDE", slideId: "s2" },
  ];
  const merged = coalesceCommands(history);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged, history);
});

// ---------------------------------------------------------------------------
// applyPatch
// ---------------------------------------------------------------------------

test("applyPatch replays presentation.set_theme from deckFields", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "SET_PRESENTATION_THEME",
    themeId: "indigo",
  });
  const replayed = applyPatch(deck, result.patches[0]!);
  assert.equal(replayed?.design?.themeId, "indigo");
});

test("applyPatch replays canvas.set_format from deckFields", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "SET_CANVAS_FORMAT",
    format: "16:9",
  });
  const replayed = applyPatch(deck, result.patches[0]!);
  assert.equal(replayed?.canvas?.format, "16:9");
});

test("applyPatch replays slide.update_title from slideFields", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "UPDATE_SLIDE_TITLE",
    slideId: "s1",
    title: "Replayed title",
  });
  const replayed = applyPatch(deck, result.patches[0]!);
  assert.equal(replayed?.slides[0]!.title, "Replayed title");
});

test("applyPatch replays element.update from elementFields", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "UPDATE_ELEMENT",
    slideId: "s1",
    elementId: "e1",
    patch: { locked: true },
  });
  const replayed = applyPatch(deck, result.patches[0]!);
  assert.equal(replayed?.slides[0]!.elements![0]!.locked, true);
});

test("applyPatch returns null for element ops with no self-contained payload (e.g. rename)", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "RENAME_ELEMENT",
    slideId: "s1",
    elementId: "e1",
    name: "Renamed",
  });
  assert.equal(result.ok, true);
  assert.equal(applyPatch(deck, result.patches[0]!), null);
});

test("applyPatch returns null for ops that cannot be replayed from the patch payload alone", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, { type: "ADD_SLIDE" });
  assert.equal(applyPatch(deck, result.patches[0]!), null);
});

test("applyPatch returns null when required payload fields are missing", () => {
  const deck = twoSlideDeck();
  const incompletePatch = {
    schemaVersion: 6,
    op: "presentation.set_theme" as const,
    slideIds: [],
    elementIds: [],
    // deckFields.design.themeId intentionally omitted
  };
  assert.equal(applyPatch(deck, incompletePatch), null);
});

test("applyPatch returns null when the target slide no longer exists", () => {
  const deck = twoSlideDeck();
  const result = executeCommand(deck, {
    type: "UPDATE_SLIDE_TITLE",
    slideId: "s1",
    title: "x",
  });
  const deckWithoutSlide = makeDeck([makeSlide({ id: "different" })]);
  assert.equal(applyPatch(deckWithoutSlide, result.patches[0]!), null);
});

// ---------------------------------------------------------------------------
// commitCommand
// ---------------------------------------------------------------------------

test("commitCommand exposes coalesceKey via commitOptions when historyKey is set", () => {
  const deck = twoSlideDeck();
  const { result, commitOptions, affectedSlideIds, patches } = commitCommand(
    deck,
    { type: "UPDATE_SLIDE_TITLE", slideId: "s1", title: "x", coalesceKey: "k" },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(commitOptions, { coalesceKey: "k" });
  assert.deepEqual(affectedSlideIds, ["s1"]);
  assert.equal(patches.length, 1);
});

test("commitCommand leaves commitOptions undefined when no historyKey is present", () => {
  const deck = twoSlideDeck();
  const { result, commitOptions } = commitCommand(deck, {
    type: "REMOVE_SLIDE",
    slideId: "s2",
  });
  assert.equal(result.ok, true);
  assert.equal(commitOptions, undefined);
});

test("commitCommand forwards affectedElementIds and a failing result untouched", () => {
  const deck = twoSlideDeck();
  const { result, affectedElementIds, affectedSlideIds } = commitCommand(deck, {
    type: "RENAME_ELEMENT",
    slideId: "s1",
    elementId: "missing",
    name: "x",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(affectedElementIds, []);
  assert.deepEqual(affectedSlideIds, []);
  assert.equal(result.deck, deck);
});
