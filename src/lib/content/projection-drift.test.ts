import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDeckSource } from "@/lib/ai/deck-source";
import { buildDeckFromBlocks } from "../document/deck-kernel/deck";
import { buildPresentationBlocks } from "../document/deck-kernel/present-blocks";
import type { Visual } from "@/lib/visual/schema";
import {
  collectDocumentBlocks,
  documentBlocksToPlainText,
  lexicalStateToPlainText,
  markdownToLexicalStateObject,
  type DocumentBlock,
} from "./index";

function visual(id: string): Visual {
  return {
    version: 1,
    type: "flowchart",
    title: "Launch flow",
    nodes: [{ id: `${id}-n1`, label: "Start" }],
    edges: [],
    style: {},
  } as unknown as Visual;
}

function text(value: string) {
  return { type: "text", text: value };
}

function state(children: unknown[]) {
  return { root: { type: "root", children } };
}

function summarizeBlocks(blocks: ReadonlyArray<DocumentBlock>) {
  return blocks.map((block) => {
    if (block.kind === "visual") {
      return `visual:${block.visualId}`;
    }
    if (block.kind === "table") {
      return `table:${block.columns.map((column) => column.label).join("|")}`;
    }
    return `${block.blockType}:${block.level ?? ""}:${block.text}`;
  });
}

test("Markdown import, plain text, document blocks, and deck source stay aligned", () => {
  const lexical = markdownToLexicalStateObject(
    "# Launch\n\nIntro paragraph\n\n- First\n- Second",
  );
  const blocks = collectDocumentBlocks(lexical);

  assert.deepEqual(summarizeBlocks(blocks), [
    "heading:1:Launch",
    "paragraph::Intro paragraph",
    "listitem::First",
    "listitem::Second",
  ]);
  const blockIds = blocks.flatMap((block) =>
    block.kind === "text" && block.blockId ? [block.blockId] : [],
  );
  assert.ok(
    blocks.every((block) => block.kind !== "text" || block.blockId),
    "markdown-derived text blocks must carry durable block ids",
  );
  assert.equal(new Set(blockIds).size, blockIds.length);
  assert.equal(
    lexicalStateToPlainText(lexical),
    "Launch\nIntro paragraph\nFirst\nSecond",
  );
  assert.equal(
    buildDeckSource(lexical, new Map()).outline,
    "# Launch\nIntro paragraph\n- First\n- Second",
  );
  assert.deepEqual(buildPresentationBlocks(lexical), blocks);
});

test("Lexical projections agree for quotes, horizontal rules, and visuals", () => {
  const v1 = visual("v1");
  const lexical = state([
    { type: "heading", tag: "h1", bid: "b-title", children: [text("Launch")] },
    { type: "paragraph", bid: "b-intro", children: [text("Intro")] },
    {
      type: "list",
      children: [
        { type: "listitem", bid: "b-first", children: [text("First")] },
        { type: "listitem", bid: "b-second", children: [text("Second")] },
      ],
    },
    { type: "quote", bid: "b-quote", children: [text("Quote")] },
    { type: "horizontalrule", bid: "b-hr" },
    { type: "visual", visualId: "v1", visual: v1 },
    { type: "heading", tag: "h2", bid: "b-close", children: [text("Close")] },
  ]);

  const blocks = collectDocumentBlocks(lexical);

  assert.deepEqual(summarizeBlocks(blocks), [
    "heading:1:Launch",
    "paragraph::Intro",
    "listitem::First",
    "listitem::Second",
    "quote::Quote",
    "hr::",
    "visual:v1",
    "heading:2:Close",
  ]);
  assert.equal(
    documentBlocksToPlainText(blocks, { includeVisualMarkers: true }),
    "Launch\nIntro\nFirst\nSecond\nQuote\n---\n[visual: v1]\nClose",
  );
  assert.equal(
    buildDeckSource(lexical, new Map([["v1", v1]])).outline,
    "# Launch\nIntro\n- First\n- Second\n> Quote\n---\n[visual: v1]\n## Close",
  );
  assert.deepEqual(buildPresentationBlocks(lexical), blocks);
  assert.equal(buildDeckFromBlocks(blocks).slides[0].title, "Launch");
});
