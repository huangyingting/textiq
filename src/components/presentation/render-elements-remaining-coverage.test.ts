import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  ResolvedNodeContent,
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "@/lib/presentation/render-tree";
import type { StyleObject } from "@/lib/presentation/style-schema";
import {
  buildMinimalThemePackage,
  buildTextContent,
} from "@/test/builders/presentation-deck";
import { createSelectionState, setSelection } from "./selection-model";
import { SlideCanvas, DeckCanvas } from "./slide-canvas";
import {
  frameToCss,
  nodeLayoutTransformToCss,
  SlideNodeRenderer,
  styleObjectToContainerCss,
} from "./slide-node-renderer";

type ElementProps = Record<string, unknown>;

function collectElements(node: ReactNode, elements: ReactElement[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, elements);
    return elements;
  }
  if (!isValidElement(node)) return elements;
  if (typeof node.type === "function") {
    collectElements(
      (node.type as (props: unknown) => ReactNode)(node.props),
      elements,
    );
    return elements;
  }
  if (
    typeof node.type === "object" &&
    node.type !== null &&
    "$$typeof" in node.type &&
    node.type["$$typeof"] === Symbol.for("react.memo")
  ) {
    collectElements(
      (node.type as { type: (props: unknown) => ReactNode }).type(node.props),
      elements,
    );
    return elements;
  }
  elements.push(node);
  collectElements((node.props as { children?: ReactNode }).children, elements);
  return elements;
}

function propsOf(element: ReactElement): ElementProps {
  return element.props as ElementProps;
}

function invokeMemoComponent<P>(component: unknown, props: P): ReactNode {
  return (component as { type: (props: P) => ReactNode }).type(props);
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
    layout: { frame: { x: 10, y: 12, w: 30, h: 20 }, zIndex: 2 },
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
        `https://assets.example/${assetId}.png`,
      ...props,
    }),
  );
}

function tableNode(): ResolvedRenderNode {
  return resolvedNode(
    "table-remaining",
    {
      type: "table",
      content: {
        header: false,
        columns: [{ id: "metric", label: "Metric" }],
        rows: [
          {
            id: "row-1",
            cells: [{ text: "Plain" }],
          },
        ],
      },
    },
    {
      table: {
        rowFill: { type: "solid", color: "#ffffff" },
        border: { color: "#111827", widthPt: 1 },
      },
    },
  );
}

test("render style helpers cover effects, radius, transforms, and image fill layers", () => {
  assert.deepEqual(frameToCss({ x: 1, y: 2, w: 3, h: 4 }), {
    position: "absolute",
    left: "1%",
    top: "2%",
    width: "3%",
    height: "4%",
  });
  assert.deepEqual(nodeLayoutTransformToCss({}), {});
  assert.match(
    String(
      styleObjectToContainerCss({
        effect: { kind: "glass", intensity: "strong" },
      }).backdropFilter,
    ),
    /22px/,
  );
  assert.equal(
    styleObjectToContainerCss({ effect: { kind: "blur", radiusPt: 5 } }).filter,
    "blur(5pt)",
  );
  assert.equal(
    styleObjectToContainerCss({
      effect: { kind: "glow", color: "#f97316", blurPt: 6, opacity: 0.5 },
      radius: {
        topLeftPt: 1,
        topRightPt: 2,
        bottomRightPt: 3,
        bottomLeftPt: 4,
      },
      shadow: { xPt: 1, yPt: 2, blurPt: 3, color: "#111827" },
      clip: { enabled: true },
      blendMode: "multiply",
      opacity: 0.75,
    }).mixBlendMode,
    "multiply",
  );

  const html = renderNode(
    resolvedNode(
      "image-fill-node",
      { type: "text", content: buildTextContent(["Image fill"]) },
      {
        fill: { type: "image", assetId: "fill", opacity: 0.4 },
        radius: { allPt: 8 },
      },
    ),
  );
  assert.match(html, /data-node-fill-layer="image"/);
  assert.match(html, /opacity:0.4/);
});

