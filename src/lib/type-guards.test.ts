import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isPlainObject,
  isNonEmptyString,
  isFiniteNumber,
} from "@/lib/type-guards";

// ---------------------------------------------------------------------------
// isPlainObject
// ---------------------------------------------------------------------------

test("isPlainObject: plain object literal", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
});

test("isPlainObject: null is rejected", () => {
  assert.equal(isPlainObject(null), false);
});

test("isPlainObject: arrays are rejected", () => {
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject([1, 2, 3]), false);
});

test("isPlainObject: Object.create(null) is accepted", () => {
  assert.equal(isPlainObject(Object.create(null)), true);
});

test("isPlainObject: class instances are accepted", () => {
  class Foo {}
  assert.equal(isPlainObject(new Foo()), true);
});

test("isPlainObject: Date instances are accepted", () => {
  assert.equal(isPlainObject(new Date()), true);
});

test("isPlainObject: Map instances are accepted", () => {
  assert.equal(isPlainObject(new Map()), true);
});

test("isPlainObject: primitives are rejected", () => {
  assert.equal(isPlainObject(undefined), false);
  assert.equal(isPlainObject(42), false);
  assert.equal(isPlainObject("string"), false);
  assert.equal(isPlainObject(true), false);
});

// ---------------------------------------------------------------------------
// isNonEmptyString
// ---------------------------------------------------------------------------

test("isNonEmptyString: non-empty string", () => {
  assert.equal(isNonEmptyString("hello"), true);
  assert.equal(isNonEmptyString("  a  "), true);
});

test("isNonEmptyString: empty string is rejected", () => {
  assert.equal(isNonEmptyString(""), false);
});

test("isNonEmptyString: whitespace-only string is rejected", () => {
  assert.equal(isNonEmptyString("   "), false);
  assert.equal(isNonEmptyString("\t\n"), false);
});

test("isNonEmptyString: non-strings are rejected", () => {
  assert.equal(isNonEmptyString(null), false);
  assert.equal(isNonEmptyString(undefined), false);
  assert.equal(isNonEmptyString(42), false);
  assert.equal(isNonEmptyString({}), false);
  assert.equal(isNonEmptyString([]), false);
});

// ---------------------------------------------------------------------------
// isFiniteNumber
// ---------------------------------------------------------------------------

test("isFiniteNumber: finite integers", () => {
  assert.equal(isFiniteNumber(0), true);
  assert.equal(isFiniteNumber(1), true);
  assert.equal(isFiniteNumber(-1), true);
  assert.equal(isFiniteNumber(42), true);
});

test("isFiniteNumber: finite floats", () => {
  assert.equal(isFiniteNumber(3.14), true);
  assert.equal(isFiniteNumber(-0.001), true);
});

test("isFiniteNumber: NaN is rejected", () => {
  assert.equal(isFiniteNumber(NaN), false);
});

test("isFiniteNumber: Infinity is rejected", () => {
  assert.equal(isFiniteNumber(Infinity), false);
  assert.equal(isFiniteNumber(-Infinity), false);
});

test("isFiniteNumber: non-numbers are rejected", () => {
  assert.equal(isFiniteNumber("42"), false);
  assert.equal(isFiniteNumber(null), false);
  assert.equal(isFiniteNumber(undefined), false);
  assert.equal(isFiniteNumber({}), false);
  assert.equal(isFiniteNumber([]), false);
  assert.equal(isFiniteNumber(true), false);
});
