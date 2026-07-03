/**
 * Unit tests for infographic-layout.ts — pure layout engine.
 *
 * Run with: node --import tsx --test src/lib/visual/infographic-layout.test.ts
 *
 * All tests are pure (no DOM, no canvas, no browser APIs).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { DocumentBlock } from "@/lib/content";
import type { Visual } from "@/lib/visual/schema";
import {
  computeInfographicLayout,
  estimateTextHeight,
  DEFAULT_INFOGRAPHIC_CONFIG,
  INFOGRAPHIC_WIDTH_PRESETS,
  type InfographicConfig,
} from "./infographic-layout";

// ---------------------------------------------------------------------------
// Test-fixture helpers
// ---------------------------------------------------------------------------

function visualFixture(value: unknown): Visual {
  return value as unknown as Visual;
}

function textBlock(
  blockType: "paragraph" | "heading" | "quote" | "listitem" | "hr",
  text: string,
  level?: 1 | 2 | 3,
): DocumentBlock {
  if (blockType === "heading") {
    return { kind: "text", blockType: "heading", level: level ?? 2, text };
  }
  if (blockType === "hr") {
    return { kind: "text", blockType: "hr", text: "" };
  }
  return { kind: "text", blockType, text } as DocumentBlock;
}

function visualBlock(visualId: string): DocumentBlock {
  return {
    kind: "visual",
    visualId,
    visual: visualFixture({
      version: 1,
      type: "flowchart",
      nodes: [],
      edges: [],
      style: {},
    }),
  };
}

/** Minimal config for predictable tests. */
const CFG: InfographicConfig = {
  width: 1000,
  paddingX: 100,
  paddingY: 50,
  gap: 20,
  fontH1: 40,
  fontH2: 30,
  fontH3: 24,
  fontBody: 20,
  lineHeight: 1.5,
  headingTopMargin: 30,
};

// Derived value: content width = 1000 - 100*2 = 800
const CONTENT_W = 800;

// ---------------------------------------------------------------------------
// estimateTextHeight
// ---------------------------------------------------------------------------

test("estimateTextHeight: empty text returns one line height", () => {
  const h = estimateTextHeight("", 20, 800, 1.5);
  assert.equal(h, 20 * 1.5);
});

test("estimateTextHeight: single char returns one line height", () => {
  const h = estimateTextHeight("a", 20, 800, 1.5);
  assert.equal(h, 20 * 1.5);
});

test("estimateTextHeight: text that fits in one line returns one line height", () => {
  // fontSize=20, avgCharW=11, charsPerLine=floor(800/11)=72
  // "Hello" = 5 chars → 1 line
  const h = estimateTextHeight("Hello", 20, 800, 1.5);
  assert.equal(h, 20 * 1.5);
});

test("estimateTextHeight: long text wraps into multiple lines", () => {
  // fontSize=20, avgCharW=11, charsPerLine=72
  // 145-char string → ceil(145/72)=3 lines
  const longText = "a".repeat(145);
  const h = estimateTextHeight(longText, 20, 800, 1.5);
  assert.equal(h, 3 * 20 * 1.5);
});

test("estimateTextHeight: zero contentWidth returns fallback one line", () => {
  const h = estimateTextHeight("Hello", 20, 0, 1.5);
  assert.equal(h, 20 * 1.5);
});

test("estimateTextHeight: larger font → fewer chars per line → more lines", () => {
  // Same text, larger font = more lines
  const shortText = "a".repeat(100);
  const hSmall = estimateTextHeight(shortText, 10, 800, 1.5);
  const hLarge = estimateTextHeight(shortText, 30, 800, 1.5);
  assert.ok(hSmall < hLarge, "larger font should produce taller block");
});

test("estimateTextHeight: scales proportionally with lineHeight", () => {
  const h1 = estimateTextHeight("Hello", 20, 800, 1.0);
  const h2 = estimateTextHeight("Hello", 20, 800, 2.0);
  assert.equal(h2, h1 * 2);
});

// ---------------------------------------------------------------------------
// computeInfographicLayout — empty / structural
// ---------------------------------------------------------------------------

