import assert from "node:assert/strict";
import { test } from "node:test";

import { executeElementFamilyCommand } from "./slide-command-element-executor";
import { makeDeck, makeShape, makeSlide } from "./deck-mutation-test-fixtures";
import type {
  AddElementCommand,
  AlignElementsCommand,
  ArrangeElementsCommand,
  BringElementToFrontCommand,
  DistributeElementsCommand,
  DuplicateElementCommand,
  DuplicateElementsCommand,
  GroupElementsCommand,
  MatchSizeElementsCommand,
  MoveElementZOrderCommand,
  NudgeElementsCommand,
  RemoveElementCommand,
  RemoveElementsCommand,
  RenameElementCommand,
  ReorderElementCommand,
  SendElementToBackCommand,
  SetElementBoxesCommand,
  SetElementHiddenCommand,
  SetElementLockedCommand,
  SetElementPatchesCommand,
  UngroupElementsCommand,
  UpdateElementCommand,
  UpdateElementContentCommand,
  UpdateElementDesignOverridesCommand,
} from "./slide-command-contracts";

function slideWithTwoShapes() {
  return makeDeck([
    makeSlide({
      id: "s1",
      elements: [
        makeShape("e1", { box: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 0 }),
        makeShape("e2", { box: { x: 20, y: 0, w: 10, h: 10 }, zIndex: 1 }),
      ],
    }),
  ]);
}

function slideWithThreeShapes() {
  return makeDeck([
    makeSlide({
      id: "s1",
      elements: [
        makeShape("e1", { box: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 0 }),
        makeShape("e2", { box: { x: 20, y: 0, w: 10, h: 10 }, zIndex: 1 }),
        makeShape("e3", { box: { x: 40, y: 0, w: 10, h: 10 }, zIndex: 2 }),
      ],
    }),
  ]);
}

// ---------------------------------------------------------------------------
// ADD_ELEMENT
// ---------------------------------------------------------------------------

test("ADD_ELEMENT appends a new element and reports its generated id", () => {
  const deck = makeDeck([makeSlide({ id: "s1", elements: [] })]);
  const cmd: AddElementCommand = {
    type: "ADD_ELEMENT",
    slideId: "s1",
    element: {
      kind: "shape",
      box: { x: 0, y: 0, w: 10, h: 10 },
      content: { kind: "shape", shape: "rect" },
    },
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements!.length, 1);
  assert.equal(result.affectedElementIds.length, 1);
  assert.deepEqual(result.patches[0]!.addedIds, result.affectedElementIds);
});

