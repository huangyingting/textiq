import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicPresentationModel } from "@/lib/public-render/presentation";
import {
  resolvePublicRenderWithSource,
  type PublicRenderPresentationRow,
  type PublicRenderSource,
} from "@/lib/public-render/resolver-core";
import { NEUTRAL_THEME_PACKAGE } from "@/lib/presentation/neutral-theme-package";
import { resolveDeckRenderTree } from "@/lib/presentation/render-resolver";
import { buildExportSpec } from "@/lib/presentation/export-spec";
import { getSlideRenderLists } from "@/lib/presentation/render-tree";
import { hitTestSlideNodes } from "@/lib/presentation/stage-hit-test";
import {
  moveNodesBy,
  updateNodeRotation,
} from "@/lib/presentation/editor-commands";
import { buildPptxSpec } from "@/lib/presentation/pptx-export-adapter";
import { resolveExportSpecAssetSources } from "@/lib/presentation/pptx-apply";
import { makeDiagnostic } from "@/lib/presentation/diagnostics";
import { compileBrandKitDraft } from "@/lib/presentation/brand-kit/compiler";
import type { Deck, SlideChildNode } from "@/lib/presentation/schema";
import type {
  ResolvedDeckRenderTree,
  ResolvedRenderNode,
} from "@/lib/presentation/render-tree";
import {
  buildDeck,
  buildImageNode,
  buildShapeNode,
  buildSlide,
  buildTableNode,
  buildTextNode,
  buildMinimalThemePackage,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";
import {
  buildPptxFidelityParityDeck,
  PPTX_FIDELITY_DATA_URI,
} from "@/test/fixtures/pptx-fidelity";
import { renderPrototypeSlideHtml } from "../../../prototypes/slide-themes/render-html";

const DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const PUBLIC_NOW = new Date("2026-06-30T10:00:00Z");

function buildCustomBrandKitPackage() {
  const result = compileBrandKitDraft({
    schemaVersion: 1,
    id: "parity-brand-draft",
    name: "Parity Brand",
    slug: "parity-brand",
    scope: { kind: "user", ownerId: "parity-user" },
    version: "2.0.0",
    revision: {
      id: "parity-rev",
      number: 3,
      createdAt: "2026-07-02T13:22:11.000Z",
    },
    palette: {
      backgrounds: {
        canvas: "#f8fafc",
        muted: "#e0f2fe",
        inverse: "#111827",
      },
      surfaces: {
        default: "#ffffff",
        elevated: "#dbeafe",
        subtle: "#dbeafe",
      },
      text: {
        primary: "#111827",
        secondary: "#334155",
        inverse: "#f8fafc",
        accent: "#1d4ed8",
      },
      accents: {
        primary: "#1d4ed8",
        secondary: "#0369a1",
      },
      borders: {
        default: "#2563eb",
        strong: "#1e40af",
      },
      charts: ["#1d4ed8", "#047857", "#b45309", "#be123c"],
      states: {
        success: { fill: "#dcfce7", text: "#166534" },
        warning: { fill: "#fef3c7", text: "#92400e" },
        danger: { fill: "#fee2e2", text: "#991b1b" },
      },
    },
    typography: {
      display: {
        family: "jetbrains-mono",
        sizePt: 40,
        weight: 800,
        lineHeight: 1.1,
      },
      heading: {
        family: "Parity Sans",
        fontAssetId: "parity-sans",
        sizePt: 24,
        weight: 700,
        lineHeight: 1.2,
      },
      body: {
        family: "Parity Sans",
        fontAssetId: "parity-sans",
        sizePt: 14,
        weight: 400,
        lineHeight: 1.45,
      },
      caption: {
        family: "Parity Sans",
        fontAssetId: "parity-sans",
        sizePt: 10,
        weight: 500,
        lineHeight: 1.3,
      },
      mono: {
        family: "jetbrains-mono",
        sizePt: 11,
        weight: 500,
        lineHeight: 1.3,
      },
      data: {
        family: "Parity Sans",
        fontAssetId: "parity-sans",
        sizePt: 34,
        weight: 800,
        lineHeight: 1.05,
      },
    },
    assets: {
      fonts: {
        "parity-sans": {
          id: "parity-sans",
          family: "Parity Sans",
          src: "/brand-assets/parity-user/parity-sans.woff2",
          weight: [400, 700],
          style: "normal",
        },
      },
    },
    decorations: {
      background: "subtle",
      chrome: "minimal",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected custom brand kit to compile");
  return result.package;
}

function buildParityDeck(): Deck {
  resetBuilderCounter();
  const connectorNode: SlideChildNode = {
    id: "parity-connector",
    type: "connector",
    role: "connector",
    layout: { frame: { x: 8, y: 70, w: 84, h: 14 }, zIndex: 6 },
    style: { ref: "connector.primary" },
    localStyle: {
      connector: {
        stroke: { color: "#2563eb", widthPt: 2, dash: "dashed" },
        startArrow: "none",
        endArrow: "filled",
        routing: "elbow",
      },
    },
    content: {
      from: { kind: "point", point: { x: 0, y: 50 } },
      to: { kind: "point", point: { x: 100, y: 50 } },
      routing: "elbow",
    },
  };
  const visualNode: SlideChildNode = {
    id: "parity-visual",
    type: "visual",
    role: "visual",
    layout: { frame: { x: 52, y: 22, w: 36, h: 32 }, zIndex: 5 },
    style: { ref: "chart.primary" },
    content: {
      assetId: "visual-snapshot",
      visualId: "revenue-chart",
      alt: "Revenue chart",
    },
  };
  const slide = buildSlide(
    "architecture",
    [
      buildTextNode({
        id: "parity-title",
        role: "title",
        layout: { frame: { x: 8, y: 8, w: 84, h: 10 }, zIndex: 1 },
        style: { ref: "text.title" },
      }),
      buildShapeNode({
        id: "parity-shape",
        layout: { frame: { x: 8, y: 22, w: 34, h: 18 }, zIndex: 2 },
        localStyle: {
          fill: { type: "solid", color: "#dbeafe" },
          stroke: { color: "#2563eb", widthPt: 1 },
        },
        content: { shape: "rect" },
      }),
      buildImageNode("img-parity", {
        id: "parity-image",
        layout: { frame: { x: 8, y: 44, w: 34, h: 20 }, zIndex: 3 },
      }),
      buildTableNode({
        id: "parity-table",
        layout: { frame: { x: 52, y: 58, w: 36, h: 24 }, zIndex: 4 },
      }),
      visualNode,
      connectorNode,
    ],
    { style: { ref: "slide.content" }, notes: "Parity fixture notes" },
  );

  return buildDeck([slide], {
    title: "Render/export parity fixture",
    theme: { packageId: "neutral" },
    chrome: {
      footer: { enabled: true, text: "TextIQ confidential" },
      pageNumber: { enabled: true, format: "number-total" },
      border: { enabled: true, color: "#2563eb", widthPt: 1 },
    },
    assets: {
      images: {
        "img-parity": {
          id: "img-parity",
          src: DATA_URI,
          alt: "Parity image",
          mimeType: "image/png",
        },
      },
      visuals: {
        "visual-snapshot": {
          id: "visual-snapshot",
          visualId: "revenue-chart",
          title: "Revenue chart",
          alt: "Revenue chart",
        },
      },
      files: {
        "visual-snapshot": {
          id: "visual-snapshot",
          src: DATA_URI,
          filename: "revenue-chart.png",
          mimeType: "image/png",
        },
      },
    },
  });
}

function surfaceSignature(tree: ResolvedDeckRenderTree) {
  return tree.slides.map((slide) => ({
    id: slide.id,
    nodes: slide.nodes.map((node) => ({
      id: node.id,
      type: node.content.type,
      zIndex: node.layout.zIndex,
    })),
    decorations: slide.decorations.map((node) => ({
      id: node.id,
      type: node.content.type,
      zIndex: node.layout.zIndex,
    })),
    chrome: slide.chrome.map((node) => ({
      id: node.id,
      type: node.content.type,
      source: node.source,
      chromeKind: node.chromeKind,
      zIndex: node.layout.zIndex,
    })),
  }));
}

function publicDocumentForDeck(
  deck: Deck,
  overrides: Partial<PublicRenderPresentationRow> = {},
): PublicRenderPresentationRow {
  return {
    id: "doc-parity",
    title: deck.title ?? "Parity deck",
    contentJson: { root: { children: [] } },
    deckJson: deck,
    shareId: "share123",
    isShared: true,
    deletedAt: null,
    shareExpiresAt: null,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    shareMetadataMode: "generic",
    shareDiscoverable: false,
    owner: { name: "TextIQ", plan: "pro" },
    ...overrides,
  };
}

function publicSource(
  row: PublicRenderPresentationRow | null,
): PublicRenderSource {
  return {
    async findDocumentByShareId() {
      if (!row) return null;
      return {
        id: row.id,
        title: row.title,
        contentJson: row.contentJson,
        shareId: row.shareId,
        isShared: row.isShared,
        deletedAt: row.deletedAt,
        shareExpiresAt: row.shareExpiresAt,
        shareEmbedEnabled: row.shareEmbedEnabled,
        sharePresentEnabled: row.sharePresentEnabled,
        sharePasscodeHash: row.sharePasscodeHash,
        shareMetadataMode: row.shareMetadataMode,
        shareDiscoverable: row.shareDiscoverable,
        owner: row.owner,
      };
    },
    async findMetadataByShareId() {
      if (!row) return null;
      return {
        title: row.title,
        contentJson: row.contentJson,
        slug: null,
        shareId: row.shareId,
        isShared: row.isShared,
        deletedAt: row.deletedAt,
        shareExpiresAt: row.shareExpiresAt,
        shareEmbedEnabled: row.shareEmbedEnabled,
        sharePresentEnabled: row.sharePresentEnabled,
        sharePasscodeHash: row.sharePasscodeHash,
        shareMetadataMode: row.shareMetadataMode,
        shareDiscoverable: row.shareDiscoverable,
      };
    },
    async findPresentationByShareId() {
      return row;
    },
  };
}

test("representative deck keeps editor, present, and public presentation render signatures aligned", () => {
  const deck = buildParityDeck();
  const editorTree = resolveDeckRenderTree(deck, NEUTRAL_THEME_PACKAGE);
  const presentTree = resolveDeckRenderTree(deck, NEUTRAL_THEME_PACKAGE);
  const publicModel = buildPublicPresentationModel({
    title: deck.title ?? "Parity deck",
    contentJson: { root: { children: [] } },
    deckJson: deck,
    owner: { name: "TextIQ", plan: "pro" },
  });
  const publicTree = resolveDeckRenderTree(
    publicModel.deck,
    publicModel.themePackage,
  );

  assert.deepEqual(surfaceSignature(presentTree), surfaceSignature(editorTree));
  assert.deepEqual(surfaceSignature(publicTree), surfaceSignature(editorTree));
  assert.equal(publicModel.themePackage.id, "neutral");
  assert.equal(
    publicModel.diagnostics.some(
      (diagnostic) => diagnostic.code === "unknown-theme-package",
    ),
    false,
  );
});

test("editor, present, public, and export share canonical z-order", () => {
  const deck = buildDeck([
    buildSlide("content", [
      buildTextNode({
        id: "surface-high",
        layout: { frame: { x: 10, y: 10, w: 30, h: 10 }, zIndex: 100 },
      }),
      buildTextNode({
        id: "surface-low",
        layout: { frame: { x: 10, y: 10, w: 30, h: 10 }, zIndex: -100 },
      }),
    ]),
  ]);
  const editorTree = resolveDeckRenderTree(deck, NEUTRAL_THEME_PACKAGE);
  const presentTree = resolveDeckRenderTree(deck, NEUTRAL_THEME_PACKAGE);
  const publicModel = buildPublicPresentationModel({
    title: "Z-order parity",
    contentJson: { root: { children: [] } },
    deckJson: deck,
    owner: { name: "TextIQ", plan: "pro" },
  });
  const publicTree = resolveDeckRenderTree(
    publicModel.deck,
    publicModel.themePackage,
  );
  const exportSpec = buildExportSpec(editorTree);
  const expected = ["surface-low", "surface-high"];

  assert.deepEqual(
    editorTree.slides[0].nodes.map((node) => node.id),
    expected,
  );
  assert.deepEqual(
    presentTree.slides[0].nodes.map((node) => node.id),
    expected,
  );
  assert.deepEqual(
    publicTree.slides[0].nodes.map((node) => node.id),
    expected,
  );
  assert.deepEqual(
    exportSpec.slides[0].operations.map((operation) => operation.id),
    expected,
  );
});

test("logical nested groups bake transforms into absolute children across render, public, export, and connectors", () => {
  const target = buildTextNode({
    id: "group-target",
    layout: { frame: { x: 34, y: 30, w: 12, h: 10 }, zIndex: 1 },
    localStyle: {
      text: { color: "#123456", fontSizePt: 19 },
      effect: { kind: "glow", color: "#abcdef", blurPt: 4, opacity: 0.6 },
    },
  });
  const connector: SlideChildNode = {
    id: "group-connector",
    type: "connector",
    role: "connector",
    layout: { frame: { x: 20, y: 20, w: 50, h: 40 }, zIndex: 2 },
    style: { ref: "connector.primary" },
    content: {
      from: { kind: "point", point: { x: 0, y: 50 } },
      to: { kind: "node", nodeId: target.id, anchor: "right" },
    },
  };
  const nestedGroup: SlideChildNode = {
    id: "nested-logical-group",
    type: "group",
    component: "custom",
    layout: { frame: { x: 20, y: 20, w: 50, h: 40 }, zIndex: 0 },
    children: [connector, target],
  };
  const outerGroup: SlideChildNode = {
    id: "outer-logical-group",
    type: "group",
    component: "custom",
    layout: { frame: { x: 15, y: 15, w: 60, h: 50 }, zIndex: 10 },
    children: [
      buildTextNode({
        id: "outer-back",
        layout: { frame: { x: 18, y: 18, w: 14, h: 10 }, zIndex: -10 },
      }),
      nestedGroup,
      buildTextNode({
        id: "outer-front",
        layout: { frame: { x: 52, y: 48, w: 14, h: 10 }, zIndex: 10 },
      }),
    ],
  };
  const baseDeck = buildDeck([
    buildSlide("content", [
      buildTextNode({
        id: "top-back",
        layout: { frame: { x: 5, y: 5, w: 12, h: 8 }, zIndex: 5 },
      }),
      outerGroup,
      buildTextNode({
        id: "top-front",
        layout: { frame: { x: 80, y: 80, w: 12, h: 8 }, zIndex: 20 },
      }),
    ]),
  ]);
  const moved = moveNodesBy(baseDeck, baseDeck.slides[0].id, [outerGroup.id], {
    x: 5,
    y: 4,
  });
  const deck = updateNodeRotation(moved, moved.slides[0].id, outerGroup.id, 90);
  const editorTree = resolveDeckRenderTree(deck, NEUTRAL_THEME_PACKAGE);
  const presentTree = resolveDeckRenderTree(deck, NEUTRAL_THEME_PACKAGE);
  const publicModel = buildPublicPresentationModel({
    title: "Logical group parity",
    contentJson: { root: { children: [] } },
    deckJson: deck,
    owner: { name: "TextIQ", plan: "pro" },
  });
  const publicTree = resolveDeckRenderTree(
    publicModel.deck,
    publicModel.themePackage,
  );
  const editorNodes = getSlideRenderLists(editorTree.slides[0]).userNodes;
  const publicNodes = getSlideRenderLists(publicTree.slides[0]).userNodes;
  const expectedRenderOrder = [
    "top-back",
    "outer-logical-group",
    "outer-back",
    "nested-logical-group",
    "group-target",
    "group-connector",
    "outer-front",
    "top-front",
  ];

  assert.deepEqual(
    editorNodes.map((node) => node.id),
    expectedRenderOrder,
  );
  assert.deepEqual(
    getSlideRenderLists(presentTree.slides[0]).userNodes.map((node) => node.id),
    expectedRenderOrder,
  );
  assert.deepEqual(
    publicNodes.map((node) => node.id),
    expectedRenderOrder,
  );
  assert.deepEqual(
    editorNodes
      .filter((node) => node.type === "group")
      .map((node) => node.style),
    [{}, {}],
  );

  const exportSpec = buildExportSpec(editorTree);
  const expectedExportOrder = [
    "top-back",
    "outer-back",
    "group-target",
    "group-connector",
    "outer-front",
    "top-front",
  ];
  assert.deepEqual(
    exportSpec.slides[0].operations.map((operation) => operation.id),
    expectedExportOrder,
  );
  const pptx = buildPptxSpec(exportSpec);
  assert.deepEqual(
    pptx.slides[0].ops.map((operation) => operation.id),
    expectedExportOrder,
  );
  const resolvedTarget = editorNodes.find((node) => node.id === target.id);
  const resolvedConnector = editorNodes.find(
    (node) => node.id === connector.id,
  );
  const connectorOperation = exportSpec.slides[0].operations.find(
    (operation) => operation.id === connector.id,
  );
  const targetOperation = exportSpec.slides[0].operations.find(
    (operation) => operation.id === target.id,
  );
  const pptxTarget = pptx.slides[0].ops.find(
    (operation) => operation.id === target.id,
  );
  const pptxConnector = pptx.slides[0].ops.find(
    (operation) => operation.id === connector.id,
  );
  assert.equal(connectorOperation?.type, "connector");
  assert.equal(resolvedConnector?.content.type, "connector");
  assert.ok(resolvedTarget);
  assert.ok(resolvedConnector);
  assert.equal(targetOperation?.type, "text");
  assert.equal(pptxTarget?.type, "text");
  assert.equal(resolvedTarget?.style.text?.color, "#123456");
  assert.equal(resolvedTarget?.style.text?.fontSizePt, 19);
  assert.equal(
    publicNodes.find((node) => node.id === target.id)?.style.text?.color,
    "#123456",
  );
  assert.equal(targetOperation?.style.text?.color, "#123456");
  assert.equal(targetOperation?.style.text?.fontSizePt, 19);
  assert.equal(pptxTarget?.textStyle.color, "123456");
  assert.equal(pptxTarget?.textStyle.fontSize, 19);
  assert.deepEqual(pptxTarget?.effect, {
    kind: "glow",
    color: "ABCDEF",
    blurPt: 4,
    opacity: 0.6,
  });
  if (targetOperation?.type === "text" && pptxTarget?.type === "text") {
    assert.notEqual(pptxTarget.x, (target.layout!.frame.x / 100) * pptx.slideW);
    assert.notEqual(pptxTarget.y, (target.layout!.frame.y / 100) * pptx.slideH);
    assert.equal(pptxTarget.rotation, targetOperation.rotation);
  }
  if (resolvedTarget) {
    const targetFrame = resolvedTarget.layout.frame;
    assert.equal(
      hitTestSlideNodes(
        {
          x: targetFrame.x + targetFrame.w / 2,
          y: targetFrame.y + targetFrame.h / 2,
        },
        deck.slides[0].children,
        { includeLocked: true, order: "visual" },
      )[0]?.node.id,
      target.id,
    );
  }
  if (
    connectorOperation?.type === "connector" &&
    resolvedConnector?.content.type === "connector" &&
    resolvedTarget
  ) {
    assert.deepEqual(
      connectorOperation.to,
      resolvedConnector.content.content.to,
    );
    assert.deepEqual(
      connectorOperation.frame,
      resolvedConnector.layout.framePx,
    );
    assert.equal(targetOperation?.type, "text");
    if (targetOperation?.type === "text") {
      assert.deepEqual(targetOperation.frame, resolvedTarget.layout.framePx);
    }
    assert.notDeepEqual(resolvedTarget.layout.frame, target.layout?.frame);
    assert.equal(pptxConnector?.type, "connector");
    if (pptxConnector?.type === "connector") {
      assert.deepEqual(pptxConnector.to, connectorOperation.to);
    }
  }
});

test("public present and embeddable projections resolve equivalent presentation render trees", async () => {
  const deck = buildParityDeck();
  const source = publicSource(publicDocumentForDeck(deck));
  const present = await resolvePublicRenderWithSource(source, {
    params: { shareId: "parity-deck-share123" },
    mode: "present",
    projection: "presentation",
    now: PUBLIC_NOW,
  });
  const embed = await resolvePublicRenderWithSource(source, {
    params: { shareId: "parity-deck-share123" },
    mode: "embed",
    projection: "presentation",
    now: PUBLIC_NOW,
  });

  assert.equal(present.ok, true);
  assert.equal(embed.ok, true);
  if (
    !present.ok ||
    present.projection !== "presentation" ||
    !embed.ok ||
    embed.projection !== "presentation"
  ) {
    throw new Error("Expected presentation projections.");
  }

  const presentTree = resolveDeckRenderTree(
    present.presentation.deck,
    present.presentation.themePackage,
  );
  const embedTree = resolveDeckRenderTree(
    embed.presentation.deck,
    embed.presentation.themePackage,
  );

  assert.deepEqual(surfaceSignature(embedTree), surfaceSignature(presentTree));
  assert.equal(present.presentation.recovery, undefined);
  assert.equal(embed.presentation.recovery, undefined);
  assert.equal(embed.presentation.themePackage.id, "neutral");
});

test("prototype HTML renderer emits nodes from the product presentation render tree", () => {
  const deck = buildParityDeck();
  const tree = resolveDeckRenderTree(deck, NEUTRAL_THEME_PACKAGE);
  const html = renderPrototypeSlideHtml(deck, NEUTRAL_THEME_PACKAGE, 0);

  for (const node of tree.slides[0].nodes) {
    assert.match(html, new RegExp(`data-node-id="${node.id}"`));
    assert.match(html, new RegExp(`data-node-type="${node.content.type}"`));
  }
});

test("PPTX parity fixture covers representative core node operations", () => {
  const deck = buildParityDeck();
  const renderTree = resolveDeckRenderTree(deck, NEUTRAL_THEME_PACKAGE);
  const exportSpec = resolveExportSpecAssetSources(
    deck,
    buildExportSpec(renderTree),
  );
  const pptx = buildPptxSpec(exportSpec);
  const ops = pptx.slides[0].ops;
  const types = new Set(ops.map((op) => op.type));
  const expectedTypes = [
    "connector",
    "image",
    "shape",
    "tableShape",
    "text",
    "visual",
  ] as const;

  assert.deepEqual(
    expectedTypes.filter((type) => !types.has(type)),
    [],
  );
  const visualOp = ops.find((op) => op.type === "visual");
  assert.equal(visualOp?.assetId, DATA_URI);
  const connectorOp = ops.find((op) => op.type === "connector");
  assert.equal(connectorOp?.routing, "elbow");
  assert.equal(connectorOp?.endArrow, "filled");
  assert.ok(
    ops.some((op) => op.id === "deck-chrome-footer"),
    "PPTX spec includes deck chrome footer",
  );
  assert.ok(
    ops.some((op) => op.id === "deck-chrome-pageNumber"),
    "PPTX spec includes deck chrome page number",
  );
  assert.equal(
    pptx.diagnostics.some((diagnostic) => diagnostic.code === "missing-asset"),
    false,
  );
});

test("custom brand-kit package preserves colors and fonts through render and PPTX export", () => {
  resetBuilderCounter();
  const pkg = buildCustomBrandKitPackage();
  const deck = buildDeck(
    [
      buildSlide(
        "content",
        [
          buildTextNode({
            id: "custom-brand-title",
            role: "title",
            layout: { frame: { x: 8, y: 8, w: 84, h: 10 }, zIndex: 1 },
            style: { ref: "text.title" },
          }),
          buildTextNode({
            id: "custom-brand-body",
            role: "body",
            layout: { frame: { x: 8, y: 22, w: 44, h: 18 }, zIndex: 2 },
            style: { ref: "text.body" },
          }),
          buildShapeNode({
            id: "custom-brand-card",
            layout: { frame: { x: 56, y: 22, w: 28, h: 18 }, zIndex: 3 },
            style: { ref: "surface.card" },
          }),
        ],
        { style: { ref: "slide.content" } },
      ),
    ],
    {
      title: "Custom brand parity",
      theme: { packageId: pkg.id, packageVersion: pkg.version },
    },
  );

  const renderTree = resolveDeckRenderTree(deck, pkg);
  const title = renderTree.slides[0].nodes.find(
    (node) => node.id === "custom-brand-title",
  );
  const body = renderTree.slides[0].nodes.find(
    (node) => node.id === "custom-brand-body",
  );
  const card = renderTree.slides[0].nodes.find(
    (node) => node.id === "custom-brand-card",
  );
  assert.equal(renderTree.theme.packageId, pkg.id);
  assert.equal(
    title?.style.text?.fontFamily,
    "'JetBrains Mono', 'Noto Sans SC', ui-monospace, monospace",
  );
  assert.equal(title?.style.text?.color, "#111827");
  assert.equal(body?.style.text?.fontFamily, "Parity Sans");
  assert.equal(card?.style.fill?.type, "solid");
  if (card?.style.fill?.type === "solid") {
    assert.equal(card.style.fill.color, "#dbeafe");
  }

  const exportSpec = buildExportSpec(renderTree);
  const pptx = buildPptxSpec(exportSpec);
  const titleOp = pptx.slides[0].ops.find(
    (op) => op.id === "custom-brand-title",
  );
  const bodyOp = pptx.slides[0].ops.find((op) => op.id === "custom-brand-body");
  const cardOp = pptx.slides[0].ops.find((op) => op.id === "custom-brand-card");
  assert.equal(titleOp?.type, "text");
  assert.equal(bodyOp?.type, "text");
  assert.equal(cardOp?.type, "shape");
  if (titleOp?.type === "text")
    assert.equal(titleOp.textStyle.fontFace, "Consolas");
  if (bodyOp?.type === "text")
    assert.equal(bodyOp.textStyle.fontFace, "Parity Sans");
  if (cardOp?.type === "shape") assert.equal(cardOp.fill, "DBEAFE");
});

test("PPTX fidelity parity fixture guards fallback-prone render-to-export behavior", () => {
  const deck = buildPptxFidelityParityDeck();
  const renderTree = resolveDeckRenderTree(deck, NEUTRAL_THEME_PACKAGE);
  const exportSpec = resolveExportSpecAssetSources(
    deck,
    buildExportSpec(renderTree),
  );
  const pptx = buildPptxSpec(exportSpec);
  const renderNodeIds = new Set(
    renderTree.slides[0].nodes.map((node) => node.id),
  );
  const pptxOpsById = new Map(pptx.slides[0].ops.map((op) => [op.id, op]));

  for (const id of [
    "fidelity-linear-gradient",
    "fidelity-radial-gradient",
    "fidelity-conic-gradient",
    "fidelity-repeating-gradient",
    "fidelity-pattern-fill",
    "fidelity-image-fill",
    "fidelity-glass-effect",
    "fidelity-blur-effect",
    "fidelity-glow-effect",
    "fidelity-straight-connector",
    "fidelity-elbow-connector",
    "fidelity-curved-connector",
    "fidelity-resolved-visual",
    "fidelity-unresolved-visual",
  ]) {
    assert.ok(renderNodeIds.has(id), `${id} is present in render tree`);
    assert.ok(pptxOpsById.has(id), `${id} is present in PPTX export`);
  }

  const resolvedVisual = pptxOpsById.get("fidelity-resolved-visual");
  assert.equal(resolvedVisual?.type, "visual");
  if (resolvedVisual?.type === "visual") {
    assert.equal(resolvedVisual.assetId, PPTX_FIDELITY_DATA_URI);
  }
  assert.ok(
    pptx.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "missing-asset" &&
        diagnostic.path === "op(visual:fidelity-unresolved-visual)",
    ),
  );
});

test("PPTX parity preserves theme decoration and deck chrome layer ordering", () => {
  resetBuilderCounter();
  const slide = buildSlide(
    "content",
    [
      buildTextNode({
        id: "parity-layer-user",
        layout: { frame: { x: 18, y: 28, w: 64, h: 12 }, zIndex: 2 },
      }),
    ],
    {
      props: {
        decoration: "default",
        chrome: "default",
      },
    },
  );
  const deck = buildDeck([slide], {
    chrome: {
      watermark: {
        enabled: true,
        text: "Draft",
        layout: { frame: { x: 12, y: 42, w: 76, h: 14 }, zIndex: -30 },
      },
      footer: { enabled: true, text: "Confidential" },
      pageNumber: { enabled: true },
    },
  });
  const pkg = buildMinimalThemePackage("test-package", {
    decorations: {
      "parity-bg": {
        id: "parity-bg",
        component: "shape",
        role: "themeDecoration",
        layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: -80 },
        style: { fill: { type: "solid", color: "#eff6ff" } },
      },
    },
  });

  const renderTree = resolveDeckRenderTree(deck, pkg);
  const exportSpec = resolveExportSpecAssetSources(
    deck,
    buildExportSpec(renderTree),
  );
  const pptx = buildPptxSpec(exportSpec);

  assert.deepEqual(
    pptx.slides[0].ops.map((op) => op.id),
    [
      "decoration-parity-bg",
      "deck-chrome-watermark",
      "parity-layer-user",
      "deck-chrome-footer",
      "deck-chrome-pageNumber",
    ],
  );
  assert.equal(
    pptx.diagnostics.some((diagnostic) => diagnostic.code === "missing-asset"),
    false,
  );
});

test("export spec flattens grouped nodes after decorations and reports unknown content fallbacks", () => {
  const decorationNode: ResolvedRenderNode = {
    id: "decoration-shape",
    type: "shape",
    role: "themeDecoration",
    layout: {
      frame: { x: 0, y: 0, w: 100, h: 12 },
      zIndex: 0,
    },
    style: { fill: { type: "solid", color: "#eff6ff" } },
    content: { type: "shape", content: { shape: "rect" } },
    source: "themeDecoration",
  };
  const groupedTextNode: ResolvedRenderNode = {
    id: "grouped-text",
    type: "text",
    role: "body",
    layout: {
      frame: { x: 10, y: 20, w: 30, h: 10 },
      framePx: { x: 96, y: 108, w: 288, h: 54 },
      rotation: 7,
      zIndex: 2,
    },
    style: {
      text: { fontSizePt: 18, color: "#111827" },
      effect: { kind: "blur", radiusPt: 4 },
    },
    content: {
      type: "text",
      content: { paragraphs: [{ id: "grouped-para", text: "Grouped text" }] },
    },
    source: "user",
  };
  const groupedImageNode: ResolvedRenderNode = {
    id: "grouped-image",
    type: "image",
    role: "image",
    layout: {
      frame: { x: 48, y: 20, w: 24, h: 18 },
      rotation: -5,
      zIndex: 3,
    },
    style: {},
    content: {
      type: "image",
      content: { assetId: "img-grouped", alt: "Grouped image" },
    },
    source: "user",
  };
  const groupNode: ResolvedRenderNode = {
    id: "node-group",
    type: "group",
    layout: {
      frame: { x: 8, y: 18, w: 72, h: 32 },
      zIndex: 1,
    },
    style: {},
    content: { type: "group" },
    children: [groupedTextNode, groupedImageNode],
    source: "user",
  };
  const unknownNode: ResolvedRenderNode = {
    id: "unsupported-node",
    type: "shape",
    role: "callout",
    layout: {
      frame: { x: 80, y: 20, w: 12, h: 12 },
      zIndex: 4,
    },
    style: {},
    content: { type: "unsupported-fixture" } as never,
    source: "user",
  };
  const renderTree: ResolvedDeckRenderTree = {
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: {
      tokens: NEUTRAL_THEME_PACKAGE.tokens,
      packageId: NEUTRAL_THEME_PACKAGE.id,
      packageVersion: NEUTRAL_THEME_PACKAGE.version,
    },
    diagnostics: [
      makeDiagnostic("local-style-overrides", "info", "carried from resolver"),
    ],
    slides: [
      {
        id: "manual-slide",
        background: {
          fill: { type: "solid", color: "#ffffff" },
          decorationLevel: "subtle",
        },
        decorations: [decorationNode],
        chrome: [],
        nodes: [groupNode, unknownNode],
        notes: "Manual export notes",
      },
    ],
  };

  const spec = buildExportSpec(renderTree);
  assert.deepEqual(
    spec.slides[0].operations.map((operation) => operation.id),
    ["decoration-shape", "grouped-text", "grouped-image"],
  );
  const textOperation = spec.slides[0].operations.find(
    (operation) => operation.id === "grouped-text",
  );
  assert.equal(textOperation?.type, "text");
  if (textOperation?.type === "text") {
    assert.deepEqual(textOperation.frame, { x: 96, y: 108, w: 288, h: 54 });
    assert.equal(textOperation.rotation, 7);
  }
  const imageOperation = spec.slides[0].operations.find(
    (operation) => operation.id === "grouped-image",
  );
  assert.equal(imageOperation?.type, "image");
  if (imageOperation?.type === "image") {
    assert.equal(imageOperation.alt, "Grouped image");
  }
  assert.equal(spec.slides[0].notes, "Manual export notes");
  assert.ok(
    spec.diagnostics.some(
      (diagnostic) => diagnostic.code === "local-style-overrides",
    ),
  );
  assert.ok(
    spec.diagnostics.some(
      (diagnostic) => diagnostic.code === "unsupported-export-feature",
    ),
  );
});
