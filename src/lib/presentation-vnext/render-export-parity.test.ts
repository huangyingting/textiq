import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicPresentationModel } from "@/lib/public-render/presentation";
import {
  resolvePublicRenderWithSource,
  type PublicRenderDocumentRow,
  type PublicRenderSource,
} from "@/lib/public-render/resolver-core";
import { NEUTRAL_THEME_PACKAGE } from "@/lib/presentation-vnext/neutral-theme-package";
import { resolveDeckRenderTree } from "@/lib/presentation-vnext/render-resolver";
import { buildExportSpec } from "@/lib/presentation-vnext/export-spec";
import { buildVnextPptxSpec } from "@/lib/presentation-vnext/pptx-export-adapter";
import { resolveExportSpecAssetSources } from "@/lib/presentation-vnext/pptx-vnext-apply";
import { makeDiagnostic } from "@/lib/presentation-vnext/diagnostics";
import type { DeckV7, SlideChildNode } from "@/lib/presentation-vnext/schema";
import type {
  ResolvedDeckRenderTree,
  ResolvedRenderNode,
} from "@/lib/presentation-vnext/render-tree";
import {
  buildDeckV7,
  buildImageNode,
  buildShapeNode,
  buildSlideV7,
  buildTableNode,
  buildTextNode,
  buildMinimalThemePackage,
  resetBuilderCounter,
} from "@/test/builders/deck-v7";
import {
  buildPptxFidelityParityDeck,
  PPTX_FIDELITY_DATA_URI,
} from "@/test/fixtures/pptx-fidelity";
import { renderPrototypeSlideHtml } from "../../../prototypes/slide-themes/render-html";

const DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const PUBLIC_NOW = new Date("2026-06-30T10:00:00Z");

function buildParityDeck(): DeckV7 {
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
  const slide = buildSlideV7(
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

  return buildDeckV7([slide], {
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
  deck: DeckV7,
  overrides: Partial<PublicRenderDocumentRow> = {},
): PublicRenderDocumentRow {
  return {
    id: "doc-parity",
    title: deck.title ?? "Parity deck",
    contentJson: { root: { children: [] } },
    deckJson: deck,
    slug: "parity-deck",
    ownerId: "owner-parity",
    workspaceId: null,
    workspace: null,
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

function publicSource(row: PublicRenderDocumentRow | null): PublicRenderSource {
  return {
    async findByShareId() {
      return row;
    },
    async findByDocumentId() {
      return row;
    },
  };
}

test("representative deck keeps editor, present, and public v7 render signatures aligned", () => {
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
    publicModel.deckV7,
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

test("public present and embeddable projections resolve equivalent v7 render trees", async () => {
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
    present.presentation.deckV7,
    present.presentation.themePackage,
  );
  const embedTree = resolveDeckRenderTree(
    embed.presentation.deckV7,
    embed.presentation.themePackage,
  );

  assert.deepEqual(surfaceSignature(embedTree), surfaceSignature(presentTree));
  assert.equal(present.presentation.recovery, undefined);
  assert.equal(embed.presentation.recovery, undefined);
  assert.equal(embed.presentation.themePackage.id, "neutral");
});

test("prototype HTML renderer emits nodes from the product v7 render tree", () => {
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
  const pptx = buildVnextPptxSpec(exportSpec);
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

test("PPTX fidelity parity fixture guards fallback-prone render-to-export behavior", () => {
  const deck = buildPptxFidelityParityDeck();
  const renderTree = resolveDeckRenderTree(deck, NEUTRAL_THEME_PACKAGE);
  const exportSpec = resolveExportSpecAssetSources(
    deck,
    buildExportSpec(renderTree),
  );
  const pptx = buildVnextPptxSpec(exportSpec);
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
  const slide = buildSlideV7(
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
  const deck = buildDeckV7([slide], {
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
  const pptx = buildVnextPptxSpec(exportSpec);

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
