import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveTableCellNavigationAction } from "./use-table-cell-editing";

describe("resolveTableCellNavigationAction", () => {
  test("returns exit action for Escape", () => {
    assert.deepEqual(
      resolveTableCellNavigationAction({
        key: "Escape",
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
      { kind: "exit" },
    );
  });

  test("maps Tab and Shift+Tab to linear navigation", () => {
    assert.deepEqual(
      resolveTableCellNavigationAction({
        key: "Tab",
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
      { kind: "linear", direction: 1 },
    );
    assert.deepEqual(
      resolveTableCellNavigationAction({
        key: "Tab",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
      { kind: "linear", direction: -1 },
    );
  });

  test("requires modifier keys for arrow grid movement", () => {
    assert.equal(
      resolveTableCellNavigationAction({
        key: "ArrowRight",
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
      null,
    );

    assert.deepEqual(
      resolveTableCellNavigationAction({
        key: "ArrowDown",
        shiftKey: false,
        metaKey: false,
        ctrlKey: true,
        altKey: false,
      }),
      { kind: "grid", rowDelta: 1, colDelta: 0 },
    );
  });
});
