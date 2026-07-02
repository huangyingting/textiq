import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DiagnosticsPanel,
  DeckChromePanel,
  InspectorShell,
  LayersPanel,
  LocalOverrideBadge,
  LocalStylePanel,
  NodeContentPanel,
  NodeGeometryPanel,
  NodeSourcePanel,
  SlideControlsPanel,
  SlideSettingsPanel,
  StyleBindingPanel,
} from "./inspector";
import {
  buildImageNode,
  buildShapeNode,
  buildSlideV7,
  buildTableNode,
  buildTextNode,
} from "@/test/builders/deck-v7";
import { withReactTestDispatcher } from "@/test/react-server-renderer";
import { makeDiagnostic } from "@/lib/presentation-vnext/diagnostics";
import type {
  NodeSourceMetadata,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation-vnext/schema";
import type { StylePatch } from "@/lib/presentation-vnext/style-schema";

const noop = () => undefined;
const updateRecord = (_patch: Record<string, unknown>) => undefined;
const updateStyle = (_patch: StylePatch) => undefined;
const updateSource = (_source: NodeSourceMetadata | undefined) => undefined;

function textNode(): SlideChildNode {
  return buildTextNode({
    id: "text-rich",
    name: "Narrative",
    role: "body",
    source: {
      documentId: "doc-1",
      blockId: "block-1",
      blockKind: "text",
      contentHash: "hash-text",
      linkedAt: "2026-06-30T07:00:00.000Z",
    },
    localStyle: {
      text: {
        color: "#111827",
        fontSizePt: 18,
        weight: 700,
        italic: true,
        underline: true,
        align: "center",
        lineHeight: 1.3,
      },
      fill: { type: "solid", color: "#f8fafc" },
      opacity: 0.82,
      shadow: {
        xPt: 1,
        yPt: 2,
        blurPt: 8,
        color: "#000000",
        opacity: 0.18,
      },
      effect: { kind: "glow", color: "#4f46e5", blurPt: 14, opacity: 0.35 },
      blendMode: "multiply",
    },
    content: {
      paragraphs: [
        { id: "text-p-1", text: "Primary insight" },
        { id: "text-p-2", text: "Secondary detail" },
      ],
    },
  });
}

function shapeNode(): SlideChildNode {
  return buildShapeNode({
    id: "shape-rich",
    name: "Decision diamond",
    role: "callout",
    localStyle: {
      text: { color: "#0f172a", fontSizePt: 14, align: "right" },
      fill: { type: "solid", color: "#dbeafe" },
      stroke: { color: "#2563eb", widthPt: 2, dash: "dashed" },
      radius: { allPt: 10 },
      opacity: 0.9,
    },
    content: {
      shape: "diamond",
    },
  });
}

function imageNode(): SlideChildNode {
  return buildImageNode("image-rich", {
    id: "image-rich",
    name: "Product screenshot",
    source: {
      documentId: "doc-2",
      blockId: "image-block",
      blockKind: "image",
      unlinked: true,
    },
    content: {
      assetId: "image-rich",
      alt: "Product screenshot",
      fit: "contain",
      crop: { top: 4, right: 8, bottom: 12, left: 16 },
    },
    localStyle: {
      opacity: 0.75,
      image: { brightness: 1.2, contrast: 0.9, saturation: 1.1 },
      effect: { kind: "blur", radiusPt: 3 },
    },
  });
}

function connectorNode(): SlideChildNode {
  return {
    id: "connector-rich",
    type: "connector",
    role: "connector",
    name: "Process connector",
    layout: { frame: { x: 10, y: 20, w: 70, h: 30 }, zIndex: 5 },
    style: { ref: "connector.primary" },
    localStyle: {
      connector: {
        stroke: { color: "#334155", widthPt: 2, dash: "dotted" },
        startArrow: "arrow",
        endArrow: "filled",
        routing: "elbow",
      },
    },
    content: {
      from: { kind: "point", point: { x: 0, y: 50 } },
      to: { kind: "node", nodeId: "target", anchor: "right" },
      routing: "elbow",
    },
  };
}

function visualNode(): SlideChildNode {
  return {
    id: "visual-rich",
    type: "visual",
    role: "visual",
    name: "Revenue visual",
    layout: { frame: { x: 20, y: 20, w: 50, h: 35 }, zIndex: 6 },
    style: { ref: "chart.primary" },
    localStyle: {
      fill: { type: "solid", color: "#eef2ff" },
      stroke: { color: "#4338ca", widthPt: 1 },
      visual: {
        channelColors: { revenue: "#2563eb" },
        transparentBackground: true,
      },
    },
    content: {
      visualId: "revenue-chart",
      assetId: "visual-rich",
      alt: "Revenue chart",
    },
  };
}

function tableNode(): SlideChildNode {
  return buildTableNode({
    id: "table-rich",
    name: "Metrics table",
    source: {
      documentId: "doc-3",
      blockId: "table-block",
      blockKind: "table",
    },
    localStyle: {
      table: {
        headerFill: { type: "solid", color: "#0f172a" },
        rowFill: { type: "solid", color: "#f8fafc" },
        text: { fontFamily: "Inter", fontSizePt: 11 },
      },
    },
  });
}

function groupNode(children: SlideChildNode[]): SlideChildNode {
  return {
    id: "group-rich",
    type: "group",
    role: "card",
    name: "Grouped callout",
    component: "custom",
    layout: { frame: { x: 5, y: 5, w: 90, h: 80 }, zIndex: 10 },
    style: { ref: "surface.card" },
    children,
  };
}

function richNodes(): SlideChildNode[] {
  const text = textNode();
  const shape = shapeNode();
  return [
    text,
    shape,
    imageNode(),
    connectorNode(),
    visualNode(),
    tableNode(),
    groupNode([
      { ...text, id: "group-text" },
      { ...shape, id: "group-shape" },
    ]),
  ];
}

function activeSlide(): SlideNode {
  return {
    ...buildSlideV7("content", richNodes(), {
      id: "slide-rich",
      name: "Quarterly overview",
      notes: "Speaker notes",
      controls: { tone: "technical", density: "dense", emphasis: "data" },
      props: { decoration: "expressive", chrome: "minimal" },
      source: {
        documentId: "doc-slide",
        blockId: "slide-block",
        blockKind: "visual",
      },
      localStyle: {
        slide: {
          background: {
            type: "linearGradient",
            from: "#0f172a",
            to: "#1d4ed8",
            angle: 135,
          },
          accent: "#38bdf8",
        },
      },
    }),
  };
}

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element);
}

