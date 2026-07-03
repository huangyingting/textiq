/**
 * Unit tests for comment anchor validation helpers.
 * DOM-free, runnable under `node --test`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  sanitizeAnchorGeometry,
  validateAnchorGeometry,
  validateElementId,
  validateSlideId,
} from "@/lib/comments";

function invalidCoordinate(value: unknown): number {
  return value as unknown as number;
}

// ---------------------------------------------------------------------------
// validateAnchorGeometry
// ---------------------------------------------------------------------------

test("validateAnchorGeometry: null input → null", () => {
  assert.equal(validateAnchorGeometry(null), null);
});

test("validateAnchorGeometry: undefined input → null", () => {
  assert.equal(validateAnchorGeometry(undefined), null);
});

test("validateAnchorGeometry: valid 0,0 → {x:0,y:0}", () => {
  assert.deepEqual(validateAnchorGeometry({ x: 0, y: 0 }), { x: 0, y: 0 });
});

test("validateAnchorGeometry: valid 100,100 → {x:100,y:100}", () => {
  assert.deepEqual(validateAnchorGeometry({ x: 100, y: 100 }), {
    x: 100,
    y: 100,
  });
});

test("validateAnchorGeometry: valid mid-range → returned as-is", () => {
  assert.deepEqual(validateAnchorGeometry({ x: 25.5, y: 75.3 }), {
    x: 25.5,
    y: 75.3,
  });
});

test("validateAnchorGeometry: non-numeric x → throws", () => {
  assert.throws(
    () => validateAnchorGeometry({ x: invalidCoordinate("50"), y: 50 }),
    /numeric/,
  );
});

test("validateAnchorGeometry: non-numeric y → throws", () => {
  assert.throws(
    () => validateAnchorGeometry({ x: 50, y: invalidCoordinate(null) }),
    /numeric/,
  );
});

test("validateAnchorGeometry: x < 0 → throws", () => {
  assert.throws(
    () => validateAnchorGeometry({ x: -1, y: 50 }),
    /0.*100|between/,
  );
});

test("validateAnchorGeometry: x > 100 → throws", () => {
  assert.throws(
    () => validateAnchorGeometry({ x: 101, y: 50 }),
    /0.*100|between/,
  );
});

test("validateAnchorGeometry: y < 0 → throws", () => {
  assert.throws(
    () => validateAnchorGeometry({ x: 50, y: -0.1 }),
    /0.*100|between/,
  );
});

test("validateAnchorGeometry: y > 100 → throws", () => {
  assert.throws(
    () => validateAnchorGeometry({ x: 50, y: 100.001 }),
    /0.*100|between/,
  );
});

// ---------------------------------------------------------------------------
// sanitizeAnchorGeometry
// ---------------------------------------------------------------------------

test("sanitizeAnchorGeometry: null → null", () => {
  assert.equal(sanitizeAnchorGeometry(null), null);
});

test("sanitizeAnchorGeometry: undefined → null", () => {
  assert.equal(sanitizeAnchorGeometry(undefined), null);
});

test("sanitizeAnchorGeometry: valid → returned", () => {
  assert.deepEqual(sanitizeAnchorGeometry({ x: 10, y: 20 }), { x: 10, y: 20 });
});

test("sanitizeAnchorGeometry: non-numeric coords → null (no throw)", () => {
  assert.equal(sanitizeAnchorGeometry({ x: "bad", y: 50 }), null);
});

test("sanitizeAnchorGeometry: x > 100 → null (no throw)", () => {
  assert.equal(sanitizeAnchorGeometry({ x: 110, y: 50 }), null);
});

test("sanitizeAnchorGeometry: y < 0 → null (no throw)", () => {
  assert.equal(sanitizeAnchorGeometry({ x: 50, y: -5 }), null);
});

test("sanitizeAnchorGeometry: missing x/y → null", () => {
  assert.equal(sanitizeAnchorGeometry({ label: "bad" }), null);
});

test("sanitizeAnchorGeometry: non-object → null", () => {
  assert.equal(sanitizeAnchorGeometry("50,50"), null);
  assert.equal(sanitizeAnchorGeometry(42), null);
});

// ---------------------------------------------------------------------------
// validateSlideId
// ---------------------------------------------------------------------------

test("validateSlideId: null → null", () => {
  assert.equal(validateSlideId(null), null);
});

test("validateSlideId: undefined → null", () => {
  assert.equal(validateSlideId(undefined), null);
});

test("validateSlideId: valid string → trimmed", () => {
  assert.equal(validateSlideId("  sl-1  "), "sl-1");
});

test("validateSlideId: empty string → null", () => {
  assert.equal(validateSlideId("   "), null);
});

test("validateSlideId: non-string → throws", () => {
  assert.throws(() => validateSlideId(42), /string/);
});

// ---------------------------------------------------------------------------
// validateElementId
// ---------------------------------------------------------------------------

test("validateElementId: null → null", () => {
  assert.equal(validateElementId(null), null);
});

test("validateElementId: valid string → trimmed", () => {
  assert.equal(validateElementId("  el-a  "), "el-a");
});

test("validateElementId: empty string → null", () => {
  assert.equal(validateElementId(""), null);
});

test("validateElementId: non-string → throws", () => {
  assert.throws(() => validateElementId({}), /string/);
});
