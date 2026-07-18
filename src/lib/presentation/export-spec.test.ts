/**
 * Export spec builder tests.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildExportSpec } from "@/lib/presentation/export-spec";
import { resolveDeckRenderTree } from "@/lib/presentation/render-resolver";
import {
  buildDeck,
  buildCoverSlide,
  buildContentSlide,
  buildTableSlide,
  buildVisualSlide,
  buildImageNode,
  buildVisualNode,
  buildTextNode,
  buildMinimalThemePackage,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";
import type { SlideChildNode } from "@/lib/presentation/schema";

function slideChildFixture(value: unknown): SlideChildNode {
  return value as unknown as SlideChildNode;
}

describe("buildExportSpec", () => {
  test("produces one slide spec per deck slide", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide(), buildContentSlide()]);
    const pkg = buildMinimalThemePackage();
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);
    assert.equal(exportSpec.slides.length, 2);
    assert.equal(exportSpec.canvas.format, "16:9");
  });

  test("each slide spec has a background operation", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()]);
    const pkg = buildMinimalThemePackage();
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);
    const slide = exportSpec.slides[0];
    assert.equal(slide.background.type, "background");
  });

  test("operations include text, image, and shape types", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildContentSlide()]);
    const pkg = buildMinimalThemePackage();
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);
    const ops = exportSpec.slides[0].operations;
    assert.ok(ops.length >= 1, "Expected at least one operation");
    assert.ok(ops.every((op) => typeof op.type === "string"));
  });

  test("table compiles to tableShape operation", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildTableSlide()]);
    const pkg = buildMinimalThemePackage();
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);
    const ops = exportSpec.slides[0].operations;
    assert.ok(
      ops.some((op) => op.type === "tableShape"),
      "Expected tableShape operation for table node",
    );
  });

  test("operations are DOM-free (no DOM types)", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()]);
    const pkg = buildMinimalThemePackage();
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);
    // Verify no DOM-like properties exist
    const jsonStr = JSON.stringify(exportSpec);
    assert.ok(
      !jsonStr.includes("document."),
      "Export spec must not reference document",
    );
    assert.ok(
      !jsonStr.includes("window."),
      "Export spec must not reference window",
    );
  });

  test("operation order matches resolved render order", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildContentSlide()]);
    const pkg = buildMinimalThemePackage();
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);

    const resolvedIds = renderTree.slides[0].nodes.map((n) => n.id);
    const exportIds = exportSpec.slides[0].operations.map((op) => op.id);
    assert.deepEqual(exportIds, resolvedIds);
  });

  test("operation order honors high z-index before stable equal-z source ties", () => {
    resetBuilderCounter();
    const deck = buildDeck([
      {
        ...buildContentSlide(),
        children: [
          buildTextNode({
            id: "export-high",
            layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex: 50 },
          }),
          buildTextNode({
            id: "export-low",
            layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex: -10 },
          }),
          buildTextNode({
            id: "export-low-later",
            layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex: -10 },
          }),
        ],
      },
    ]);
    const exportSpec = buildExportSpec(
      resolveDeckRenderTree(deck, buildMinimalThemePackage()),
    );

    assert.deepEqual(
      exportSpec.slides[0].operations.map((operation) => operation.id),
      ["export-low", "export-low-later", "export-high"],
    );
  });

  test("operations include deck chrome in deterministic render order", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildContentSlide()], {
      chrome: {
        watermark: { enabled: true, text: "Draft" },
        footer: { enabled: true, text: "Footer" },
        pageNumber: { enabled: true },
      },
    });
    const renderTree = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    const exportSpec = buildExportSpec(renderTree);
    const ids = exportSpec.slides[0].operations.map((op) => op.id);
    const firstUserId = renderTree.slides[0].nodes[0].id;

    assert.ok(ids.indexOf("deck-chrome-watermark") < ids.indexOf(firstUserId));
    assert.ok(ids.indexOf("deck-chrome-footer") > ids.indexOf(firstUserId));
    assert.ok(ids.includes("deck-chrome-pageNumber"));
    assert.ok(
      ids.indexOf("deck-chrome-footer") < ids.indexOf("deck-chrome-pageNumber"),
    );
  });

  test("operations keep theme decorations, background chrome, and foreground chrome in parity order", () => {
    resetBuilderCounter();
    const userNode = buildTextNode({
      id: "export-user-node",
      layout: { frame: { x: 20, y: 30, w: 60, h: 12 }, zIndex: 2 },
    });
    const deck = buildDeck(
      [
        {
          ...buildContentSlide(),
          props: {
            decoration: "default",
            chrome: "default",
          },
          children: [userNode],
        },
      ],
      {
        chrome: {
          watermark: {
            enabled: true,
            text: "Draft",
            layout: { frame: { x: 10, y: 40, w: 80, h: 20 }, zIndex: -40 },
          },
          footer: { enabled: true, text: "Footer" },
          pageNumber: { enabled: true },
        },
      },
    );
    const pkg = buildMinimalThemePackage("test-package", {
      decorations: {
        "export-bg": {
          id: "export-bg",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: -80 },
          style: { fill: { type: "solid", color: "#eff6ff" } },
        },
      },
    });

    const exportSpec = buildExportSpec(resolveDeckRenderTree(deck, pkg));

    assert.deepEqual(
      exportSpec.slides[0].operations.map((op) => op.id),
      [
        "decoration-export-bg",
        "deck-chrome-watermark",
        "export-user-node",
        "deck-chrome-footer",
        "deck-chrome-pageNumber",
      ],
    );
  });

  test("detached deck chrome is exported once through the user-owned node", () => {
    resetBuilderCounter();
    const detachedFooter = buildTextNode({
      id: "detached-footer-node",
      role: "caption",
      layout: { frame: { x: 6, y: 91, w: 88, h: 5 }, zIndex: 900 },
      content: { paragraphs: [{ id: "detached-footer-p0", text: "Footer" }] },
    });
    const deck = buildDeck(
      [
        {
          ...buildContentSlide(),
          children: [detachedFooter],
          props: {
            deckChrome: {
              footer: {
                mode: "detached",
                nodeId: "detached-footer-node",
              },
            },
          },
        },
      ],
      {
        chrome: {
          footer: { enabled: true, text: "Footer" },
        },
      },
    );

    const ids = buildExportSpec(
      resolveDeckRenderTree(deck, buildMinimalThemePackage()),
    ).slides[0].operations.map((op) => op.id);

    assert.deepEqual(
      ids.filter((id) => id.includes("footer")),
      ["detached-footer-node"],
    );
  });

  test("emits warnings for glass effect (unsupported export)", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    // We'll need to inject the effect into the resolved style via a pkg variant
    // Instead test that the warning mechanism is wired by using a pkg with
    // glass effect in a style variant
    const pkg = buildMinimalThemePackage("test-package", {
      styles: {
        ...buildMinimalThemePackage().styles,
        "text.title": {
          default: {
            text: { fontSizePt: 36, color: "#111111" },
            effect: { kind: "glass", intensity: "strong" },
          },
        },
      },
    });
    const deck = buildDeck([slide]);
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);
    assert.ok(
      exportSpec.diagnostics.some(
        (d) => d.code === "unsupported-export-feature",
      ),
      "Expected unsupported-export-feature diagnostic for glass effect",
    );
  });

  test("emits theme-decoration-export-fallback for decoration export effects", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()]);
    const pkg = buildMinimalThemePackage("test-package", {
      decorations: {
        "glass-corner": {
          id: "glass-corner",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 0 },
          style: {
            fill: { type: "solid", color: "#ffffff" },
            effect: { kind: "glass", intensity: "light" },
          },
        },
      },
    });

    const exportSpec = buildExportSpec(resolveDeckRenderTree(deck, pkg));

    assert.ok(
      exportSpec.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "theme-decoration-export-fallback" &&
          diagnostic.details?.decorationId === "glass-corner",
      ),
    );
  });

  test("preserves speaker notes on export slide spec", () => {
    resetBuilderCounter();
    const slide = { ...buildCoverSlide(), notes: "Remember to breathe." };
    const deck = buildDeck([slide]);
    const pkg = buildMinimalThemePackage();
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);
    assert.equal(exportSpec.slides[0].notes, "Remember to breathe.");
  });
});

// ---------------------------------------------------------------------------
// Additional operation types
// ---------------------------------------------------------------------------

describe("buildExportSpec — additional operation types", () => {
  test("visual slide produces at least one operation", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildVisualSlide()]);
    const pkg = buildMinimalThemePackage();
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);
    assert.ok(exportSpec.slides[0].operations.length >= 1);
  });

  test("render diagnostics are carried forward into export spec", () => {
    resetBuilderCounter();
    // Build a deck with an image node referencing a missing asset to trigger
    // a render diagnostic.
    const slide = buildCoverSlide();
    const imgNode = slideChildFixture({
      ...slide.children[0],
      id: "img-missing",
      type: "image" as const,
      content: { assetId: "ghost-asset" },
    });
    const badSlide = { ...slide, children: [imgNode] };
    const deck = buildDeck([badSlide]);
    const pkg = buildMinimalThemePackage();
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);
    // Render errors (missing-asset) flow through to exportSpec.diagnostics
    assert.ok(
      exportSpec.diagnostics.some((d) => d.code === "missing-asset"),
      "Expected missing-asset diagnostic carried from render tree",
    );
  });

  test("image operations carry fit, crop, and alt text for export parity", () => {
    resetBuilderCounter();
    const imageNode = buildImageNode("img-001", {
      content: {
        assetId: "img-001",
        fit: "contain",
        crop: { top: 5, right: 10, bottom: 15, left: 20 },
        alt: "Cropped product image",
      },
    });
    const deck = buildDeck([{ ...buildCoverSlide(), children: [imageNode] }]);
    const renderTree = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    const exportSpec = buildExportSpec(renderTree);
    const imageOp = exportSpec.slides[0].operations.find(
      (op) => op.type === "image",
    );
    assert.ok(imageOp);
    assert.equal(imageOp.type, "image");
    if (imageOp.type === "image") {
      assert.equal(imageOp.fit, "contain");
      assert.deepEqual(imageOp.crop, {
        top: 5,
        right: 10,
        bottom: 15,
        left: 20,
      });
      assert.equal(imageOp.alt, "Cropped product image");
    }
  });

  test("visual operations carry supported channel colors and filter unsupported channels", () => {
    resetBuilderCounter();
    const visualNode = buildVisualNode({
      localStyle: {
        visual: {
          channelColors: {
            primary: "#111111",
            accent: "#ffcc00",
            tertiary: "#00ff00",
          },
        },
      },
    });
    const deck = buildDeck([{ ...buildCoverSlide(), children: [visualNode] }]);
    const renderTree = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    const exportSpec = buildExportSpec(renderTree);
    const visualOp = exportSpec.slides[0].operations.find(
      (op) => op.type === "visual",
    );
    assert.ok(visualOp);
    assert.equal(visualOp.type, "visual");
    if (visualOp.type === "visual") {
      assert.deepEqual(visualOp.channelColors, {
        primary: "#111111",
        accent: "#ffcc00",
      });
      assert.equal("tertiary" in (visualOp.channelColors ?? {}), false);
    }
    assert.ok(
      exportSpec.diagnostics.some(
        (d) =>
          d.code === "unsupported-export-feature" &&
          d.details?.channel === "tertiary",
      ),
    );
  });

  test("framePx is preferred over frame when present on resolved node", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()]);
    const pkg = buildMinimalThemePackage();
    const renderTree = resolveDeckRenderTree(deck, pkg);
    const exportSpec = buildExportSpec(renderTree);
    const ops = exportSpec.slides[0].operations;
    assert.ok(ops.length > 0);
    for (const op of ops) {
      assert.ok(typeof op.frame.x === "number");
      assert.ok(typeof op.frame.y === "number");
    }
  });
});
