import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConnectorElement } from "./deck-elements";
import {
  DUPLICATE_ELEMENT_OFFSET_PCT,
  addElement,
  bringElementToFront,
  duplicateElement,
  duplicateElements,
  groupElements,
  nudgeElements,
  removeElement,
  removeElements,
  sendElementToBack,
  setElementBoxes,
  setElementPatches,
  ungroupElements,
  updateElement,
} from "./deck-mutation-elements";
import {
  makeConnector,
  makeDeck,
  makeShape,
  makeSlide,
} from "./deck-mutation-test-fixtures";

// ---------------------------------------------------------------------------
// addElement
// ---------------------------------------------------------------------------

test("addElement appends an element with a generated id and next zIndex", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("el-1", { zIndex: 3 })] }),
  ]);
  const result = addElement(deck, 0, {
    kind: "shape",
    box: { x: 0, y: 0, w: 10, h: 10 },
    content: { kind: "shape", shape: "circle" },
  });
  const elements = result.slides[0]!.elements!;
  assert.equal(elements.length, 2);
  assert.equal(elements[1]!.zIndex, 4);
  assert.ok(elements[1]!.id.length > 0);
});

test("addElement honors an explicit id and zIndex", () => {
  const deck = makeDeck([makeSlide({ elements: [] })]);
  const result = addElement(deck, 0, {
    id: "el-fixed",
    kind: "shape",
    box: { x: 0, y: 0, w: 10, h: 10 },
    content: { kind: "shape", shape: "rect" },
    zIndex: 42,
  });
  const [element] = result.slides[0]!.elements!;
  assert.equal(element!.id, "el-fixed");
  assert.equal(element!.zIndex, 42);
});

test("addElement is a no-op for an out-of-range slide index", () => {
  const deck = makeDeck([makeSlide()]);
  assert.equal(
    addElement(deck, 5, {
      kind: "shape",
      box: { x: 0, y: 0, w: 10, h: 10 },
      content: { kind: "shape", shape: "rect" },
    }),
    deck,
  );
});

// ---------------------------------------------------------------------------
// updateElement
// ---------------------------------------------------------------------------

test("updateElement patches a matching element without touching id or kind", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = updateElement(deck, 0, "el-1", {
    box: { x: 5, y: 5, w: 5, h: 5 },
    locked: true,
  });
  const element = result.slides[0]!.elements![0]!;
  assert.equal(element.id, "el-1");
  assert.equal(element.kind, "shape");
  assert.deepEqual(element.box, { x: 5, y: 5, w: 5, h: 5 });
  assert.equal(element.locked, true);
});

test("updateElement leaves the slide unaffected when the id is missing", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = updateElement(deck, 0, "missing", { locked: true });
  assert.deepEqual(result.slides[0]!.elements, deck.slides[0]!.elements);
});

test("updateElement is a no-op when the slide has no elements array", () => {
  const deck = makeDeck([makeSlide({ elements: undefined })]);
  const result = updateElement(deck, 0, "el-1", { locked: true });
  assert.equal(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// duplicateElement
// ---------------------------------------------------------------------------

test("duplicateElement clones the element with a fresh id, top zIndex, and offset box", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [makeShape("el-1", { box: { x: 10, y: 10, w: 20, h: 20 } })],
    }),
  ]);
  const { deck: result, newElementId } = duplicateElement(deck, 0, "el-1");
  assert.ok(newElementId);
  const elements = result.slides[0]!.elements!;
  assert.equal(elements.length, 2);
  const copy = elements[1]!;
  assert.equal(copy.id, newElementId);
  assert.equal(copy.zIndex, 1);
  assert.deepEqual(copy.box, {
    x: 10 + DUPLICATE_ELEMENT_OFFSET_PCT,
    y: 10 + DUPLICATE_ELEMENT_OFFSET_PCT,
    w: 20,
    h: 20,
  });
});

