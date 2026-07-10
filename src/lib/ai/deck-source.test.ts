import assert from "node:assert/strict";
import { test } from "node:test";

import { AI_GENERATION_INPUT_MAX_CHARS } from "@/lib/limits/ai";
import type { Visual } from "@/lib/visual/schema";
import {
  FORMAT_BOLD,
  FORMAT_CODE,
  FORMAT_ITALIC,
  buildContentJson as state,
  buildHeadingNode as heading,
  buildHorizontalRuleNode as hr,
  buildListNode as list,
  buildParagraphNode,
  buildQuoteNode as quote,
  buildTextNode,
  buildVisualLexicalNode as visualNode,
  type SerializedFixtureTextNode,
  type SerializedFixtureRootChild,
} from "@/test/builders/lexical";
import {
  buildVisual,
  buildVisualMap as visualMap,
  buildVisualNode,
} from "@/test/builders/visual";
import { buildDeckSource } from "./deck-source";

function visual(id: string, overrides: Partial<Visual> = {}): Visual {
  const built = buildVisual({
    nodes: [
      buildVisualNode({ id: `${id}-n1`, label: "Start" }),
      buildVisualNode({ id: `${id}-n2`, label: "Finish", x: 360 }),
    ],
    edges: [],
    ...overrides,
  });
  if (!("title" in overrides)) {
    delete built.title;
  }
  return built;
}

function text(value: string, format = 0): SerializedFixtureTextNode {
  return buildTextNode(value, { format });
}

function paragraph(
  ...children: SerializedFixtureTextNode[]
): SerializedFixtureRootChild {
  return buildParagraphNode(children);
}

// ---------------------------------------------------------------------------
// Rich document — headings + bullets + emphasis + visual
// ---------------------------------------------------------------------------

test("rich document folds into a structured outline", () => {
  const doc = state([
    heading(1, "Title"),
    paragraph(text("Intro paragraph.")),
    heading(2, "Section"),
    list(["First point", "Second point"]),
    visualNode("v1"),
    quote("A pithy quote"),
    hr(),
    heading(3, "Closing"),
  ]);

  const { outline, visualInventory } = buildDeckSource(
    doc,
    visualMap(["v1", visual("v1")]),
  );

  assert.equal(
    outline,
    [
      "# Title",
      "Intro paragraph.",
      "## Section",
      "- First point",
      "- Second point",
      "[visual: v1]",
      "> A pithy quote",
      "---",
      "### Closing",
    ].join("\n"),
  );

  assert.deepEqual(
    visualInventory.map((item) => item.id),
    ["v1"],
  );
});

test("inline emphasis is preserved with cheap markers", () => {
  const doc = state([
    paragraph(
      text("plain "),
      text("bold", FORMAT_BOLD),
      text(" "),
      text("italic", FORMAT_ITALIC),
      text(" "),
      text("code", FORMAT_CODE),
    ),
  ]);

  const { outline } = buildDeckSource(doc, visualMap());

  assert.equal(outline, "plain **bold** *italic* `code`");
});

// ---------------------------------------------------------------------------
// Headings-only
// ---------------------------------------------------------------------------

test("headings-only document keeps every heading level", () => {
  const doc = state([
    heading(1, "One"),
    heading(2, "Two"),
    heading(3, "Three"),
  ]);

  const { outline, visualInventory } = buildDeckSource(doc, visualMap());

  assert.equal(outline, "# One\n## Two\n### Three");
  assert.deepEqual(visualInventory, []);
});

// ---------------------------------------------------------------------------
// No visuals
// ---------------------------------------------------------------------------

test("document with no visuals yields an empty inventory", () => {
  const doc = state([heading(1, "Doc"), paragraph(text("Body text."))]);

  const { outline, visualInventory } = buildDeckSource(doc, visualMap());

  assert.equal(outline, "# Doc\nBody text.");
  assert.deepEqual(visualInventory, []);
});

// ---------------------------------------------------------------------------
// Visuals-only
// ---------------------------------------------------------------------------

test("visuals-only document references each visual inline and in inventory", () => {
  const va = visual("va", { title: "Alpha Flow" } as Partial<Visual>);
  const vb = visual("vb", { type: "mindmap" } as Partial<Visual>);
  const doc = state([visualNode("va", va), visualNode("vb", vb)]);

  const { outline, visualInventory } = buildDeckSource(
    doc,
    visualMap(["va", va], ["vb", vb]),
  );

  assert.equal(outline, "[visual: va]\n[visual: vb]");

  assert.deepEqual(
    visualInventory.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
    })),
    [
      { id: "va", title: "Alpha Flow", type: "flowchart" },
      { id: "vb", title: "Mindmap", type: "mindmap" },
    ],
  );

  for (const item of visualInventory) {
    assert.ok(item.summary.length <= 120);
  }
  assert.equal(visualInventory[0].summary, "Start, Finish");
});