test("text, shape, visual, connector, and accessibility variants render meaningful branches", () => {
  const numberedHtml = renderNode(
    resolvedNode("numbered-text", {
      type: "text",
      content: {
        paragraphs: [
          {
            id: "a",
            text: "Alpha",
            list: { kind: "number", numberStyle: "lower-alpha" },
          },
          {
            id: "b",
            text: "Roman",
            list: { kind: "number", indent: 1, numberStyle: "lower-roman" },
          },
          { id: "c", text: "Reset" },
          {
            id: "d",
            text: "Upper",
            list: { kind: "number", numberStyle: "upper-alpha" },
          },
        ],
      },
    }),
  );
  const shapeHtml = ["ellipse", "circle", "line", "triangle", "square"]
    .map((shape) =>
      renderNode(
        resolvedNode(
          `shape-${shape}`,
          {
            type: "shape",
            content: { shape: shape as never },
          },
          { fill: { type: "solid", color: "#22c55e" } },
        ),
      ),
    )
    .join("\n");
  const visualImageHtml = renderNode(
    resolvedNode("visual-backed", {
      type: "visual",
      content: { assetId: "visual-img", visualId: "chart", alt: "Chart" },
    }),
  );
  const transparentVisualHtml = renderNode(
    resolvedNode(
      "visual-transparent",
      {
        type: "visual",
        content: { visualId: "transparent", transparentBackground: true },
      },
      { visual: { transparentBackground: false } },
    ),
  );
  const connectorHtml = renderNode(
    resolvedNode(
      "connector-center",
      {
        type: "connector",
        content: {
          from: { kind: "node", nodeId: "a", anchor: "center" },
          to: { kind: "point", point: { x: 25, y: 75 } },
        },
      },
      { stroke: { color: "#111111", widthPt: 4, dash: "dashed" } },
    ),
  );
  const decorativeHtml = renderNode(
    resolvedNode(
      "decorative",
      { type: "image", content: { assetId: "decorative" } },
      {},
      { accessibility: { decorative: true } },
    ),
    { interactive: true },
  );

  assert.match(numberedHtml, /a\./);
  assert.match(numberedHtml, /i\./);
  assert.match(numberedHtml, /A\./);
  assert.match(shapeHtml, /<ellipse/);
  assert.match(shapeHtml, /<circle/);
  assert.match(shapeHtml, /<line/);
  assert.match(shapeHtml, /M 50 0 L 100 100 L 0 100 Z/);
  assert.match(shapeHtml, /xMidYMid meet/);
  assert.match(
    visualImageHtml,
    /src="https:\/\/assets.example\/visual-img.png"/,
  );
  assert.match(transparentVisualHtml, /background-color:transparent/);
  assert.match(connectorHtml, /stroke-dasharray="6 4"/);
  assert.match(connectorHtml, /M 50 50 L 25 75/);
  assert.match(decorativeHtml, /aria-label="Decorative image"/);
});

