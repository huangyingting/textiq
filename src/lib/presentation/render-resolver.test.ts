/**
 * Render resolver, render tree ordering, and decoration layering tests.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveDeckRenderTree } from "@/lib/presentation/render-resolver";
import { getSlideRenderLists } from "@/lib/presentation/render-tree";
import {
  groupNodes,
  moveNodesBy,
  updateSlideLocalStyle,
} from "@/lib/presentation/editor-commands";
import {
  buildDeck,
  buildCoverSlide,
  buildContentSlide,
  buildSlide,
  buildMinimalThemePackage,
  buildShapeNode,
  buildTextNode,
  buildImageAsset,
  buildImageNode,
  buildVisualNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";
import type {
  LayoutBox,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation/schema";

function invalidLayoutBox(value: unknown): LayoutBox {
  return value as unknown as LayoutBox;
}

function makeSlideWithZIndices(zIndices: number[]): SlideNode {
  resetBuilderCounter();
  const slide = buildCoverSlide();
  const children = zIndices.map((z, i) =>
    buildTextNode({
      id: `z-node-${i}`,
      layout: { frame: { x: 8, y: 8 + i * 5, w: 30, h: 5 }, zIndex: z },
    }),
  );
  return { ...slide, children };
}

describe("resolveDeckRenderTree", () => {
  test("returns a resolved tree with correct canvas", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()]);
    const pkg = buildMinimalThemePackage();
    const result = resolveDeckRenderTree(deck, pkg);
    assert.equal(result.canvas.format, "16:9");
    assert.equal(result.slides.length, 1);
  });

  test("excludes hidden nodes from resolved output", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const hiddenNode = buildTextNode({
      id: "hidden-text",
      hidden: true,
    });
    const slideWithHidden = {
      ...slide,
      children: [...slide.children, hiddenNode],
    };
    const deck = buildDeck([slideWithHidden]);
    const pkg = buildMinimalThemePackage();
    const result = resolveDeckRenderTree(deck, pkg);
    const resolvedSlide = result.slides[0];
    assert.ok(
      !resolvedSlide.nodes.some((n) => n.id === "hidden-text"),
      "Hidden node should not appear in resolved output",
    );
  });

  test("prunes hidden group subtrees and restores their render order when unhidden", () => {
    resetBuilderCounter();
    const child = buildTextNode({ id: "visible-child" });
    const group: SlideChildNode = {
      id: "hidden-group",
      type: "group",
      component: "custom",
      hidden: true,
      layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 1 },
      children: [child],
    };
    const pkg = buildMinimalThemePackage();

    const hiddenResult = resolveDeckRenderTree(
      buildDeck([buildSlide("content", [group])]),
      pkg,
    );
    assert.deepEqual(
      getSlideRenderLists(hiddenResult.slides[0]).userNodes.map(
        (node) => node.id,
      ),
      [],
    );

    const visibleResult = resolveDeckRenderTree(
      buildDeck([buildSlide("content", [{ ...group, hidden: false }])]),
      pkg,
    );
    assert.deepEqual(
      getSlideRenderLists(visibleResult.slides[0]).userNodes.map(
        (node) => node.id,
      ),
      ["hidden-group", "visible-child"],
    );
  });

  test("preserves locked node state in resolved render nodes", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const lockedNode = buildTextNode({
      id: "locked-text",
      locked: true,
    });
    const deck = buildDeck([
      {
        ...slide,
        children: [...slide.children, lockedNode],
      },
    ]);
    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    const resolved = result.slides[0].nodes.find(
      (node) => node.id === "locked-text",
    );
    assert.equal(resolved?.locked, true);
  });

  test("orders siblings by z-index and keeps nested groups as stacking contexts", () => {
    resetBuilderCounter();
    const nestedChildHigh = buildTextNode({
      id: "nested-high-z-first",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 900 },
    });
    const nestedChildLow = buildTextNode({
      id: "nested-low-z-later",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: -900 },
    });
    const group: SlideChildNode = {
      id: "traversal-group",
      type: "group",
      component: "custom",
      layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 500 },
      children: [nestedChildHigh, nestedChildLow],
    };
    const laterLow = buildTextNode({
      id: "later-low-z",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: -500 },
    });
    const deck = buildDeck([buildSlide("content", [group, laterLow])]);

    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());

    assert.deepEqual(
      getSlideRenderLists(result.slides[0]).userNodes.map((node) => node.id),
      [
        "later-low-z",
        "traversal-group",
        "nested-low-z-later",
        "nested-high-z-first",
      ],
    );
  });

  test("preserves authored node name and accessibility metadata", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const authoredNode = buildShapeNode({
      id: "authored-shape",
      name: "Quarterly highlight",
      accessibility: {
        label: "Quarterly highlight callout",
        alt: "Quarterly highlight alt",
        decorative: false,
      },
    });
    const deck = buildDeck([
      {
        ...slide,
        children: [...slide.children, authoredNode],
      },
    ]);
    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    const resolved = result.slides[0].nodes.find(
      (node) => node.id === "authored-shape",
    );
    assert.equal(resolved?.name, "Quarterly highlight");
    assert.deepEqual(resolved?.accessibility, {
      label: "Quarterly highlight callout",
      alt: "Quarterly highlight alt",
      decorative: false,
    });
  });

  test("includes grouped children in flattened user render lists with resolved styles", () => {
    resetBuilderCounter();
    const groupedText = buildTextNode({
      id: "grouped-text",
      layout: { frame: { x: 20, y: 22, w: 30, h: 8 }, zIndex: 2 },
      localStyle: { text: { fontSizePt: 22, fontFamily: "Georgia" } },
    });
    const group = {
      id: "group-node",
      type: "group" as const,
      component: "custom" as const,
      layout: { frame: { x: 18, y: 20, w: 36, h: 14 }, zIndex: 3 },
      children: [groupedText],
    };
    const slide = buildSlide("content", [group]);
    const deck = buildDeck([slide]);

    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    const userNodes = getSlideRenderLists(result.slides[0]).userNodes;
    const resolvedGroup = userNodes.find((node) => node.id === group.id);
    const resolvedGroupedText = userNodes.find(
      (node) => node.id === groupedText.id,
    );

    assert.deepEqual(resolvedGroup?.style, {});
    assert.equal(resolvedGroupedText?.style.text?.fontSizePt, 22);
    assert.equal(resolvedGroupedText?.style.text?.fontFamily, "Georgia");
  });

  test("resolves connector node endpoints to target anchor points", () => {
    resetBuilderCounter();
    const target = buildTextNode({
      id: "target-node",
      layout: { frame: { x: 40, y: 20, w: 20, h: 20 }, zIndex: 1 },
    });
    const connector: SlideChildNode = {
      id: "connector-node",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 2 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "point", point: { x: 0, y: 50 } },
        to: { kind: "node", nodeId: "target-node", anchor: "right" },
        routing: "straight",
      },
    };
    const deck = buildDeck([
      {
        ...buildCoverSlide(),
        children: [target, connector],
      },
    ]);
    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    const resolved = result.slides[0].nodes.find(
      (node) => node.id === "connector-node",
    );
    assert.equal(resolved?.content.type, "connector");
    if (resolved?.content.type === "connector") {
      assert.deepEqual(resolved.content.content.to, {
        kind: "point",
        point: { x: 60, y: 30 },
      });
    }
  });

  test("diagnoses missing connector endpoint bindings", () => {
    resetBuilderCounter();
    const connector: SlideChildNode = {
      id: "dangling-connector",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 2 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "node", nodeId: "missing-node", anchor: "left" },
        to: { kind: "point", point: { x: 100, y: 50 } },
      },
    };
    const deck = buildDeck([
      {
        ...buildCoverSlide(),
        children: [connector],
      },
    ]);

    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());

    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "unsupported-export-feature" &&
          diagnostic.nodeId === "dangling-connector" &&
          diagnostic.message.includes("missing-node"),
      ),
    );
  });

  test("diagnoses crop values outside safe bounds", () => {
    resetBuilderCounter();
    const image = buildImageNode("img-001", {
      id: "unsafe-crop-image",
      content: {
        assetId: "img-001",
        crop: { top: 70, right: 60, bottom: 40, left: 50 },
      },
    });
    const deck = buildDeck(
      [
        {
          ...buildCoverSlide(),
          children: [image],
        },
      ],
      {
        assets: {
          images: {
            "img-001": buildImageAsset("img-001"),
          },
        },
      },
    );

    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());

    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "unsupported-export-feature" &&
          diagnostic.nodeId === "unsafe-crop-image" &&
          diagnostic.message.includes("crop values"),
      ),
    );
  });

  test("sorts user siblings by zIndex", () => {
    resetBuilderCounter();
    const slide = makeSlideWithZIndices([3, 1, 2]);
    const deck = buildDeck([slide]);
    const pkg = buildMinimalThemePackage();
    const result = resolveDeckRenderTree(deck, pkg);
    assert.deepEqual(
      result.slides[0].nodes.map((node) => node.layout.zIndex),
      [1, 2, 3],
    );
  });

  test("canonicalizes missing and non-finite resolved z-index values to stable zero", () => {
    resetBuilderCounter();
    const frame = { x: 8, y: 8, w: 30, h: 5 };
    const children = [
      buildTextNode({
        id: "valid-positive-z",
        layout: { frame, zIndex: 10 },
      }),
      buildTextNode({
        id: "missing-z",
        layout: invalidLayoutBox({ frame }),
      }),
      buildTextNode({
        id: "nan-z",
        layout: invalidLayoutBox({ frame, zIndex: Number.NaN }),
      }),
      buildTextNode({
        id: "infinite-z",
        layout: invalidLayoutBox({
          frame,
          zIndex: Number.POSITIVE_INFINITY,
        }),
      }),
    ];
    const result = resolveDeckRenderTree(
      buildDeck([buildSlide("content", children)]),
      buildMinimalThemePackage(),
    );

    assert.deepEqual(
      result.slides[0].nodes.map((node) => [node.id, node.layout.zIndex]),
      [
        ["missing-z", 0],
        ["nan-z", 0],
        ["infinite-z", 0],
        ["valid-positive-z", 10],
      ],
    );
  });

  test("resolves theme decorations into decorations array", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const deck = buildDeck([slide]);
    const pkg = buildMinimalThemePackage("test-package", {
      decorations: {
        "bg-corner": {
          id: "bg-corner",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 0 },
          style: { fill: { type: "solid", color: "#cccccc" } },
          visibility: "default",
        },
      },
    });
    const result = resolveDeckRenderTree(deck, pkg);
    const resolvedSlide = result.slides[0];
    assert.ok(
      resolvedSlide.decorations.length >= 1,
      "Expected at least one decoration",
    );
    assert.ok(
      resolvedSlide.decorations[0].source === "themeDecoration",
      "Decoration source must be 'themeDecoration'",
    );
  });

  test("respects disabledDecorations from deck theme overrides", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const deck = buildDeck([slide], {
      theme: {
        packageId: "test-package",
        overrides: { disabledDecorations: ["bg-corner"] },
      },
    });
    const pkg = buildMinimalThemePackage("test-package", {
      decorations: {
        "bg-corner": {
          id: "bg-corner",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 0 },
          style: {},
        },
      },
    });
    const result = resolveDeckRenderTree(deck, pkg);
    assert.equal(
      result.slides[0].decorations.length,
      0,
      "Disabled decoration should not appear",
    );
  });

  test("resolves deck chrome with slide-level disable and page numbers", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide(), buildContentSlide()], {
      chrome: {
        logo: { enabled: true, assetId: "img-001", placement: "top-left" },
        footer: {
          enabled: true,
          text: "Confidential",
          align: "center",
          style: { text: { color: { token: "colors.accent.fill" } } },
        },
        pageNumber: { enabled: true, format: "number-total" },
        watermark: {
          enabled: true,
          text: "Draft",
          layoutMode: "diagonal",
          opacity: 0.2,
        },
        border: { enabled: true, color: "#111111", widthPt: 1 },
        safeArea: {
          enabled: true,
          insets: { top: 8, right: 8, bottom: 8, left: 8 },
        },
      },
      slides: [
        buildCoverSlide(),
        {
          ...buildContentSlide(),
          props: { deckChrome: { footer: { mode: "disabled" } } },
        },
      ],
    });

    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    const firstChrome = result.slides[0].chrome;
    assert.deepEqual(
      firstChrome.map((node) => node.chromeKind),
      ["logo", "watermark", "border", "safeArea", "footer", "pageNumber"],
    );
    assert.ok(firstChrome.every((node) => node.source === "deckChrome"));
    const pageNumber = firstChrome.find(
      (node) => node.chromeKind === "pageNumber",
    );
    assert.equal(pageNumber?.content.type, "text");
    if (pageNumber?.content.type === "text") {
      assert.equal(pageNumber.content.content.paragraphs[0].text, "1 / 2");
    }
    const footer = firstChrome.find((node) => node.chromeKind === "footer");
    assert.equal(footer?.style.text?.color, "#0066cc");
    assert.equal(
      result.slides[1].chrome.some((node) => node.chromeKind === "footer"),
      false,
    );
  });

  test("keeps theme decorations and deck chrome in distinct render layers", () => {
    resetBuilderCounter();
    const userNode = buildTextNode({
      id: "layer-user-node",
      layout: { frame: { x: 20, y: 22, w: 60, h: 14 }, zIndex: 5 },
    });
    const slide = {
      ...buildCoverSlide(),
      props: { decoration: "expressive" as const, chrome: "default" as const },
      children: [userNode],
    };
    const deck = buildDeck([slide], {
      chrome: {
        watermark: {
          enabled: true,
          text: "Draft",
          layout: { frame: { x: 10, y: 40, w: 80, h: 20 }, zIndex: -30 },
        },
        footer: { enabled: true, text: "Footer" },
        border: { enabled: true, color: "#0f172a", widthPt: 1 },
      },
    });
    const pkg = buildMinimalThemePackage("test-package", {
      decorations: {
        "cover-glow": {
          id: "cover-glow",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: -80 },
          style: { fill: { type: "solid", color: "#eff6ff" } },
          visibility: "expressive",
        },
      },
    });

    const result = resolveDeckRenderTree(deck, pkg);
    const resolvedSlide = result.slides[0];
    const backgroundChrome = resolvedSlide.chrome.filter(
      (node) => (node.layout.zIndex ?? 0) < 0,
    );
    const foregroundChrome = resolvedSlide.chrome.filter(
      (node) => (node.layout.zIndex ?? 0) >= 0,
    );

    assert.deepEqual(
      resolvedSlide.decorations.map((node) => node.id),
      ["decoration-cover-glow"],
    );
    assert.equal(resolvedSlide.decorations[0].source, "themeDecoration");
    assert.deepEqual(
      backgroundChrome.map((node) => node.chromeKind),
      ["watermark"],
    );
    assert.deepEqual(
      foregroundChrome.map((node) => node.chromeKind),
      ["border", "footer"],
    );
    assert.deepEqual(
      resolvedSlide.nodes.map((node) => node.id),
      ["layer-user-node"],
    );
    assert.ok(
      resolvedSlide.chrome.every((node) => node.source === "deckChrome"),
    );
  });

  test("slide deck chrome disabled and detached modes avoid double-rendering", () => {
    resetBuilderCounter();
    const detachedFooter = buildTextNode({
      id: "detached-footer-node",
      role: "caption",
      layout: { frame: { x: 6, y: 91, w: 88, h: 5 }, zIndex: 900 },
      content: { paragraphs: [{ id: "detached-footer-p0", text: "Footer" }] },
    });
    const slide = {
      ...buildContentSlide(),
      children: [detachedFooter],
      props: {
        deckChrome: {
          footer: { mode: "detached" as const, nodeId: "detached-footer-node" },
          pageNumber: { mode: "disabled" as const },
        },
      },
    };
    const deck = buildDeck([slide], {
      chrome: {
        footer: { enabled: true, text: "Footer" },
        pageNumber: { enabled: true, format: "number-total" },
      },
    });

    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    const resolvedSlide = result.slides[0];

    assert.equal(
      resolvedSlide.chrome.some((node) => node.chromeKind === "footer"),
      false,
    );
    assert.equal(
      resolvedSlide.chrome.some((node) => node.chromeKind === "pageNumber"),
      false,
    );
    assert.equal(
      resolvedSlide.nodes.filter((node) => node.id === "detached-footer-node")
        .length,
      1,
    );
    assert.equal(
      resolvedSlide.nodes.some((node) => node.id === "deck-chrome-footer"),
      false,
    );
  });

  test("reports missing deck chrome logo assets", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()], {
      assets: { images: {} },
      chrome: {
        logo: { enabled: true, assetId: "missing-logo" },
      },
    });
    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());

    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "missing-asset" &&
          diagnostic.nodeId === "deck-chrome-logo",
      ),
    );
  });

  test("resolves deck chrome logo assets from the active theme package", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()], {
      assets: { images: {} },
    });
    const result = resolveDeckRenderTree(
      deck,
      buildMinimalThemePackage("test-package", {
        chrome: {
          logo: { enabled: true, assetId: "package-logo" },
        },
        assets: {
          images: {
            "package-logo": buildImageAsset("package-logo", {
              src: "/api/brand-assets/owner/logo.png",
            }),
          },
        },
      }),
    );

    assert.equal(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "missing-asset" &&
          diagnostic.nodeId === "deck-chrome-logo",
      ),
      false,
    );
    assert.equal(result.slides[0].chrome[0]?.content?.type, "image");
  });

  test("diagnoses stale disabled decoration overrides with repair action", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()], {
      theme: {
        packageId: "test-package",
        overrides: { disabledDecorations: ["missing-decoration"] },
      },
    });
    const result = resolveDeckRenderTree(
      deck,
      buildMinimalThemePackage("test-package", { decorations: {} }),
    );

    const diagnostic = result.diagnostics.find(
      (candidate) => candidate.code === "missing-decoration",
    );
    assert.ok(diagnostic);
    assert.equal(diagnostic.action?.type, "restore-decoration");
    assert.deepEqual(diagnostic.action?.payload, {
      decorationId: "missing-decoration",
    });
  });

  test("diagnoses theme decoration image recipes with missing assets", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()]);
    const pkg = buildMinimalThemePackage("test-package", {
      decorations: {
        "missing-image-decoration": {
          id: "missing-image-decoration",
          component: "image",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 0 },
          style: {},
          content: { type: "image", assetId: "theme-missing-image" },
        },
      },
    });

    const result = resolveDeckRenderTree(deck, pkg);

    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "missing-decoration" &&
          diagnostic.details?.assetId === "theme-missing-image",
      ),
    );
  });

  test("filters decorations by template kind", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide(), buildContentSlide()]);
    const pkg = buildMinimalThemePackage("test-package", {
      decorations: {
        "cover-only": {
          id: "cover-only",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 0 },
          style: { fill: { type: "solid", color: "#cccccc" } },
          appliesTo: { templateKinds: ["cover"] },
        },
      },
    });

    const result = resolveDeckRenderTree(deck, pkg);

    assert.deepEqual(
      result.slides[0].decorations.map((decoration) => decoration.id),
      ["decoration-cover-only"],
    );
    assert.deepEqual(result.slides[1].decorations, []);
  });

  test("filters decorations by slide decoration level", () => {
    resetBuilderCounter();
    const slide = {
      ...buildCoverSlide(),
      props: { decoration: "subtle" as const },
    };
    const deck = buildDeck([slide]);
    const pkg = buildMinimalThemePackage("test-package", {
      decorations: {
        "expressive-bg": {
          id: "expressive-bg",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 0 },
          style: {},
          visibility: "expressive", // only shows at "expressive" level
        },
        "subtle-bg": {
          id: "subtle-bg",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 0 },
          style: {},
          visibility: "subtle",
        },
      },
    });
    const result = resolveDeckRenderTree(deck, pkg);
    const decorIds = result.slides[0].decorations.map((d) => d.id);
    assert.ok(
      !decorIds.includes("decoration-expressive-bg"),
      "Expressive decoration should be filtered at 'subtle' level",
    );
    assert.ok(
      decorIds.includes("decoration-subtle-bg"),
      "Subtle decoration should show at 'subtle' level",
    );
  });

  test("emits missing-asset diagnostic for unresolved image", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const imageNode = buildImageNode("nonexistent-asset");
    const slideWithImage = {
      ...slide,
      children: [...slide.children, imageNode],
    };
    const deck = buildDeck([slideWithImage]);
    const pkg = buildMinimalThemePackage();
    const result = resolveDeckRenderTree(deck, pkg);
    assert.ok(
      result.diagnostics.some((d) => d.code === "missing-asset"),
      "Expected missing-asset diagnostic",
    );
  });

  test("enriches visual nodes from assets.visuals and keeps visual assets resolved", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const visualNode = buildVisualNode({
      content: { assetId: "visual-asset-1" },
    });
    const deck = buildDeck(
      [
        {
          ...slide,
          children: [visualNode],
        },
      ],
      {
        assets: {
          images: {},
          visuals: {
            "visual-asset-1": {
              id: "visual-asset-1",
              visualId: "doc-visual-1",
              alt: "Document visual",
            },
          },
        },
      },
    );
    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    const resolved = result.slides[0].nodes[0];
    assert.equal(resolved.content.type, "visual");
    if (resolved.content.type === "visual") {
      assert.equal(resolved.content.content.visualId, "doc-visual-1");
      assert.equal(resolved.content.content.alt, "Document visual");
    }
    assert.equal(
      result.diagnostics.some((d) => d.code === "missing-asset"),
      false,
    );
  });

  test("emits diagnostics for unsupported visual channel colors", () => {
    resetBuilderCounter();
    const visualNode = buildVisualNode({
      localStyle: {
        visual: {
          channelColors: {
            primary: "#2563eb",
            tertiary: "#111111",
          },
        },
      },
    });
    const deck = buildDeck([{ ...buildCoverSlide(), children: [visualNode] }]);
    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());
    assert.ok(
      result.diagnostics.some(
        (d) =>
          d.code === "unsupported-export-feature" &&
          d.details?.channel === "tertiary",
      ),
      "Expected unsupported channel diagnostic",
    );
  });

  test("emits missing-node-layout diagnostic for nodes without layout", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const noLayoutNode = {
      ...buildTextNode({ id: "no-layout-node" }),
      layout: invalidLayoutBox(undefined),
    };
    const badSlide = { ...slide, children: [...slide.children, noLayoutNode] };
    const deck = buildDeck([badSlide]);
    const pkg = buildMinimalThemePackage();
    const result = resolveDeckRenderTree(deck, pkg);
    assert.ok(
      result.diagnostics.some((d) => d.code === "missing-node-layout"),
      "Expected missing-node-layout diagnostic",
    );
  });

  test("slide localStyle overrides theme slide background", () => {
    resetBuilderCounter();
    const baseDeck = buildDeck([buildCoverSlide()]);
    const deck = updateSlideLocalStyle(baseDeck, baseDeck.slides[0].id, {
      slide: { background: { type: "solid", color: "#123456" } },
    });
    const result = resolveDeckRenderTree(deck, buildMinimalThemePackage());

    assert.deepEqual(result.slides[0].background.fill, {
      type: "solid",
      color: "#123456",
    });
  });

  test("theme switch preserves node layout frames", () => {
    resetBuilderCounter();
    const slide = buildContentSlide("Layout check");
    const deck = buildDeck([slide]);
    const pkg1 = buildMinimalThemePackage("pkg-a");
    const pkg2 = buildMinimalThemePackage("pkg-b");

    const result1 = resolveDeckRenderTree(deck, pkg1);
    const result2 = resolveDeckRenderTree(deck, pkg2);

    // Frames should be identical regardless of theme
    for (let i = 0; i < result1.slides[0].nodes.length; i++) {
      const n1 = result1.slides[0].nodes[i];
      const n2 = result2.slides[0].nodes[i];
      assert.deepEqual(
        n1.layout.frame,
        n2.layout.frame,
        `Frame should not change after theme switch for node ${n1.id}`,
      );
    }
  });

  test("provides framePx for each resolved node", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildContentSlide()]);
    const pkg = buildMinimalThemePackage();
    const result = resolveDeckRenderTree(deck, pkg, {
      canvasWidthPx: 1280,
      canvasHeightPx: 720,
    });
    for (const node of result.slides[0].nodes) {
      assert.ok(node.layout.framePx, `Expected framePx on node ${node.id}`);
    }
  });

  test("renders grouped children at moved positions after moving the group", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildContentSlide("Group movement")]);
    const slide = deck.slides[0];
    const grouped = groupNodes(
      deck,
      slide.id,
      slide.children.map((node) => node.id),
      "moved-group",
    );
    const moved = moveNodesBy(grouped, slide.id, ["moved-group"], {
      x: 6,
      y: 4,
    });

    const resolved = resolveDeckRenderTree(moved, buildMinimalThemePackage());
    const resolvedGroup = resolved.slides[0].nodes.find(
      (node) => node.id === "moved-group",
    );
    assert.equal(resolvedGroup?.type, "group");
    if (resolvedGroup?.type !== "group") return;
    const resolvedChildren = resolvedGroup.children ?? [];
    assert.ok(resolvedChildren.length > 0);
    const firstChild = resolvedChildren[0];
    if (!firstChild) return;
    const sourceChild = (
      moved.slides[0].children.find((node) => node.id === "moved-group") as
        Extract<SlideChildNode, { type: "group" }> | undefined
    )?.children.find((node) => node.id === firstChild.id);
    assert.deepEqual(firstChild.layout.frame, sourceChild?.layout?.frame);
  });

  test("resolves nested groups, visual assets, decoration content, and connector fallbacks", () => {
    resetBuilderCounter();
    const nestedTarget = buildTextNode({
      id: "nested-target",
      layout: { frame: { x: 20, y: 20, w: 20, h: 20 }, zIndex: 3 },
    });
    const group: SlideChildNode = {
      id: "group-node",
      type: "group",
      component: "custom",
      role: "body",
      layout: { frame: { x: 10, y: 10, w: 40, h: 40 }, zIndex: 1 },
      locked: true,
      children: [
        buildTextNode({
          id: "group-child-late",
          layout: { frame: { x: 10, y: 10, w: 20, h: 10 }, zIndex: 2 },
        }),
        buildShapeNode({
          id: "group-child-first",
          layout: { frame: { x: 10, y: 25, w: 20, h: 10 }, zIndex: 1 },
        }),
        nestedTarget,
      ],
    };
    const connectorToNested: SlideChildNode = {
      id: "connector-to-nested",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 2 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "node", nodeId: "nested-target", anchor: "top" },
        to: { kind: "node", nodeId: "nested-target", anchor: "bottom" },
        routing: "elbow",
      },
    };
    const zeroSizeConnector: SlideChildNode = {
      id: "connector-zero",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 0, h: 0 }, zIndex: 3 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "node", nodeId: "nested-target", anchor: "left" },
        to: { kind: "node", nodeId: "missing", anchor: "center" },
        routing: "straight",
      },
    };
    const visual: SlideChildNode = {
      id: "visual-node",
      type: "visual",
      role: "visual",
      layout: { frame: { x: 5, y: 5, w: 30, h: 20 }, zIndex: 4 },
      style: { ref: "chart.primary" },
      content: { assetId: "visual-asset", visualId: "chart-1" },
    };
    const slide: SlideNode = {
      ...buildContentSlide("Resolver coverage"),
      template: { kind: "content", layoutId: "content-layout" },
      props: { chrome: "none", decoration: "expressive" },
      children: [group, connectorToNested, zeroSizeConnector, visual],
    };
    const deck = buildDeck([slide], {
      assets: {
        images: {
          "img-001": buildImageAsset("img-001"),
          "decoration-image": buildImageAsset("decoration-image"),
        },
      },
    });
    const pkg = buildMinimalThemePackage("test-package", {
      decorations: {
        "content-text": {
          id: "content-text",
          component: "text",
          role: "themeDecoration",
          layout: { frame: { x: 1, y: 2, w: 3, h: 4 }, zIndex: 0 },
          content: { type: "text", text: "Decorative text" },
          style: { text: { color: "#123456" } },
          appliesTo: { layoutIds: ["content-layout"] },
          visibility: "expressive",
        },
        "content-image": {
          id: "content-image",
          component: "image",
          role: "themeDecoration",
          layout: { frame: { x: 5, y: 6, w: 7, h: 8 }, zIndex: 1 },
          content: { type: "image", assetId: "decoration-image" },
          style: {},
          appliesTo: { templateKinds: ["content"] },
        },
        "filtered-layout": {
          id: "filtered-layout",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 2 },
          style: {},
          appliesTo: { layoutIds: ["other-layout"] },
        },
        "filtered-chrome": {
          id: "filtered-chrome",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 3 },
          style: {},
          chrome: "minimal",
        },
      },
    });

    const result = resolveDeckRenderTree(deck, pkg, {
      canvasWidthPx: 1000,
      canvasHeightPx: 500,
    });
    const resolvedSlide = result.slides[0];
    assert.deepEqual(
      resolvedSlide.decorations.map((decoration) => decoration.id),
      ["decoration-content-text", "decoration-content-image"],
    );
    assert.equal(resolvedSlide.decorations[0].content.type, "text");
    assert.equal(resolvedSlide.decorations[1].content.type, "image");
    assert.deepEqual(resolvedSlide.decorations[0].layout.framePx, {
      x: 10,
      y: 10,
      w: 30,
      h: 20,
    });

    const resolvedGroup = resolvedSlide.nodes.find(
      (node) => node.id === "group-node",
    );
    assert.equal(resolvedGroup?.type, "group");
    assert.equal(resolvedGroup?.locked, true);
    assert.deepEqual(
      resolvedGroup?.children?.map((node) => node.id),
      ["group-child-first", "group-child-late", "nested-target"],
    );

    const resolvedConnector = resolvedSlide.nodes.find(
      (node) => node.id === "connector-to-nested",
    );
    assert.equal(resolvedConnector?.content.type, "connector");
    if (resolvedConnector?.content.type === "connector") {
      assert.deepEqual(resolvedConnector.content.content.from, {
        kind: "point",
        point: { x: 30, y: 20 },
      });
      assert.deepEqual(resolvedConnector.content.content.to, {
        kind: "point",
        point: { x: 30, y: 40 },
      });
    }

    const fallbackConnector = resolvedSlide.nodes.find(
      (node) => node.id === "connector-zero",
    );
    assert.equal(fallbackConnector?.content.type, "connector");
    if (fallbackConnector?.content.type === "connector") {
      assert.deepEqual(fallbackConnector.content.content.from, {
        kind: "node",
        nodeId: "nested-target",
        anchor: "left",
      });
      assert.deepEqual(fallbackConnector.content.content.to, {
        kind: "node",
        nodeId: "missing",
        anchor: "center",
      });
    }
    assert.ok(result.diagnostics.some((d) => d.code === "missing-asset"));
  });
});