test("empty blocks → totalHeight equals paddingY * 2", () => {
  const layout = computeInfographicLayout([], CFG);
  assert.equal(layout.totalHeight, CFG.paddingY * 2);
  assert.equal(layout.blocks.length, 0);
  assert.equal(layout.contentWidth, CONTENT_W);
});

test("contentWidth is width minus 2 * paddingX", () => {
  const layout = computeInfographicLayout([], CFG);
  assert.equal(layout.contentWidth, CFG.width - CFG.paddingX * 2);
});

// ---------------------------------------------------------------------------
// computeInfographicLayout — single block y-offset
// ---------------------------------------------------------------------------

test("first block starts at paddingY", () => {
  const blocks: DocumentBlock[] = [textBlock("paragraph", "Hello")];
  const layout = computeInfographicLayout(blocks, CFG);
  assert.equal(layout.blocks[0].y, CFG.paddingY);
});

test("second block starts at: paddingY + block0Height + gap", () => {
  const blocks: DocumentBlock[] = [
    textBlock("paragraph", "First"),
    textBlock("paragraph", "Second"),
  ];
  const layout = computeInfographicLayout(blocks, CFG);
  const b0 = layout.blocks[0];
  const b1 = layout.blocks[1];
  assert.equal(b1.y, b0.y + b0.height + CFG.gap);
});

test("heading (non-first) block gets gap + headingTopMargin above it", () => {
  const blocks: DocumentBlock[] = [
    textBlock("paragraph", "Intro text"),
    textBlock("heading", "Chapter", 2),
  ];
  const layout = computeInfographicLayout(blocks, CFG);
  const b0 = layout.blocks[0];
  const b1 = layout.blocks[1];
  assert.equal(b1.y, b0.y + b0.height + CFG.gap + CFG.headingTopMargin);
});

test("heading as first block does NOT get headingTopMargin", () => {
  const blocks: DocumentBlock[] = [
    textBlock("heading", "Title", 1),
    textBlock("paragraph", "Body"),
  ];
  const layout = computeInfographicLayout(blocks, CFG);
  // First block starts at paddingY — no extra margin
  assert.equal(layout.blocks[0].y, CFG.paddingY);
  // Second block: gap only (no headingTopMargin for paragraph)
  const b0 = layout.blocks[0];
  const b1 = layout.blocks[1];
  assert.equal(b1.y, b0.y + b0.height + CFG.gap);
});

// ---------------------------------------------------------------------------
// computeInfographicLayout — block heights
// ---------------------------------------------------------------------------

test("paragraph height uses fontBody", () => {
  const text = "Short";
  const blocks: DocumentBlock[] = [textBlock("paragraph", text)];
  const layout = computeInfographicLayout(blocks, CFG);
  const expected = estimateTextHeight(
    text,
    CFG.fontBody,
    CONTENT_W,
    CFG.lineHeight,
  );
  assert.equal(layout.blocks[0].height, expected);
});

test("h1 heading height uses fontH1", () => {
  const text = "Big Title";
  const blocks: DocumentBlock[] = [textBlock("heading", text, 1)];
  const layout = computeInfographicLayout(blocks, CFG);
  const expected = estimateTextHeight(
    text,
    CFG.fontH1,
    CONTENT_W,
    CFG.lineHeight,
  );
  assert.equal(layout.blocks[0].height, expected);
});

test("h2 heading height uses fontH2", () => {
  const text = "Section";
  const blocks: DocumentBlock[] = [textBlock("heading", text, 2)];
  const layout = computeInfographicLayout(blocks, CFG);
  const expected = estimateTextHeight(
    text,
    CFG.fontH2,
    CONTENT_W,
    CFG.lineHeight,
  );
  assert.equal(layout.blocks[0].height, expected);
});

test("h3 heading height uses fontH3", () => {
  const text = "Subsection";
  const blocks: DocumentBlock[] = [textBlock("heading", text, 3)];
  const layout = computeInfographicLayout(blocks, CFG);
  const expected = estimateTextHeight(
    text,
    CFG.fontH3,
    CONTENT_W,
    CFG.lineHeight,
  );
  assert.equal(layout.blocks[0].height, expected);
});