function withFakeHooks<T>(renderComponent: () => T): T {
  return withReactTestDispatcher(
    {
      useState: <S>(initial: S | (() => S)) => [
        typeof initial === "function" ? (initial as () => S)() : initial,
        () => undefined,
      ],
      useReducer: <S>(_: unknown, initial: S) => [initial, () => undefined],
      useRef: <T>(initial: T) => ({ current: initial }),
      useMemo: <T>(factory: () => T) => factory(),
      useCallback: <T>(callback: T) => callback,
      useId: () => "fake-react-id",
      useContext: () => undefined,
      useEffect: () => undefined,
      useLayoutEffect: () => undefined,
      useInsertionEffect: () => undefined,
      useSyncExternalStore: () => undefined,
      useTransition: () => [false, () => undefined],
      useDeferredValue: <T>(value: T) => value,
    },
    renderComponent,
    { requireInternals: false },
  );
}

function collectHandlers(
  node: ReactNode,
  propName: string,
  handlers: ((event?: unknown) => void)[] = [],
): ((event?: unknown) => void)[] {
  if (Array.isArray(node)) {
    for (const child of node) collectHandlers(child, propName, handlers);
    return handlers;
  }
  if (!isValidElement(node)) return handlers;
  const props = node.props as Record<string, unknown>;
  if (typeof props[propName] === "function") {
    handlers.push(props[propName] as (event?: unknown) => void);
  }
  collectHandlers(props.children as ReactNode, propName, handlers);
  return handlers;
}