test("ADD_ELEMENT fails for a missing slide", () => {
  const deck = makeDeck([makeSlide({ id: "s1" })]);
  const result = executeElementFamilyCommand(deck, {
    type: "ADD_ELEMENT",
    slideId: "missing",
    element: {
      kind: "shape",
      box: { x: 0, y: 0, w: 10, h: 10 },
      content: { kind: "shape", shape: "rect" },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

// ---------------------------------------------------------------------------
// UPDATE_ELEMENT / UPDATE_ELEMENT_CONTENT / UPDATE_ELEMENT_DESIGN_OVERRIDES
// ---------------------------------------------------------------------------

test("UPDATE_ELEMENT patches the element and forwards the coalesce key", () => {
  const deck = slideWithTwoShapes();
  const cmd: UpdateElementCommand = {
    type: "UPDATE_ELEMENT",
    slideId: "s1",
    elementId: "e1",
    patch: { locked: true },
    coalesceKey: "drag:e1",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements![0]!.locked, true);
  assert.equal(result.historyKey, "drag:e1");
});

test("UPDATE_ELEMENT fails for a missing element on an existing slide", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "UPDATE_ELEMENT",
    slideId: "s1",
    elementId: "missing",
    patch: { locked: true },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Element not found: missing");
});

test("UPDATE_ELEMENT fails for a missing slide", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "UPDATE_ELEMENT",
    slideId: "missing",
    elementId: "e1",
    patch: { locked: true },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

test("UPDATE_ELEMENT_CONTENT patches content/role and emits an element.update_content patch", () => {
  const deck = slideWithTwoShapes();
  const cmd: UpdateElementContentCommand = {
    type: "UPDATE_ELEMENT_CONTENT",
    slideId: "s1",
    elementId: "e1",
    content: { kind: "shape", shape: "ellipse" },
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.patches[0]!.op, "element.update_content");
  assert.equal(
    (result.deck.slides[0]!.elements![0]!.content as { shape?: string }).shape,
    "ellipse",
  );
});

test("UPDATE_ELEMENT_CONTENT fails for a missing element", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "UPDATE_ELEMENT_CONTENT",
    slideId: "s1",
    elementId: "missing",
    content: { kind: "shape", shape: "ellipse" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Element not found: missing");
});

test("UPDATE_ELEMENT_DESIGN_OVERRIDES patches design overrides", () => {
  const deck = slideWithTwoShapes();
  const cmd: UpdateElementDesignOverridesCommand = {
    type: "UPDATE_ELEMENT_DESIGN_OVERRIDES",
    slideId: "s1",
    elementId: "e2",
    designOverrides: { opacity: 0.5 },
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.patches[0]!.op, "element.update_design_overrides");
  assert.deepEqual(result.deck.slides[0]!.elements![1]!.designOverrides, {
    opacity: 0.5,
  });
});

test("UPDATE_ELEMENT_DESIGN_OVERRIDES fails for a missing element", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "UPDATE_ELEMENT_DESIGN_OVERRIDES",
    slideId: "s1",
    elementId: "missing",
    designOverrides: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Element not found: missing");
});

// ---------------------------------------------------------------------------
// REMOVE_ELEMENT / REMOVE_ELEMENTS
// ---------------------------------------------------------------------------

test("REMOVE_ELEMENT removes the targeted element", () => {
  const deck = slideWithTwoShapes();
  const cmd: RemoveElementCommand = {
    type: "REMOVE_ELEMENT",
    slideId: "s1",
    elementId: "e1",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.deck.slides[0]!.elements!.map((e) => e.id),
    ["e2"],
  );
  assert.deepEqual(result.patches[0]!.removedIds, ["e1"]);
});

test("REMOVE_ELEMENT fails for a missing element", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "REMOVE_ELEMENT",
    slideId: "s1",
    elementId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Element not found: missing");
});

test("REMOVE_ELEMENTS rejects an empty elementIds array", () => {
  const deck = slideWithTwoShapes();
  const cmd: RemoveElementsCommand = {
    type: "REMOVE_ELEMENTS",
    slideId: "s1",
    elementIds: [],
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, false);
  assert.equal(result.error, "elementIds must not be empty");
});

test("REMOVE_ELEMENTS removes only the ids that exist and ignores unknown ones", () => {
  const deck = slideWithTwoShapes();
  const cmd: RemoveElementsCommand = {
    type: "REMOVE_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1", "unknown"],
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.affectedElementIds, ["e1"]);
  assert.deepEqual(
    result.deck.slides[0]!.elements!.map((e) => e.id),
    ["e2"],
  );
});

test("REMOVE_ELEMENTS fails when none of the element ids are found", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "REMOVE_ELEMENTS",
    slideId: "s1",
    elementIds: ["unknown-1", "unknown-2"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "None of the element ids were found");
});

// ---------------------------------------------------------------------------
// DUPLICATE_ELEMENT / DUPLICATE_ELEMENTS
// ---------------------------------------------------------------------------

test("DUPLICATE_ELEMENT clones the element and reports both ids", () => {
  const deck = slideWithTwoShapes();
  const cmd: DuplicateElementCommand = {
    type: "DUPLICATE_ELEMENT",
    slideId: "s1",
    elementId: "e1",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements!.length, 3);
  assert.equal(result.affectedElementIds[0], "e1");
  assert.deepEqual(result.patches[0]!.addedIds, [result.affectedElementIds[1]]);
});

test("DUPLICATE_ELEMENT fails for a missing element", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "DUPLICATE_ELEMENT",
    slideId: "s1",
    elementId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Element not found: missing");
});