test("hr block has height 1", () => {
  const blocks: DocumentBlock[] = [textBlock("hr", "")];
  const layout = computeInfographicLayout(blocks, CFG);
  assert.equal(layout.blocks[0].height, 1);
});

test("listitem height uses fontBody with reduced width", () => {
  const text = "A list item";
  const blocks: DocumentBlock[] = [textBlock("listitem", text)];
  const layout = computeInfographicLayout(blocks, CFG);
  const expected = estimateTextHeight(
    text,
    CFG.fontBody,
    Math.max(1, CONTENT_W - 32),
    CFG.lineHeight,
  );
  assert.equal(layout.blocks[0].height, expected);
});

test("quote uses fontBody with reduced width", () => {
  const text = "A profound quote";
  const blocks: DocumentBlock[] = [textBlock("quote", text)];
  const layout = computeInfographicLayout(blocks, CFG);
  const expected = estimateTextHeight(
    text,
    CFG.fontBody,
    Math.max(1, CONTENT_W - CFG.paddingX * 0.5),
    CFG.lineHeight,
  );
  assert.equal(layout.blocks[0].height, expected);
});

// ---------------------------------------------------------------------------
// computeInfographicLayout — visual blocks
// ---------------------------------------------------------------------------

test("visual block with known dimensions uses aspect ratio", () => {
  const cfg: InfographicConfig = {
    ...CFG,
    visualDimensions: { v1: { width: 400, height: 200 } }, // 2:1 ratio
  };
  const blocks: DocumentBlock[] = [visualBlock("v1")];
  const layout = computeInfographicLayout(blocks, cfg);
  // contentWidth = 800, ratio = 200/400 = 0.5 → height = 800 * 0.5 = 400
  assert.equal(layout.blocks[0].height, 400);
});

test("visual block uses visualDefaultHeight when no dims and no default config", () => {
  const cfg: InfographicConfig = { ...CFG, visualDefaultHeight: 300 };
  const blocks: DocumentBlock[] = [visualBlock("v-unknown")];
  const layout = computeInfographicLayout(blocks, cfg);
  assert.equal(layout.blocks[0].height, 300);
});

test("visual block falls back to 16:9 when no dims and no visualDefaultHeight", () => {
  const blocks: DocumentBlock[] = [visualBlock("v-unknown")];
  const layout = computeInfographicLayout(blocks, CFG);
  const expected = Math.round(CONTENT_W * (9 / 16));
  assert.equal(layout.blocks[0].height, expected);
});

test("visual block with zero-area dims falls back to default", () => {
  const cfg: InfographicConfig = {
    ...CFG,
    visualDimensions: { v1: { width: 0, height: 0 } },
    visualDefaultHeight: 250,
  };
  const blocks: DocumentBlock[] = [visualBlock("v1")];
  const layout = computeInfographicLayout(blocks, cfg);
  assert.equal(layout.blocks[0].height, 250);
});

// ---------------------------------------------------------------------------
// computeInfographicLayout — totalHeight accounting
// ---------------------------------------------------------------------------

test("totalHeight = paddingY + sum(heights) + sum(gaps) + paddingY", () => {
  const blocks: DocumentBlock[] = [
    textBlock("paragraph", "A"),
    textBlock("paragraph", "B"),
    textBlock("paragraph", "C"),
  ];
  const layout = computeInfographicLayout(blocks, CFG);
  const h0 = layout.blocks[0].height;
  const h1 = layout.blocks[1].height;
  const h2 = layout.blocks[2].height;
  // All paragraphs → no headingTopMargin
  const expected =
    CFG.paddingY + h0 + CFG.gap + h1 + CFG.gap + h2 + CFG.paddingY;
  assert.equal(layout.totalHeight, expected);
});

