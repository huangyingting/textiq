import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as React from "react";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SourceBlockIndexEntry } from "@/lib/presentation/block-index";
import { resolveDeckRenderTree } from "@/lib/presentation/render-resolver";
import type {
  ResolvedDeckRenderTree,
  ResolvedNodeContent,
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "@/lib/presentation/render-tree";
import type { SlideChildNode } from "@/lib/presentation/schema";
import type { SourceReviewItem } from "@/lib/presentation/source-links";
import type { StyleObject } from "@/lib/presentation/style-schema";
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
} from "@/test/builders/presentation-deck";
import { createServerRenderHarness } from "@/test/react-server-renderer";
import { PresentMode } from "./present-mode";
import {
  PresenterPanelPresentation,
  SlideOverviewPanelPresentation,
} from "./present-mode/presenter-tools";
import { PublicPresentViewer } from "./public-present-viewer";
import { SlideCanvas } from "./slide-canvas";
import { SlideNodeRenderer } from "./slide-node-renderer";
import { SourceReviewPanel } from "./source-review-panel";
import { StageNodeContextMenu, stageNodeMenuLabel } from "./stage-context-menu";
import { createSelectionState, setSelection } from "./selection-model";

type ElementProps = Record<string, unknown>;

type PortalLike = {
  children?: ReactNode;
  [key: string]: unknown;
};

function createHookRenderer() {
  return createServerRenderHarness({ idPrefix: "render-surface-id" });
}

function collectElements(node: ReactNode, elements: ReactElement[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, elements);
    return elements;
  }
  if (isValidElement(node)) {
    elements.push(node);
    collectElements(
      (node.props as { children?: ReactNode }).children,
      elements,
    );
    return elements;
  }
  const maybePortal = node as PortalLike | null;
  if (maybePortal && maybePortal["$$typeof"] === Symbol.for("react.portal")) {
    collectElements(maybePortal.children, elements);
  }
  return elements;
}

function propsOf(element: ReactElement): ElementProps {
  return element.props as ElementProps;
}

function clickMenuItems(node: ReactNode): string[] {
  const calls: string[] = [];
  for (const element of collectElements(node)) {
    const props = propsOf(element);
    if (props.role !== "menuitem" || typeof props.onClick !== "function") {
      continue;
    }
    (props.onClick as () => void)();
    const label = collectElements(element)
      .map((child) => (propsOf(child).children ?? "").toString())
      .find((value) => value.length > 0);
    if (label) calls.push(label);
  }
  return calls;
}

function resolvedNode(
  id: string,
  content: ResolvedNodeContent,
  style: StyleObject = {},
  overrides: Partial<ResolvedRenderNode> = {},
): ResolvedRenderNode {
  return {
    id,
    type: content.type,
    role: "body",
    layout: {
      frame: { x: 8, y: 10, w: 34, h: 24 },
      rotation: 12,
      zIndex: 3,
      flipY: true,
    },
    style,
    content,
    source: "user",
    ...overrides,
  };
}

function renderNode(node: ResolvedRenderNode, props: ElementProps = {}) {
  return renderToStaticMarkup(
    createElement(SlideNodeRenderer, {
      node,
      assetResolver: (assetId: string) =>
        assetId === "missing" ? undefined : `https://assets.example/${assetId}`,
      ...props,
    }),
  );
}

