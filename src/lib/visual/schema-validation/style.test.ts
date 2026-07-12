/**
 * Unit tests for style-level visual schema validation and defaulting:
 * `normalizeStyle`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_STYLE } from "@/lib/visual/schema-types";
import { normalizeStyle } from "./style";

test("normalizeStyle returns a copy of the defaults when input is undefined", () => {
  const style = normalizeStyle(undefined);
  assert.deepEqual(style, DEFAULT_STYLE);
  assert.notEqual(
    style,
    DEFAULT_STYLE,
    "must not return the shared default object",
  );
});

test("normalizeStyle rejects non-object input", () => {
  const invalid: unknown[] = [null, "style", 42, [], true];
  for (const value of invalid) {
    assert.throws(
      () => normalizeStyle(value),
      /style must be an object/,
      `expected normalizeStyle to reject ${JSON.stringify(value)}`,
    );
  }
});

test("normalizeStyle keeps each valid string field and rejects wrong types", () => {
  const stringKeys = [
    "background",
    "nodeFill",
    "nodeStroke",
    "nodeText",
    "edgeColor",
    "fontFamily",
  ] as const;
  for (const key of stringKeys) {
    const style = normalizeStyle({ [key]: "#123456" });
    assert.equal(
      style[key],
      "#123456",
      `expected normalizeStyle to keep style.${key}`,
    );
    assert.throws(
      () => normalizeStyle({ [key]: 42 }),
      new RegExp(`style\\.${key} must be a string`),
      `expected normalizeStyle to reject a non-string style.${key}`,
    );
  }
});

test("normalizeStyle validates palette as a non-empty array of strings", () => {
  const style = normalizeStyle({ palette: ["#111111", "#222222"] });
  assert.deepEqual(style.palette, ["#111111", "#222222"]);

  const invalidPalettes: unknown[] = [[], "not-an-array", [1, 2], null];
  for (const palette of invalidPalettes) {
    assert.throws(
      () => normalizeStyle({ palette }),
      /style\.palette must be a non-empty array of strings/,
      `expected normalizeStyle to reject palette ${JSON.stringify(palette)}`,
    );
  }
});

test("normalizeStyle enforces fontSize and fontWeight are positive numbers", () => {
  const numericFields = ["fontSize", "fontWeight"] as const;
  for (const field of numericFields) {
    const style = normalizeStyle({ [field]: 20 });
    assert.equal(style[field], 20, `expected normalizeStyle to keep ${field}`);

    const invalidValues: unknown[] = [0, -1, "18", NaN, Infinity];
    for (const value of invalidValues) {
      assert.throws(
        () => normalizeStyle({ [field]: value }),
        new RegExp(`style\\.${field} must be a positive number`),
        `expected normalizeStyle to reject ${field}=${JSON.stringify(value)}`,
      );
    }
  }
});

test("normalizeStyle falls back to defaults for omitted fields while keeping overrides", () => {
  const style = normalizeStyle({ nodeFill: "#fff", fontSize: 18 });
  assert.equal(style.nodeFill, "#fff");
  assert.equal(style.fontSize, 18);
  assert.equal(style.background, DEFAULT_STYLE.background);
  assert.equal(style.fontWeight, DEFAULT_STYLE.fontWeight);
  assert.deepEqual(style.palette, DEFAULT_STYLE.palette);
});