test("duplicateElement clamps the offset box within the slide bounds", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [makeShape("el-1", { box: { x: 99, y: 99, w: 20, h: 20 } })],
    }),
  ]);
  const { deck: result } = duplicateElement(deck, 0, "el-1");
  const copy = result.slides[0]!.elements![1]!;
  assert.equal(copy.box.x, 80);
  assert.equal(copy.box.y, 80);
});

test("duplicateElement clears groupId on the lone copy", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("el-1", { groupId: "g1" })] }),
  ]);
  const { deck: result } = duplicateElement(deck, 0, "el-1");
  const copy = result.slides[0]!.elements![1]!;
  assert.ok(!("groupId" in copy));
});

test("duplicateElement detaches a copied connector's endpoint when the bound shape isn't duplicated", () => {
  const shape = makeShape("shape-1", { box: { x: 0, y: 0, w: 10, h: 10 } });
  const connector = makeConnector(
    "conn-1",
    { elementId: "shape-1", anchor: "center" },
    { x: 90, y: 90 },
  );
  const deck = makeDeck([makeSlide({ elements: [shape, connector] })]);
  const { deck: result } = duplicateElement(deck, 0, "conn-1");
  const copy = result.slides[0]!.elements!.at(-1) as ConnectorElement;
  assert.deepEqual(copy.content.start, { x: 5, y: 5 });
});

test("duplicateElement is a no-op when the element id is missing", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = duplicateElement(deck, 0, "missing");
  assert.equal(result.deck, deck);
  assert.equal(result.newElementId, null);
});

test("duplicateElement is a no-op for an out-of-range index", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = duplicateElement(deck, 9, "el-1");
  assert.equal(result.deck, deck);
  assert.equal(result.newElementId, null);
});

test("duplicateElement is a no-op when the slide has no elements array", () => {
  const deck = makeDeck([makeSlide({ elements: undefined })]);
  const result = duplicateElement(deck, 0, "el-1");
  assert.equal(result.deck, deck);
  assert.equal(result.newElementId, null);
});

// ---------------------------------------------------------------------------
// duplicateElements
// ---------------------------------------------------------------------------

test("duplicateElements clones every selected element with sequential top zIndexes", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("el-1", { zIndex: 0 }),
        makeShape("el-2", { zIndex: 1 }),
      ],
    }),
  ]);
  const { deck: result, newElementIds } = duplicateElements(deck, 0, [
    "el-1",
    "el-2",
  ]);
  assert.equal(newElementIds.length, 2);
  const elements = result.slides[0]!.elements!;
  assert.equal(elements.length, 4);
  assert.equal(elements[2]!.zIndex, 2);
  assert.equal(elements[3]!.zIndex, 3);
});

test("duplicateElements keeps a shared fresh groupId when every group member is selected", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("el-1", { groupId: "g1" }),
        makeShape("el-2", { groupId: "g1" }),
      ],
    }),
  ]);
  const { deck: result } = duplicateElements(deck, 0, ["el-1", "el-2"]);
  const elements = result.slides[0]!.elements!;
  const copyA = elements[2] as { groupId?: string };
  const copyB = elements[3] as { groupId?: string };
  assert.ok(copyA.groupId);
  assert.equal(copyA.groupId, copyB.groupId);
  assert.notEqual(copyA.groupId, "g1");
});

test("duplicateElements dissolves groupId on a partial group copy", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("el-1", { groupId: "g1" }),
        makeShape("el-2", { groupId: "g1" }),
      ],
    }),
  ]);
  const { deck: result } = duplicateElements(deck, 0, ["el-1"]);
  const copy = result.slides[0]!.elements![2] as { groupId?: string };
  assert.ok(!("groupId" in copy));
});

test("duplicateElements is a no-op for an empty selection", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = duplicateElements(deck, 0, []);
  assert.equal(result.deck, deck);
  assert.deepEqual(result.newElementIds, []);
});