function richRenderTree(): ResolvedDeckRenderTree {
  const deck = buildDeck(
    [
      buildSlide(
        "content",
        [
          buildTextNode({
            id: "title-node",
            role: "title",
            content: buildTextContent(["Quarterly plan"]),
          }),
          buildShapeNode({
            id: "shape-node",
            content: { shape: "diamond" },
            localStyle: { fill: { type: "solid", color: "#fde68a" } },
          }),
          buildImageNode("hero", {
            id: "image-node",
            content: {
              assetId: "hero",
              alt: "Hero image",
              fit: "contain",
              crop: { top: 4, right: 6, bottom: 8, left: 10 },
            },
          }),
          buildVisualNode({
            id: "visual-node",
            content: {
              assetId: "visual-asset",
              visualId: "visual-1",
              alt: "Chart preview",
            },
          }),
          buildTableNode({ id: "table-node" }),
        ],
        { id: "slide-one", name: "Named slide", notes: "Discuss risks." },
      ),
      buildSlide(
        "content",
        [
          buildTextNode({
            id: "untitled-body",
            content: buildTextContent(["Fallback label"]),
          }),
        ],
        { id: "slide-two", name: "\n  " },
      ),
    ],
    {
      assets: {
        images: {
          hero: buildImageAsset("hero", { src: "https://assets.example/hero" }),
          backing: buildImageAsset("backing", {
            src: "https://assets.example/backing",
          }),
        },
        visuals: {
          "visual-asset": {
            id: "backing",
            visualId: "visual-1",
            alt: "Chart preview",
          },
        },
      },
    },
  );
  return resolveDeckRenderTree(deck, buildMinimalThemePackage());
}

