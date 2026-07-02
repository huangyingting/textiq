import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { DocumentBlock } from "@/lib/content";
import { hashDocumentBlock } from "@/lib/presentation/document-block-hash";
import { DEFAULT_STYLE, VISUAL_SCHEMA_VERSION } from "@/lib/visual/schema";
import { buildSourceBlockIndex, findSourceBlock } from "./block-index";

const blocks: DocumentBlock[] = [
  {
    kind: "text",
    blockType: "heading",
    level: 2,
    blockId: "text-1",
    text: "Quarterly results",
    runs: [{ text: "Quarterly results", bold: true }],
  },
  {
    kind: "table",
    blockId: "table-1",
    caption: "Revenue table",
    columns: [{ id: "c1", label: "Metric" }],
    rows: [{ id: "r1", cells: [{ text: "ARR" }] }],
  },
  {
    kind: "visual",
    visualId: "visual-1",
    visual: {
      version: VISUAL_SCHEMA_VERSION,
      type: "flowchart",
      title: "Revenue flow",
      width: 640,
      height: 360,
      nodes: [],
      edges: [],
      style: DEFAULT_STYLE,
    },
  },
];

describe("buildSourceBlockIndex", () => {
  test("indexes text, table, and visual blocks with hashes and refresh payloads", () => {
    const index = buildSourceBlockIndex("doc-1", blocks);

    assert.equal(index.documentId, "doc-1");
    assert.equal(index.blocks.length, 3);
    assert.deepEqual(
      index.blocks.map((block) => [block.id, block.kind, block.hash]),
      blocks.map((block) => {
        const id =
          block.kind === "visual" ? block.visualId : (block.blockId as string);
        return [id, block.kind, hashDocumentBlock(block)];
      }),
    );

    const text = index.blocks[0];
    assert.equal(text.displayLabel, "Quarterly results");
    assert.deepEqual(text.refresh, {
      kind: "text",
      text: "Quarterly results",
      runs: [{ text: "Quarterly results", bold: true }],
    });

    const table = index.blocks[1];
    assert.equal(table.displayLabel, "Revenue table");
    assert.deepEqual(table.refresh, {
      kind: "table",
      columns: [{ id: "c1", label: "Metric" }],
      rows: [{ id: "r1", cells: [{ text: "ARR" }] }],
      caption: "Revenue table",
    });

    const visual = index.blocks[2];
    assert.equal(visual.displayLabel, "Revenue flow");
    assert.deepEqual(visual.refresh, {
      kind: "visual",
      visualId: "visual-1",
      alt: "Revenue flow",
    });
  });

  test("finds blocks by id and optional kind without cross-kind matches", () => {
    const index = buildSourceBlockIndex("doc-1", blocks);

    assert.equal(findSourceBlock(index, { blockId: "text-1" })?.kind, "text");
    assert.equal(
      findSourceBlock(index, { blockId: "text-1", blockKind: "table" }),
      undefined,
    );
  });
});