test("totalHeight accounts for headingTopMargin", () => {
  const blocks: DocumentBlock[] = [
    textBlock("paragraph", "Intro"),
    textBlock("heading", "Title", 1),
  ];
  const layout = computeInfographicLayout(blocks, CFG);
  const h0 = layout.blocks[0].height;
  const h1 = layout.blocks[1].height;
  const expected =
    CFG.paddingY + h0 + CFG.gap + CFG.headingTopMargin + h1 + CFG.paddingY;
  assert.equal(layout.totalHeight, expected);
});

test("blockIndex matches input array index", () => {
  const blocks: DocumentBlock[] = [
    textBlock("heading", "T", 1),
    textBlock("paragraph", "P"),
    visualBlock("v1"),
  ];
  const layout = computeInfographicLayout(blocks, CFG);
  layout.blocks.forEach((b, i) => {
    assert.equal(b.blockIndex, i);
  });
});

test("blocks are in strict ascending y order", () => {
  const blocks: DocumentBlock[] = [
    textBlock("heading", "Title", 1),
    textBlock("paragraph", "First paragraph with some text"),
    visualBlock("v1"),
    textBlock("paragraph", "Second paragraph"),
    textBlock("heading", "Section", 2),
  ];
  const layout = computeInfographicLayout(blocks, CFG);
  for (let i = 1; i < layout.blocks.length; i++) {
    assert.ok(
      layout.blocks[i].y > layout.blocks[i - 1].y,
      `block ${i} y should be greater than block ${i - 1} y`,
    );
  }
});

test("all block heights are positive", () => {
  const blocks: DocumentBlock[] = [
    textBlock("heading", "Title", 1),
    textBlock("paragraph", "Body"),
    textBlock("quote", "Quote"),
    textBlock("listitem", "Item"),
    textBlock("hr", ""),
    visualBlock("v1"),
  ];
  const layout = computeInfographicLayout(blocks, CFG);
  for (const b of layout.blocks) {
    assert.ok(
      b.height > 0,
      `block ${b.blockIndex} should have positive height`,
    );
  }
});

// ---------------------------------------------------------------------------
// DEFAULT_INFOGRAPHIC_CONFIG smoke test
// ---------------------------------------------------------------------------

test("DEFAULT_INFOGRAPHIC_CONFIG produces valid layout for mixed document", () => {
  const blocks: DocumentBlock[] = [
    textBlock("heading", "Infographic Title", 1),
    textBlock("paragraph", "This is an introductory paragraph with some text."),
    visualBlock("chart-1"),
    textBlock("heading", "Section Two", 2),
    textBlock("listitem", "First point"),
    textBlock("listitem", "Second point"),
    textBlock("quote", "A notable quote from someone important"),
    textBlock("hr", ""),
    textBlock("paragraph", "Concluding remarks."),
  ];

  const layout = computeInfographicLayout(blocks, DEFAULT_INFOGRAPHIC_CONFIG);
  assert.equal(layout.blocks.length, blocks.length);
  assert.ok(layout.totalHeight > 0, "total height must be positive");
  assert.equal(
    layout.contentWidth,
    DEFAULT_INFOGRAPHIC_CONFIG.width - DEFAULT_INFOGRAPHIC_CONFIG.paddingX * 2,
  );

  // All block y-offsets should be within [paddingY, totalHeight - paddingY]
  for (const b of layout.blocks) {
    assert.ok(
      b.y >= DEFAULT_INFOGRAPHIC_CONFIG.paddingY,
      `block ${b.blockIndex} y must be >= paddingY`,
    );
    assert.ok(
      b.y < layout.totalHeight,
      `block ${b.blockIndex} y must be < totalHeight`,
    );
  }
});

// ---------------------------------------------------------------------------
// INFOGRAPHIC_WIDTH_PRESETS
// ---------------------------------------------------------------------------

test("width presets have positive widths and non-empty labels", () => {
  for (const [key, preset] of Object.entries(INFOGRAPHIC_WIDTH_PRESETS)) {
    assert.ok(preset.width > 0, `preset ${key} must have positive width`);
    assert.ok(preset.label.length > 0, `preset ${key} must have a label`);
  }
});

test("preset '1080' has width 1080", () => {
  assert.equal(INFOGRAPHIC_WIDTH_PRESETS["1080"].width, 1080);
});