test("duplicateElements is a no-op when no selected id is present on the slide", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = duplicateElements(deck, 0, ["missing"]);
  assert.equal(result.deck, deck);
  assert.deepEqual(result.newElementIds, []);
});

test("duplicateElements is a no-op for an out-of-range index", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = duplicateElements(deck, 9, ["el-1"]);
  assert.equal(result.deck, deck);
});

// ---------------------------------------------------------------------------
// removeElement
// ---------------------------------------------------------------------------

test("removeElement removes the matching element", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("el-1"), makeShape("el-2")] }),
  ]);
  const result = removeElement(deck, 0, "el-1");
  assert.deepEqual(
    result.slides[0]!.elements!.map((e) => e.id),
    ["el-2"],
  );
});

test("removeElement detaches a connector endpoint bound to the removed element", () => {
  const shape = makeShape("shape-1", { box: { x: 0, y: 0, w: 10, h: 10 } });
  const connector = makeConnector(
    "conn-1",
    { elementId: "shape-1", anchor: "center" },
    { x: 90, y: 90 },
  );
  const deck = makeDeck([makeSlide({ elements: [shape, connector] })]);
  const result = removeElement(deck, 0, "shape-1");
  const remaining = result.slides[0]!.elements as ConnectorElement[];
  assert.equal(remaining.length, 1);
  assert.deepEqual(remaining[0]!.content.start, { x: 5, y: 5 });
});

test("removeElement is a no-op when the id is missing", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = removeElement(deck, 0, "missing");
  assert.deepEqual(
    result.slides[0]!.elements!.map((e) => e.id),
    ["el-1"],
  );
});

test("removeElement is a no-op when the slide has no elements array", () => {
  const deck = makeDeck([makeSlide({ elements: undefined })]);
  const result = removeElement(deck, 0, "el-1");
  assert.equal(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// removeElements
// ---------------------------------------------------------------------------

test("removeElements removes every selected element in one mutation", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [makeShape("el-1"), makeShape("el-2"), makeShape("el-3")],
    }),
  ]);
  const result = removeElements(deck, 0, ["el-1", "el-3"]);
  assert.deepEqual(
    result.slides[0]!.elements!.map((e) => e.id),
    ["el-2"],
  );
});

test("removeElements is a no-op for an empty selection and returns the same deck", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  assert.equal(removeElements(deck, 0, []), deck);
});

test("removeElements returns the same slide reference when no selected id is present", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const result = removeElements(deck, 0, ["missing"]);
  assert.equal(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// nudgeElements
// ---------------------------------------------------------------------------

test("nudgeElements shifts every selected element's box by dx/dy", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [makeShape("el-1", { box: { x: 10, y: 10, w: 20, h: 20 } })],
    }),
  ]);
  const result = nudgeElements(deck, 0, ["el-1"], 5, -3);
  assert.deepEqual(result.slides[0]!.elements![0]!.box, {
    x: 15,
    y: 7,
    w: 20,
    h: 20,
  });
});

test("nudgeElements clamps the box within the [0, 100 - size] slide bounds", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [makeShape("el-1", { box: { x: 1, y: 95, w: 20, h: 20 } })],
    }),
  ]);
  const result = nudgeElements(deck, 0, ["el-1"], -10, 10);
  const box = result.slides[0]!.elements![0]!.box;
  assert.equal(box.x, 0);
  assert.equal(box.y, 80);
});

test("nudgeElements is a no-op for an empty selection", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  assert.equal(nudgeElements(deck, 0, [], 5, 5), deck);
});

test("nudgeElements is a no-op when dx and dy are both 0", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  assert.equal(nudgeElements(deck, 0, ["el-1"], 0, 0), deck);
});

test("nudgeElements leaves unselected elements untouched", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("el-1", { box: { x: 10, y: 10, w: 10, h: 10 } }),
        makeShape("el-2", { box: { x: 50, y: 50, w: 10, h: 10 } }),
      ],
    }),
  ]);
  const result = nudgeElements(deck, 0, ["el-1"], 1, 1);
  assert.deepEqual(result.slides[0]!.elements![1]!.box, {
    x: 50,
    y: 50,
    w: 10,
    h: 10,
  });
});

