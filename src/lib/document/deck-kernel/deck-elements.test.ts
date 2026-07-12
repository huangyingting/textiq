import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_VISUAL_BOX,
  buildVisualElement,
  normalizeTextParagraphs,
} from "./deck-elements";
import type { TextElement } from "./deck-elements";

// ---------------------------------------------------------------------------
// normalizeTextParagraphs
// ---------------------------------------------------------------------------

test("normalizeTextParagraphs returns content.paragraphs verbatim when present", () => {
  const el: Pick<TextElement, "content"> = {
    content: {
      kind: "text",
      text: "ignored",
      paragraphs: [{ text: "first" }, { text: "second", indent: 1 }],
    },
  };
  const result = normalizeTextParagraphs(el);
  assert.deepEqual(result, [{ text: "first" }, { text: "second", indent: 1 }]);
});

test("normalizeTextParagraphs wraps plain text with its runs when paragraphs is absent", () => {
  const el: Pick<TextElement, "content"> = {
    content: {
      kind: "text",
      text: "hello world",
      runs: [{ text: "hello world", bold: true }],
    },
  };
  const result = normalizeTextParagraphs(el);
  assert.deepEqual(result, [
    { text: "hello world", runs: [{ text: "hello world", bold: true }] },
  ]);
});

test("normalizeTextParagraphs omits the runs key when runs is an empty array", () => {
  const el: Pick<TextElement, "content"> = {
    content: { kind: "text", text: "plain", runs: [] },
  };
  const result = normalizeTextParagraphs(el);
  assert.deepEqual(result, [{ text: "plain" }]);
  assert.ok(!("runs" in result[0]!));
});

test("normalizeTextParagraphs wraps plain text with no runs key when runs is absent", () => {
  const el: Pick<TextElement, "content"> = {
    content: { kind: "text", text: "plain" },
  };
  const result = normalizeTextParagraphs(el);
  assert.deepEqual(result, [{ text: "plain" }]);
});

test("normalizeTextParagraphs returns an empty array when content.text is not a string", () => {
  // Defensive fallback branch — not reachable through the TextElement type,
  // but guards a malformed/legacy payload that slipped past validation.
  const el = {
    content: { kind: "text", text: undefined },
  } as unknown as Pick<TextElement, "content">;
  const result = normalizeTextParagraphs(el);
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// buildVisualElement
// ---------------------------------------------------------------------------

test("buildVisualElement builds a visual element with default id, box, and role", () => {
  const el = buildVisualElement("visual-1");
  assert.equal(el.kind, "visual");
  assert.equal(el.role, "visual");
  assert.deepEqual(el.box, DEFAULT_VISUAL_BOX);
  assert.deepEqual(el.content, { kind: "visual", visualId: "visual-1" });
  assert.ok(el.id.length > 0);
  assert.ok(!("zIndex" in el));
});

test("buildVisualElement honors an explicit id, box, and styleThemeId", () => {
  const box = { x: 1, y: 2, w: 3, h: 4 };
  const el = buildVisualElement("visual-2", {
    id: "el-fixed",
    box,
    styleThemeId: "theme-a",
  });
  assert.equal(el.id, "el-fixed");
  assert.deepEqual(el.box, box);
  assert.deepEqual(el.content, {
    kind: "visual",
    visualId: "visual-2",
    styleThemeId: "theme-a",
  });
});

test("buildVisualElement stamps optional source provenance only when provided", () => {
  const withoutSource = buildVisualElement("visual-3");
  assert.ok(!("source" in withoutSource));

  const source = {
    documentId: "doc-1",
    blockId: "block-1",
    blockKind: "visual" as const,
    linkedAt: "2026-01-01T00:00:00.000Z",
  };
  const withSource = buildVisualElement("visual-3", { source });
  assert.deepEqual(withSource.source, source);
});
