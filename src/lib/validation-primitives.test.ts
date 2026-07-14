import assert from "node:assert/strict";
import { test } from "node:test";

import {
  forEachUnknownKey,
  isLiteralMember,
  isValidationFiniteNumber,
  isValidationNonEmptyString,
  isValidationPlainObject,
} from "./validation-primitives";

test("isValidationPlainObject accepts plain objects and rejects arrays/null", () => {
  assert.equal(isValidationPlainObject({ a: 1 }), true);
  assert.equal(isValidationPlainObject([]), false);
  assert.equal(isValidationPlainObject(null), false);
});

test("forEachUnknownKey visits only unknown keys in object key order", () => {
  const unknown: string[] = [];
  forEachUnknownKey({ known: 1, extraA: 2, extraB: 3 }, ["known"], (key) => {
    unknown.push(key);
  });
  assert.deepEqual(unknown, ["extraA", "extraB"]);
});

test("isLiteralMember accepts matching literals and rejects non-members", () => {
  assert.equal(isLiteralMember("center", ["left", "center", "right"]), true);
  assert.equal(isLiteralMember("justify", ["left", "center", "right"]), false);
  assert.equal(isLiteralMember(1, ["left", "center", "right"]), false);
});

test("isValidationFiniteNumber excludes NaN and infinities", () => {
  assert.equal(isValidationFiniteNumber(5), true);
  assert.equal(isValidationFiniteNumber(Number.NaN), false);
  assert.equal(isValidationFiniteNumber(Number.POSITIVE_INFINITY), false);
});

test("isValidationNonEmptyString supports trimmed and exact modes", () => {
  assert.equal(isValidationNonEmptyString(" text "), true);
  assert.equal(isValidationNonEmptyString("   "), false);
  assert.equal(isValidationNonEmptyString("   ", "exact"), true);
  assert.equal(isValidationNonEmptyString("", "exact"), false);
});