function invokePanelHandlers(node: ReactNode): number {
  const changeValues = [
    "#123456",
    "linearGradient",
    "radialGradient",
    "image",
    "blur",
    "glow",
    "glass",
    "node",
    "point",
    "dashed",
    "filled",
  ];
  const clickEvent = {
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    currentTarget: {
      value: "#123456",
      checked: true,
    },
  };
  const handlers = [
    ...collectHandlers(node, "onChange").flatMap((handler) =>
      changeValues.map(
        (value) => () =>
          handler({
            currentTarget: {
              value,
              checked: true,
            },
          }),
      ),
    ),
    ...collectHandlers(node, "onClick").map(
      (handler) => () => handler(clickEvent),
    ),
  ];
  for (const handler of handlers) handler();
  return handlers.length;
}

function shellProps(
  overrides: Partial<ComponentProps<typeof InspectorShell>> = {},
): ComponentProps<typeof InspectorShell> {
  const slide = activeSlide();
  return {
    activeSlide: slide,
    deckChrome: undefined,
    selectedNode: slide.children[0],
    selectedIds: [slide.children[0].id],
    isDecorationSelected: false,
    diagnostics: [
      makeDiagnostic(
        "unsupported-export-feature",
        "warning",
        "Gradient fallback required",
        { action: { type: "replace-style-ref" } },
      ),
    ],
    onUpdateControls: noop,
    onUpdateProps: noop,
    onUpdateDeckChrome: noop,
    onUpdateSlideAttributes: noop,
    onUpdateSlideLocalStyle: updateStyle,
    onResetSlideLocalStyle: noop,
    onUpdateSlideSource: updateSource,
    onUpdateSelectedLayout: updateRecord,
    onUpdateSelectedAttributes: noop,
    onUpdateSelectedContent: updateRecord,
    onUpdateSelectedLocalStyle: updateStyle,
    assetResolver: (assetId) => `https://example.com/${assetId}.png`,
    onReplaceImage: noop,
    onResetToTheme: noop,
    onUpdateSelectedSource: updateSource,
    onRefreshSelectedSource: noop,
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
      { kind: "content", label: "Content" },
      { kind: "visual-focus", label: "Visual" },
    ],
    activeTemplate: { layouts: [{ id: "default" }, { id: "dense" }] },
    activeLayoutId: "dense",
    onReapplyTemplate: noop,
    selectionMode: "normal",
    onToggleSelectionMode: noop,
    ...overrides,
  };
}

