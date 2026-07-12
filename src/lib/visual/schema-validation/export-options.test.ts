/**
 * Unit tests for persisted visual-level export/frame preference validation:
 * `parseVisualExportOptions`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ASPECT_RATIO_PRESETS, CANVAS_STYLES } from "@/lib/visual/schema-types";
import { parseVisualExportOptions } from "./export-options";

test("parseVisualExportOptions keeps every supported aspect ratio preset", () => {
  for (const aspectRatio of ASPECT_RATIO_PRESETS) {
    assert.deepEqual(
      parseVisualExportOptions({ aspectRatio }),
      { aspectRatio },
      `expected aspectRatio "${aspectRatio}" to be kept`,
    );
  }
});

test("parseVisualExportOptions keeps every supported canvas style", () => {
  for (const canvasStyle of CANVAS_STYLES) {
    assert.deepEqual(
      parseVisualExportOptions({ canvasStyle }),
      { canvasStyle },
      `expected canvasStyle "${canvasStyle}" to be kept`,
    );
  }
});

test("parseVisualExportOptions keeps both fields together when both are valid", () => {
  assert.deepEqual(
    parseVisualExportOptions({ aspectRatio: "16:9", canvasStyle: "dot-grid" }),
    { aspectRatio: "16:9", canvasStyle: "dot-grid" },
  );
});

test("parseVisualExportOptions drops unsupported or mistyped values without throwing", () => {
  const invalid: { aspectRatio?: unknown; canvasStyle?: unknown }[] = [
    { aspectRatio: "2:1" },
    { aspectRatio: 169 },
    { aspectRatio: null },
    { canvasStyle: "unknown" },
    { canvasStyle: 42 },
    { canvasStyle: null },
  ];
  for (const input of invalid) {
    assert.deepEqual(
      parseVisualExportOptions(input),
      {},
      `expected ${JSON.stringify(input)} to be dropped`,
    );
  }
});

test("parseVisualExportOptions returns an empty object when both fields are absent", () => {
  assert.deepEqual(parseVisualExportOptions({}), {});
});
