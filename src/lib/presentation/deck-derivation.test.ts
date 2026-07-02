import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveDeckFromDocumentContent } from "./deck-derivation";
import type { SlideChildNode } from "./schema";

function collectNodes(nodes: ReadonlyArray<SlideChildNode>): SlideChildNode[] {
  const flattened: SlideChildNode[] = [];
  const walk = (list: ReadonlyArray<SlideChildNode>) => {
    for (const node of list) {
      flattened.push(node);
      if (node.type === "group") {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return flattened;
}

test("deriveDeckFromDocumentContent builds populated Deck with source metadata", () => {
  const contentJson = JSON.stringify({
    root: {
      type: "root",
      children: [
        {
          type: "heading",
          tag: "h1",
          bid: "heading-1",
          children: [{ type: "text", text: "Quarterly business review" }],
        },
        {
          type: "paragraph",
          bid: "paragraph-1",
          children: [
            { type: "text", text: "Revenue grew 24% year-over-year." },
          ],
        },
        {
          type: "list",
          children: [
            {
              type: "listitem",
              bid: "list-1",
              children: [
                { type: "text", text: "Expand the EU product launch" },
              ],
            },
          ],
        },
        {
          type: "table",
          bid: "table-1",
          children: [
            {
              type: "tablerow",
              children: [
                {
                  type: "tablecell",
                  children: [{ type: "text", text: "KPI" }],
                },
                {
                  type: "tablecell",
                  children: [{ type: "text", text: "Result" }],
                },
              ],
            },
            {
              type: "tablerow",
              children: [
                {
                  type: "tablecell",
                  children: [{ type: "text", text: "NPS" }],
                },
                { type: "tablecell", children: [{ type: "text", text: "58" }] },
              ],
            },
          ],
        },
        {
          type: "visual",
          visualId: "visual-1",
          visual: {
            id: "visual-1",
            type: "flow",
            title: "Customer journey",
            nodes: [],
            edges: [],
          },
        },
      ],
    },
  });

  const result = deriveDeckFromDocumentContent({
    contentJson,
    documentId: "doc-1388",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.ok(result.deck.slides.length >= 3);
  assert.equal(result.deck.metadata?.sourceDocumentId, "doc-1388");

  const allNodes = result.deck.slides.flatMap((slide) =>
    collectNodes(slide.children),
  );
  assert.ok(allNodes.some((node) => node.type === "table"));
  const visualNode = allNodes.find((node) => node.type === "visual");
  assert.equal(visualNode?.type, "visual");
  if (visualNode?.type === "visual") {
    assert.equal(visualNode.content.visualId, "visual-1");
  }
  assert.ok(
    allNodes.some(
      (node) =>
        node.type === "text" &&
        node.content.paragraphs.some((paragraph) =>
          paragraph.text.includes("Revenue grew"),
        ),
    ),
  );
  assert.ok(
    allNodes.some(
      (node) =>
        node.source?.documentId === "doc-1388" &&
        typeof node.source.blockKind === "string",
    ),
  );
});

test("deriveDeckFromDocumentContent keeps safe blank behavior for malformed content", () => {
  const result = deriveDeckFromDocumentContent({
    contentJson: "{ this is not valid json",
    documentId: "doc-1388",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.deck.slides.length, 1);
  assert.equal(result.deck.slides[0].id, "slide-blank-1");
  assert.deepEqual(result.deck.slides[0].children, []);
  assert.equal(result.deck.metadata?.sourceDocumentId, "doc-1388");
});
