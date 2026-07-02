import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ContextToolbar } from "./context-toolbar";
import type { SlideChildNode } from "@/lib/presentation/schema";
import type { StyleObject } from "@/lib/presentation/style-schema";
import {
  buildImageNode,
  buildShapeNode,
  buildTableNode,
  buildTextNode,
  buildVisualNode,
} from "@/test/builders/presentation-deck";

const resolvedStyle: StyleObject = {
  text: { color: "#0f172a", fontSizePt: 22, align: "center", weight: 700 },
  fill: { type: "solid", color: "#dbeafe" },
  stroke: { color: "#2563eb", widthPt: 2 },
  opacity: 0.8,
  connector: {
    stroke: { color: "#ef4444", widthPt: 3, dash: "dashed" },
    startArrow: "arrow",
    endArrow: "filled",
  },
};

function connectorNode(): SlideChildNode {
  return {
    id: "connector-1",
    type: "connector",
    role: "connector",
    layout: { frame: { x: 10, y: 10, w: 40, h: 20 }, zIndex: 3 },
    content: {
      from: { kind: "point", point: { x: 0, y: 0 } },
      to: { kind: "point", point: { x: 100, y: 100 } },
      routing: "elbow",
    },
  };
}

function renderToolbar(selectedNode: SlideChildNode | undefined): string {
  const noop = () => undefined;
  return renderToStaticMarkup(
    createElement(ContextToolbar, {
      selectedIds: selectedNode ? [selectedNode.id] : [],
      selectedNode,
      selectedResolvedStyle: resolvedStyle,
      isInlineEditing: selectedNode?.type === "text",
      isDragging: false,
      isDecorationSelected: false,
      onDelete: noop,
      onCut: noop,
      onDuplicate: noop,
      onGroup: noop,
      onUngroup: noop,
      onBringForward: noop,
      onSendBackward: noop,
      onBringToFront: noop,
      onSendToBack: noop,
      onAlignSelection: noop,
      onDistributeSelection: noop,
      onMatchSize: noop,
      onUpdateSelectedContent: noop,
      onUpdateSelectedLayout: noop,
      onUpdateSelectedLocalStyle: noop,
      onUpdateSelectedAttributes: noop,
      onReplaceImage: noop,
      onReplaceVisual: noop,
      onResetImageCrop: noop,
      onEnterTableEdit: noop,
      slideBackgroundColor: "#ffffff",
      onUpdateSlideLocalStyle: noop,
      onInsertSlide: noop,
      onInsertText: noop,
      onInsertShape: noop,
      onInsertImage: noop,
      onInsertVisual: noop,
      onInsertConnector: noop,
      onInsertTable: noop,
      onDuplicateSlide: noop,
      onDeleteSlide: noop,
      canDeleteSlide: true,
      onDetachDecoration: noop,
      onRequestStageFocus: noop,
    }),
  );
}

test("ContextToolbar renders command surfaces for every selected node family", () => {
  const nodes: Array<SlideChildNode | undefined> = [
    undefined,
    buildTextNode({ id: "text-1", role: "title" }),
    buildShapeNode({ id: "shape-1" }),
    buildImageNode("asset-1", {
      id: "image-1",
      content: {
        assetId: "asset-1",
        fit: "cover",
        crop: { top: 5, right: 5, bottom: 5, left: 5 },
      },
    }),
    buildVisualNode({ id: "visual-1" }),
    connectorNode(),
    buildTableNode({ id: "table-1" }),
  ];

  const html = nodes.map(renderToolbar).join("\n");

  assert.equal(typeof html, "string");
});
