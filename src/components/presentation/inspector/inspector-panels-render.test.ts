import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DiagnosticsPanel } from "./diagnostics-panel";
import { LayersPanel } from "./layers-panel";
import { LocalStylePanel } from "./local-style-panel";
import { NodeGeometryPanel } from "./node-geometry-panel";
import { NodeSourcePanel } from "./node-source-panel";
import { SlideControlsPanel } from "./slide-controls-panel";
import { SlideSettingsPanel } from "./slide-settings-panel";
import { StyleBindingPanel } from "./style-binding-panel";
import { makeDiagnostic } from "@/lib/presentation/diagnostics";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import type { SlideChildNode, SlideNode } from "@/lib/presentation/schema";
import type { StyleObject, StylePatch } from "@/lib/presentation/style-schema";
import { renderWithTestRenderer } from "@/test/react-render-harness";
import {
  SLIDE_FONT_OPTIONS,
  slideFontCssStack,
} from "@/lib/presentation/slide-fonts";

type ElementWithProps = ReactElement<Record<string, unknown>>;

function elements(root: ReactNode): ElementWithProps[] {
  const found: ElementWithProps[] = [];
  function visit(node: ReactNode): void {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const element = child as ElementWithProps;
      found.push(element);
      visit(element.props.children as ReactNode);
    });
  }
  visit(root);
  return found;
}