describe("presentation render element surfaces", () => {
  test("renders representative text, shape, media, table, connector, and group branches", () => {
    const textHtml = renderNode(
      resolvedNode(
        "text-rich",
        {
          type: "text",
          content: {
            paragraphs: [
              {
                id: "p1",
                text: "Alpha",
                runs: [
                  { text: "Alpha", bold: true, strikethrough: true },
                  { text: " Link", link: "https://example.com" },
                ],
              },
              { id: "p2", text: "Beta", list: { kind: "number", indent: 9 } },
            ],
          },
        },
        {
          text: {
            fontFamily: "Inter",
            fontSizePt: 16,
            color: "#111827",
            verticalAlign: "bottom",
            paragraphSpacingPt: 3,
          },
        },
      ),
      { interactive: true, selected: true, tabIndex: 0 },
    );
    const shapeHtml = renderNode(
      resolvedNode(
        "shape-hidden-text",
        {
          type: "shape",
          content: {
            shape: "path",
            path: "M 0 0 L 100 20 L 80 100 Z",
          },
        },
        {
          fill: { type: "solid", color: "#dbeafe" },
          stroke: { color: "#1d4ed8", widthPt: 2, dash: "dashed" },
        },
      ),
      { hidden: true },
    );
    const missingImageHtml = renderNode(
      resolvedNode("image-missing", {
        type: "image",
        content: { assetId: "missing", alt: "Missing image" },
      }),
    );
    const filteredImageHtml = renderNode(
      resolvedNode(
        "image-filtered",
        {
          type: "image",
          content: { assetId: "img.png", fit: "contain" },
        },
        { image: { brightness: 1.2, contrast: 0.8, saturation: 1.4 } },
      ),
    );
    const visualHtml = renderNode(
      resolvedNode(
        "visual-fallback",
        {
          type: "visual",
          content: { visualId: "viz", transparentBackground: false },
        },
        {
          visual: {
            transparentBackground: false,
            channelColors: { primary: "#111111", muted: "#999999" },
          },
        },
      ),
    );
    const tableHtml = renderNode(
      resolvedNode(
        "table-editable",
        {
          type: "table",
          content: {
            header: true,
            caption: "Forecast table",
            columns: [
              { id: "c1", label: "Metric" },
              { id: "c2", label: "Value" },
            ],
            rows: [
              {
                id: "r1",
                cells: [
                  { text: "Revenue" },
                  {
                    text: "42",
                    runs: [{ text: "42", bold: true, code: true }],
                  },
                ],
              },
              { id: "r2", cells: [{ text: "Cost" }, { text: "17" }] },
            ],
          },
        },
        {
          table: {
            headerFill: { type: "solid", color: "#e0f2fe" },
            rowFill: { type: "solid", color: "#ffffff" },
            alternateRowFill: { type: "solid", color: "#f8fafc" },
            border: { color: "#0f172a", widthPt: 1 },
            cellPaddingPt: { top: 1, right: 2, bottom: 3, left: 4 },
          },
        },
      ),
      { tableEditing: true, activeTableCell: { rowIndex: 1, colIndex: 0 } },
    );
    const connectorHtml = ["straight", "elbow", "curved"]
      .map((routing) =>
        renderNode(
          resolvedNode(
            `connector-${routing}`,
            {
              type: "connector",
              content: {
                from: { kind: "node", nodeId: "a", anchor: "top" },
                to: { kind: "node", nodeId: "b", anchor: "left" },
                routing: routing as "straight" | "elbow" | "curved",
              },
            },
            {
              connector: {
                stroke: { color: "#ef4444", widthPt: 3, dash: "dotted" },
                startArrow: routing === "straight" ? "none" : "filled",
                endArrow: routing === "curved" ? "none" : "arrow",
              },
            },
          ),
        ),
      )
      .join("\n");
    const groupHtml = renderNode(
      resolvedNode("group-node", { type: "group" }, {}, { type: "group" }),
      { interactive: true },
    );

    assert.match(textHtml, /Text: Alpha Beta/);
    assert.match(textHtml, /line-through/);
    assert.match(textHtml, /justify-content:flex-end/);
    assert.match(shapeHtml, /M 0 0 L 100 20 L 80 100 Z/);
    assert.doesNotMatch(shapeHtml, /Hidden label/);
    assert.match(missingImageHtml, /aria-label="Missing image"/);
    assert.match(
      filteredImageHtml,
      /filter:brightness\(1.2\) contrast\(0.8\) saturate\(1.4\)/,
    );
    assert.match(visualHtml, /aria-label="viz"/);
    assert.match(visualHtml, /background-color:#99999922/);
    assert.match(tableHtml, /contentEditable="true"/);
    assert.match(tableHtml, /data-table-cell="1:0"/);
    assert.match(tableHtml, /outline outline-2 outline-ds-accent/);
    assert.match(connectorHtml, /stroke-dasharray="1 4"/);
    assert.match(connectorHtml, /C 25 0 25 50 0 50/);
    assert.match(groupHtml, /aria-label="Group node"/);
  });

  test("renders slide canvas selection, image background, gesture drafts, and preview suppression", () => {
    const multiSelection = setSelection(createSelectionState("normal"), [
      "image-node",
      "connector-node",
    ]);
    const imageSelection = setSelection(createSelectionState("normal"), [
      "image-node",
    ]);
    const connectorSelection = setSelection(createSelectionState("normal"), [
      "connector-node",
    ]);
    const draftMap = new Map([
      [
        "image-node",
        {
          frame: { x: 12, y: 14, w: 28, h: 30 },
          rotation: 45,
          crop: { top: 10, right: 20, bottom: 30, left: 40 },
        },
      ],
      [
        "connector-node",
        {
          connectorEndpoints: {
            from: { kind: "point" as const, point: { x: 10, y: 20 } },
            to: { kind: "point" as const, point: { x: 90, y: 80 } },
          },
        },
      ],
    ]);
    const slide: ResolvedSlideRenderTree = {
      id: "canvas-slide",
      background: {
        fill: { type: "image", assetId: "bg", opacity: 0.25 },
        decorationLevel: "expressive",
      },
      decorations: [
        resolvedNode(
          "decoration",
          { type: "text", content: buildTextContent(["Decoration"]) },
          {},
          { source: "themeDecoration" },
        ),
      ],
      chrome: [],
      nodes: [
        resolvedNode("image-node", {
          type: "image",
          content: { assetId: "image", alt: "Draft image" },
        }),
        resolvedNode("connector-node", {
          type: "connector",
          content: {
            from: { kind: "point", point: { x: 0, y: 50 } },
            to: { kind: "point", point: { x: 100, y: 50 } },
          },
        }),
      ],
    };

    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide,
        selection: imageSelection,
        assetResolver: (assetId) => `https://assets.example/${assetId}.png`,
        nodeGestureDrafts: draftMap,
        focusedNodeId: "image-node",
        hoveredNodeId: "connector-node",
        onNodePointerDown: () => undefined,
        onResizeHandlePointerDown: () => undefined,
        onCropHandlePointerDown: () => undefined,
        onRotationHandlePointerDown: () => undefined,
        onConnectorEndpointPointerDown: () => undefined,
        activeCropHandle: { nodeId: "image-node", handle: "left" },
        activeConnectorEndpoint: { nodeId: "connector-node", endpoint: "from" },
      }),
    );
    const connectorHtml = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide,
        selection: connectorSelection,
        assetResolver: (assetId) => `https://assets.example/${assetId}.png`,
        nodeGestureDrafts: draftMap,
        onConnectorEndpointPointerDown: () => undefined,
        activeConnectorEndpoint: { nodeId: "connector-node", endpoint: "from" },
      }),
    );
    const previewHtml = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide,
        selection: multiSelection,
        preview: true,
        onResizeHandlePointerDown: () => undefined,
        onCropHandlePointerDown: () => undefined,
        onConnectorEndpointPointerDown: () => undefined,
      }),
    );

    assert.match(html, /data-slide-background-fill-layer="image"/);
    assert.match(html, /opacity:0.25/);
    assert.match(html, /left:12%/);
    assert.match(html, /rotate\(45deg\)/);
    assert.match(html, /width:160%/);
    assert.match(html, /data-crop-handle="left"/);
    assert.match(connectorHtml, /data-connector-endpoint="from"/);
    assert.match(html, /data-node-hovered="true"/);
    assert.doesNotMatch(previewHtml, /data-crop-handle=/);
    assert.doesNotMatch(previewHtml, /data-node-chrome-frame=/);
  });
});