test("table editing and canvas chrome invoke remaining safe handlers", () => {
  const calls: string[] = [];
  const tableTree = invokeMemoComponent(SlideNodeRenderer, {
    node: tableNode(),
    tableEditing: true,
    activeTableCell: { rowIndex: 0, colIndex: 0 },
    onTableCellFocus: (nodeId: string, rowIndex: number, colIndex: number) =>
      calls.push(`focus:${nodeId}:${rowIndex}:${colIndex}`),
    onTableCellCommit: (
      nodeId: string,
      rowIndex: number,
      colIndex: number,
      text: string,
    ) => calls.push(`commit:${nodeId}:${rowIndex}:${colIndex}:${text}`),
    onTableCellKeyDown: (nodeId: string) => calls.push(`key:${nodeId}`),
  });
  const cellProps = collectElements(tableTree)
    .map(propsOf)
    .find((props) => props["data-table-cell"] === "0:0");
  assert.ok(cellProps);
  (cellProps.onFocus as () => void)();
  (cellProps.onBlur as (event: unknown) => void)({
    currentTarget: { textContent: "Edited" },
  });
  (cellProps.onKeyDown as (event: unknown) => void)({ key: "Enter" });

  const group = resolvedNode(
    "group-a",
    { type: "group" },
    {},
    {
      type: "group",
      layout: { frame: { x: 5, y: 5, w: 20, h: 20 }, zIndex: 1 },
    },
  );
  const image = resolvedNode("image-a", {
    type: "image",
    content: {
      assetId: "image-a",
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  });
  const connector = resolvedNode("connector-a", {
    type: "connector",
    content: {
      from: { kind: "point", point: { x: 0, y: 0 } },
      to: { kind: "node", nodeId: "image-a", anchor: "bottom" },
    },
  });
  const hiddenText = resolvedNode("hidden-text", {
    type: "text",
    content: buildTextContent(["Hidden text"]),
  });
  const slide: ResolvedSlideRenderTree = {
    id: "slide-render-remaining",
    background: {
      fill: { type: "solid", color: "#f8fafc" },
      decorationLevel: "none",
    },
    decorations: [],
    chrome: [],
    nodes: [group, image, connector, hiddenText],
  };
  const multiSelection = setSelection(createSelectionState("normal"), [
    "group-a",
    "image-a",
    "connector-a",
  ]);
  const imageSelection = setSelection(createSelectionState("normal"), [
    "image-a",
  ]);
  const connectorSelection = setSelection(createSelectionState("normal"), [
    "connector-a",
  ]);
  const canvas = invokeMemoComponent(SlideCanvas, {
    slide,
    selection: multiSelection,
    activeGroupId: "group-a",
    slideHovered: true,
    slideSelected: true,
    focusedNodeId: "image-a",
    hiddenNodeIds: new Set(["hidden-text"]),
    onNodePointerDown: (nodeId: string) => calls.push(`pointer:${nodeId}`),
    onNodeDoubleClick: (nodeId: string) => calls.push(`double:${nodeId}`),
    onNodeFocus: (nodeId: string) => calls.push(`node-focus:${nodeId}`),
    onMultiResizeHandlePointerDown: (handle: string) =>
      calls.push(`multi-resize:${handle}`),
    onMultiRotationHandlePointerDown: () => calls.push("multi-rotate"),
  });
  const imageCanvas = invokeMemoComponent(SlideCanvas, {
    slide,
    selection: imageSelection,
    onResizeHandlePointerDown: (nodeId: string, handle: string) =>
      calls.push(`resize:${nodeId}:${handle}`),
    onRotationHandlePointerDown: (nodeId: string) =>
      calls.push(`rotate:${nodeId}`),
    onCropHandlePointerDown: (nodeId: string, handle: string) =>
      calls.push(`crop:${nodeId}:${handle}`),
    activeResizeHandle: { nodeId: "image-a", handle: "se" },
    activeRotationNodeId: "image-a",
    activeCropHandle: { nodeId: "image-a", handle: "bottom" },
  });
  const connectorCanvas = invokeMemoComponent(SlideCanvas, {
    slide,
    selection: connectorSelection,
    onConnectorEndpointPointerDown: (nodeId: string, endpoint: string) =>
      calls.push(`connector:${nodeId}:${endpoint}`),
    activeConnectorEndpoint: { nodeId: "connector-a", endpoint: "to" },
  });
  const html = renderToStaticMarkup(canvas);
  const canvasElements = [canvas, imageCanvas, connectorCanvas]
    .flatMap((node) => collectElements(node))
    .map(propsOf);
  const nodeProps = canvasElements.find(
    (props) => props["data-node-id"] === "image-a",
  );
  assert.ok(nodeProps);
  (nodeProps.onPointerDown as (event: unknown) => void)({});
  (nodeProps.onDoubleClick as (event: unknown) => void)({});
  (nodeProps.onFocus as (event: unknown) => void)({});
  const pointerEvent = {
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  };
  const multiResizeHandle = canvasElements.find(
    (props) => props["data-multi-resize-handle"] === "se",
  );
  assert.ok(multiResizeHandle);
  (multiResizeHandle.onPointerDown as (event: unknown) => void)(pointerEvent);
  const multiRotationHandle = canvasElements.find(
    (props) => props["data-multi-rotation-handle"] === "true",
  );
  assert.ok(multiRotationHandle);
  (multiRotationHandle.onPointerDown as (event: unknown) => void)(pointerEvent);
  const resizeHandle = canvasElements.find(
    (props) => props["data-resize-handle"] === "se",
  );
  assert.ok(resizeHandle);
  (resizeHandle.onPointerDown as (event: unknown) => void)(pointerEvent);
  const rotationHandle = canvasElements.find(
    (props) => props["data-rotation-handle"] === "true",
  );
  assert.ok(rotationHandle);
  (rotationHandle.onPointerDown as (event: unknown) => void)(pointerEvent);
  const cropHandle = canvasElements.find(
    (props) => props["data-crop-handle"] === "bottom",
  );
  assert.ok(cropHandle);
  (cropHandle.onPointerDown as (event: unknown) => void)(pointerEvent);
  const connectorHandle = canvasElements.find(
    (props) => props["data-connector-endpoint"] === "to",
  );
  assert.ok(connectorHandle);
  (connectorHandle.onPointerDown as (event: unknown) => void)(pointerEvent);

  assert.match(html, /data-slide-hovered="true"/);
  assert.match(html, /data-slide-selected="true"/);
  assert.match(html, /data-node-chrome-frame="activeGroup"/);
  assert.match(html, /visibility:hidden/);
  assert.ok(calls.includes("commit:table-remaining:0:0:Edited"));
  assert.ok(calls.some((call) => call.endsWith(":se")));
  assert.ok(calls.includes("connector:connector-a:to"));
});

test("DeckCanvas returns null for missing slides and delegates active slide rendering", () => {
  const slide: ResolvedSlideRenderTree = {
    id: "active-slide",
    background: {
      fill: { type: "solid", color: "#ffffff" },
      decorationLevel: "none",
    },
    decorations: [],
    chrome: [],
    nodes: [
      resolvedNode("active-text", {
        type: "text",
        content: buildTextContent(["Active"]),
      }),
    ],
  };
  const themePackage = buildMinimalThemePackage();
  const deck = {
    canvas: { format: "16:9", width: 16, height: 9, unit: "percent" },
    theme: {
      tokens: themePackage.tokens,
      packageId: themePackage.id,
      packageVersion: themePackage.version,
    },
    slides: [slide],
    diagnostics: [],
  } satisfies Parameters<typeof DeckCanvas>[0]["deck"];
  assert.equal(
    DeckCanvas({
      deck,
      activeSlideIndex: 4,
    }),
    null,
  );
  const html = renderToStaticMarkup(
    createElement(DeckCanvas, {
      deck,
      activeSlideIndex: 0,
      preview: true,
    }),
  );
  assert.match(html, /Active/);
});
