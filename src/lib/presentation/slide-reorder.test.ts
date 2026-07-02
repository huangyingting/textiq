import assert from "node:assert/strict";
import { test } from "node:test";

import {
  reorderTargetIndex,
  reorderTargetIndexForDraggedItem,
  slideReorderKeyDirection,
  type RailItemExtent,
} from "./slide-reorder";

// A simple vertical rail of three 100px-tall thumbnails stacked from y=0.
const VERTICAL: RailItemExtent[] = [
  { start: 0, end: 100 },
  { start: 100, end: 200 },
  { start: 200, end: 300 },
];

test("reorderTargetIndex: empty list returns 0 (defensive)", () => {
  assert.equal(reorderTargetIndex(123, []), 0);
});

test("reorderTargetIndex: pointer before the first midpoint targets index 0", () => {
  assert.equal(reorderTargetIndex(10, VERTICAL), 0);
  assert.equal(reorderTargetIndex(49, VERTICAL), 0);
});

test("reorderTargetIndex: crossing a midpoint advances the target", () => {
  // 50 is the first item's midpoint → still flips to the next item.
  assert.equal(reorderTargetIndex(50, VERTICAL), 1);
  assert.equal(reorderTargetIndex(120, VERTICAL), 1);
});

test("reorderTargetIndex: middle item resolves around its midpoint", () => {
  assert.equal(reorderTargetIndex(149, VERTICAL), 1);
  assert.equal(reorderTargetIndex(150, VERTICAL), 2);
});

test("reorderTargetIndex: pointer past the last midpoint targets the last index", () => {
  assert.equal(reorderTargetIndex(260, VERTICAL), 2);
});

test("reorderTargetIndex: pointer beyond the rail clamps to the last index", () => {
  assert.equal(reorderTargetIndex(9999, VERTICAL), 2);
});

test("reorderTargetIndex: pointer before the rail clamps to index 0", () => {
  assert.equal(reorderTargetIndex(-50, VERTICAL), 0);
});

test("reorderTargetIndex: works for a horizontal strip (axis-agnostic)", () => {
  const horizontal: RailItemExtent[] = [
    { start: 0, end: 160 },
    { start: 160, end: 320 },
  ];
  assert.equal(reorderTargetIndex(40, horizontal), 0);
  assert.equal(reorderTargetIndex(80, horizontal), 1);
  assert.equal(reorderTargetIndex(300, horizontal), 1);
});

test("reorderTargetIndex: single item always targets index 0", () => {
  const one: RailItemExtent[] = [{ start: 0, end: 100 }];
  assert.equal(reorderTargetIndex(-10, one), 0);
  assert.equal(reorderTargetIndex(500, one), 0);
});

test("reorderTargetIndexForDraggedItem resolves from the dragged item's center", () => {
  assert.equal(
    reorderTargetIndexForDraggedItem({
      fromIndex: 1,
      pointerMain: 190,
      pointerCross: 20,
      itemMainOffset: 90,
      itemMainSize: 100,
      items: VERTICAL,
      crossStart: 0,
      crossEnd: 120,
    }),
    1,
  );
});

test("reorderTargetIndexForDraggedItem moves forward and then back across remaining siblings", () => {
  const base = {
    fromIndex: 1,
    pointerCross: 20,
    itemMainOffset: 50,
    itemMainSize: 100,
    items: VERTICAL,
    crossStart: 0,
    crossEnd: 120,
  };
  assert.equal(
    reorderTargetIndexForDraggedItem({ ...base, pointerMain: 260 }),
    2,
  );
  assert.equal(
    reorderTargetIndexForDraggedItem({ ...base, pointerMain: 160 }),
    1,
  );
});

test("reorderTargetIndexForDraggedItem moves backward and then back across remaining siblings", () => {
  const base = {
    fromIndex: 1,
    pointerCross: 20,
    itemMainOffset: 50,
    itemMainSize: 100,
    items: VERTICAL,
    crossStart: 0,
    crossEnd: 120,
  };
  assert.equal(
    reorderTargetIndexForDraggedItem({ ...base, pointerMain: 40 }),
    0,
  );
  assert.equal(
    reorderTargetIndexForDraggedItem({ ...base, pointerMain: 160 }),
    1,
  );
});

test("reorderTargetIndexForDraggedItem cancels when pointer leaves the rail cross-axis", () => {
  assert.equal(
    reorderTargetIndexForDraggedItem({
      fromIndex: 1,
      pointerMain: 260,
      pointerCross: 500,
      itemMainOffset: 50,
      itemMainSize: 100,
      items: VERTICAL,
      crossStart: 0,
      crossEnd: 120,
      crossTolerance: 48,
    }),
    null,
  );
});

test("slideReorderKeyDirection: Alt+Arrow nudges, plain arrows do not", () => {
  assert.equal(slideReorderKeyDirection("ArrowUp", true), -1);
  assert.equal(slideReorderKeyDirection("ArrowLeft", true), -1);
  assert.equal(slideReorderKeyDirection("ArrowDown", true), 1);
  assert.equal(slideReorderKeyDirection("ArrowRight", true), 1);
  assert.equal(slideReorderKeyDirection("ArrowUp", false), null);
  assert.equal(slideReorderKeyDirection("Enter", true), null);
});