describe("present and public viewer render states", () => {
  test("renders present mode, public viewer embed mode, presenter notes, and slide overview", () => {
    const renderTree = richRenderTree();
    const deck = buildDeck([
      buildSlide(
        "content",
        [buildTextNode({ content: buildTextContent(["First title"]) })],
        {
          id: "s1",
          name: "First slide",
          notes: "Speaker note line",
        },
      ),
      buildSlide(
        "content",
        [
          buildShapeNode({
            content: { shape: "rect" },
            name: "Second shape",
          }),
        ],
        {
          id: "s2",
        },
      ),
    ]);

    const presentHtml = renderToStaticMarkup(
      createElement(PresentMode, {
        deck,
        themePackage: buildMinimalThemePackage(),
        onClose: () => undefined,
      }),
    );
    const publicHtml = renderToStaticMarkup(
      createElement(PublicPresentViewer, {
        deck,
        themePackage: buildMinimalThemePackage(),
        title: "Published deck",
        embed: true,
        showAttribution: true,
      }),
    );
    const presenterHtml = renderToStaticMarkup(
      createElement(PresenterPanelPresentation, {
        currentSlide: deck.slides[0],
        currentIndex: 0,
        total: 2,
        nextSlide: deck.slides[1],
        nextSlideTree: renderTree.slides[1],
        canvas: renderTree.canvas,
      }),
    );
    const noNextPresenterHtml = renderToStaticMarkup(
      createElement(PresenterPanelPresentation, {
        currentSlide: { ...deck.slides[1], notes: undefined },
        currentIndex: 1,
        total: 2,
        canvas: { ...renderTree.canvas, width: 0, height: 0 },
      }),
    );
    const overviewHtml = renderToStaticMarkup(
      createElement(SlideOverviewPanelPresentation, {
        slides: deck.slides,
        renderTree: {
          ...renderTree,
          canvas: { ...renderTree.canvas, width: 0 },
        },
        currentIndex: 1,
        onJump: () => undefined,
        onClose: () => undefined,
      }),
    );

    assert.match(presentHtml, /aria-label="Presentation"/);
    assert.match(presentHtml, /Presentation controls/);
    assert.match(publicHtml, /Presentation: Published deck/);
    assert.doesNotMatch(publicHtml, /Presentation controls/);
    assert.match(publicHtml, /Made with/);
    assert.match(presenterHtml, /Speaker note line/);
    assert.match(presenterHtml, /Up next/);
    assert.match(noNextPresenterHtml, /No speaker notes for this slide/);
    assert.doesNotMatch(noNextPresenterHtml, /Up next/);
    assert.match(overviewHtml, /Slide overview/);
    assert.match(overviewHtml, /aria-current="true"/);
    assert.match(overviewHtml, /Jump to slide 2/);
  });

  test("limits public recovery details and keeps attribution visible", () => {
    const html = renderToStaticMarkup(
      createElement(PublicPresentViewer, {
        deck: buildDeck([]),
        title: "Recovery",
        showAttribution: true,
        recovery: {
          error: "Invalid public deck",
          diagnostics: Array.from({ length: 5 }, (_, index) => ({
            code: "local-style-overrides" as const,
            category: "validation" as const,
            severity: "warning" as const,
            message: `Diagnostic ${index}`,
            target: { scope: "deck" as const },
          })),
          validationErrors: ["Validation A", "Validation B", "Validation C"],
        },
      }),
    );

    assert.match(html, /Presentation deck could not be opened/);
    assert.match(html, /Diagnostic 4/);
    assert.match(html, /Validation A/);
    assert.doesNotMatch(html, /Validation B/);
    assert.match(html, /Made with/);
  });
});

