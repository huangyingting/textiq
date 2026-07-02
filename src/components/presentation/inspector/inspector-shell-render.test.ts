import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DiagnosticsPanel } from "./diagnostics-panel";
import { InspectorShell } from "./inspector-shell";
import { makeDiagnostic } from "@/lib/presentation/diagnostics";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import type { SlideChildNode, SlideNode } from "@/lib/presentation/schema";
import type { StyleObject } from "@/lib/presentation/style-schema";

const textNode: SlideChildNode = {
  id: "text-1",
  type: "text",
  role: "body",
  name: "Body text",
  layout: { frame: { x: 10, y: 10, w: 30, h: 12 }, zIndex: 1 },
  style: { ref: "text.body", variant: "default" },
  localStyle: {
    text: { color: "#111111", fontSizePt: 18, lineHeight: 1.2 },
    fill: { type: "solid", color: "#ffffff" },
    opacity: 0.92,
  },
  source: {
    documentId: "doc-1",
    blockId: "block-1",
    blockKind: "text",
    contentHash: "hash-1",
    linkedAt: "2026-06-30T00:00:00.000Z",
  },
  content: { paragraphs: [{ id: "p1", text: "Body" }] },
};

const shapeNode: SlideChildNode = {
  id: "shape-1",
  type: "shape",
  role: "card",
  name: "Callout shape",
  layout: { frame: { x: 44, y: 10, w: 20, h: 18 }, zIndex: 2 },
  style: { ref: "surface.card" },
  localStyle: {
    text: { color: "#222222", fontSizePt: 13 },
    fill: { type: "solid", color: "#fff7ed" },
    stroke: { color: "#fb923c", widthPt: 2 },
  },
  content: { shape: "rect" },
};

const imageNode: SlideChildNode = {
  id: "image-1",
  type: "image",
  role: "image",
  layout: {
    frame: { x: 8, y: 30, w: 32, h: 18 },
    zIndex: 3,
    rotation: 4,
    autoHeight: false,
    flipX: true,
    constraints: { preserveAspectRatio: true },
  },
  style: { ref: "media.inline" },
  localStyle: {
    opacity: 0.8,
    image: { brightness: 1.1, contrast: 0.9, saturation: 1.2 },
    effect: { kind: "blur", radiusPt: 6 },
    shadow: { xPt: 2, yPt: 4, blurPt: 12, color: "#000000", opacity: 0.2 },
    blendMode: "multiply",
  },
  source: { documentId: "doc-1", blockId: "image-block", blockKind: "image" },
  content: {
    assetId: "asset-1",
    alt: "Product screenshot",
    fit: "contain",
    crop: { top: 1, right: 2, bottom: 3, left: 4 },
  },
};

const visualNode: SlideChildNode = {
  id: "visual-1",
  type: "visual",
  role: "visual",
  layout: { frame: { x: 44, y: 34, w: 24, h: 18 }, zIndex: 4 },
  style: { ref: "chart.primary" },
  localStyle: {
    visual: {
      styleThemeId: "accent",
      transparentBackground: true,
      channelColors: { primary: "#2563eb", accent: "#f59e0b" },
    },
    opacity: 0.9,
  },
  content: {
    visualId: "chart-1",
    assetId: "visual-asset-1",
    alt: "Revenue chart",
    transparentBackground: true,
  },
};

const tableNode: SlideChildNode = {
  id: "table-1",
  type: "table",
  role: "table",
  layout: { frame: { x: 8, y: 52, w: 48, h: 22 }, zIndex: 5 },
  style: { ref: "surface.table" },
  localStyle: {
    table: {
      headerFill: { type: "solid", color: "#f8fafc" },
      rowFill: { type: "solid", color: "#ffffff" },
      alternateRowFill: { type: "solid", color: "#f1f5f9" },
      border: { color: "#cbd5e1", widthPt: 1 },
      cellPaddingPt: { top: 6, right: 6, bottom: 6, left: 6 },
    },
  },
  source: { documentId: "doc-1", blockId: "table-block", blockKind: "table" },
  content: {
    columns: [
      { id: "col-1", label: "Metric" },
      { id: "col-2", label: "Value" },
    ],
    rows: [
      { id: "row-1", cells: [{ text: "ARR" }, { text: "$12M" }] },
      { id: "row-2", cells: [{ text: "NRR" }, { text: "118%" }] },
    ],
    header: true,
    caption: "Metrics table",
  },
};

