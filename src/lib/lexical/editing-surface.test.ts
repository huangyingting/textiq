import assert from "node:assert/strict";
import { test } from "node:test";

import {
  groupForSelectionKind,
  resolveEditingSurface,
  selectionKindFromContext,
  type EditingSurfaceSelectionKind,
  type ResolvedEditingSurface,
} from "./editing-surface";

// ---------------------------------------------------------------------------
// selectionKindFromContext — raw EditorContextKind → coarse selection kind.
// ---------------------------------------------------------------------------

test("selectionKindFromContext maps range → range", () => {
  assert.equal(selectionKindFromContext("range"), "range");
});

test("selectionKindFromContext maps visual → visual", () => {
  assert.equal(selectionKindFromContext("visual"), "visual");
});

test("selectionKindFromContext maps table → table", () => {
  assert.equal(selectionKindFromContext("table"), "table");
});

test("selectionKindFromContext maps none → none", () => {
  assert.equal(selectionKindFromContext("none"), "none");
});

test("selectionKindFromContext maps empty-block → none", () => {
  assert.equal(selectionKindFromContext("empty-block"), "none");
});

test("selectionKindFromContext maps collapsed → none", () => {
  assert.equal(selectionKindFromContext("collapsed"), "none");
});

// ---------------------------------------------------------------------------
// groupForSelectionKind — selection kind → content group.
// ---------------------------------------------------------------------------

test("groupForSelectionKind maps range → text-format", () => {
  assert.equal(groupForSelectionKind("range"), "text-format");
});

test("groupForSelectionKind maps visual → visual-edit", () => {
  assert.equal(groupForSelectionKind("visual"), "visual-edit");
});

test("groupForSelectionKind maps table → table-edit", () => {
  assert.equal(groupForSelectionKind("table"), "table-edit");
});

test("groupForSelectionKind maps none → overall", () => {
  assert.equal(groupForSelectionKind("none"), "overall");
});

// ---------------------------------------------------------------------------
// resolveEditingSurface — the full 2 × 4 = 8-row decision matrix.
// ---------------------------------------------------------------------------

function expectSurface(
  pointerFine: boolean,
  selectionKind: EditingSurfaceSelectionKind,
  expected: ResolvedEditingSurface,
) {
  assert.deepEqual(
    resolveEditingSurface({
      pointerFine,
      selectionKind,
    }),
    expected,
  );
}

// --- pointerFine = true -----------------------------------------------------

test("T,range → float(text-format)", () => {
  expectSurface(true, "range", {
    mode: "float",
    group: "text-format",
  });
});

test("T,visual → float(visual-edit)", () => {
  expectSurface(true, "visual", {
    mode: "float",
    group: "visual-edit",
  });
});

test("T,table → float(table-edit)", () => {
  expectSurface(true, "table", {
    mode: "float",
    group: "table-edit",
  });
});

test("T,none → none(overall)", () => {
  expectSurface(true, "none", {
    mode: "none",
    group: "overall",
  });
});

// --- pointerFine = false ----------------------------------------------------

test("F,range → sheet(text-format)", () => {
  expectSurface(false, "range", {
    mode: "sheet",
    group: "text-format",
  });
});

test("F,visual → sheet(visual-edit)", () => {
  expectSurface(false, "visual", {
    mode: "sheet",
    group: "visual-edit",
  });
});

test("F,table → sheet(table-edit)", () => {
  expectSurface(false, "table", {
    mode: "sheet",
    group: "table-edit",
  });
});

test("F,none → none(overall)", () => {
  expectSurface(false, "none", {
    mode: "none",
    group: "overall",
  });
});

// ---------------------------------------------------------------------------
// Totality — the resolver returns a value for every one of the 6 inputs and
// the group is always selection-derived.
// ---------------------------------------------------------------------------

test("resolveEditingSurface is total over all 8 input combinations", () => {
  const pointerFines = [true, false];
  const selectionKinds: EditingSurfaceSelectionKind[] = [
    "range",
    "visual",
    "table",
    "none",
  ];

  let count = 0;
  for (const pointerFine of pointerFines) {
    for (const selectionKind of selectionKinds) {
      const result = resolveEditingSurface({
        pointerFine,
        selectionKind,
      });
      assert.ok(["float", "sheet", "none"].includes(result.mode));
      assert.equal(result.group, groupForSelectionKind(selectionKind));
      count += 1;
    }
  }
  assert.equal(count, 8);
});

test("fine pointer text, visual, and table contexts use popovers", () => {
  expectSurface(true, "range", {
    mode: "float",
    group: "text-format",
  });
  expectSurface(true, "visual", {
    mode: "float",
    group: "visual-edit",
  });
  expectSurface(true, "table", {
    mode: "float",
    group: "table-edit",
  });
});

test("coarse pointer text, visual, and table contexts use the sheet toolbox", () => {
  expectSurface(false, "range", {
    mode: "sheet",
    group: "text-format",
  });
  expectSurface(false, "visual", {
    mode: "sheet",
    group: "visual-edit",
  });
  expectSurface(false, "table", {
    mode: "sheet",
    group: "table-edit",
  });
});

test("document context has no contextual surface", () => {
  expectSurface(true, "none", {
    mode: "none",
    group: "overall",
  });
  expectSurface(false, "none", {
    mode: "none",
    group: "overall",
  });
});
