import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SourceBlockIndexEntry } from "./block-index";
import {
  createDocumentSourceNode,
  documentSourceInsertBlocks,
  sourceBlockKindLabel,
  type DocumentSourceInsertBlock,
} from "./document-source-commands";

const textBlock: SourceBlockIndexEntry = {
  documentId: "doc-1",
  id: "text-1",
  kind: "text",
  hash: "hash-text-1",
  displayLabel: "Executive summary",
  refresh: {
    kind: "text",
    text: "Executive summary",
    runs: [{ text: "Executive", bold: true }, { text: " summary" }],
  },
};

const tableBlock: SourceBlockIndexEntry = {
  documentId: "doc-1",
  id: "table-1",
  kind: "table",
  hash: "hash-table-1",
  displayLabel: "Revenue table",
  refresh: {
    kind: "table",
    columns: [{ id: "col-1", label: "Quarter" }],
    rows: [{ id: "row-1", cells: [{ text: "Q1" }] }],
    caption: "Quarterly revenue",
  },
};

const visualBlock: SourceBlockIndexEntry = {
  documentId: "doc-1",
  id: "visual-1",
  kind: "visual",
  hash: "hash-visual-1",
  displayLabel: "Pipeline chart",
  refresh: {
    kind: "visual",
    visualId: "visual-1",
    alt: "Pipeline",
  },
};

const textInsertBlock = textBlock as DocumentSourceInsertBlock;
const tableInsertBlock = tableBlock as DocumentSourceInsertBlock;
const visualInsertBlock = visualBlock as DocumentSourceInsertBlock;

describe("document-source-commands", () => {
  test("filters source blocks to insertable kinds", () => {
    const insertables = documentSourceInsertBlocks({
      documentId: "doc-1",
      blocks: [
        textBlock,
        {
          documentId: "doc-1",
          id: "image-1",
          kind: "image",
          hash: "hash-image-1",
          displayLabel: "Diagram image",
          refresh: { kind: "image", assetId: "asset-1" },
        },
        tableBlock,
      ],
    });
    assert.deepEqual(
      insertables.map((entry) => `${entry.kind}:${entry.id}`),
      ["text:text-1", "table:table-1"],
    );
  });

  test("creates source-linked nodes for text, table, and visual blocks", () => {
    const linkedAt = "2026-07-01T00:00:00.000Z";
    const textNode = createDocumentSourceNode({
      block: textInsertBlock,
      nodeId: "text-node",
      zIndex: 3,
      linkedAt,
    });
    assert.equal(textNode.type, "text");
    assert.equal(textNode.source?.blockKind, "text");
    assert.equal(textNode.source?.blockId, "text-1");
    assert.equal(textNode.source?.contentHash, "hash-text-1");
    assert.equal(textNode.source?.refresh?.state, "fresh");

    const tableNode = createDocumentSourceNode({
      block: tableInsertBlock,
      nodeId: "table-node",
      zIndex: 4,
      linkedAt,
    });
    assert.equal(tableNode.type, "table");
    assert.equal(tableNode.source?.blockKind, "table");
    assert.equal(tableNode.source?.blockId, "table-1");
    assert.equal(tableNode.source?.contentHash, "hash-table-1");

    const visualNode = createDocumentSourceNode({
      block: visualInsertBlock,
      nodeId: "visual-node",
      zIndex: 5,
      linkedAt,
    });
    assert.equal(visualNode.type, "visual");
    assert.equal(visualNode.source?.blockKind, "visual");
    assert.equal(visualNode.source?.blockId, "visual-1");
    assert.equal(visualNode.source?.contentHash, "hash-visual-1");
  });

  test("labels source block kinds for command surfaces", () => {
    assert.equal(sourceBlockKindLabel("text"), "Text");
    assert.equal(sourceBlockKindLabel("table"), "Table");
    assert.equal(sourceBlockKindLabel("visual"), "Visual");
  });
});
