/**
 * Unit tests for shared visual schema validation helpers: `numberField` and
 * `VisualValidationError`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { VisualValidationError, numberField } from "./utils";

test("VisualValidationError carries a distinct name and message", () => {
  const error = new VisualValidationError("boom");
  assert.ok(error instanceof Error);
  assert.equal(error.name, "VisualValidationError");
  assert.equal(error.message, "boom");
});

test("numberField returns undefined when the key is absent", () => {
  assert.equal(numberField({}, "width", "Visual"), undefined);
  assert.equal(numberField({ width: undefined }, "width", "Visual"), undefined);
});

test("numberField returns finite numeric values unchanged", () => {
  const cases: { source: Record<string, unknown>; expected: number }[] = [
    { source: { width: 0 }, expected: 0 },
    { source: { width: 42 }, expected: 42 },
    { source: { width: -13.5 }, expected: -13.5 },
  ];
  for (const { source, expected } of cases) {
    assert.equal(
      numberField(source, "width", "Visual"),
      expected,
      `expected numberField to keep ${JSON.stringify(source)}`,
    );
  }
});

test("numberField rejects non-finite or non-numeric values", () => {
  const invalid: unknown[] = [
    "12",
    null,
    true,
    {},
    [],
    NaN,
    Infinity,
    -Infinity,
  ];
  for (const value of invalid) {
    assert.throws(
      () => numberField({ width: value }, "width", "Visual"),
      /Visual\.width must be a finite number/,
      `expected numberField to reject ${JSON.stringify(value)}`,
    );
  }
});

test("numberField enforces the positive constraint only when requested", () => {
  assert.equal(
    numberField({ height: -5 }, "height", "Visual"),
    -5,
    "without positive:true, negative numbers pass through",
  );
  assert.throws(
    () => numberField({ height: 0 }, "height", "Visual", { positive: true }),
    /Visual\.height must be greater than 0/,
  );
  assert.throws(
    () => numberField({ height: -1 }, "height", "Visual", { positive: true }),
    /Visual\.height must be greater than 0/,
  );
  assert.equal(
    numberField({ height: 1 }, "height", "Visual", { positive: true }),
    1,
  );
});

test("numberField includes the field context in error messages", () => {
  assert.throws(
    () => numberField({ borderWidth: "x" }, "borderWidth", "nodes[3]"),
    /nodes\[3\]\.borderWidth must be a finite number/,
  );
});
