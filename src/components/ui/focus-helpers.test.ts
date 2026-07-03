import assert from "node:assert/strict";
import test from "node:test";

import {
  dialogReducer,
  getTabbableElements,
  nextFocusIndex,
  TABBABLE_SELECTOR,
} from "./focus-helpers";

function testElement(element: unknown): Element {
  return element as unknown as Element;
}

// ---------------------------------------------------------------------------
// nextFocusIndex
// ---------------------------------------------------------------------------

test("nextFocusIndex: returns -1 for an empty list", () => {
  assert.equal(nextFocusIndex(0, -1, false), -1);
  assert.equal(nextFocusIndex(0, -1, true), -1);
});

test("nextFocusIndex: single element — forward stays at 0", () => {
  assert.equal(nextFocusIndex(1, 0, false), 0);
});

test("nextFocusIndex: single element — backward stays at 0", () => {
  assert.equal(nextFocusIndex(1, 0, true), 0);
});

test("nextFocusIndex: forward increments within bounds", () => {
  assert.equal(nextFocusIndex(3, 0, false), 1);
  assert.equal(nextFocusIndex(3, 1, false), 2);
});

test("nextFocusIndex: forward wraps from last to first", () => {
  assert.equal(nextFocusIndex(3, 2, false), 0);
  assert.equal(nextFocusIndex(5, 4, false), 0);
});

test("nextFocusIndex: backward decrements within bounds", () => {
  assert.equal(nextFocusIndex(3, 2, true), 1);
  assert.equal(nextFocusIndex(3, 1, true), 0);
});

test("nextFocusIndex: backward wraps from first to last", () => {
  assert.equal(nextFocusIndex(3, 0, true), 2);
  assert.equal(nextFocusIndex(5, 0, true), 4);
});

test("nextFocusIndex: forward from -1 (no current focus) lands at index 0", () => {
  // -1 is treated as "before the list", so forward should produce 0
  assert.equal(nextFocusIndex(3, -1, false), 0);
});

test("nextFocusIndex: backward from -1 (no current focus) wraps to last", () => {
  // -1 <= 0, so backward wraps to count-1
  assert.equal(nextFocusIndex(3, -1, true), 2);
});

// ---------------------------------------------------------------------------
// getTabbableElements
// ---------------------------------------------------------------------------

test("getTabbableElements: returns elements matching TABBABLE_SELECTOR", () => {
  const button = testElement({ tagName: "BUTTON" });
  const input = testElement({ tagName: "INPUT" });
  const mockContainer = {
    querySelectorAll: (selector: string) => {
      assert.equal(selector, TABBABLE_SELECTOR);
      return [button, input];
    },
  };
  const result = getTabbableElements(mockContainer);
  assert.equal(result.length, 2);
  assert.equal(result[0], button);
  assert.equal(result[1], input);
});

test("getTabbableElements: returns empty array for empty container", () => {
  const mockContainer = { querySelectorAll: () => [] };
  const result = getTabbableElements(mockContainer);
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// dialogReducer
// ---------------------------------------------------------------------------

test("dialogReducer: open action sets state to true", () => {
  assert.equal(dialogReducer(false, { type: "open" }), true);
  assert.equal(dialogReducer(true, { type: "open" }), true);
});

test("dialogReducer: close action sets state to false", () => {
  assert.equal(dialogReducer(true, { type: "close" }), false);
  assert.equal(dialogReducer(false, { type: "close" }), false);
});

test("dialogReducer: toggle flips open → closed", () => {
  assert.equal(dialogReducer(true, { type: "toggle" }), false);
});

test("dialogReducer: toggle flips closed → open", () => {
  assert.equal(dialogReducer(false, { type: "toggle" }), true);
});
