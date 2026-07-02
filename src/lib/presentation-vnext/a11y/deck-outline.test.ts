import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildDeckOutline } from "@/lib/presentation-vnext/a11y/deck-outline";
import { resolveDeckRenderTree } from "@/lib/presentation-vnext/render-resolver";
import type { ConnectorNode, GroupNode } from "@/lib/presentation-vnext/schema";
import {
  buildDeckV7,
  buildImageAsset,
  buildImageNode,
  buildLayoutBox,
  buildMinimalThemePackage,
  buildShapeNode,
  buildSlideV7,
  buildTableNode,
  buildTextContent,
  buildTextNode,
  buildTitleNode,
  buildVisualNode,
  resetBuilderCounter,
} from "@/test/builders/deck-v7";

describe("buildDeckOutline", () => {
  test("builds an ordered multi-slide outline and filters decorative nodes", () => {
    resetBuilderCounter();
    const title = buildTitleNode("A11y Foundation");
    const image = buildImageNode("hero", {
      id: "hero-image",
      layout: buildLayoutBox({ zIndex: 2 }),
    });
    const decorative = buildShapeNode({
      id: "decorative-shape",
      layout: buildLayoutBox({ zIndex: 3 }),
      accessibility: { decorative: true },
      content: { shape: "circle" },
    });
    const table = buildTableNode({
      id: "metrics-table",
      layout: buildLayoutBox({ zIndex: 4 }),
      content: {
        columns: [
          { id: "region", label: "Region" },
          { id: "revenue", label: "Revenue" },
        ],
        rows: [{ id: "row-1", cells: [{ text: "NA" }, { text: "$10" }] }],
        header: true,
        caption: "Quarterly results",
      },
    });
    const visual = buildVisualNode({
      id: "pipeline-visual",
      layout: buildLayoutBox({ zIndex: 5 }),
      content: { assetId: "visual-asset", visualId: "pipeline" },
    });
    const connector: ConnectorNode = {
      id: "flow-connector",
      type: "connector",
      role: "connector",
      layout: buildLayoutBox({ zIndex: 6 }),
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "point", point: { x: 0, y: 50 } },
        to: { kind: "point", point: { x: 100, y: 50 } },
        routing: "elbow",
      },
    };
    const group: GroupNode = {
      id: "callout-group",
      type: "group",
      component: "metricCard",
      role: "card",
      layout: buildLayoutBox({ zIndex: 7 }),
      style: { ref: "surface.card" },
      children: [
        buildShapeNode({
          id: "group-shape",
          layout: buildLayoutBox({ zIndex: 1 }),
        }),
        buildTextNode({
          id: "group-text",
          layout: buildLayoutBox({ zIndex: 2 }),
          content: buildTextContent(["Grouped insight"]),
        }),
      ],
    };
    const firstSlide = buildSlideV7(
      "content",
      [table, connector, image, decorative, title, visual, group],
      { id: "slide-one" },
    );
    const secondSlide = buildSlideV7(
      "content",
      [
        buildTextNode({
          id: "reading-order-late",
          layout: buildLayoutBox({ zIndex: 1 }),
          accessibility: { readingOrder: 2 },
          content: buildTextContent(["Second by reading order"]),
        }),
        buildTextNode({
          id: "reading-order-first",
          layout: buildLayoutBox({ zIndex: 9 }),
          accessibility: { readingOrder: 1 },
          content: buildTextContent(["First by reading order"]),
        }),
      ],
      { id: "slide-two" },
    );
    const emptySlide = buildSlideV7("content", [], { id: "empty-slide" });
    const deck = buildDeckV7([firstSlide, secondSlide, emptySlide], {
      assets: {
        images: {
          hero: buildImageAsset("hero", { alt: "Hero customer photo" }),
        },
        visuals: {
          "visual-asset": {
            id: "visual-asset",
            visualId: "pipeline",
            title: "Pipeline chart",
            alt: "Pipeline conversion chart",
          },
        },
      },
    });
    const resolved = resolveDeckRenderTree(deck, buildMinimalThemePackage());

    const outline = buildDeckOutline(resolved, { assets: deck.assets });

    assert.equal(outline.slides.length, 3);
    assert.deepEqual(
      outline.slides[0].nodes.map((node) => node.id),
      [
        title.id,
        image.id,
        table.id,
        visual.id,
        connector.id,
        group.id,
        "group-shape",
        "group-text",
      ],
    );
    assert.equal(outline.slides[0].title, "A11y Foundation");
    assert.equal(outline.slides[0].position, 1);
    assert.equal(
      outline.slides[0].nodes[1].label,
      "Image: Hero customer photo",
    );
    assert.equal(
      outline.slides[0].nodes[2].label,
      "Table: Quarterly results, 2 columns, 1 rows, headers: Region, Revenue",
    );
    assert.equal(
      outline.slides[0].nodes[3].label,
      "Visual: Pipeline conversion chart",
    );
    assert.ok(
      outline.slides[0].summary.includes("1 image"),
      "summary includes node role counts",
    );
    assert.deepEqual(
      outline.slides[1].nodes.map((node) => node.id),
      ["reading-order-first", "reading-order-late"],
    );
    assert.equal(outline.slides[2].title, "Slide 3");
    assert.equal(outline.slides[2].summary, "Empty slide");
  });

  test("omits theme and chrome nodes from the content outline", () => {
    resetBuilderCounter();
    const slide = buildSlideV7(
      "content",
      [buildTextNode({ id: "only-content" })],
      { id: "content-slide" },
    );
    const deck = buildDeckV7([slide], {
      chrome: {
        footer: { text: "Confidential", enabled: true },
        pageNumber: { enabled: true },
      },
    });
    const resolved = resolveDeckRenderTree(deck, buildMinimalThemePackage());

    const outline = buildDeckOutline(resolved, { assets: deck.assets });
    const ids = outline.slides[0].nodes.map((node) => node.id);

    assert.deepEqual(ids, ["only-content"]);
    assert.equal(
      resolved.slides[0].chrome.length > 0 ||
        resolved.slides[0].decorations.length > 0,
      true,
    );
  });
});
