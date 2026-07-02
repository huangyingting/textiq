/**
 * Unit tests for {@link hashDocumentBlock} and
 * {@link documentBlockSignature} — DOM-free, runnable under `node --test`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { DocumentBlock } from "@/lib/content";
import type { Visual } from "@/lib/visual/schema";

import {
  documentBlockSignature,
  hashDocumentBlock,
} from "./document-block-hash";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function para(text: string): DocumentBlock {
  return { kind: "text", blockType: "paragraph", text };
}

function heading(text: string, level: 1 | 2 | 3): DocumentBlock {
  return { kind: "text", blockType: "heading", level, text };
}

function visual(visualId: string): DocumentBlock {
  return { kind: "visual", visualId, visual: {} as unknown as Visual };
}

// ---------------------------------------------------------------------------
// documentBlockSignature
// ---------------------------------------------------------------------------

test("documentBlockSignature is deterministic for paragraph blocks", () => {
  assert.equal(
    documentBlockSignature(para("Hello")),
    documentBlockSignature(para("Hello")),
  );
});

test("documentBlockSignature differs for different text", () => {
  assert.notEqual(
    documentBlockSignature(para("Hello")),
    documentBlockSignature(para("World")),
  );
});

test("documentBlockSignature encodes blockType: paragraph vs heading differ even for same text", () => {
  assert.notEqual(
    documentBlockSignature(para("Intro")),
    documentBlockSignature(heading("Intro", 1)),
  );
});

test("documentBlockSignature encodes level: h1 and h2 differ", () => {
  assert.notEqual(
    documentBlockSignature(heading("Intro", 1)),
    documentBlockSignature(heading("Intro", 2)),
  );
});

test("documentBlockSignature for visual uses kind+visualId", () => {
  const sig = documentBlockSignature(visual("vis-abc"));
  assert.ok(sig.includes("visual"));
  assert.ok(sig.includes("vis-abc"));
});

test("documentBlockSignature for visuals differs by visualId", () => {
  assert.notEqual(
    documentBlockSignature(visual("vis-1")),
    documentBlockSignature(visual("vis-2")),
  );
});

// ---------------------------------------------------------------------------
// hashDocumentBlock
// ---------------------------------------------------------------------------

test("hashDocumentBlock is deterministic: same block always same hash", () => {
  const block = para("Stable text");
  assert.equal(hashDocumentBlock(block), hashDocumentBlock(block));
  assert.equal(
    hashDocumentBlock(block),
    hashDocumentBlock(para("Stable text")),
  );
});

test("hashDocumentBlock returns 8-char hex string", () => {
  const hash = hashDocumentBlock(para("Test"));
  assert.match(hash, /^[0-9a-f]{8}$/);
});

test("hashDocumentBlock differs for different text", () => {
  assert.notEqual(
    hashDocumentBlock(para("AAA")),
    hashDocumentBlock(para("BBB")),
  );
});

test("hashDocumentBlock differs for heading vs paragraph with same text", () => {
  assert.notEqual(
    hashDocumentBlock(para("Section")),
    hashDocumentBlock(heading("Section", 1)),
  );
});

test("hashDocumentBlock differs for h1 vs h2 same text", () => {
  assert.notEqual(
    hashDocumentBlock(heading("Title", 1)),
    hashDocumentBlock(heading("Title", 2)),
  );
});

test("hashDocumentBlock differs for visual vs text block", () => {
  assert.notEqual(
    hashDocumentBlock(para("vis-abc")),
    hashDocumentBlock(visual("vis-abc")),
  );
});

test("hashDocumentBlock is consistent across repeated calls (no mutation)", () => {
  const block = heading("Repeated", 2);
  const first = hashDocumentBlock(block);
  hashDocumentBlock(block);
  hashDocumentBlock(block);
  assert.equal(hashDocumentBlock(block), first);
});
