import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeImportedText } from "./normalize";

test("normalizeImportedText trims leading and trailing whitespace", () => {
  assert.equal(normalizeImportedText("  hello world  "), "hello world");
});

test("normalizeImportedText collapses 3+ blank lines to a single blank line", () => {
  const input = "Para one\n\n\n\n\nPara two";
  const result = normalizeImportedText(input);
  assert.ok(!result.includes("\n\n\n"));
  assert.ok(result.includes("Para one"));
  assert.ok(result.includes("Para two"));
});

test("normalizeImportedText strips null bytes", () => {
  const input = "Hello\x00World";
  assert.ok(!normalizeImportedText(input).includes("\x00"));
  assert.ok(normalizeImportedText(input).includes("Hello"));
});

test("normalizeImportedText strips control characters except newlines/tabs", () => {
  const input = "Hello\x07\x08World"; // BEL and BS
  const result = normalizeImportedText(input);
  assert.ok(!result.includes("\x07"));
  assert.ok(!result.includes("\x08"));
  assert.ok(result.includes("Hello"));
  assert.ok(result.includes("World"));
});

test("normalizeImportedText preserves newlines and tabs", () => {
  const input = "Line one\n\tIndented\nLine two";
  const result = normalizeImportedText(input);
  assert.ok(result.includes("\n"));
  assert.ok(result.includes("\t"));
});

test("normalizeImportedText returns empty string for blank input", () => {
  assert.equal(normalizeImportedText(""), "");
  assert.equal(normalizeImportedText("   "), "");
  assert.equal(normalizeImportedText("\n\n\n"), "");
});

test("normalizeImportedText truncates at AI_GENERATION_INPUT_MAX_CHARS", async () => {
  // Import AI_GENERATION_INPUT_MAX_CHARS dynamically from its canonical owner.
  const { AI_GENERATION_INPUT_MAX_CHARS } = await import("@/lib/limits/ai");
  const overlong = "x".repeat(AI_GENERATION_INPUT_MAX_CHARS + 5000);
  const result = normalizeImportedText(overlong);
  assert.ok(result.length <= AI_GENERATION_INPUT_MAX_CHARS);
});