describe("source review and context menu render surfaces", () => {
  const sourceBlock: SourceBlockIndexEntry = {
    documentId: "doc-1",
    id: "block-1",
    kind: "text",
    hash: "hash-1",
    displayLabel: "Block One",
    refresh: { kind: "text", text: "Block One" },
  };

  function reviewItem(
    state: SourceReviewItem["state"],
    nodeId: string,
  ): SourceReviewItem {
    return {
      slideId: "slide-1",
      slideIndex: 0,
      slideLabel: "Slide 1",
      nodeId,
      nodeType: "text",
      source: {
        documentId: "doc-1",
        blockId: nodeId,
        blockKind: "text",
        contentHash: "hash-old",
      },
      state,
      reason: `${state} reason`,
      sourceLabel: `${state} source`,
      ...(state === "fresh" ? { block: sourceBlock } : {}),
    };
  }

  test("renders source review state badges and safe action handlers", () => {
    const items = [
      reviewItem("fresh", "fresh-node"),
      reviewItem("unknown", "unknown-node"),
      reviewItem("unlinked", "unlinked-node"),
      reviewItem("stale", "stale-node"),
    ];
    const calls: string[] = [];
    const element = SourceReviewPanel({
      items,
      sourceBlocks: [],
      statusMessage: "No relink candidates",
      onSelect: (_slideId, nodeId) => calls.push(`select:${nodeId}`),
      onRefresh: (_slideId, nodeId) => calls.push(`refresh:${nodeId}`),
      onUnlink: (_slideId, nodeId) => calls.push(`unlink:${nodeId}`),
      onRelink: (_slideId, nodeId) => calls.push(`relink:${nodeId}`),
      onNavigateSource: (_documentId, blockId) =>
        calls.push(`source:${blockId}`),
      onDismiss: (_slideId, nodeId) => calls.push(`dismiss:${nodeId}`),
      onRefreshAll: () => calls.push("refresh-all"),
    });
    const html = renderToStaticMarkup(element);

    for (const handler of collectElements(element)
      .map(propsOf)
      .filter((props) => typeof props.onClick === "function")
      .map((props) => props.onClick as () => void)) {
      handler();
    }

    assert.match(html, /Fresh/);
    assert.match(html, /Unknown/);
    assert.match(html, /Unlinked/);
    assert.match(html, /Refresh all safe stale \(1\)/);
    assert.match(html, /disabled=""/);
    assert.ok(calls.includes("refresh-all"));
    assert.ok(calls.includes("select:fresh-node"));
    assert.ok(calls.includes("source:fresh-node"));
    assert.ok(calls.includes("dismiss:stale-node"));
  });

  test("renders node context menus for text, connector, lock, grouping, and candidate layers", () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    Object.assign(globalThis, {
      document: { body: { nodeType: 1 } },
      window: {
        innerWidth: 320,
        innerHeight: 240,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });

    try {
      const textNode: SlideChildNode = buildTextNode({
        id: "text-menu",
        name: "",
        content: buildTextContent(["Menu label"]),
      });
      const connectorNode: SlideChildNode = {
        id: "connector-menu",
        type: "connector",
        role: "connector",
        layout: buildLayoutBox(),
        style: { ref: "connector.primary" },
        locked: true,
        content: {
          from: { kind: "node", nodeId: "text-menu", anchor: "right" },
          to: { kind: "point", point: { x: 90, y: 50 } },
        },
      };
      const calls: string[] = [];
      const common = {
        x: 999,
        y: -20,
        candidates: [textNode, connectorNode],
        selectedCount: 2,
        canPaste: true,
        canGroup: true,
        canUngroup: true,
        onClose: () => calls.push("close"),
        onSelectCandidate: (nodeId: string) => calls.push(`select:${nodeId}`),
        onEdit: () => calls.push("edit"),
        onDuplicate: () => calls.push("duplicate"),
        onCopy: () => calls.push("copy"),
        onCut: () => calls.push("cut"),
        onPaste: () => calls.push("paste"),
        onDelete: () => calls.push("delete"),
        onBringToFront: () => calls.push("front"),
        onSendToBack: () => calls.push("back"),
        onToggleLock: () => calls.push("lock"),
        onDetachConnectorFrom: () => calls.push("detach-from"),
        onDetachConnectorTo: () => calls.push("detach-to"),
        onGroup: () => calls.push("group"),
        onUngroup: () => calls.push("ungroup"),
      };

      const textMenu = createHookRenderer().run(() =>
        StageNodeContextMenu({ ...common, node: textNode }),
      );
      const connectorMenu = createHookRenderer().run(() =>
        StageNodeContextMenu({
          ...common,
          node: connectorNode,
          selectedCount: 1,
        }),
      );
      const textHtml = renderToStaticMarkup(
        createElement(React.Fragment, null, collectElements(textMenu)[0]),
      );
      const connectorHtml = renderToStaticMarkup(
        createElement(React.Fragment, null, collectElements(connectorMenu)[0]),
      );
      clickMenuItems(connectorMenu);
      const menuProps = propsOf(collectElements(connectorMenu)[0]);
      (menuProps.onKeyDown as (event: unknown) => void)({
        key: "Escape",
        preventDefault: () => calls.push("prevent"),
      });

      assert.equal(stageNodeMenuLabel(textNode), "Text: Menu label");
      assert.equal(stageNodeMenuLabel(connectorNode), "Connector");
      assert.match(textHtml, /Select layer/);
      assert.match(textHtml, /Current/);
      assert.match(textHtml, /left:88/);
      assert.match(connectorHtml, /Unlock/);
      assert.match(connectorHtml, /Detach start/);
      assert.ok(calls.includes("detach-from"));
      assert.ok(calls.includes("prevent"));
      assert.ok(calls.filter((call) => call === "close").length >= 2);
    } finally {
      Object.assign(globalThis, {
        document: previousDocument,
        window: previousWindow,
      });
    }
  });
});
