import assert from "node:assert/strict";
import { test } from "node:test";

import { executeSourceRefFamilyCommand } from "./slide-command-source-ref-executor";
import { makeDeck, makeSlide } from "./deck-mutation-test-fixtures";
import type {
  RemoveSourceElementCommand,
  UpdateElementSourceCommand,
} from "./slide-command-contracts";
import type { SourceRef } from "./deck-source-refs";
import type { ShapeElement, TextElement } from "./deck-elements";

const SOURCE_A: SourceRef = {
  documentId: "doc-1",
  blockId: "block-1",
  blockKind: "text",
  linkedAt: "2026-01-01T00:00:00.000Z",
};

const SOURCE_B: SourceRef = {
  documentId: "doc-1",
  blockId: "block-2",
  blockKind: "text",
  linkedAt: "2026-01-02T00:00:00.000Z",
};

function shapeWithSource(id: string, source?: SourceRef): ShapeElement {
  return {
    id,
    kind: "shape",
    box: { x: 10, y: 10, w: 20, h: 20 },
    zIndex: 0,
    content: { kind: "shape", shape: "rect" },
    ...(source !== undefined ? { source } : {}),
  } as ShapeElement;
}

function textWithSource(
  id: string,
  text: string,
  source?: SourceRef,
): TextElement {
  return {
    id,
    kind: "text",
    box: { x: 10, y: 10, w: 20, h: 20 },
    zIndex: 0,
    content: { kind: "text", text, paragraphs: [{ text }] },
    ...(source !== undefined ? { source } : {}),
  } as TextElement;
}

// ---------------------------------------------------------------------------
// UPDATE_ELEMENT_SOURCE
// ---------------------------------------------------------------------------

test("UPDATE_ELEMENT_SOURCE relinks to a new active source ref", () => {
  const deck = makeDeck([
    makeSlide({ id: "s1", elements: [shapeWithSource("e1", SOURCE_A)] }),
  ]);
  const cmd: UpdateElementSourceCommand = {
    type: "UPDATE_ELEMENT_SOURCE",
    slideId: "s1",
    elementId: "e1",
    source: SOURCE_B,
  };
  const result = executeSourceRefFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  const element = result.deck.slides[0]!.elements![0] as ShapeElement & {
    source: SourceRef;
  };
  assert.deepEqual(element.source, SOURCE_B);
  assert.deepEqual(result.affectedElementIds, ["e1"]);
  assert.equal(result.patches[0]!.op, "element.update");
});

test("UPDATE_ELEMENT_SOURCE unlinks the current source when unlink is true", () => {
  const deck = makeDeck([
    makeSlide({ id: "s1", elements: [shapeWithSource("e1", SOURCE_A)] }),
  ]);
  const cmd: UpdateElementSourceCommand = {
    type: "UPDATE_ELEMENT_SOURCE",
    slideId: "s1",
    elementId: "e1",
    unlink: true,
  };
  const result = executeSourceRefFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  const element = result.deck.slides[0]!.elements![0] as ShapeElement & {
    source: SourceRef;
  };
  assert.equal(element.source.unlinked, true);
  assert.equal(element.source.blockId, SOURCE_A.blockId);
});

test("UPDATE_ELEMENT_SOURCE updates text content and runs alongside the source patch", () => {
  const deck = makeDeck([
    makeSlide({
      id: "s1",
      elements: [textWithSource("e1", "Original", SOURCE_A)],
    }),
  ]);
  const cmd: UpdateElementSourceCommand = {
    type: "UPDATE_ELEMENT_SOURCE",
    slideId: "s1",
    elementId: "e1",
    text: "Refreshed text",
    runs: [{ text: "Refreshed text", bold: true }],
  };
  const result = executeSourceRefFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  const element = result.deck.slides[0]!.elements![0] as TextElement;
  assert.equal(element.content.text, "Refreshed text");
  assert.deepEqual(element.content.paragraphs, [
    {
      text: "Refreshed text",
      runs: [{ text: "Refreshed text", bold: true }],
    },
  ]);
});

test("UPDATE_ELEMENT_SOURCE fails for a missing slide", () => {
  const deck = makeDeck([makeSlide({ id: "s1" })]);
  const result = executeSourceRefFamilyCommand(deck, {
    type: "UPDATE_ELEMENT_SOURCE",
    slideId: "missing",
    elementId: "e1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

test("UPDATE_ELEMENT_SOURCE fails for a missing element", () => {
  const deck = makeDeck([makeSlide({ id: "s1", elements: [] })]);
  const result = executeSourceRefFamilyCommand(deck, {
    type: "UPDATE_ELEMENT_SOURCE",
    slideId: "s1",
    elementId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Element not found: missing");
});

test("UPDATE_ELEMENT_SOURCE fails when the element has no existing source link", () => {
  const deck = makeDeck([
    makeSlide({ id: "s1", elements: [shapeWithSource("e1")] }),
  ]);
  const result = executeSourceRefFamilyCommand(deck, {
    type: "UPDATE_ELEMENT_SOURCE",
    slideId: "s1",
    elementId: "e1",
    source: SOURCE_B,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Element has no source link: e1");
});

// ---------------------------------------------------------------------------
// REMOVE_SOURCE_ELEMENT
// ---------------------------------------------------------------------------

test("REMOVE_SOURCE_ELEMENT removes the element from the slide", () => {
  const deck = makeDeck([
    makeSlide({
      id: "s1",
      elements: [shapeWithSource("e1", SOURCE_A), shapeWithSource("e2")],
    }),
  ]);
  const cmd: RemoveSourceElementCommand = {
    type: "REMOVE_SOURCE_ELEMENT",
    slideId: "s1",
    elementId: "e1",
  };
  const result = executeSourceRefFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.deck.slides[0]!.elements!.map((e) => e.id),
    ["e2"],
  );
  assert.deepEqual(result.patches[0]!.removedIds, ["e1"]);
});

test("REMOVE_SOURCE_ELEMENT fails for a missing slide", () => {
  const deck = makeDeck([makeSlide({ id: "s1" })]);
  const result = executeSourceRefFamilyCommand(deck, {
    type: "REMOVE_SOURCE_ELEMENT",
    slideId: "missing",
    elementId: "e1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

test("REMOVE_SOURCE_ELEMENT fails for a missing element and leaves the deck untouched", () => {
  const deck = makeDeck([
    makeSlide({ id: "s1", elements: [shapeWithSource("e1", SOURCE_A)] }),
  ]);
  const result = executeSourceRefFamilyCommand(deck, {
    type: "REMOVE_SOURCE_ELEMENT",
    slideId: "s1",
    elementId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Element not found: missing");
  assert.equal(result.deck, deck);
});