const connectorNode: SlideChildNode = {
  id: "connector-1",
  type: "connector",
  role: "connector",
  layout: { frame: { x: 2, y: 2, w: 10, h: 10 }, zIndex: 6 },
  style: { ref: "connector.primary" },
  localStyle: {
    connector: {
      stroke: { color: "#0f172a", widthPt: 2, dash: "dashed" },
      startArrow: "arrow",
      endArrow: "filled",
    },
    effect: { kind: "glow", color: "#4f46e5", blurPt: 14, opacity: 0.35 },
  },
  content: {
    from: { kind: "point", point: { x: 0, y: 50 } },
    to: { kind: "node", nodeId: "shape-1", anchor: "left" },
    routing: "elbow",
  },
};

const groupNode: SlideChildNode = {
  id: "group-1",
  type: "group",
  component: "custom",
  name: "Grouped card",
  layout: { frame: { x: 58, y: 52, w: 22, h: 12 }, zIndex: 7 },
  children: [
    {
      id: "group-text-1",
      type: "text",
      layout: { frame: { x: 0, y: 0, w: 20, h: 8 }, zIndex: 1 },
      content: { paragraphs: [{ id: "group-p1", text: "Nested" }] },
    },
  ],
};

const slide: SlideNode = {
  id: "slide-1",
  type: "slide",
  name: "Slide 1",
  template: { kind: "cover", layoutId: "default" },
  controls: { tone: "confident", density: "normal", emphasis: "visual" },
  props: { decoration: "subtle", chrome: "minimal" },
  localStyle: {
    slide: {
      background: {
        type: "linearGradient",
        from: "#0f172a",
        to: "#1e293b",
        angle: 135,
      },
      accent: "#38bdf8",
    },
  },
  source: { documentId: "doc-1", blockId: "slide-block" },
  children: [
    textNode,
    shapeNode,
    imageNode,
    visualNode,
    tableNode,
    connectorNode,
    groupNode,
  ],
  notes: "Speaker note text",
};

type InspectorProps = Parameters<typeof InspectorShell>[0];

function renderInspector({
  initialPanel,
  diagnostics = [],
  selectedNode,
  selectedIds,
  activeSlide = slide,
  isDecorationSelected = false,
  selectionMode = "normal",
  activeTemplate,
  activeLayoutId = "default",
  assetResolver,
  onReplaceImage,
  onReplaceVisual,
  selectedResolvedStyle,
}: {
  initialPanel?: InspectorProps["initialPanel"];
  diagnostics?: PresentationDiagnostic[];
  selectedNode?: SlideChildNode;
  selectedIds?: string[];
  activeSlide?: SlideNode;
  isDecorationSelected?: boolean;
  selectionMode?: InspectorProps["selectionMode"];
  activeTemplate?: InspectorProps["activeTemplate"];
  activeLayoutId?: string;
  assetResolver?: InspectorProps["assetResolver"];
  onReplaceImage?: InspectorProps["onReplaceImage"];
  onReplaceVisual?: InspectorProps["onReplaceVisual"];
  selectedResolvedStyle?: StyleObject;
} = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    createElement(InspectorShell, {
      activeSlide,
      deckChrome: undefined,
      selectedNode,
      selectedResolvedStyle,
      selectedIds: selectedIds ?? (selectedNode ? [selectedNode.id] : []),
      isDecorationSelected,
      diagnostics,
      onUpdateControls: noop,
      onUpdateProps: noop,
      onUpdateDeckChrome: noop,
      onUpdateSlideAttributes: noop,
      onUpdateSlideLocalStyle: noop,
      onResetSlideLocalStyle: noop,
      onUpdateSlideSource: noop,
      onUpdateSelectedLayout: noop,
      onUpdateSelectedAttributes: noop,
      onUpdateSelectedContent: noop,
      onUpdateSelectedLocalStyle: noop,
      onResetToTheme: noop,
      onUpdateSelectedSource: noop,
      onChangeStyleBinding: noop,
      onAlignSelection: noop,
      onDistributeSelection: noop,
      onMatchSize: noop,
      onGroupSelection: noop,
      onUngroupSelection: noop,
      onReorderSelection: noop,
      onSelectLayer: noop,
      onUpdateLayer: noop,
      onReorderLayer: noop,
      onDetachDecoration: noop,
      onDiagnosticAction: noop,
      TEMPLATE_OPTIONS: [
        { kind: "cover", label: "Cover" },
        { kind: "section", label: "Section" },
      ],
      activeTemplate,
      activeLayoutId,
      onReapplyTemplate: noop,
      selectionMode,
      onToggleSelectionMode: noop,
      assetResolver,
      onReplaceImage,
      onReplaceVisual,
      initialPanel,
    }),
  );
}

