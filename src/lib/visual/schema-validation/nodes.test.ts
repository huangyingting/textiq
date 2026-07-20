/**
 * Unit tests for node-level visual schema validation: `validateNode`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FILL_STYLES,
  LINE_STYLES,
  NODE_SHAPES,
  TEXT_ALIGNS,
} from "@/lib/visual/schema-types";
import { validateNode } from "./nodes";

test("validateNode rejects a non-object input", () => {
  const invalid: unknown[] = [null, undefined, "node", 42, []];
  for (const value of invalid) {
    assert.throws(
      () => validateNode(value, 0),
      /nodes\[0\] must be an object/,
      `expected validateNode to reject ${JSON.stringify(value)}`,
    );
  }
});

test("validateNode requires a non-empty string id and a string label", () => {
  assert.throws(
    () => validateNode({ label: "Alpha" }, 0),
    /nodes\[0\]\.id must be a non-empty string/,
  );
  assert.throws(
    () => validateNode({ id: "", label: "Alpha" }, 0),
    /nodes\[0\]\.id must be a non-empty string/,
  );
  assert.throws(
    () => validateNode({ id: 42, label: "Alpha" }, 0),
    /nodes\[0\]\.id must be a non-empty string/,
  );
  assert.throws(
    () => validateNode({ id: "a" }, 1),
    /nodes\[1\]\.label must be a string/,
  );
  assert.throws(
    () => validateNode({ id: "a", label: 42 }, 1),
    /nodes\[1\]\.label must be a string/,
  );
});

test("validateNode accepts every declared node shape and rejects unknown ones", () => {
  for (const shape of NODE_SHAPES) {
    const node = validateNode({ id: "a", label: "Alpha", shape }, 0);
    assert.equal(node.shape, shape, `expected shape "${shape}" to be kept`);
  }
  assert.throws(
    () => validateNode({ id: "a", label: "Alpha", shape: "blob" }, 0),
    /nodes\[0\]\.shape must be one of/,
  );
});

test("validateNode defaults optional fields to undefined when omitted", () => {
  const node = validateNode({ id: "a", label: "Alpha" }, 0);
  assert.equal(node.x, undefined);
  assert.equal(node.y, undefined);
  assert.equal(node.width, undefined);
  assert.equal(node.height, undefined);
  assert.equal(node.value, undefined);
  assert.equal(node.shape, undefined);
  assert.equal(node.color, undefined);
  assert.equal(node.icon, undefined);
  assert.equal(node.fillStyle, undefined);
  assert.equal(node.borderStyle, undefined);
  assert.equal(node.borderWidth, undefined);
  assert.equal(node.textAlign, undefined);
  assert.equal(node.fontFamily, undefined);
});

test("validateNode keeps x/y/value at zero or negative but requires width/height/borderWidth positive", () => {
  const unconstrained = validateNode(
    { id: "a", label: "Alpha", x: -10, y: 0, value: -5 },
    0,
  );
  assert.equal(unconstrained.x, -10);
  assert.equal(unconstrained.y, 0);
  assert.equal(unconstrained.value, -5);

  const positiveFields = ["width", "height", "borderWidth"] as const;
  for (const field of positiveFields) {
    const node = validateNode({ id: "a", label: "Alpha", [field]: 12 }, 0);
    assert.equal(node[field], 12, `expected ${field} to be kept`);
    assert.throws(
      () => validateNode({ id: "a", label: "Alpha", [field]: 0 }, 0),
      new RegExp(`nodes\\[0\\]\\.${field} must be greater than 0`),
      `expected ${field}=0 to be rejected`,
    );
    assert.throws(
      () => validateNode({ id: "a", label: "Alpha", [field]: -1 }, 0),
      new RegExp(`nodes\\[0\\]\\.${field} must be greater than 0`),
      `expected ${field}=-1 to be rejected`,
    );
  }
});

test("validateNode requires color, stroke, and textColor to be strings when present", () => {
  const stringFields = ["color", "stroke", "textColor"] as const;
  for (const field of stringFields) {
    const node = validateNode({ id: "a", label: "Alpha", [field]: "#fff" }, 0);
    assert.equal(node[field], "#fff", `expected ${field} to be kept`);
    assert.throws(
      () => validateNode({ id: "a", label: "Alpha", [field]: 42 }, 0),
      new RegExp(`nodes\\[0\\]\\.${field} must be a string`),
      `expected non-string ${field} to be rejected`,
    );
  }
});

test("validateNode rejects unsafe paint and accepts safe color grammar", () => {
  const safeColors = [
    "#fff",
    "#ffffffff",
    "rgb(255, 255, 255)",
    "hsl(0 0% 100%)",
    "white",
    "brand.primary",
  ];
  for (const color of safeColors) {
    assert.equal(
      validateNode({ id: "a", label: "Alpha", color }, 0).color,
      color,
    );
  }

  const unsafePaint = [
    "url(#paint)",
    "image(url(foo.png))",
    "element(#source)",
    "var(--visual-color)",
    "linear-gradient(red, blue)",
  ];
  for (const color of unsafePaint) {
    assert.throws(
      () => validateNode({ id: "a", label: "Alpha", color }, 0),
      /nodes\[0\]\.color must be a safe color/,
    );
  }
});

test("validateNode keeps a known icon and silently drops unknown or non-string icons", () => {
  const known = validateNode({ id: "a", label: "Idea", icon: "Lightbulb" }, 0);
  assert.equal(known.icon, "Lightbulb");

  const unknown = validateNode(
    { id: "a", label: "Idea", icon: "ThisIconDoesNotExist123" },
    0,
  );
  assert.equal(unknown.icon, undefined);

  const nonString = validateNode({ id: "a", label: "Idea", icon: 42 }, 0);
  assert.equal(nonString.icon, undefined);
});

test("validateNode keeps every declared fill style and silently drops unknown ones", () => {
  for (const fillStyle of FILL_STYLES) {
    const node = validateNode({ id: "a", label: "Alpha", fillStyle }, 0);
    assert.equal(node.fillStyle, fillStyle);
  }
  const invalid = validateNode(
    { id: "a", label: "Alpha", fillStyle: "textured" },
    0,
  );
  assert.equal(invalid.fillStyle, undefined);
});

test("validateNode keeps every declared border style and silently drops unknown ones", () => {
  for (const borderStyle of LINE_STYLES) {
    const node = validateNode({ id: "a", label: "Alpha", borderStyle }, 0);
    assert.equal(node.borderStyle, borderStyle);
  }
  const invalid = validateNode(
    { id: "a", label: "Alpha", borderStyle: "wavy" },
    0,
  );
  assert.equal(invalid.borderStyle, undefined);
});

test("validateNode keeps every declared text alignment and silently drops unknown ones", () => {
  for (const textAlign of TEXT_ALIGNS) {
    const node = validateNode({ id: "a", label: "Alpha", textAlign }, 0);
    assert.equal(node.textAlign, textAlign);
  }
  const invalid = validateNode(
    { id: "a", label: "Alpha", textAlign: "justify" },
    0,
  );
  assert.equal(invalid.textAlign, undefined);
});

test("validateNode trims fontFamily to 200 characters and ignores an empty string", () => {
  const node = validateNode(
    { id: "a", label: "Alpha", fontFamily: "Georgia, serif" },
    0,
  );
  assert.equal(node.fontFamily, "Georgia, serif");

  const longFamily = "x".repeat(250);
  const trimmed = validateNode(
    { id: "a", label: "Alpha", fontFamily: longFamily },
    0,
  );
  assert.equal(trimmed.fontFamily?.length, 200);

  const empty = validateNode({ id: "a", label: "Alpha", fontFamily: "" }, 0);
  assert.equal(empty.fontFamily, undefined);
});
