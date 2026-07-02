/**
 * Tests for src/lib/presentation/rich-text.ts
 *
 * Covers: paragraph serialization, run merging, plain-text extraction,
 * shouldStoreRuns, parseParagraphsFromPlainText, framePctToCssPx.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  paragraphsToPlainText,
  runsToPlainText,
  shouldStoreRuns,
  mergeRuns,
  parseParagraphsFromPlainText,
  framePctToCssPx,
  resetParagraphIdCounter,
} from "@/lib/presentation/rich-text";
import type { Paragraph, TextRun } from "@/lib/presentation/schema";

// ---------------------------------------------------------------------------
// paragraphsToPlainText
// ---------------------------------------------------------------------------

describe("paragraphsToPlainText", () => {
  test("joins single paragraph to its text", () => {
    const paras: Paragraph[] = [{ id: "p1", text: "Hello" }];
    assert.equal(paragraphsToPlainText(paras), "Hello");
  });

  test("joins multiple paragraphs with newlines", () => {
    const paras: Paragraph[] = [
      { id: "p1", text: "Line one" },
      { id: "p2", text: "Line two" },
      { id: "p3", text: "Line three" },
    ];
    assert.equal(
      paragraphsToPlainText(paras),
      "Line one\nLine two\nLine three",
    );
  });

  test("preserves empty paragraphs as blank lines", () => {
    const paras: Paragraph[] = [
      { id: "p1", text: "First" },
      { id: "p2", text: "" },
      { id: "p3", text: "Third" },
    ];
    assert.equal(paragraphsToPlainText(paras), "First\n\nThird");
  });

  test("returns empty string for empty array", () => {
    assert.equal(paragraphsToPlainText([]), "");
  });
});

// ---------------------------------------------------------------------------
// runsToPlainText
// ---------------------------------------------------------------------------

describe("runsToPlainText", () => {
  test("concatenates run text fields", () => {
    const runs: TextRun[] = [
      { text: "Hello" },
      { text: " " },
      { text: "world", bold: true },
    ];
    assert.equal(runsToPlainText(runs), "Hello world");
  });

  test("returns empty string for empty runs", () => {
    assert.equal(runsToPlainText([]), "");
  });
});

// ---------------------------------------------------------------------------
// shouldStoreRuns
// ---------------------------------------------------------------------------

describe("shouldStoreRuns", () => {
  test("returns false for plain text-only runs", () => {
    const runs: TextRun[] = [{ text: "plain" }, { text: " text" }];
    assert.equal(shouldStoreRuns(runs), false);
  });

  test("returns true when any run has bold", () => {
    const runs: TextRun[] = [{ text: "normal" }, { text: "bold", bold: true }];
    assert.equal(shouldStoreRuns(runs), true);
  });

  test("returns true when any run has italic", () => {
    assert.equal(shouldStoreRuns([{ text: "em", italic: true }]), true);
  });

  test("returns true when any run has underline", () => {
    assert.equal(shouldStoreRuns([{ text: "u", underline: true }]), true);
  });

  test("returns true when any run has strikethrough", () => {
    assert.equal(shouldStoreRuns([{ text: "s", strikethrough: true }]), true);
  });

  test("returns true when any run has code", () => {
    assert.equal(shouldStoreRuns([{ text: "code", code: true }]), true);
  });

  test("returns true when any run has a link", () => {
    assert.equal(
      shouldStoreRuns([{ text: "click", link: "https://example.com" }]),
      true,
    );
  });

  test("returns true when any run has localStyle", () => {
    const runs: TextRun[] = [{ text: "big", localStyle: { fontSizePt: 36 } }];
    assert.equal(shouldStoreRuns(runs), true);
  });

  test("returns false for empty runs array", () => {
    assert.equal(shouldStoreRuns([]), false);
  });
});

// ---------------------------------------------------------------------------
// mergeRuns
// ---------------------------------------------------------------------------

describe("mergeRuns", () => {
  test("merges consecutive runs with identical formatting", () => {
    const runs: TextRun[] = [{ text: "Hello" }, { text: " world" }];
    const merged = mergeRuns(runs);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, "Hello world");
  });

  test("does not merge runs with different formatting", () => {
    const runs: TextRun[] = [{ text: "normal" }, { text: "bold", bold: true }];
    const merged = mergeRuns(runs);
    assert.equal(merged.length, 2);
  });

  test("discards empty-text runs", () => {
    const runs: TextRun[] = [{ text: "" }, { text: "hello" }, { text: "" }];
    const merged = mergeRuns(runs);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, "hello");
  });

  test("returns empty array for all-empty input", () => {
    assert.deepEqual(mergeRuns([{ text: "" }]), []);
  });

  test("does not merge runs with different localStyle colors", () => {
    const runs: TextRun[] = [
      { text: "red", localStyle: { color: "#ff0000" } },
      { text: "blue", localStyle: { color: "#0000ff" } },
    ];
    const merged = mergeRuns(runs);
    assert.equal(merged.length, 2);
  });

  test("merges runs with identical localStyle", () => {
    const runs: TextRun[] = [
      { text: "big", localStyle: { fontSizePt: 36 } },
      { text: " text", localStyle: { fontSizePt: 36 } },
    ];
    const merged = mergeRuns(runs);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, "big text");
  });

  test("merges runs with same bold+italic combination", () => {
    const runs: TextRun[] = [
      { text: "A", bold: true, italic: true },
      { text: "B", bold: true, italic: true },
    ];
    const merged = mergeRuns(runs);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, "AB");
  });

  test("does not merge runs with different strikethrough state", () => {
    const runs: TextRun[] = [{ text: "A", strikethrough: true }, { text: "B" }];
    const merged = mergeRuns(runs);
    assert.equal(merged.length, 2);
  });

  test("does not mutate input runs", () => {
    const original: TextRun[] = [{ text: "hello" }, { text: " world" }];
    const originalCopy = original.map((r) => ({ ...r }));
    mergeRuns(original);
    assert.deepEqual(original, originalCopy);
  });
});

// ---------------------------------------------------------------------------
// parseParagraphsFromPlainText
// ---------------------------------------------------------------------------

describe("parseParagraphsFromPlainText", () => {
  test("single line produces one paragraph", () => {
    resetParagraphIdCounter();
    const paras = parseParagraphsFromPlainText("Hello", () => "p1");
    assert.equal(paras.length, 1);
    assert.equal(paras[0].text, "Hello");
    assert.equal(paras[0].id, "p1");
  });

  test("multi-line input produces one paragraph per line", () => {
    const ids = ["a", "b", "c"];
    let i = 0;
    const paras = parseParagraphsFromPlainText(
      "Line 1\nLine 2\nLine 3",
      () => ids[i++],
    );
    assert.equal(paras.length, 3);
    assert.equal(paras[0].text, "Line 1");
    assert.equal(paras[1].text, "Line 2");
    assert.equal(paras[2].text, "Line 3");
  });

  test("empty string produces one empty paragraph", () => {
    const paras = parseParagraphsFromPlainText("", () => "p-empty");
    assert.equal(paras.length, 1);
    assert.equal(paras[0].text, "");
  });

  test("blank line in the middle becomes an empty paragraph", () => {
    const ids = ["x", "y", "z"];
    let i = 0;
    const paras = parseParagraphsFromPlainText(
      "First\n\nThird",
      () => ids[i++],
    );
    assert.equal(paras.length, 3);
    assert.equal(paras[1].text, "");
  });

  test("uses default id generator when not supplied", () => {
    resetParagraphIdCounter();
    const paras = parseParagraphsFromPlainText("one\ntwo");
    assert.equal(paras.length, 2);
    paras.forEach((p) => assert.ok(p.id.length > 0));
  });
});

// ---------------------------------------------------------------------------
// framePctToCssPx — inline editor overlay geometry
// ---------------------------------------------------------------------------

describe("framePctToCssPx", () => {
  test("converts percent frame to pixel css values", () => {
    // Frame at (10%, 20%, 50%, 30%) in a 1600x900 canvas
    const result = framePctToCssPx({ x: 10, y: 20, w: 50, h: 30 }, 1600, 900);
    assert.equal(result.left, 160);
    assert.equal(result.top, 180);
    assert.equal(result.width, 800);
    assert.equal(result.height, 270);
  });

  test("full-canvas frame maps to full pixel dimensions", () => {
    const result = framePctToCssPx({ x: 0, y: 0, w: 100, h: 100 }, 1920, 1080);
    assert.equal(result.left, 0);
    assert.equal(result.top, 0);
    assert.equal(result.width, 1920);
    assert.equal(result.height, 1080);
  });

  test("zero frame produces zero pixel values", () => {
    const result = framePctToCssPx({ x: 0, y: 0, w: 0, h: 0 }, 1600, 900);
    assert.equal(result.left, 0);
    assert.equal(result.top, 0);
    assert.equal(result.width, 0);
    assert.equal(result.height, 0);
  });

  test("matches spec formula for title node typical position", () => {
    // Typical title node: x=8, y=8, w=84, h=14 in a 1600x900 canvas
    const result = framePctToCssPx({ x: 8, y: 8, w: 84, h: 14 }, 1600, 900);
    assert.equal(result.left, 128);
    assert.equal(result.top, 72);
    assert.equal(result.width, 1344);
    // 14/100 * 900 = 126 (allow for floating-point rounding)
    assert.ok(Math.abs(result.height - 126) < 0.001);
  });
});