test("DUPLICATE_ELEMENTS rejects an empty elementIds array", () => {
  const deck = slideWithTwoShapes();
  const cmd: DuplicateElementsCommand = {
    type: "DUPLICATE_ELEMENTS",
    slideId: "s1",
    elementIds: [],
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, false);
  assert.equal(result.error, "elementIds must not be empty");
});

test("DUPLICATE_ELEMENTS clones the requested elements", () => {
  const deck = slideWithTwoShapes();
  const cmd: DuplicateElementsCommand = {
    type: "DUPLICATE_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1", "e2"],
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements!.length, 4);
  assert.equal(result.affectedElementIds.length, 4);
});

test("DUPLICATE_ELEMENTS fails when none of the requested ids exist", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "DUPLICATE_ELEMENTS",
    slideId: "s1",
    elementIds: ["unknown"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Duplicate elements failed");
});

// ---------------------------------------------------------------------------
// NUDGE_ELEMENTS
// ---------------------------------------------------------------------------

test("NUDGE_ELEMENTS shifts the given elements' boxes and forwards the coalesce key", () => {
  const deck = slideWithTwoShapes();
  const cmd: NudgeElementsCommand = {
    type: "NUDGE_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1"],
    dx: 5,
    dy: 2,
    coalesceKey: "nudge:e1",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements![0]!.box.x, 5);
  assert.equal(result.deck.slides[0]!.elements![0]!.box.y, 2);
  assert.equal(result.historyKey, "nudge:e1");
});

test("NUDGE_ELEMENTS rejects an empty elementIds array", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "NUDGE_ELEMENTS",
    slideId: "s1",
    elementIds: [],
    dx: 1,
    dy: 1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "elementIds must not be empty");
});

// ---------------------------------------------------------------------------
// GROUP_ELEMENTS / UNGROUP_ELEMENTS
// ---------------------------------------------------------------------------

test("GROUP_ELEMENTS requires at least 2 element ids", () => {
  const deck = slideWithTwoShapes();
  const cmd: GroupElementsCommand = {
    type: "GROUP_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1"],
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, false);
  assert.equal(result.error, "GROUP_ELEMENTS requires at least 2 element ids");
});

test("GROUP_ELEMENTS assigns a shared groupId to the given elements", () => {
  const deck = slideWithTwoShapes();
  const cmd: GroupElementsCommand = {
    type: "GROUP_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1", "e2"],
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  const [first, second] = result.deck.slides[0]!.elements!;
  assert.ok(first!.groupId);
  assert.equal(first!.groupId, second!.groupId);
});

test("UNGROUP_ELEMENTS fails when the groupId has no members", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "UNGROUP_ELEMENTS",
    slideId: "s1",
    groupId: "missing-group",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Group not found: missing-group");
});

test("UNGROUP_ELEMENTS clears the groupId from every member", () => {
  const grouped = slideWithTwoShapes();
  const groupResult = executeElementFamilyCommand(grouped, {
    type: "GROUP_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1", "e2"],
  });
  const groupId = groupResult.deck.slides[0]!.elements![0]!.groupId!;
  const cmd: UngroupElementsCommand = {
    type: "UNGROUP_ELEMENTS",
    slideId: "s1",
    groupId,
  };
  const result = executeElementFamilyCommand(groupResult.deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.affectedElementIds.sort(), ["e1", "e2"]);
  assert.ok(
    result.deck.slides[0]!.elements!.every((e) => e.groupId === undefined),
  );
});

test("UNGROUP_ELEMENTS fails for a missing slide", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "UNGROUP_ELEMENTS",
    slideId: "missing",
    groupId: "g1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

// ---------------------------------------------------------------------------
// ALIGN_ELEMENTS / DISTRIBUTE_ELEMENTS / MATCH_SIZE_ELEMENTS / ARRANGE_ELEMENTS
// ---------------------------------------------------------------------------

test("ALIGN_ELEMENTS requires at least 2 element ids", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "ALIGN_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1"],
    mode: "left",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "ALIGN_ELEMENTS requires at least 2 element ids");
});