describe("vNext inspector components", () => {
  test("renders direct panel variants for every editable node surface", () => {
    const slide = activeSlide();
    const [text, shape, image, connector, visual, table] = slide.children;
    const html = [
      render(
        createElement(NodeContentPanel, {
          node: text,
          onUpdateContent: updateRecord,
        }),
      ),
      render(
        createElement(NodeContentPanel, {
          node: shape,
          onUpdateContent: updateRecord,
        }),
      ),
      render(
        createElement(NodeContentPanel, {
          node: image,
          onUpdateContent: updateRecord,
          assetResolver: (assetId) => `https://example.com/${assetId}.png`,
          onReplaceImage: noop,
        }),
      ),
      render(
        createElement(NodeContentPanel, {
          node: connector,
          onUpdateContent: updateRecord,
        }),
      ),
      render(
        createElement(NodeContentPanel, {
          node: visual,
          onUpdateContent: updateRecord,
        }),
      ),
      render(
        createElement(NodeContentPanel, {
          node: table,
          onUpdateContent: updateRecord,
        }),
      ),
      render(
        createElement(LocalStylePanel, {
          node: text,
          onUpdateLocalStyle: updateStyle,
        }),
      ),
      render(
        createElement(LocalStylePanel, {
          node: shape,
          onUpdateLocalStyle: updateStyle,
        }),
      ),
      render(
        createElement(LocalStylePanel, {
          node: connector,
          onUpdateLocalStyle: updateStyle,
        }),
      ),
      render(
        createElement(LocalStylePanel, {
          node: visual,
          onUpdateLocalStyle: updateStyle,
        }),
      ),
      render(
        createElement(LocalStylePanel, {
          node: table,
          onUpdateLocalStyle: updateStyle,
        }),
      ),
    ].join("\n");

    assert.match(html, /Primary insight/);
    assert.match(html, /Product screenshot/);
    assert.match(html, /Routing/);
    assert.match(html, /Replace visual/);
    assert.match(html, /Header row/);
    assert.match(html, /Local Style/);
  });

  test("renders slide, source, layer, diagnostics, and geometry panels", () => {
    const slide = activeSlide();
    const [text] = slide.children;
    const html = [
      render(
        createElement(SlideControlsPanel, {
          controls: slide.controls,
          props: slide.props,
          onUpdateControls: noop,
          onUpdateProps: noop,
        }),
      ),
      render(
        createElement(SlideSettingsPanel, {
          slide,
          onUpdateSlide: noop,
          onUpdateSource: updateSource,
          onUpdateLocalStyle: updateStyle,
          onResetLocalStyle: noop,
        }),
      ),
      render(
        createElement(NodeSourcePanel, {
          node: text,
          onUpdateSource: updateSource,
          onRefreshSource: noop,
        }),
      ),
      render(
        createElement(NodeGeometryPanel, {
          node: text,
          onUpdateLayout: updateRecord,
          onUpdateAttributes: noop,
        }),
      ),
      render(
        createElement(StyleBindingPanel, {
          role: text.role,
          binding: text.style,
          onChangeStyleBinding: noop,
        }),
      ),
      render(
        createElement(LocalOverrideBadge, {
          localStyle: text.localStyle,
          onResetToTheme: noop,
        }),
      ),
      render(
        createElement(LayersPanel, {
          nodes: slide.children,
          selectedIds: [text.id, "group-text"],
          onSelectNode: noop,
          onUpdateNode: noop,
          onReorderNode: noop,
        }),
      ),
      render(
        createElement(DiagnosticsPanel, {
          diagnostics: [
            makeDiagnostic("missing-token", "error", "Token missing", {
              action: { type: "reset-to-theme" },
            }),
            makeDiagnostic("local-style-overrides", "info", "Local override"),
          ],
          onAction: noop,
          hideInfo: false,
        }),
      ),
    ].join("\n");

    assert.match(html, /Slide Controls/);
    assert.match(html, /Quarterly overview/);
    assert.match(html, /Linked/);
    assert.match(html, /Geometry/);
    assert.match(html, /Style Binding/);
    assert.match(html, /Layers/);
    assert.match(html, /Token missing/);
  });

  test("renders deck chrome slide override editors", () => {
    const html = render(
      createElement(DeckChromePanel, {
        chrome: {
          footer: { enabled: true, text: "Global footer", align: "center" },
        },
        slideProps: {
          deckChrome: {
            footer: {
              mode: "override",
              value: { enabled: true, text: "Slide footer", align: "right" },
            },
          },
        },
        onUpdateChrome: noop,
        onUpdateSlideProps: noop,
      }),
    );

    assert.match(html, /Deck chrome defaults/);
    assert.match(html, /Selected slide overrides/);
    assert.match(html, /Use deck default/);
    assert.match(html, /Slide footer/);
    assert.match(html, /Enabled in this slide override/);
  });

  test("renders configured global chrome as enabled", () => {
    const html = render(
      createElement(DeckChromePanel, {
        chrome: {
          footer: { text: "Configured footer" },
        },
        onUpdateChrome: noop,
        onUpdateSlideProps: noop,
      }),
    );

    assert.match(
      html,
      /id="deck-chrome-footer-enabled" type="checkbox" checked=""/,
    );
  });

  test("supports custom deck chrome control ids for additional toolbar mounts", () => {
    const html = render(
      createElement(DeckChromePanel, {
        idPrefix: "deck-chrome-toolbar",
        chrome: {
          footer: { text: "Configured footer" },
        },
        onUpdateChrome: noop,
        onUpdateSlideProps: noop,
      }),
    );

    assert.match(
      html,
      /id="deck-chrome-toolbar-footer-enabled" type="checkbox" checked=""/,
    );
    assert.match(html, /id="deck-chrome-toolbar-override-logo"/);
  });

  test("renders inspector shell route panels for slide, node, multi-select, decoration, and diagnostics contexts", () => {
    const slide = activeSlide();
    const [text, , image] = slide.children;
    const html = [
      render(
        createElement(
          InspectorShell,
          shellProps({
            selectedNode: undefined,
            selectedIds: [],
            initialPanel: "slide",
          }),
        ),
      ),
      render(
        createElement(
          InspectorShell,
          shellProps({
            selectedNode: undefined,
            selectedIds: [],
            initialPanel: "notes",
          }),
        ),
      ),
      render(
        createElement(
          InspectorShell,
          shellProps({ selectedNode: text, initialPanel: "text" }),
        ),
      ),
      render(
        createElement(
          InspectorShell,
          shellProps({ selectedNode: image, initialPanel: "adjust" }),
        ),
      ),
      render(
        createElement(
          InspectorShell,
          shellProps({ selectedNode: text, initialPanel: "arrange" }),
        ),
      ),
      render(
        createElement(
          InspectorShell,
          shellProps({
            selectedIds: ["text-rich", "shape-rich", "image-rich"],
            selectedNode: undefined,
            initialPanel: "arrange",
          }),
        ),
      ),
      render(
        createElement(
          InspectorShell,
          shellProps({ selectedNode: text, initialPanel: "effects" }),
        ),
      ),
      render(
        createElement(
          InspectorShell,
          shellProps({ selectedNode: text, initialPanel: "source" }),
        ),
      ),
      render(
        createElement(
          InspectorShell,
          shellProps({ selectedNode: text, initialPanel: "style" }),
        ),
      ),
      render(
        createElement(InspectorShell, shellProps({ initialPanel: "layers" })),
      ),
      render(
        createElement(
          InspectorShell,
          shellProps({
            selectedNode: undefined,
            isDecorationSelected: true,
            initialPanel: "decoration",
          }),
        ),
      ),
      render(
        createElement(
          InspectorShell,
          shellProps({ selectedNode: text, initialPanel: "diagnostics" }),
        ),
      ),
    ].join("\n");

    assert.match(html, /Template/);
    assert.match(html, /Speaker Notes/);
    assert.match(html, /Image Adjust/);
    assert.match(html, /Arrange 3 nodes/);
    assert.match(html, /Glow opacity/);
    assert.match(html, /Shadow opacity/);
    assert.match(html, /Theme Decoration/);
    assert.match(html, /Gradient fallback required/);
  });

  test("invokes inspector panel input handlers for content, styles, metadata, and layers", () => {
    const slide = activeSlide();
    const [text, shape, image, connector, visual, table] = slide.children;
    const updates: unknown[] = [];
    const recordUpdate = (patch: unknown) => updates.push(patch);
    const panels: ReactNode[] = [
      withFakeHooks(() =>
        NodeContentPanel({
          node: text,
          onUpdateContent: recordUpdate as (
            patch: Record<string, unknown>,
          ) => void,
        }),
      ),
      withFakeHooks(() =>
        NodeContentPanel({
          node: shape,
          onUpdateContent: recordUpdate as (
            patch: Record<string, unknown>,
          ) => void,
        }),
      ),
      withFakeHooks(() =>
        NodeContentPanel({
          node: image,
          onUpdateContent: recordUpdate as (
            patch: Record<string, unknown>,
          ) => void,
          assetResolver: (assetId) => `https://example.com/${assetId}.png`,
          onReplaceImage: () => updates.push("replace-image"),
        }),
      ),
      withFakeHooks(() =>
        NodeContentPanel({
          node: connector,
          onUpdateContent: recordUpdate as (
            patch: Record<string, unknown>,
          ) => void,
        }),
      ),
      withFakeHooks(() =>
        NodeContentPanel({
          node: visual,
          onUpdateContent: recordUpdate as (
            patch: Record<string, unknown>,
          ) => void,
        }),
      ),
      withFakeHooks(() =>
        NodeContentPanel({
          node: table,
          onUpdateContent: recordUpdate as (
            patch: Record<string, unknown>,
          ) => void,
        }),
      ),
      LocalStylePanel({
        node: text,
        onUpdateLocalStyle: recordUpdate as (patch: StylePatch) => void,
      }),
      LocalStylePanel({
        node: shape,
        onUpdateLocalStyle: recordUpdate as (patch: StylePatch) => void,
      }),
      LocalStylePanel({
        node: connector,
        onUpdateLocalStyle: recordUpdate as (patch: StylePatch) => void,
      }),
      LocalStylePanel({
        node: visual,
        onUpdateLocalStyle: recordUpdate as (patch: StylePatch) => void,
      }),
      LocalStylePanel({
        node: table,
        onUpdateLocalStyle: recordUpdate as (patch: StylePatch) => void,
      }),
      SlideSettingsPanel({
        slide,
        onUpdateSlide: recordUpdate as (patch: {
          name?: string;
          notes?: string;
        }) => void,
        onUpdateSource: recordUpdate as (
          source: NodeSourceMetadata | undefined,
        ) => void,
        onUpdateLocalStyle: recordUpdate as (patch: StylePatch) => void,
        onResetLocalStyle: () => updates.push("reset-slide-style"),
      }),
      SlideSettingsPanel({
        slide: {
          ...slide,
          id: "slide-image-bg",
          localStyle: {
            slide: {
              background: { type: "image", assetId: "bg-image", opacity: 1 },
              accent: "#0ea5e9",
            },
          },
        },
        onUpdateSlide: recordUpdate as (patch: {
          name?: string;
          notes?: string;
        }) => void,
        onUpdateSource: recordUpdate as (
          source: NodeSourceMetadata | undefined,
        ) => void,
        onUpdateLocalStyle: recordUpdate as (patch: StylePatch) => void,
        onResetLocalStyle: () => updates.push("reset-image-slide-style"),
      }),
      SlideSettingsPanel({
        slide: {
          ...slide,
          id: "slide-radial-bg",
          localStyle: {
            slide: {
              background: {
                type: "radialGradient",
                inner: "#f8fafc",
                outer: "#1d4ed8",
              },
            },
          },
        },
        onUpdateSlide: recordUpdate as (patch: {
          name?: string;
          notes?: string;
        }) => void,
        onUpdateSource: recordUpdate as (
          source: NodeSourceMetadata | undefined,
        ) => void,
        onUpdateLocalStyle: recordUpdate as (patch: StylePatch) => void,
        onResetLocalStyle: () => updates.push("reset-radial-slide-style"),
      }),
      NodeSourcePanel({
        node: text,
        onUpdateSource: recordUpdate as (
          source: NodeSourceMetadata | undefined,
        ) => void,
        onRefreshSource: () => updates.push("refresh-source"),
      }),
      NodeGeometryPanel({
        node: text,
        onUpdateLayout: recordUpdate as ComponentProps<
          typeof NodeGeometryPanel
        >["onUpdateLayout"],
        onUpdateAttributes: recordUpdate as ComponentProps<
          typeof NodeGeometryPanel
        >["onUpdateAttributes"],
      }),
      SlideControlsPanel({
        controls: slide.controls,
        props: slide.props,
        onUpdateControls: recordUpdate as ComponentProps<
          typeof SlideControlsPanel
        >["onUpdateControls"],
        onUpdateProps: recordUpdate as ComponentProps<
          typeof SlideControlsPanel
        >["onUpdateProps"],
      }),
      StyleBindingPanel({
        role: text.role,
        binding: text.style,
        onChangeStyleBinding: recordUpdate as ComponentProps<
          typeof StyleBindingPanel
        >["onChangeStyleBinding"],
      }),
      LocalOverrideBadge({
        localStyle: text.localStyle,
        onResetToTheme: () => updates.push("reset-node-style"),
      }),
      withFakeHooks(() =>
        LayersPanel({
          nodes: slide.children,
          selectedIds: [text.id],
          onSelectNode: recordUpdate as (nodeId: string) => void,
          onUpdateNode: ((nodeId, patch) =>
            updates.push({ nodeId, patch })) as ComponentProps<
            typeof LayersPanel
          >["onUpdateNode"],
          onReorderNode: ((nodeId, targetIndex) =>
            updates.push({ nodeId, targetIndex })) as ComponentProps<
            typeof LayersPanel
          >["onReorderNode"],
        }),
      ),
      DiagnosticsPanel({
        diagnostics: [
          makeDiagnostic("missing-token", "error", "Token missing", {
            action: { type: "reset-to-theme" },
          }),
        ],
        onAction: ((action, diagnostic) =>
          updates.push({ action, diagnostic })) as ComponentProps<
          typeof DiagnosticsPanel
        >["onAction"],
      }),
    ];

    const invoked = panels.reduce<number>(
      (count, panel) => count + invokePanelHandlers(panel),
      0,
    );
    assert.ok(invoked > 80);
    assert.ok(updates.length > 50);
  });
});
