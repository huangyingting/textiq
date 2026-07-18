import assert from "node:assert/strict";
import { test } from "node:test";

import { structuredJsonEqual } from "./structured-json";

test("structuredJsonEqual ignores object key insertion order", () => {
  assert.equal(
    structuredJsonEqual(
      { slides: [{ id: "slide-1", meta: { b: 2, a: 1 } }] },
      { slides: [{ meta: { a: 1, b: 2 }, id: "slide-1" }] },
    ),
    true,
  );
});

test("structuredJsonEqual preserves array order and detects nested changes", () => {
  assert.equal(structuredJsonEqual([1, 2], [2, 1]), false);
  assert.equal(
    structuredJsonEqual(
      { slides: [{ id: "slide-1" }] },
      { slides: [{ id: "slide-2" }] },
    ),
    false,
  );
});