function invokeHandlers(root: ReactNode): number {
  let count = 0;
  for (const element of elements(root)) {
    const props = element.props as {
      disabled?: boolean;
      type?: string;
      onChange?: (event: {
        currentTarget: { value: string; checked: boolean };
      }) => void;
      onClick?: (event: {
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => void;
    };
    if (props.onChange) {
      const value =
        props.type === "number" || props.type === "range"
          ? "12"
          : props.type === "color"
            ? "#123456"
            : "sample";
      props.onChange({
        currentTarget: { value, checked: true },
      });
      count += 1;
    }
    if (props.onClick && props.disabled !== true) {
      props.onClick({
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      });
      count += 1;
    }
  }
  return count;
}

function findElement(
  root: ReactNode,
  predicate: (element: ElementWithProps) => boolean,
): ElementWithProps | undefined {
  return elements(root).find((element) => predicate(element));
}

function childNode(patch: Partial<SlideChildNode>): SlideChildNode {
  return {
    id: "node-1",
    type: "text",
    role: "body",
    layout: { frame: { x: 10, y: 10, w: 30, h: 20 }, zIndex: 1 },
    content: { paragraphs: [{ id: "p1", text: "Body" }] },
    ...patch,
  } as SlideChildNode;
}

function render(element: ReactNode) {
  return element ? renderToStaticMarkup(element as ReactElement) : "";
}

function withFakeHooks<T>(renderComponent: () => T): T {
  return renderWithTestRenderer(renderComponent);
}

describe("inspector panels render and wire controls", () => {
  test("LocalStylePanel renders and writes registry-backed text font families", () => {
    const updates: StylePatch[] = [];
    const currentFontFamily = slideFontCssStack("source-serif-4");
    const nextFontFamily = slideFontCssStack("jetbrains-mono");
    assert.ok(currentFontFamily);
    assert.ok(nextFontFamily);

    const element = LocalStylePanel({
      node: childNode({
        localStyle: { text: { fontFamily: currentFontFamily } },
      }),
      onUpdateLocalStyle: (patch) => updates.push(patch),
    });

    const html = render(element);
    assert.match(html, /Font family/);
    assert.match(html, /Theme default/);
    for (const font of SLIDE_FONT_OPTIONS) {
      assert.match(
        html,
        new RegExp(font.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }

    const fontSelect = findElement(
      element,
      (candidate) =>
        candidate.type === "select" &&
        candidate.props.value === "source-serif-4",
    );
    assert.ok(fontSelect);
    const onChange = fontSelect.props.onChange as
      | ((event: { currentTarget: { value: string } }) => void)
      | undefined;
    assert.ok(onChange);
    onChange?.({ currentTarget: { value: "jetbrains-mono" } });

    assert.deepEqual(updates.at(-1), {
      text: { fontFamily: nextFontFamily },
    });
  });

  test("LocalStylePanel exposes fill, stroke, and opacity controls for shapes", () => {
    const updates: unknown[] = [];
    const element = LocalStylePanel({
      node: childNode({
        type: "shape",
        content: { shape: "rect" },
        localStyle: {
          fill: { type: "solid", color: "#ffffff" },
          stroke: { color: "#111111", widthPt: 2 },
          opacity: 0.8,
        },
      }),
      onUpdateLocalStyle: (patch) => updates.push(patch),
    });

    const html = render(element);
    assert.match(html, /Local Style/);
    assert.match(html, /Fill color/);
    assert.match(html, /Stroke width/);
    assert.ok(invokeHandlers(element) >= 4);
    assert.ok(updates.length >= 4);
  });

  test("LocalStylePanel exposes connector, visual, and table-specific controls", () => {
    const updates: unknown[] = [];
    const connector = LocalStylePanel({
      node: childNode({
        type: "connector",
        content: {
          from: { kind: "point", point: { x: 0, y: 0 } },
          to: { kind: "point", point: { x: 100, y: 100 } },
        },
        localStyle: {
          connector: {
            stroke: { color: "#334455", widthPt: 2, dash: "dashed" },
            startArrow: "arrow",
            endArrow: "filled",
          },
        },
      }),
      onUpdateLocalStyle: (patch) => updates.push(patch),
    });
    const visual = LocalStylePanel({
      node: childNode({
        type: "visual",
        content: {
          visualId: "visual-1",
          transparentBackground: true,
        },
        localStyle: {
          visual: {
            styleThemeId: "accent",
            transparentBackground: true,
            channelColors: {
              primary: "#111111",
              secondary: "#222222",
              accent: "#333333",
              muted: "#444444",
            },
          },
        },
      }),
      onUpdateLocalStyle: (patch) => updates.push(patch),
    });
    const table = LocalStylePanel({
      node: childNode({
        type: "table",
        content: {
          columns: [{ id: "col", label: "Metric" }],
          rows: [{ id: "row", cells: [{ text: "NPS" }] }],
        },
        localStyle: {
          table: {
            headerFill: { type: "solid", color: "#f8fafc" },
            rowFill: { type: "solid", color: "#ffffff" },
            alternateRowFill: { type: "solid", color: "#eeeeee" },
            border: { color: "#cbd5e1", widthPt: 1 },
            cellPaddingPt: { top: 4, right: 4, bottom: 4, left: 4 },
          },
        },
      }),
      onUpdateLocalStyle: (patch) => updates.push(patch),
    });

    assert.match(render(connector), /Line color/);
    assert.match(render(visual), /primary color/);
    assert.match(render(table), /Header fill/);
    assert.ok(invokeHandlers(connector) >= 5);
    assert.ok(invokeHandlers(visual) >= 6);
    assert.ok(invokeHandlers(table) >= 6);
    assert.ok(updates.length >= 17);
  });

  test("LocalStylePanel seeds resolved values and preserves resolved stroke color on width edit", () => {
    const updates: StylePatch[] = [];
    const resolvedStyle: StyleObject = {
      fill: { type: "solid", color: "#dbeafe" },
      stroke: { color: "#2563eb", widthPt: 3 },
    };
    const element = LocalStylePanel({
      node: childNode({
        type: "shape",
        content: { shape: "rect" },
        localStyle: {},
      }),
      resolvedStyle,
      onUpdateLocalStyle: (patch) => updates.push(patch),
    });

    const html = render(element);
    assert.match(html, /value="#dbeafe"/);
    assert.match(html, /value="#2563eb"/);

    const strokeWidthInput = findElement(
      element,
      (candidate) =>
        candidate.type === "input" &&
        candidate.props.type === "number" &&
        candidate.props.min === 0 &&
        candidate.props.max === 24 &&
        candidate.props.step === 0.5,
    );
    assert.ok(strokeWidthInput);
    const onChange = strokeWidthInput.props.onChange as
      | ((event: { currentTarget: { value: string } }) => void)
      | undefined;
    assert.ok(onChange);
    onChange?.({ currentTarget: { value: "6" } });

    assert.deepEqual(updates.at(-1), {
      stroke: { color: "#2563eb", widthPt: 6 },
    });
  });

  test("LocalStylePanel preserves resolved connector color on line width edit", () => {
    const updates: StylePatch[] = [];
    const resolvedStyle: StyleObject = {
      connector: {
        stroke: { color: "#0f172a", widthPt: 2.5, dash: "dashed" },
      },
    };
    const element = LocalStylePanel({
      node: childNode({
        type: "connector",
        content: {
          from: { kind: "point", point: { x: 0, y: 0 } },
          to: { kind: "point", point: { x: 100, y: 100 } },
        },
        localStyle: {},
      }),
      resolvedStyle,
      onUpdateLocalStyle: (patch) => updates.push(patch),
    });

    const lineWidthInput = findElement(
      element,
      (candidate) =>
        candidate.type === "input" &&
        candidate.props.type === "number" &&
        candidate.props.min === 0.5 &&
        candidate.props.max === 24 &&
        candidate.props.step === 0.5,
    );
    assert.ok(lineWidthInput);
    const onChange = lineWidthInput.props.onChange as
      | ((event: { currentTarget: { value: string } }) => void)
      | undefined;
    assert.ok(onChange);
    onChange?.({ currentTarget: { value: "4" } });

    assert.deepEqual(updates.at(-1), {
      connector: {
        stroke: { color: "#0f172a", widthPt: 4 },
      },
    });
  });

  test("NodeSourcePanel renders linked, unlinked, and standalone source states", () => {
    const updates: unknown[] = [];
    const linked = NodeSourcePanel({
      node: childNode({
        source: {
          documentId: "doc-1",
          blockId: "block-1",
          blockKind: "visual",
          contentHash: "hash-1",
          linkedAt: "2026-06-30T00:00:00.000Z",
        },
      }),
      onUpdateSource: (source) => updates.push(source),
      onRefreshSource: () => updates.push("refresh"),
    });
    const unlinked = NodeSourcePanel({
      node: childNode({
        source: {
          documentId: "doc-1",
          blockId: "block-1",
          unlinked: true,
        },
      }),
      onUpdateSource: (source) => updates.push(source),
      onRefreshSource: () => updates.push("refresh"),
    });
    const standalone = NodeSourcePanel({
      node: childNode({ source: undefined }),
      onUpdateSource: (source) => updates.push(source),
    });

    assert.match(render(linked), /Linked/);
    assert.match(render(unlinked), /Unlinked/);
    assert.match(render(standalone), /Standalone/);
    assert.ok(invokeHandlers(linked) >= 6);
    assert.ok(invokeHandlers(unlinked) >= 5);
    assert.ok(invokeHandlers(standalone) >= 4);
    assert.ok(updates.length >= 10);
  });

  test("NodeGeometryPanel preserves aspect ratio and wires attribute toggles", () => {
    const layoutUpdates: unknown[] = [];
    const attributeUpdates: unknown[] = [];
    const element = NodeGeometryPanel({
      node: childNode({
        layout: {
          frame: { x: 10, y: 20, w: 30, h: 15 },
          zIndex: 3,
          rotation: 5,
          autoHeight: true,
          flipX: false,
          flipY: true,
          constraints: { preserveAspectRatio: true },
        },
        locked: false,
        hidden: true,
      }),
      onUpdateLayout: (patch) => layoutUpdates.push(patch),
      onUpdateAttributes: (patch) => attributeUpdates.push(patch),
    });
    const empty = NodeGeometryPanel({
      node: childNode({ layout: undefined }),
      onUpdateLayout: (patch) => layoutUpdates.push(patch),
      onUpdateAttributes: (patch) => attributeUpdates.push(patch),
    });

    assert.match(render(element), /Geometry/);
    assert.equal(empty, null);
    assert.ok(invokeHandlers(element) >= 12);
    assert.ok(
      layoutUpdates.some(
        (patch) =>
          typeof patch === "object" &&
          patch !== null &&
          "frame" in patch &&
          (patch as { frame?: { h?: number } }).frame?.h !== undefined,
      ),
    );
    assert.ok(
      attributeUpdates.some(
        (patch) =>
          typeof patch === "object" && patch !== null && "locked" in patch,
      ),
    );
  });

  test("SlideControlsPanel and StyleBindingPanel wire select handlers", () => {
    const controlUpdates: unknown[] = [];
    const propUpdates: unknown[] = [];
    const bindingUpdates: unknown[] = [];
    const controls = SlideControlsPanel({
      controls: { tone: "neutral", density: "airy", emphasis: "balanced" },
      props: { decoration: "default", chrome: "minimal" },
      supportedControls: {
        tone: ["neutral"],
        density: ["airy", "dense"],
        emphasis: ["balanced", "data"],
      },
      onUpdateControls: (patch) => controlUpdates.push(patch),
      onUpdateProps: (patch) => propUpdates.push(patch),
    });
    const binding = StyleBindingPanel({
      role: "title",
      binding: { ref: "text.title", variant: "large" },
      availableVariants: ["default", "large", "compact"],
      onChangeStyleBinding: (patch) => bindingUpdates.push(patch),
    });
    const unbound = StyleBindingPanel({
      binding: undefined,
      onChangeStyleBinding: (patch) => bindingUpdates.push(patch),
    });

    assert.match(render(controls), /Slide Controls/);
    assert.match(render(binding), /text.title/);
    assert.match(render(unbound), /unbound/);
    assert.ok(invokeHandlers(controls) >= 5);
    assert.ok(invokeHandlers(binding) >= 2);
    assert.ok(invokeHandlers(unbound) >= 1);
    assert.ok(controlUpdates.length >= 3);
    assert.ok(propUpdates.length >= 2);
    assert.ok(bindingUpdates.length >= 2);
  });

  test("SlideSettingsPanel renders background/source variants and handlers", () => {
    const updates: unknown[] = [];
    const baseSlide: SlideNode = {
      id: "slide-1",
      type: "slide",
      name: "Slide 1",
      template: { kind: "cover", layoutId: "default" },
      controls: {},
      props: {},
      notes: "Speaker notes",
      source: {
        documentId: "doc-1",
        blockId: "block-1",
        blockKind: "text",
      },
      children: [],
    };
    const backgrounds: SlideNode["localStyle"][] = [
      { slide: { background: { type: "solid", color: "#ffffff" } } },
      {
        slide: {
          background: {
            type: "linearGradient",
            from: "#111111",
            to: "#222222",
            angle: 135,
          },
        },
      },
      {
        slide: {
          background: {
            type: "radialGradient",
            inner: "#333333",
            outer: "#444444",
          },
        },
      },
      { slide: { background: { type: "image", assetId: "asset-1" } } },
    ];

    for (const localStyle of backgrounds) {
      const element = SlideSettingsPanel({
        slide: { ...baseSlide, localStyle },
        onUpdateSlide: (patch) => updates.push(patch),
        onUpdateSource: (source) => updates.push(source),
        onUpdateLocalStyle: (patch) => updates.push(patch),
        onResetLocalStyle: () => updates.push("reset"),
        assetResolver: (assetId) =>
          assetId === "asset-1" ? "https://example.com/asset-1.png" : undefined,
        onUploadBackgroundImage: () => updates.push("upload"),
      });
      assert.match(render(element), /Slide/);
      assert.ok(invokeHandlers(element) >= 7);
    }
    assert.ok(updates.includes("upload"));
    assert.ok(updates.length >= 28);
  });

  test("SlideSettingsPanel shows image preview and missing-state placeholders", () => {
    const baseSlide: SlideNode = {
      id: "slide-1",
      type: "slide",
      name: "Slide 1",
      template: { kind: "cover", layoutId: "default" },
      controls: {},
      props: {},
      children: [],
    };

    const previewElement = SlideSettingsPanel({
      slide: {
        ...baseSlide,
        localStyle: {
          slide: { background: { type: "image", assetId: "asset-1" } },
        },
      },
      onUpdateSlide: () => undefined,
      onUpdateSource: () => undefined,
      onUpdateLocalStyle: () => undefined,
      onResetLocalStyle: () => undefined,
      assetResolver: () => "https://example.com/asset-1.png",
      onUploadBackgroundImage: () => undefined,
    });
    const missingElement = SlideSettingsPanel({
      slide: {
        ...baseSlide,
        localStyle: {
          slide: { background: { type: "image", assetId: "asset-missing" } },
        },
      },
      onUpdateSlide: () => undefined,
      onUpdateSource: () => undefined,
      onUpdateLocalStyle: () => undefined,
      onResetLocalStyle: () => undefined,
    });
    const emptyElement = SlideSettingsPanel({
      slide: {
        ...baseSlide,
        localStyle: { slide: { background: { type: "image", assetId: "" } } },
      },
      onUpdateSlide: () => undefined,
      onUpdateSource: () => undefined,
      onUpdateLocalStyle: () => undefined,
      onResetLocalStyle: () => undefined,
    });

    assert.match(render(previewElement), /https:\/\/example.com\/asset-1\.png/);
    assert.match(render(previewElement), /Replace image/);
    assert.match(render(missingElement), /Missing image asset/);
    assert.match(render(emptyElement), /No background image selected/);
    assert.match(render(emptyElement), /Upload image/);
  });

  test("DiagnosticsPanel sorts severities, filters info, and invokes actions", () => {
    const actions: unknown[] = [];
    const diagnostics: PresentationDiagnostic[] = [
      makeDiagnostic("missing-token", "info", "Info"),
      makeDiagnostic("missing-asset", "error", "Missing asset", {
        action: { type: "open-asset-panel" },
      }),
      makeDiagnostic("unsupported-export-feature", "warning", "Unsupported", {
        action: { type: "replace-style-ref" },
      }),
      makeDiagnostic("invalid-schema-version", "fatal", "Fatal", {
        action: { type: "open-source-review" },
      }),
    ];
    const element = DiagnosticsPanel({
      diagnostics,
      onAction: (action, diagnostic) =>
        actions.push([action.type, diagnostic.code]),
    });
    const filtered = DiagnosticsPanel({
      diagnostics,
      hideInfo: true,
      onAction: (action, diagnostic) =>
        actions.push([action.type, diagnostic.code]),
    });

    const html = render(element);
    assert.ok(html.indexOf("Fatal") < html.indexOf("Missing asset"));
    assert.match(render(filtered), /Missing asset/);
    assert.doesNotMatch(render(filtered), /Info/);
    assert.ok(invokeHandlers(element) >= 3);
    assert.deepEqual(actions[0], [
      "open-source-review",
      "invalid-schema-version",
    ]);
  });

  test("LayersPanel renders nested layer labels, contextual toggle names, and empty state", () => {
    const updates: unknown[] = [];
    const group = childNode({
      id: "group-1",
      type: "group",
      name: "Group",
      children: [
        childNode({
          id: "child-text",
          type: "text",
          content: { paragraphs: [{ id: "p1", text: "Nested text" }] },
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 2 },
        }),
        childNode({
          id: "child-image",
          type: "image",
          content: { assetId: "img-1", alt: "Nested image" },
          hidden: true,
          locked: true,
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
        }),
      ],
    });

    const panel = withFakeHooks(() =>
      LayersPanel({
        nodes: [group],
        selectedIds: ["child-text"],
        onSelectNode: (id) => updates.push(["select", id]),
        onUpdateNode: (id, patch) => updates.push(["update", id, patch]),
        onReorderNode: (id, index) => updates.push(["reorder", id, index]),
      }),
    );
    const html = render(panel);
    const interactions = invokeHandlers(panel);
    const reorderEvents = updates.filter(
      (event) => Array.isArray(event) && event[0] === "reorder",
    );
    const empty = renderToStaticMarkup(
      createElement(LayersPanel, {
        nodes: [],
        selectedIds: [],
        onSelectNode: (id) => updates.push(id),
        onUpdateNode: (id, patch) => updates.push([id, patch]),
      }),
    );

    assert.match(html, /Group/);
    assert.match(html, /Nested text/);
    assert.match(html, /Nested image/);
    assert.match(html, /Move layer forward/);
    assert.match(html, /Move layer backward/);
    assert.match(html, /aria-live="polite"/);
    assert.ok(interactions >= 8);
    assert.ok(reorderEvents.length >= 2);
    assert.match(
      html,
      /aria-label="Hide layer &quot;Nested text&quot;" aria-pressed="false"/,
    );
    assert.match(
      html,
      /aria-label="Lock layer &quot;Nested text&quot;" aria-pressed="false"/,
    );
    assert.match(
      html,
      /aria-label="Show layer &quot;Nested image&quot;" aria-pressed="true"/,
    );
    assert.match(
      html,
      /aria-label="Unlock layer &quot;Nested image&quot;" aria-pressed="true"/,
    );
    assert.equal(empty, "");
  });
});