// ---------------------------------------------------------------------------
// bringElementToFront / sendElementToBack
// ---------------------------------------------------------------------------

test("bringElementToFront raises the element above the current maximum zIndex", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("el-1", { zIndex: 0 }),
        makeShape("el-2", { zIndex: 5 }),
      ],
    }),
  ]);
  const result = bringElementToFront(deck, 0, "el-1");
  assert.equal(result.slides[0]!.elements![0]!.zIndex, 6);
});

test("sendElementToBack lowers the element beneath the current minimum zIndex", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("el-1", { zIndex: 0 }),
        makeShape("el-2", { zIndex: 5 }),
      ],
    }),
  ]);
  const result = sendElementToBack(deck, 0, "el-2");
  assert.equal(result.slides[0]!.elements![1]!.zIndex, -1);
});

// ---------------------------------------------------------------------------
// setElementBoxes / setElementPatches
// ---------------------------------------------------------------------------

test("setElementBoxes only updates the boxes named in boxesById", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [makeShape("el-1"), makeShape("el-2")],
    }),
  ]);
  const box = { x: 1, y: 2, w: 3, h: 4 };
  const result = setElementBoxes(deck, 0, { "el-1": box });
  assert.deepEqual(result.slides[0]!.elements![0]!.box, box);
  assert.deepEqual(result.slides[0]!.elements![1]!.box, {
    x: 10,
    y: 10,
    w: 20,
    h: 20,
  });
});

test("setElementPatches applies per-element patches while preserving id/kind", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("el-1"), makeShape("el-2")] }),
  ]);
  const result = setElementPatches(deck, 0, {
    "el-1": { rotation: 45, id: "hacked", kind: "text" } as never,
  });
  const patched = result.slides[0]!.elements![0]!;
  assert.equal(patched.id, "el-1");
  assert.equal(patched.kind, "shape");
  assert.equal(patched.rotation, 45);
});

// ---------------------------------------------------------------------------
// groupElements / ungroupElements
// ---------------------------------------------------------------------------

test("groupElements assigns a fresh shared groupId to the given ids", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("el-1"), makeShape("el-2")] }),
  ]);
  const { deck: result, groupId } = groupElements(deck, 0, ["el-1", "el-2"]);
  assert.ok(groupId);
  assert.equal(result.slides[0]!.elements![0]!.groupId, groupId);
  assert.equal(result.slides[0]!.elements![1]!.groupId, groupId);
});

test("groupElements is a no-op for an empty id list but still returns a groupId", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const { deck: result, groupId } = groupElements(deck, 0, []);
  assert.equal(result, deck);
  assert.ok(groupId);
});

test("groupElements leaves the slide unchanged when no id is present", () => {
  const deck = makeDeck([makeSlide({ elements: [makeShape("el-1")] })]);
  const { deck: result } = groupElements(deck, 0, ["missing"]);
  assert.equal(result.slides[0], deck.slides[0]);
});

test("ungroupElements clears the groupId from every member", () => {
  const deck = makeDeck([
    makeSlide({
      elements: [
        makeShape("el-1", { groupId: "g1" }),
        makeShape("el-2", { groupId: "g1" }),
      ],
    }),
  ]);
  const result = ungroupElements(deck, 0, "g1");
  assert.ok(!("groupId" in result.slides[0]!.elements![0]!));
  assert.ok(!("groupId" in result.slides[0]!.elements![1]!));
});

test("ungroupElements is a no-op when the groupId is not present on the slide", () => {
  const deck = makeDeck([
    makeSlide({ elements: [makeShape("el-1", { groupId: "g1" })] }),
  ]);
  const result = ungroupElements(deck, 0, "missing-group");
  assert.equal(result.slides[0], deck.slides[0]);
});
