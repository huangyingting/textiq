import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  narrateNode,
  truncateNarrationText,
} from "@/lib/presentation/a11y/node-narration";
import { resolveDeckRenderTree } from "@/lib/presentation/render-resolver";
import type {
  ConnectorNode,
  DeckAssetRegistry,
  SlideChildNode,
} from "@/lib/presentation/schema";
import type { ResolvedRenderNode } from "@/lib/presentation/render-tree";
import {
  buildDeck,
  buildImageAsset,
  buildImageNode,
  buildLayoutBox,
  buildMinimalThemePackage,
  buildShapeNode,
  buildSlide,
  buildTableNode,
  buildTextContent,
  buildTextNode,
  buildVisualNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";

function resolveNode(
  node: SlideChildNode,
  assets?: DeckAssetRegistry,
): ResolvedRenderNode {
  const deck = buildDeck([buildSlide("content", [node])], {
    ...(assets ? { assets } : {}),
  });
  const resolved = resolveDeckRenderTree(deck, buildMinimalThemePackage());
  const resolvedNode = resolved.slides[0].nodes[0];
  assert.ok(resolvedNode);
  return resolvedNode;
}

describe("narrateNode", () => {
  test("creates stable text previews with truncation and empty text warnings", () => {
    resetBuilderCounter();
    assert.equal(truncateNarrationText("  A   B\nC  ", 4), "A B…");
    assert.equal(truncateNarrationText("abcdef", 1), "…");

    const longText = resolveNode(
      buildTextNode({
        role: "title",
        content: buildTextContent([
          "This is a deliberately long title that should be shortened",
        ]),
      }),
    );
    const emptyText = resolveNode(
      buildTextNode({
        content: { paragraphs: [{ id: "empty", text: "   " }] },
      }),
    );

    assert.equal(
      narrateNode(longText, { maxTextPreviewLength: 24 }).label,
      "Title: This is a deliberately…",
    );
    assert.deepEqual(narrateNode(emptyText).warnings, ["empty-text"]);
    assert.equal(narrateNode(emptyText).label, "Text: Empty text");
  });

  test("uses image alt text and reports deterministic missing-alt fallback", () => {
    resetBuilderCounter();
    const assets = {
      images: {
        assetAlt: buildImageAsset("assetAlt", { alt: "Asset alt text" }),
      },
    };
    const contentAlt = resolveNode(
      buildImageNode("assetAlt", {
        content: { assetId: "assetAlt", alt: "Node alt" },
      }),
      assets,
    );
    const assetAlt = resolveNode(buildImageNode("assetAlt"), assets);
    const missingAlt = resolveNode(buildImageNode("missing"));

    assert.equal(narrateNode(contentAlt, { assets }).label, "Image: Node alt");
    assert.equal(
      narrateNode(assetAlt, { assets }).label,
      "Image: Asset alt text",
    );
    assert.equal(narrateNode(missingAlt).label, "Image: Missing alt text");
    assert.deepEqual(narrateNode(missingAlt).warnings, ["missing-alt"]);
  });

  test("describes shapes, decorative shapes, tables, and explicit labels", () => {
    resetBuilderCounter();
    const shape = resolveNode(
      buildShapeNode({ role: "callout", content: { shape: "diamond" } }),
    );
    const decorative = resolveNode(
      buildShapeNode({
        content: { shape: "rect" },
        accessibility: { decorative: true },
      }),
    );
    const explicit = resolveNode(
      buildShapeNode({ accessibility: { label: "Author provided label" } }),
    );
    const table = resolveNode(
      buildTableNode({
        content: {
          columns: [
            { id: "name", label: "Name" },
            { id: "value", label: "Value" },
          ],
          rows: [],
        },
      }),
    );

    assert.equal(narrateNode(shape).label, "Shape: callout diamond shape");
    assert.equal(
      narrateNode(decorative).label,
      "Decorative callout rectangle shape",
    );
    assert.deepEqual(narrateNode(decorative).warnings, ["decorative"]);
    assert.equal(narrateNode(explicit).label, "Author provided label");
    assert.equal(narrateNode(table).label, "Table: Table, 2 columns, 0 rows");
  });

  test("describes visuals from asset metadata and reports missing descriptions", () => {
    resetBuilderCounter();
    const assets: DeckAssetRegistry = {
      images: {},
      visuals: {
        chart: {
          id: "chart",
          visualId: "vis-1",
          title: "Revenue chart",
          alt: "Revenue by quarter",
        },
        titleOnly: {
          id: "titleOnly",
          visualId: "vis-2",
          title: "Pipeline chart",
        },
      },
    };
    const contentAlt = resolveNode(
      buildVisualNode({
        content: { assetId: "chart", alt: "Inline chart alt" },
      }),
      assets,
    );
    const assetAlt = resolveNode(
      buildVisualNode({ content: { assetId: "chart" } }),
      assets,
    );
    const titleOnly = resolveNode(
      buildVisualNode({ content: { assetId: "titleOnly" } }),
      assets,
    );
    const visualIdOnly = resolveNode(
      buildVisualNode({ content: { visualId: "embedded-visual" } }),
    );
    const missing = resolveNode(buildVisualNode({ content: {} }));

    assert.equal(
      narrateNode(contentAlt, { assets }).label,
      "Visual: Inline chart alt",
    );
    assert.equal(
      narrateNode(assetAlt, { assets }).label,
      "Visual: Revenue by quarter",
    );
    assert.equal(
      narrateNode(titleOnly, { assets }).label,
      "Visual: Pipeline chart",
    );
    assert.equal(narrateNode(visualIdOnly).label, "Visual: embedded-visual");
    assert.equal(narrateNode(missing).label, "Visual: Missing description");
    assert.deepEqual(narrateNode(missing).warnings, [
      "missing-visual-description",
    ]);
  });

  test("describes connectors and group child role summaries", () => {
    resetBuilderCounter();
    const unboundConnector: ConnectorNode = {
      id: "unbound",
      type: "connector",
      role: "connector",
      layout: buildLayoutBox(),
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "node", nodeId: "missing", anchor: "left" },
        to: { kind: "point", point: { x: 100, y: 50 } },
        routing: "curved",
      },
    };
    const pointConnector: ConnectorNode = {
      ...unboundConnector,
      id: "point",
      content: {
        from: { kind: "point", point: { x: 0, y: 50 } },
        to: { kind: "point", point: { x: 100, y: 50 } },
      },
    };
    const group = resolveNode({
      id: "group",
      type: "group",
      component: "custom",
      layout: buildLayoutBox(),
      children: [
        buildTextNode({ id: "child-text" }),
        buildShapeNode({
          id: "child-decorative",
          accessibility: { decorative: true },
        }),
        buildImageNode("missing", { id: "child-image" }),
      ],
    });

    assert.equal(
      narrateNode(resolveNode(unboundConnector)).label,
      "Connector: curved from unbound endpoint to point",
    );
    assert.deepEqual(narrateNode(resolveNode(unboundConnector)).warnings, [
      "unbound-connector",
    ]);
    assert.equal(
      narrateNode(resolveNode(pointConnector)).label,
      "Connector: straight from point to point",
    );
    assert.equal(narrateNode(group).label, "Group: 2 children (text, image)");
  });
});