test("inventory ids only include real document visuals, deduplicated in order", () => {
  const doc = state([
    visualNode("v1"),
    paragraph(text("between")),
    visualNode("v2"),
    visualNode("v1"),
  ]);

  // Map carries an extra visual the document never references.
  const { visualInventory } = buildDeckSource(
    doc,
    visualMap(
      ["v1", visual("v1")],
      ["v2", visual("v2")],
      ["ghost", visual("ghost")],
    ),
  );

  assert.deepEqual(
    visualInventory.map((item) => item.id),
    ["v1", "v2"],
  );
});

test("inventory falls back to the embedded visual when the map lacks it", () => {
  const embedded = visual("v1", { title: "Embedded" } as Partial<Visual>);
  const doc = state([visualNode("v1", embedded)]);

  const { visualInventory } = buildDeckSource(doc, visualMap());

  assert.equal(visualInventory.length, 1);
  assert.equal(visualInventory[0].title, "Embedded");
});

// ---------------------------------------------------------------------------
// Huge document — truncation keeps headings under the budget
// ---------------------------------------------------------------------------

test("huge document is truncated to AI_GENERATION_INPUT_MAX_CHARS while retaining headings", () => {
  const children: SerializedFixtureRootChild[] = [];
  const headingTexts: string[] = [];
  for (let i = 0; i < 200; i++) {
    const headingText = `Section ${i}`;
    headingTexts.push(headingText);
    children.push(heading(2, headingText));
    // Long detail paragraph to blow past the budget.
    children.push(paragraph(text(`detail ${i} ` + "x".repeat(200))));
  }

  const { outline, truncated } = buildDeckSource(state(children), visualMap());

  assert.ok(
    outline.length <= AI_GENERATION_INPUT_MAX_CHARS,
    `outline length ${outline.length} exceeds ${AI_GENERATION_INPUT_MAX_CHARS}`,
  );

  assert.equal(truncated, true, "huge document must report truncated=true");

  // Every heading must survive, in order, even though detail was dropped.
  const headingLines = outline
    .split("\n")
    .filter((line) => line.startsWith("## "));
  assert.deepEqual(
    headingLines,
    headingTexts.map((t) => `## ${t}`),
  );
});

test("truncation is deterministic and never alters leading content", () => {
  const children: SerializedFixtureRootChild[] = [heading(1, "Top")];
  for (let i = 0; i < 500; i++) {
    children.push(paragraph(text(`para ${i} ` + "y".repeat(100))));
  }
  const doc = state(children);

  const a = buildDeckSource(doc, visualMap()).outline;
  const b = buildDeckSource(doc, visualMap()).outline;

  assert.equal(a, b);
  assert.ok(a.startsWith("# Top\npara 0 "));
  assert.ok(a.length <= AI_GENERATION_INPUT_MAX_CHARS);
});

test("small document reports truncated=false and keeps all content", () => {
  const children: SerializedFixtureRootChild[] = [
    heading(1, "Top"),
    paragraph(text("A short paragraph.")),
    heading(2, "Next"),
    paragraph(text("Another short paragraph.")),
  ];

  const { outline, truncated, originalChars, keptChars } = buildDeckSource(
    state(children),
    visualMap(),
  );

  assert.equal(truncated, false, "small document must report truncated=false");
  assert.equal(keptChars, outline.length);
  assert.equal(originalChars, keptChars);
  assert.ok(outline.includes("A short paragraph."));
  assert.ok(outline.includes("Another short paragraph."));
});

// ---------------------------------------------------------------------------
// Empty / malformed — never throws
// ---------------------------------------------------------------------------

test("empty document returns a minimal valid source without throwing", () => {
  const result = buildDeckSource(state([]), visualMap());
  assert.deepEqual(result, {
    outline: "",
    visualInventory: [],
    truncated: false,
    originalChars: 0,
    keptChars: 0,
  });
});

test("malformed input does not throw", () => {
  for (const bad of ["not json", null, undefined, {}, 42]) {
    const result = buildDeckSource(bad, visualMap());
    assert.equal(result.outline, "");
    assert.deepEqual(result.visualInventory, []);
  }
});
