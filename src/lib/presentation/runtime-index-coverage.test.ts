import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as runtime from "@/lib/presentation";
import {
  buildDeck,
  buildImageNode,
  buildMinimalThemePackage,
  buildShapeNode,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import type { ResolvedRenderNode } from "@/lib/presentation/render-tree";

function findNode(
  nodes: readonly runtime.SlideChildNode[],
  id: string,
): runtime.SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "group") {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

describe("presentation runtime barrel coverage", () => {
  test("drives command helpers and pure runtime facades through the public index", () => {
    assert.equal(runtime.isValidId("node-1"), true);
    assert.equal(runtime.clamp(12, 0, 10), 10);
    assert.equal(
      runtime.resolveToken(
        {
          colors: { canvas: { text: "#111111" } },
          fonts: { body: "Inter" },
        } as runtime.ThemeTokens,
        "colors.canvas.text",
      ),
      "#111111",
    );

    const text = buildTextNode({
      id: "node-text",
      content: { paragraphs: [{ id: "p1", text: "Original" }] },
    });
    const image = buildImageNode("img-001", {
      id: "node-image",
      content: {
        assetId: "img-001",
        crop: { top: 1, right: 2, bottom: 3, left: 4 },
      },
    });
    const shape = buildShapeNode({ id: "node-shape" });
    let deck = buildDeck(undefined, {
      theme: { packageId: "missing-package" },
      slides: [
        {
          id: "slide-1",
          type: "slide",
          template: { kind: "content" },
          style: { ref: "slide.content" },
          children: [text, image, shape],
        },
      ],
    });
    const slideId = deck.slides[0].id;

    const blank = runtime.insertBlankSlide(deck, 0);
    deck = blank.deck;
    assert.equal(deck.slides[0].id, blank.slideId);

    const duplicateSlide = runtime.duplicateSlide(deck, slideId);
    deck = duplicateSlide.deck;
    assert.equal(duplicateSlide.index, 2);

    const movedSlide = runtime.moveSlide(deck, duplicateSlide.slideId, 0);
    deck = movedSlide.deck;
    assert.equal(movedSlide.index, 0);

    deck = runtime.updateSlideControls(deck, slideId, {
      tone: "confident",
      density: "dense",
    });
    deck = runtime.updateSlideAttributes(deck, slideId, {
      name: "Runtime slide",
      notes: "Notes",
    });
    deck = runtime.updateSlideLocalStyle(deck, slideId, {
      slide: { background: { type: "solid", color: "#fafafa" } },
    });
    deck = runtime.resetSlideLocalStyle(deck, slideId);
    deck = runtime.updateSlideSourceMetadata(deck, slideId, {
      documentId: "doc-1",
      blockId: "block-1",
      blockKind: "text",
    });

    const inserted = runtime.insertNode(deck, slideId, {
      ...buildTextNode({ id: "node-text" }),
      content: { paragraphs: [{ id: "inserted-p", text: "Inserted" }] },
    });
    deck = inserted.deck;
    assert.notEqual(inserted.nodeId, "node-text");

    deck = runtime.updateNodeContent(deck, slideId, "node-text", {
      paragraphs: [{ id: "p1", text: "Updated" }],
    });
    deck = runtime.updateNodeLayout(deck, slideId, "node-text", {
      frame: { x: 15, y: 16, w: 25, h: 10 },
    });
    deck = runtime.updateNodeRotation(deck, slideId, "node-text", 450);
    deck = runtime.updateNodeLayouts(
      deck,
      slideId,
      new Map([["node-shape", { frame: { x: 50, y: 10, w: 10, h: 10 } }]]),
    );
    deck = runtime.updateNodeAttributes(deck, slideId, "node-shape", {
      name: "Shape",
      locked: true,
    });
    deck = runtime.updateNodeSourceMetadata(deck, slideId, "node-shape", {
      documentId: "doc-2",
      blockId: "shape",
      blockKind: "image",
    });
    deck = runtime.updateNodeStyleBinding(deck, slideId, "node-shape", {
      ref: "surface.card",
    });
    deck = runtime.updateLocalStyle(deck, slideId, "node-shape", {
      fill: { type: "solid", color: "#eeeeee" },
      stroke: { color: "#111111", widthPt: 1 },
    });
    deck = runtime.resetLocalStyleOverride(deck, slideId, "node-shape", [
      "stroke",
    ]);
    deck = runtime.moveNodesBy(deck, slideId, ["node-shape"], {
      x: 100,
      y: -50,
    });
    deck = runtime.reorderZIndex(deck, slideId, "node-shape", 9);
    deck = runtime.resetImageCrop(deck, slideId, "node-image");
    deck = runtime.updateAssetMetadata(deck, "img-001", {
      alt: "Updated asset",
      contentHash: "hash",
    });
    deck = runtime.updateDeckChrome(deck, {
      footer: { enabled: true, text: "Footer" },
    });
    deck = runtime.setThemePackage(deck, "neutral", "1.0.0");
    deck = {
      ...deck,
      theme: {
        ...deck.theme,
        overrides: { disabledDecorations: ["watermark", "logo"] },
      },
    };
    deck = runtime.restoreThemeDecoration(deck, "logo");
    deck = runtime.detachDecoration(
      deck,
      slideId,
      "decoration-watermark",
      { frame: { x: 1, y: 1, w: 5, h: 5 }, zIndex: 1 },
      { opacity: 0.4 },
      {
        type: "text",
        content: { paragraphs: [{ id: "decor-p", text: "Watermark" }] },
      },
    );

    deck = runtime.groupNodes(
      deck,
      slideId,
      ["node-text", "node-shape"],
      "group-1",
      {
        ref: "surface.card",
      },
    );
    assert.equal(
      findNode(
        deck.slides.find((slide) => slide.id === slideId)!.children,
        "group-1",
      )?.type,
      "group",
    );
    const ungrouped = runtime.ungroupNodes(deck, slideId, "group-1");
    deck = ungrouped.deck;
    assert.deepEqual(ungrouped.nodeIds.sort(), ["node-shape", "node-text"]);

    const duplicated = runtime.duplicateNodes(deck, slideId, ["node-text"]);
    deck = duplicated.deck;
    assert.equal(duplicated.duplicatedIds.length, 1);

    const cut = runtime.cutNodes(deck, slideId, duplicated.duplicatedIds);
    deck = cut.deck;
    assert.equal(cut.nodes.length, 1);

    const pasted = runtime.pasteNodes(deck, slideId, cut.nodes);
    deck = pasted.deck;
    assert.equal(pasted.nodeIds.length, 1);

    const deleted = runtime.deleteNodes(deck, slideId, pasted.nodeIds);
    assert.equal(
      findNode(
        deleted.slides.find((slide) => slide.id === slideId)!.children,
        pasted.nodeIds[0],
      ),
      undefined,
    );

    const packageResolution = runtime.resolveThemePackageForDeck(deck);
    assert.equal(packageResolution.fallback, false);
    assert.ok(runtime.listThemePackages().length > 0);
    assert.equal(runtime.resolveThemePackageId("default"), "clarity");
    assert.ok(runtime.getThemePackage("neutral"));

    const pkg = buildMinimalThemePackage("neutral");
    const validation = runtime.validateThemePackage(pkg);
    assert.equal(validation.valid, true);
    const theme = runtime.resolveTheme(pkg, {
      packageId: pkg.id,
      overrides: { tokens: { colors: { accent: { fill: "#123456" } } } },
    });
    assert.equal(theme.tokens.colors.accent.fill, "#123456");

    const renderTree = runtime.resolveDeckRenderTree(deck, pkg, {
      canvasWidthPx: 800,
      canvasHeightPx: 450,
    });
    assert.equal(renderTree.slides.length, deck.slides.length);
    const exportSpec = runtime.buildExportSpec(renderTree);
    const pptxSpec = runtime.buildPptxSpec(exportSpec);
    assert.equal(pptxSpec.slides.length, exportSpec.slides.length);

    const parsed = runtime.safeParseDeck(deck);
    assert.equal(parsed.success, true);
    assert.equal(runtime.looksLikeDeck(deck), true);
    assert.equal(runtime.decideDeckOpen(deck).mode, "open");
    assert.equal(runtime.openDeckFromJson(deck).ok, true);
  });

  test("covers deck-chrome detachment, selection helpers, source helpers, and open-deck failure facades", () => {
    let deck = runtime.createBlankDeck();
    const slideId = deck.slides[0].id;
    deck = runtime.insertNode(deck, slideId, {
      id: "focus-node",
      type: "text",
      role: "body",
      layout: { frame: { x: 10, y: 10, w: 20, h: 20 }, zIndex: 1 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "focus-p", text: "Original source" }] },
    }).deck;

    const chromeNode: ResolvedRenderNode = {
      id: "chrome-border",
      type: "shape",
      role: "themeDecoration",
      layout: {
        frame: { x: 0, y: 0, w: 100, h: 100 },
        framePx: { x: 0, y: 0, w: 960, h: 540 },
        zIndex: 0,
      },
      style: { stroke: { color: "#111111", widthPt: 1 } },
      content: { type: "shape", content: { shape: "rect" } },
      source: "deckChrome",
      chromeKind: "border",
    };
    deck = runtime.detachDeckChrome(deck, slideId, "border", chromeNode);
    assert.equal(deck.slides[0].props?.deckChrome?.border?.mode, "detached");

    const selection = runtime.normalizeSelectionFrame(
      { x: 40, y: 40 },
      { x: 0, y: 0 },
    );
    assert.deepEqual(selection, { x: 0, y: 0, w: 40, h: 40 });
    assert.ok(
      runtime
        .selectNodesInFrame(deck.slides[0].children, selection)
        .includes("focus-node"),
    );
    const snapped = runtime.snapFrameToStageGuides(
      { x: 49, y: 49, w: 10, h: 10 },
      1.5,
      runtime.alignmentGuidesForFrames([{ x: 10, y: 10, w: 20, h: 20 }]),
    );
    assert.equal(snapped.frame.x, 50);

    const sourceDeck = runtime.updateNodeSourceMetadata(
      deck,
      slideId,
      "focus-node",
      {
        documentId: "doc",
        blockId: "block",
        blockKind: "text",
        contentHash: "old",
        refresh: { state: "stale" },
      },
    );
    const index = runtime.buildSourceBlockIndex("doc", [
      {
        kind: "text",
        blockType: "paragraph",
        blockId: "block",
        text: "Updated source",
        runs: [{ text: "Updated source", bold: true }],
      },
    ]);
    assert.equal(
      runtime.findSourceBlock(index, { blockId: "block" })?.kind,
      "text",
    );
    const classified = runtime.classifyDeckSourceLinks(sourceDeck, index);
    assert.equal(classified[0].state, "stale");
    assert.ok(runtime.sourceReviewItems(sourceDeck, classified).length > 0);
    assert.ok(runtime.sourceLinkDiagnostics(classified).length > 0);
    const refreshed = runtime.refreshNodeSource(
      sourceDeck,
      slideId,
      "focus-node",
      index,
      "2026-01-01T00:00:00Z",
    );
    assert.equal(refreshed.status, "refreshed");

    assert.equal(runtime.openDeckFromJson({ schemaVersion: 7 }).ok, false);
    assert.equal(runtime.openAiGeneratedDeck({ schemaVersion: 6 }).ok, false);
    assert.equal(runtime.decideDeckOpen({ schemaVersion: 6 }).mode, "recovery");
  });
});