test("ALIGN_ELEMENTS aligns the given elements", () => {
  const deck = slideWithTwoShapes();
  const cmd: AlignElementsCommand = {
    type: "ALIGN_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1", "e2"],
    mode: "left",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements![0]!.box.x, 0);
  assert.equal(result.deck.slides[0]!.elements![1]!.box.x, 0);
  assert.equal(result.patches[0]!.op, "element.align");
});

test("DISTRIBUTE_ELEMENTS requires at least 3 element ids", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "DISTRIBUTE_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1", "e2"],
    mode: "horizontal",
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    "DISTRIBUTE_ELEMENTS requires at least 3 element ids",
  );
});

test("DISTRIBUTE_ELEMENTS distributes 3+ elements", () => {
  const deck = slideWithThreeShapes();
  const cmd: DistributeElementsCommand = {
    type: "DISTRIBUTE_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1", "e2", "e3"],
    mode: "horizontal",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.patches[0]!.op, "element.distribute");
});

test("MATCH_SIZE_ELEMENTS requires at least 2 element ids", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "MATCH_SIZE_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1"],
    mode: "width",
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    "MATCH_SIZE_ELEMENTS requires at least 2 element ids",
  );
});

test("MATCH_SIZE_ELEMENTS matches size across elements", () => {
  const deck = slideWithTwoShapes();
  const cmd: MatchSizeElementsCommand = {
    type: "MATCH_SIZE_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1", "e2"],
    mode: "width",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.patches[0]!.op, "element.match_size");
});

test("ARRANGE_ELEMENTS rejects an empty elementIds array", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "ARRANGE_ELEMENTS",
    slideId: "s1",
    elementIds: [],
    mode: "front",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "elementIds must not be empty");
});

test("ARRANGE_ELEMENTS rearranges the requested elements", () => {
  const deck = slideWithTwoShapes();
  const cmd: ArrangeElementsCommand = {
    type: "ARRANGE_ELEMENTS",
    slideId: "s1",
    elementIds: ["e1"],
    mode: "front",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.patches[0]!.op, "element.arrange");
});

// ---------------------------------------------------------------------------
// Single-element layer ops (bring/send/hide/lock/zorder/rename/reorder)
// ---------------------------------------------------------------------------

test("BRING_ELEMENT_TO_FRONT raises the element's z-index above its siblings", () => {
  const deck = slideWithTwoShapes();
  const cmd: BringElementToFrontCommand = {
    type: "BRING_ELEMENT_TO_FRONT",
    slideId: "s1",
    elementId: "e1",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.patches[0]!.op, "element.bring_to_front");
});

test("SEND_ELEMENT_TO_BACK lowers the element's z-index below its siblings", () => {
  const deck = slideWithTwoShapes();
  const cmd: SendElementToBackCommand = {
    type: "SEND_ELEMENT_TO_BACK",
    slideId: "s1",
    elementId: "e2",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.patches[0]!.op, "element.send_to_back");
});

test("SET_ELEMENT_HIDDEN toggles the hidden flag", () => {
  const deck = slideWithTwoShapes();
  const cmd: SetElementHiddenCommand = {
    type: "SET_ELEMENT_HIDDEN",
    slideId: "s1",
    elementId: "e1",
    hidden: true,
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements![0]!.hidden, true);
});

test("SET_ELEMENT_LOCKED toggles the locked flag", () => {
  const deck = slideWithTwoShapes();
  const cmd: SetElementLockedCommand = {
    type: "SET_ELEMENT_LOCKED",
    slideId: "s1",
    elementId: "e1",
    locked: true,
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements![0]!.locked, true);
});