describe("InspectorShell render affordances", () => {
  test("initialPanel can open the notes panel", () => {
    const html = renderInspector({ initialPanel: "notes" });

    assert.match(html, /Speaker Notes/);
    assert.match(html, /Speaker note text/);
    assert.match(html, /aria-selected="true"/);
  });

  test("incompatible initialPanel falls back to the multi-select arrange panel", () => {
    const html = renderInspector({
      initialPanel: "text",
      selectedNode: textNode,
      selectedIds: ["text-1", "shape-1"],
    });

    assert.match(html, /Arrange 2 nodes/);
    assert.doesNotMatch(html, /Content/);
  });

  test("diagnostics tab displays a count badge", () => {
    const html = renderInspector({
      diagnostics: [
        makeDiagnostic("missing-asset", "error", "Missing asset"),
        makeDiagnostic(
          "unsupported-export-feature",
          "warning",
          "Unsupported export feature",
        ),
      ],
    });

    assert.match(html, /Diagnostics/);
    assert.match(html, /aria-label="2 diagnostics"/);
  });

  test("diagnostics panel sorts severities, labels actions, and hides info", () => {
    const diagnostics: PresentationDiagnostic[] = [
      makeDiagnostic("unknown-template-kind", "info", "Info item", {
        action: { type: "replace-style-ref" },
      }),
      makeDiagnostic("missing-asset", "fatal", "Fatal item", {
        action: { type: "open-asset-panel" },
      }),
      makeDiagnostic("invalid-schema-version", "error", "Error item"),
      makeDiagnostic("unsupported-export-feature", "warning", "Warning item", {
        action: { type: "reset-to-theme" },
      }),
      makeDiagnostic("missing-token", "warning", "Densify item", {
        action: { type: "choose-denser-layout" },
      }),
      makeDiagnostic("slot-over-capacity", "warning", "Split item", {
        action: { type: "split-slide" },
      }),
      makeDiagnostic("local-style-overrides", "warning", "Override item", {
        action: { type: "remove-override" },
      }),
    ];

    const html = renderToStaticMarkup(
      createElement(DiagnosticsPanel, {
        diagnostics,
        onAction: () => undefined,
      }),
    );
    const hiddenInfoHtml = renderToStaticMarkup(
      createElement(DiagnosticsPanel, {
        diagnostics,
        hideInfo: true,
        onAction: () => undefined,
      }),
    );
    const emptyHtml = renderToStaticMarkup(
      createElement(DiagnosticsPanel, {
        diagnostics: [diagnostics[0]],
        hideInfo: true,
        onAction: () => undefined,
      }),
    );

    assert.ok(html.indexOf("Fatal item") < html.indexOf("Error item"));
    assert.ok(html.indexOf("Error item") < html.indexOf("Split item"));
    assert.match(html, /Info item/);
    assert.match(html, /deck/);
    assert.match(html, /asset/);
    assert.match(html, /style/);
    assert.match(html, /export/);
    assert.match(html, /Open asset panel/);
    assert.doesNotMatch(html, /Repair AI plan/);
    assert.match(html, /Reset to theme/);
    assert.match(html, /Use denser layout/);
    assert.match(html, /Split slide/);
    assert.match(html, /Remove override/);
    assert.match(html, /Replace style ref/);
    assert.doesNotMatch(hiddenInfoHtml, /Info item/);
    assert.equal(emptyHtml, "");
  });

  test("single selection arrange panel exposes align and z-order controls", () => {
    const html = renderInspector({
      initialPanel: "arrange",
      selectedNode: textNode,
    });

    assert.match(html, />Arrange</);
    assert.match(html, />Center</);
    assert.match(html, />Bring front</);
    assert.match(html, />Backward</);
  });

  test("slide panel renders template, controls, settings, and source fields", () => {
    const html = renderInspector({
      initialPanel: "slide",
      activeTemplate: { layouts: [{ id: "default" }, { id: "hero" }] },
    });

    assert.match(html, /Slide Controls/);
    assert.match(html, /Tone/);
    assert.match(html, /Decoration/);
    assert.match(html, /Background type/);
    assert.match(html, /Source document/);
    assert.match(html, /hero/);
  });

  test("text and shape panels render content and local style controls", () => {
    const textHtml = renderInspector({
      initialPanel: "text",
      selectedNode: textNode,
    });
    const shapeHtml = renderInspector({
      initialPanel: "shape",
      selectedNode: shapeNode,
    });

    assert.match(textHtml, /Content/);
    assert.match(textHtml, /Local Style/);
    assert.match(textHtml, /3 local overrides/);
    assert.match(shapeHtml, /Shape/);
    assert.match(shapeHtml, /Stroke width/);
  });

  test("local style controls seed from resolved styles", () => {
    const inheritedShape: SlideChildNode = {
      ...shapeNode,
      localStyle: { text: { weight: 700 } },
    };
    const resolvedStyle: StyleObject = {
      text: {
        color: "#1d4ed8",
        fontSizePt: 28,
        lineHeight: 1.4,
        align: "right",
      },
      fill: { type: "solid", color: "#dbeafe" },
      stroke: { color: "#2563eb", widthPt: 3 },
    };

    const shapeHtml = renderInspector({
      initialPanel: "shape",
      selectedNode: inheritedShape,
      selectedResolvedStyle: resolvedStyle,
    });

    assert.match(shapeHtml, /value="#dbeafe"/);
    assert.match(shapeHtml, /value="#2563eb"/);
    assert.match(shapeHtml, /value="3"/);
  });

  test("image, visual, table, and connector content panels render type controls", () => {
    const imageHtml = renderInspector({
      selectedNode: imageNode,
      assetResolver: () => "https://example.com/image.png",
      onReplaceImage: () => undefined,
    });
    const visualHtml = renderInspector({
      selectedNode: visualNode,
      assetResolver: () => "https://example.com/visual.png",
      onReplaceVisual: () => undefined,
    });
    const tableHtml = renderInspector({ selectedNode: tableNode });
    const connectorHtml = renderInspector({
      initialPanel: "line",
      selectedNode: connectorNode,
    });

    assert.match(imageHtml, /Product screenshot/);
    assert.match(imageHtml, /Replace image/);
    assert.match(visualHtml, /Replace visual/);
    assert.match(visualHtml, /Debug identifiers/);
    assert.match(visualHtml, /Transparent background/);
    assert.match(tableHtml, /Metrics table/);
    assert.match(tableHtml, /Insert row before/);
    assert.match(connectorHtml, /Routing/);
    assert.match(connectorHtml, /from endpoint kind/);
  });

  test("adjust and effects panels render image adjustments and effect controls", () => {
    const adjustHtml = renderInspector({
      initialPanel: "adjust",
      selectedNode: imageNode,
    });
    const blurEffectsHtml = renderInspector({
      initialPanel: "effects",
      selectedNode: imageNode,
    });
    const glowEffectsHtml = renderInspector({
      initialPanel: "effects",
      selectedNode: connectorNode,
    });

    assert.match(adjustHtml, /Image Adjust/);
    assert.match(adjustHtml, /Reset crop/);
    assert.match(blurEffectsHtml, /Blur radius/);
    assert.match(glowEffectsHtml, /Glow color/);
    assert.match(glowEffectsHtml, /Shadow/);
  });

  test("source and style panels render metadata and type-specific styles", () => {
    const sourceHtml = renderInspector({
      initialPanel: "source",
      selectedNode: textNode,
    });
    const connectorStyleHtml = renderInspector({
      initialPanel: "style",
      selectedNode: connectorNode,
    });
    const visualStyleHtml = renderInspector({
      initialPanel: "style",
      selectedNode: visualNode,
    });
    const tableStyleHtml = renderInspector({
      initialPanel: "style",
      selectedNode: tableNode,
    });

    assert.match(sourceHtml, /Linked/);
    assert.match(sourceHtml, /Clear source/);
    assert.match(connectorStyleHtml, /Start arrow/);
    assert.match(visualStyleHtml, /Visual theme/);
    assert.match(tableStyleHtml, /Header fill/);
  });

  test("layers, multi-select, and decoration states render context panels", () => {
    const layersHtml = renderInspector({
      initialPanel: "layers",
      selectedIds: ["image-1", "group-text-1"],
      selectionMode: "layers",
    });
    const multiArrangeHtml = renderInspector({
      initialPanel: "arrange",
      selectedNode: textNode,
      selectedIds: ["text-1", "shape-1", "image-1"],
    });
    const decorationHtml = renderInspector({
      initialPanel: "decoration",
      selectedNode: shapeNode,
      isDecorationSelected: true,
    });

    assert.match(layersHtml, /Layers/);
    assert.match(layersHtml, /Grouped card/);
    assert.match(layersHtml, /Nested/);
    assert.match(multiArrangeHtml, /Arrange 3 nodes/);
    assert.match(multiArrangeHtml, /Distribute H/);
    assert.match(decorationHtml, /Theme Decoration/);
    assert.match(decorationHtml, /Detach from theme/);
  });
});