test("MOVE_ELEMENT_ZORDER shifts the element's stacking position", () => {
  const deck = slideWithTwoShapes();
  const cmd: MoveElementZOrderCommand = {
    type: "MOVE_ELEMENT_ZORDER",
    slideId: "s1",
    elementId: "e1",
    direction: "up",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.patches[0]!.op, "element.move_zorder");
});

test("RENAME_ELEMENT sets the element's display name", () => {
  const deck = slideWithTwoShapes();
  const cmd: RenameElementCommand = {
    type: "RENAME_ELEMENT",
    slideId: "s1",
    elementId: "e1",
    name: "Hero shape",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements![0]!.name, "Hero shape");
});

test("REORDER_ELEMENT moves the element next to a target element", () => {
  const deck = slideWithTwoShapes();
  const cmd: ReorderElementCommand = {
    type: "REORDER_ELEMENT",
    slideId: "s1",
    elementId: "e2",
    targetElementId: "e1",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.patches[0]!.op, "element.reorder");
});

test("layer ops fail for a missing element on an existing slide", () => {
  const deck = slideWithTwoShapes();
  const result = executeElementFamilyCommand(deck, {
    type: "RENAME_ELEMENT",
    slideId: "s1",
    elementId: "missing",
    name: "x",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Element not found: missing");
});

// ---------------------------------------------------------------------------
// SET_ELEMENT_BOXES / SET_ELEMENT_PATCHES
// ---------------------------------------------------------------------------

test("SET_ELEMENT_BOXES rejects an empty boxesById map", () => {
  const deck = slideWithTwoShapes();
  const cmd: SetElementBoxesCommand = {
    type: "SET_ELEMENT_BOXES",
    slideId: "s1",
    boxesById: {},
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, false);
  assert.equal(result.error, "boxesById must not be empty");
});

test("SET_ELEMENT_BOXES applies boxes to the given elements and forwards the coalesce key", () => {
  const deck = slideWithTwoShapes();
  const cmd: SetElementBoxesCommand = {
    type: "SET_ELEMENT_BOXES",
    slideId: "s1",
    boxesById: { e1: { x: 50, y: 50, w: 10, h: 10 } },
    coalesceKey: "resize:e1",
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.deck.slides[0]!.elements![0]!.box, {
    x: 50,
    y: 50,
    w: 10,
    h: 10,
  });
  assert.equal(result.historyKey, "resize:e1");
});

test("SET_ELEMENT_PATCHES rejects an empty patchesById map", () => {
  const deck = slideWithTwoShapes();
  const cmd: SetElementPatchesCommand = {
    type: "SET_ELEMENT_PATCHES",
    slideId: "s1",
    patchesById: {},
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, false);
  assert.equal(result.error, "patchesById must not be empty");
});

test("SET_ELEMENT_PATCHES applies per-element patches atomically", () => {
  const deck = slideWithTwoShapes();
  const cmd: SetElementPatchesCommand = {
    type: "SET_ELEMENT_PATCHES",
    slideId: "s1",
    patchesById: { e1: { locked: true }, e2: { hidden: true } },
  };
  const result = executeElementFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.elements![0]!.locked, true);
  assert.equal(result.deck.slides[0]!.elements![1]!.hidden, true);
  assert.deepEqual(result.patches[0]!.elementFields, cmd.patchesById);
});

test("SET_ELEMENT_BOXES and SET_ELEMENT_PATCHES fail for a missing slide", () => {
  const deck = slideWithTwoShapes();
  const boxesResult = executeElementFamilyCommand(deck, {
    type: "SET_ELEMENT_BOXES",
    slideId: "missing",
    boxesById: { e1: { x: 0, y: 0, w: 1, h: 1 } },
  });
  assert.equal(boxesResult.ok, false);
  assert.equal(boxesResult.error, "Slide not found: missing");

  const patchesResult = executeElementFamilyCommand(deck, {
    type: "SET_ELEMENT_PATCHES",
    slideId: "missing",
    patchesById: { e1: { locked: true } },
  });
  assert.equal(patchesResult.ok, false);
  assert.equal(patchesResult.error, "Slide not found: missing");
});
