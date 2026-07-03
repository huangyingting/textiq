import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DeckCanvas,
  SlideCanvas,
  type SlideCanvasProps,
  type SlideCanvasNodeGestureDraft,
} from "./slide-canvas";
import {
  interactiveNodeCursor,
  SlideNodeRenderer,
  styleObjectToContainerCss,
} from "./slide-node-renderer";
import { createSelectionState, setSelection } from "./selection-model";
import { Filmstrip } from "./filmstrip/filmstrip";
import {
  createFocusGeometryRegistry,
  focusGeometryTargets,
} from "./focus-geometry-registry";
import type {
  ResolvedDeckRenderTree,
  ResolvedNodeContent,
  ResolvedRenderNode,
  ResolvedSlideRenderLists,
  ResolvedSlideRenderTree,
} from "@/lib/presentation/render-tree";
import type { FillStyle, StyleObject } from "@/lib/presentation/style-schema";

type ElementWithProps = ReactElement<Record<string, unknown>>;

// e2e-governance-allow oversized-test: presentation canvas parity coverage is still centralized here; split tracked separately.
function textNode(
  id: string,
  frame: { x: number; y: number; w: number; h: number },
  options: Partial<ResolvedRenderNode> = {},
): ResolvedRenderNode {
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame, zIndex: 1 },
    style: {},
    content: {
      type: "text",
      content: { paragraphs: [{ id: `${id}-p1`, text: id }] },
    },
    source: "user",
    ...options,
  };
}

function imageNode(
  id: string,
  frame: { x: number; y: number; w: number; h: number },
  options: Partial<ResolvedRenderNode> = {},
): ResolvedRenderNode {
  return {
    id,
    type: "image",
    role: "body",
    layout: { frame, zIndex: 1 },
    style: {},
    content: {
      type: "image",
      content: { assetId: "image-1", fit: "cover" },
    },
    source: "user",
    ...options,
  };
}

function slide(nodes: ResolvedRenderNode[]): ResolvedSlideRenderTree {
  return {
    id: "slide-1",
    background: {
      fill: { type: "solid", color: "#ffffff" },
      decorationLevel: "none",
    },
    decorations: [],
    chrome: [],
    nodes,
  };
}

function renderNode(
  id: string,
  content: ResolvedNodeContent,
  style: StyleObject = {},
  options: Partial<ResolvedRenderNode> = {},
): ResolvedRenderNode {
  return {
    id,
    type: content.type,
    role: "body",
    layout: {
      frame: { x: 10, y: 10, w: 40, h: 24 },
      rotation: 8,
      zIndex: 2,
      flipX: true,
    },
    style,
    content,
    source: "user",
    ...options,
  };
}

function renderResolvedNodeMarkup(node: ResolvedRenderNode): string {
  return renderToStaticMarkup(
    createElement(SlideNodeRenderer, {
      node,
      interactive: true,
      selected: true,
      hovered: true,
      focused: true,
      tabIndex: 0,
      onDoubleClick: () => undefined,
      onPointerDown: () => undefined,
      onFocus: () => undefined,
      assetResolver: (assetId) =>
        assetId === "missing"
          ? undefined
          : `https://example.com/${assetId}.png`,
    }),
  );
}

function findElement(
  root: ReactNode,
  predicate: (element: ElementWithProps) => boolean,
): ElementWithProps | null {
  let found: ElementWithProps | null = null;
  function visit(node: ReactNode): void {
    if (found) return;
    Children.forEach(node, (child) => {
      if (found || !isValidElement(child)) return;
      const element = child as ElementWithProps;
      if (predicate(element)) {
        found = element;
        return;
      }
      visit(element.props.children as ReactNode);
    });
  }
  visit(root);
  return found;
}

function renderSlideCanvasTree(props: SlideCanvasProps): ReactNode {
  return callableSlideCanvas(SlideCanvas).type(props);
}

function fakeStageElement(
  onFocus: (options?: FocusOptions) => void,
): HTMLDivElement {
  return {
    focus: onFocus,
    getBoundingClientRect: () =>
      ({
        bottom: 20,
        height: 10,
        left: 1,
        right: 11,
        top: 10,
        width: 10,
        x: 1,
        y: 10,
        toJSON: () => ({}),
      }) as DOMRectReadOnly,
  } as HTMLDivElement;
}

describe("SlideCanvas stage editing render affordances", () => {
  test("renders stage nodes as accessible roving-tabindex controls", () => {
    const selection = setSelection(createSelectionState("normal"), ["node-1"]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([textNode("node-1", { x: 10, y: 10, w: 20, h: 10 })]),
        selection,
        focusedNodeId: "node-1",
        onNodePointerDown: () => undefined,
      }),
    );

    assert.match(html, /role="button"/);
    assert.match(html, /tabindex="0"/);
    assert.match(html, /aria-label="Text: node-1"/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /data-node-id="node-1"[^>]*style="[^"]*cursor:default/);
  });

  test("maps stage node cursors from interaction state", () => {
    assert.equal(
      interactiveNodeCursor({
        hasPointerHandler: true,
        locked: false,
        dragging: false,
      }),
      "default",
    );
    assert.equal(
      interactiveNodeCursor({
        hasPointerHandler: true,
        locked: false,
        dragging: true,
      }),
      "grabbing",
    );
    assert.equal(
      interactiveNodeCursor({
        hasPointerHandler: true,
        locked: true,
        dragging: false,
      }),
      "not-allowed",
    );
    assert.equal(
      interactiveNodeCursor({
        hasPointerHandler: false,
        locked: false,
        dragging: false,
      }),
      "default",
    );
  });

  test("renders grabbing cursor only during active stage drag", () => {
    const selection = setSelection(createSelectionState("normal"), ["node-1"]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([textNode("node-1", { x: 10, y: 10, w: 20, h: 10 })]),
        selection,
        draggingStage: true,
        onNodePointerDown: () => undefined,
      }),
    );

    assert.match(
      html,
      /data-slide-canvas="true"[^>]*style="[^"]*cursor:grabbing/,
    );
    assert.match(html, /data-node-id="node-1"[^>]*style="[^"]*cursor:grabbing/);
  });

  test("exposes selected and unselected state with aria-pressed", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "node-selected",
    ]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          textNode("node-selected", { x: 10, y: 10, w: 20, h: 10 }),
          textNode("node-unselected", { x: 40, y: 10, w: 20, h: 10 }),
        ]),
        selection,
        focusedNodeId: "node-selected",
        onNodePointerDown: () => undefined,
      }),
    );

    assert.match(html, /data-node-id="node-selected"[^>]*aria-pressed="true"/);
    assert.match(
      html,
      /data-node-id="node-unselected"[^>]*aria-pressed="false"/,
    );
  });

  test("keeps a single focused node in the roving tabindex order", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "node-a",
      "node-b",
    ]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          textNode("node-a", { x: 10, y: 10, w: 20, h: 10 }),
          textNode("node-b", { x: 40, y: 10, w: 20, h: 10 }),
        ]),
        selection,
        focusedNodeId: "node-b",
        onNodePointerDown: () => undefined,
        onNodeFocus: () => undefined,
      }),
    );

    assert.match(html, /<div[^>]*data-node-id="node-a"[^>]*tabindex="-1"/);
    assert.match(html, /<div[^>]*data-node-id="node-b"[^>]*tabindex="0"/);
    assert.match(html, /data-node-focused="true"/);
  });

  test("applies focus-visible and reduced-motion guards to focusable stage nodes", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "locked",
      "group-1",
    ]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          textNode("locked", { x: 10, y: 10, w: 20, h: 10 }, { locked: true }),
          renderNode("group-1", { type: "group" }, {}, { type: "group" }),
        ]),
        selection,
        focusedNodeId: "locked",
        onNodePointerDown: () => undefined,
      }),
    );

    assert.match(
      html,
      /data-node-id="locked"[^>]*class="[^"]*focus-visible:ring-ds-focus-ring[^"]*motion-reduce:transition-none/,
    );
    assert.match(
      html,
      /data-node-id="group-1"[^>]*class="[^"]*focus-visible:ring-ds-focus-ring[^"]*motion-reduce:transition-none/,
    );
    assert.match(html, /data-node-id="locked"[^>]*aria-disabled="true"/);
  });

  test("registers stage node elements with the focus geometry registry", () => {
    const registry = createFocusGeometryRegistry();
    const focusCalls: Array<FocusOptions | undefined> = [];
    const tree = renderSlideCanvasTree({
      slide: slide([textNode("node-1", { x: 10, y: 10, w: 20, h: 10 })]),
      focusedNodeId: "node-1",
      focusGeometryRegistry: registry,
      onNodePointerDown: () => undefined,
    });
    const renderer = findElement(
      tree,
      (candidate) =>
        candidate.type === SlideNodeRenderer &&
        (candidate.props.node as ResolvedRenderNode).id === "node-1",
    );
    assert.ok(renderer, "expected stage node renderer");
    const nodeRef = renderer.props.nodeRef as
      | ((element: HTMLDivElement | null) => void)
      | undefined;
    assert.ok(nodeRef, "expected stage node registry ref");

    const element = fakeStageElement((options) => focusCalls.push(options));
    nodeRef(element);

    const key = focusGeometryTargets.stageNode("node-1");
    assert.equal(registry.getElement(key), element);
    assert.equal(registry.focus(key, { preventScroll: true }), true);
    assert.deepEqual(focusCalls, [{ preventScroll: true }]);

    nodeRef(null);
    assert.equal(registry.getElement(key), null);
  });

  test("renders locked selected nodes with disabled state", () => {
    const selection = setSelection(createSelectionState("normal"), ["locked"]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          textNode("locked", { x: 10, y: 10, w: 20, h: 10 }, { locked: true }),
        ]),
        selection,
        focusedNodeId: "locked",
        onNodePointerDown: () => undefined,
      }),
    );

    assert.match(html, /aria-disabled="true"/);
    assert.match(
      html,
      /data-node-id="locked"[^>]*style="[^"]*cursor:not-allowed/,
    );
    assert.match(html, /data-node-chrome-frame="selected"/);
    assert.match(html, /border:2px dashed var\(--ds-accent-fill, #6366f1\)/);
  });

  test("renders generated chrome without intercepting pointer events", () => {
    const html = renderToStaticMarkup(
      createElement(SlideNodeRenderer, {
        node: textNode(
          "deck-chrome-footer",
          { x: 0, y: 90, w: 100, h: 10 },
          { source: "deckChrome", chromeKind: "footer" },
        ),
      }),
    );

    assert.match(html, /pointer-events:none/);
    assert.match(html, /aria-hidden="true"/);
  });

  test("renders foreground chrome in z-index order", () => {
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: {
          ...slide([]),
          chrome: [
            textNode(
              "deck-chrome-pageNumber",
              { x: 90, y: 90, w: 6, h: 5 },
              {
                source: "deckChrome",
                chromeKind: "pageNumber",
                layout: { frame: { x: 90, y: 90, w: 6, h: 5 }, zIndex: 910 },
              },
            ),
            textNode(
              "deck-chrome-footer",
              { x: 10, y: 90, w: 80, h: 5 },
              {
                source: "deckChrome",
                chromeKind: "footer",
                layout: { frame: { x: 10, y: 90, w: 80, h: 5 }, zIndex: 900 },
              },
            ),
          ],
        },
      }),
    );

    assert.ok(
      html.indexOf("deck-chrome-footer") <
        html.indexOf("deck-chrome-pageNumber"),
    );
  });

  test("prefers precomputed render lists when available", () => {
    const precomputedLists: ResolvedSlideRenderLists = {
      decorations: [
        textNode(
          "precomputed-decoration",
          { x: 0, y: 0, w: 20, h: 10 },
          { source: "themeDecoration" },
        ),
      ],
      backgroundChrome: [
        textNode(
          "precomputed-background-chrome",
          { x: 0, y: 90, w: 100, h: 5 },
          {
            source: "deckChrome",
            chromeKind: "watermark",
            layout: { frame: { x: 0, y: 90, w: 100, h: 5 }, zIndex: -10 },
          },
        ),
      ],
      foregroundChrome: [
        textNode(
          "precomputed-foreground-chrome",
          { x: 0, y: 95, w: 100, h: 5 },
          {
            source: "deckChrome",
            chromeKind: "footer",
            layout: { frame: { x: 0, y: 95, w: 100, h: 5 }, zIndex: 900 },
          },
        ),
      ],
      userNodes: [textNode("precomputed-user", { x: 30, y: 30, w: 20, h: 10 })],
    };
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: {
          ...slide([textNode("fallback-user", { x: 10, y: 10, w: 20, h: 10 })]),
          decorations: [
            textNode("fallback-decoration", { x: 0, y: 0, w: 100, h: 100 }),
          ],
          chrome: [
            textNode("fallback-foreground-chrome", {
              x: 10,
              y: 90,
              w: 80,
              h: 5,
            }),
          ],
          renderLists: precomputedLists,
        },
      }),
    );

    assert.match(html, /precomputed-decoration/);
    assert.match(html, /precomputed-background-chrome/);
    assert.match(html, /precomputed-user/);
    assert.match(html, /precomputed-foreground-chrome/);
    assert.doesNotMatch(html, /fallback-decoration/);
    assert.doesNotMatch(html, /fallback-user/);
    assert.doesNotMatch(html, /fallback-foreground-chrome/);
    assert.ok(
      html.indexOf("precomputed-decoration") <
        html.indexOf("precomputed-background-chrome"),
    );
    assert.ok(
      html.indexOf("precomputed-background-chrome") <
        html.indexOf("precomputed-user"),
    );
    assert.ok(
      html.indexOf("precomputed-user") <
        html.indexOf("precomputed-foreground-chrome"),
    );
  });

  test("renders hover chrome as a separate preselection frame", () => {
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([textNode("hovered", { x: 10, y: 10, w: 20, h: 10 })]),
        hoveredNodeId: "hovered",
      }),
    );

    assert.match(html, /data-node-chrome-frame="preselected"/);
    assert.match(html, /border:2px solid var\(--ds-accent-fill, #6366f1\)/);
  });

  test("renders slide preselection and selection frames", () => {
    const preselectedHtml = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([textNode("node-1", { x: 10, y: 10, w: 20, h: 10 })]),
        slideHovered: true,
      }),
    );
    const selectedHtml = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([textNode("node-1", { x: 10, y: 10, w: 20, h: 10 })]),
        slideSelected: true,
      }),
    );

    assert.match(preselectedHtml, /data-slide-hovered="true"/);
    assert.match(selectedHtml, /data-slide-selected="true"/);
    assert.match(preselectedHtml, /data-slide-chrome-frame="preselected"/);
    assert.match(selectedHtml, /data-slide-chrome-frame="selected"/);
    assert.match(
      preselectedHtml,
      /border:2px solid var\(--ds-accent-fill, #6366f1\)/,
    );
    assert.match(
      selectedHtml,
      /border:2px solid var\(--ds-accent-fill, #6366f1\)/,
    );
  });

  test("renders a multi-selection bounding box", () => {
    const selection = setSelection(createSelectionState("normal"), ["a", "b"]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          textNode("a", { x: 10, y: 10, w: 20, h: 10 }),
          textNode("b", { x: 40, y: 30, w: 20, h: 10 }),
        ]),
        selection,
        focusedNodeId: "a",
        onResizeHandlePointerDown: () => undefined,
        onMultiResizeHandlePointerDown: () => undefined,
        onMultiRotationHandlePointerDown: () => undefined,
      }),
    );

    assert.match(html, /data-multi-selection-bounds="true"/);
    assert.match(html, /border-2 border-dashed border-ds-accent-fill/);
    assert.match(html, /pointer-events-auto/);
    assert.match(html, /left:10%/);
    assert.match(html, /top:10%/);
    assert.match(html, /width:50%/);
    assert.match(html, /height:30%/);
    assert.match(html, /data-multi-resize-handle="nw"/);
    assert.match(html, /data-multi-resize-handle="se"/);
    assert.match(html, /data-multi-rotation-handle="true"/);
    assert.doesNotMatch(html, /data-node-chrome-overlay="resize"/);
  });

  test("renders crop handles for a selected image", () => {
    const selection = setSelection(createSelectionState("normal"), ["image-1"]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([imageNode("image-1", { x: 10, y: 10, w: 30, h: 20 })]),
        selection,
        focusedNodeId: "image-1",
        onCropHandlePointerDown: () => undefined,
      }),
    );

    assert.match(html, /data-crop-handle="top"/);
    assert.match(
      html,
      /data-crop-handle="top"[^>]*style="[^"]*cursor:ns-resize/,
    );
    assert.match(html, /data-crop-handle="right"/);
    assert.match(
      html,
      /data-crop-handle="right"[^>]*style="[^"]*cursor:ew-resize/,
    );
    assert.match(html, /data-crop-handle="bottom"/);
    assert.match(html, /data-crop-handle="left"/);
  });

  test("renders active resize handles for selected unlocked nodes", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "resizable",
    ]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          textNode("resizable", { x: 10, y: 10, w: 30, h: 20 }),
          textNode(
            "locked-resizable",
            { x: 50, y: 10, w: 20, h: 10 },
            { locked: true },
          ),
        ]),
        selection,
        focusedNodeId: "resizable",
        onResizeHandlePointerDown: () => undefined,
        activeResizeHandle: { nodeId: "resizable", handle: "se" },
      }),
    );

    assert.match(html, /data-resize-handle="nw"/);
    assert.match(html, /data-resize-handle="se"/);
    assert.match(
      html,
      /data-resize-handle="se"[^>]*style="[^"]*cursor:nwse-resize/,
    );
    assert.doesNotMatch(html, /locked-resizable-resize-overlay/);
  });

  test("renders rotation handle, connector endpoints, and active group chrome", () => {
    const shapeSelection = setSelection(createSelectionState("normal"), [
      "shape-1",
    ]);
    const connectorSelection = setSelection(createSelectionState("normal"), [
      "connector-1",
    ]);
    const nodes = [
      renderNode("group-1", { type: "group" }, {}, { type: "group" }),
      renderNode("shape-1", {
        type: "shape",
        content: { shape: "rect" },
      }),
      renderNode("connector-1", {
        type: "connector",
        content: {
          from: { kind: "point", point: { x: 0, y: 50 } },
          to: { kind: "point", point: { x: 100, y: 50 } },
        },
      }),
    ];
    const shapeHtml = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide(nodes),
        selection: shapeSelection,
        activeGroupId: "group-1",
        onRotationHandlePointerDown: () => undefined,
      }),
    );
    const connectorHtml = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide(nodes),
        selection: connectorSelection,
        onConnectorEndpointPointerDown: () => undefined,
      }),
    );

    assert.match(shapeHtml, /data-rotation-handle="true"/);
    assert.match(shapeHtml, /data-node-chrome-frame="activeGroup"/);
    assert.match(connectorHtml, /data-connector-endpoint="from"/);
    assert.match(connectorHtml, /data-connector-endpoint="to"/);
  });

  test("applies node transforms to selection and handle overlays", () => {
    const imageSelection = setSelection(createSelectionState("normal"), [
      "rotated-image",
    ]);
    const connectorSelection = setSelection(createSelectionState("normal"), [
      "rotated-connector",
    ]);
    const nodes = [
      imageNode(
        "rotated-image",
        { x: 10, y: 10, w: 20, h: 16 },
        {
          layout: {
            frame: { x: 10, y: 10, w: 20, h: 16 },
            zIndex: 2,
            rotation: 30,
            flipX: true,
            flipY: true,
          },
        },
      ),
      renderNode(
        "rotated-connector",
        {
          type: "connector",
          content: {
            from: { kind: "point", point: { x: 0, y: 50 } },
            to: { kind: "point", point: { x: 100, y: 50 } },
          },
        },
        {},
        {
          layout: {
            frame: { x: 48, y: 20, w: 28, h: 12 },
            zIndex: 3,
            rotation: 30,
            flipX: true,
            flipY: true,
          },
        },
      ),
    ];
    const imageHtml = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide(nodes),
        selection: imageSelection,
        onResizeHandlePointerDown: () => undefined,
        onCropHandlePointerDown: () => undefined,
        onRotationHandlePointerDown: () => undefined,
      }),
    );
    const connectorHtml = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide(nodes),
        selection: connectorSelection,
        onConnectorEndpointPointerDown: () => undefined,
      }),
    );

    assert.match(
      imageHtml,
      /data-node-chrome-frame="selected"[^>]*data-node-id="rotated-image"[^>]*transform:rotate\(30deg\) scaleX\(-1\) scaleY\(-1\);transform-origin:center/,
    );
    assert.match(
      imageHtml,
      /data-node-chrome-overlay="resize"[^>]*data-node-id="rotated-image"[^>]*transform:rotate\(30deg\) scaleX\(-1\) scaleY\(-1\);transform-origin:center/,
    );
    assert.match(
      imageHtml,
      /data-node-chrome-overlay="rotation"[^>]*data-node-id="rotated-image"[^>]*transform:rotate\(30deg\) scaleX\(-1\) scaleY\(-1\);transform-origin:center/,
    );
    assert.match(
      imageHtml,
      /data-node-chrome-overlay="crop"[^>]*data-node-id="rotated-image"[^>]*transform:rotate\(30deg\) scaleX\(-1\) scaleY\(-1\);transform-origin:center/,
    );
    assert.match(
      connectorHtml,
      /data-node-chrome-overlay="connector-endpoints"[^>]*data-node-id="rotated-connector"[^>]*transform:rotate\(30deg\) scaleX\(-1\) scaleY\(-1\);transform-origin:center/,
    );
  });

  test("includes rotated node geometry when drawing multi-selection bounds", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "rotated",
      "plain",
    ]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          textNode(
            "rotated",
            { x: 10, y: 10, w: 20, h: 10 },
            {
              layout: {
                frame: { x: 10, y: 10, w: 20, h: 10 },
                zIndex: 1,
                rotation: 90,
              },
            },
          ),
          textNode("plain", { x: 40, y: 30, w: 20, h: 10 }),
        ]),
        selection,
      }),
    );
    const multiBoundsStyleMatch = html.match(
      /border-dashed border-ds-accent-fill[^>]*style="([^"]+)"/,
    );
    assert.ok(multiBoundsStyleMatch);
    const multiBoundsStyle = multiBoundsStyleMatch[1];
    const left = Number(multiBoundsStyle.match(/left:([^;%]+)%/)?.[1]);
    const top = Number(multiBoundsStyle.match(/top:([^;%]+)%/)?.[1]);
    const width = Number(multiBoundsStyle.match(/width:([^;%]+)%/)?.[1]);
    const height = Number(multiBoundsStyle.match(/height:([^;%]+)%/)?.[1]);

    assert.ok(Math.abs(left - 15) < 0.001);
    assert.ok(Math.abs(top - 5) < 0.001);
    assert.ok(Math.abs(width - 45) < 0.001);
    assert.ok(Math.abs(height - 35) < 0.001);
  });

  test("renders a deterministic dense stage chrome regression signature", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "overlap-image",
      "overlap-connector",
    ]);
    const denseSlide: ResolvedSlideRenderTree = {
      ...slide([
        textNode("overlap-text", { x: 18, y: 18, w: 42, h: 14 }),
        imageNode("overlap-image", { x: 34, y: 24, w: 34, h: 24 }),
        renderNode("overlap-connector", {
          type: "connector",
          content: {
            from: { kind: "point", point: { x: 0, y: 50 } },
            to: { kind: "point", point: { x: 100, y: 50 } },
            routing: "elbow",
          },
        }),
        textNode("inline-edit-source", { x: 20, y: 54, w: 48, h: 10 }),
      ]),
      background: {
        fill: { type: "solid", color: "#f8fafc" },
        decorationLevel: "expressive",
      },
      decorations: [
        textNode(
          "decoration-grid",
          { x: 0, y: 0, w: 100, h: 100 },
          {
            source: "themeDecoration",
            role: "themeDecoration",
            layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: -80 },
          },
        ),
      ],
      chrome: [
        textNode(
          "deck-chrome-watermark",
          { x: 12, y: 42, w: 76, h: 14 },
          {
            source: "deckChrome",
            chromeKind: "watermark",
            layout: { frame: { x: 12, y: 42, w: 76, h: 14 }, zIndex: -30 },
          },
        ),
        textNode(
          "deck-chrome-footer",
          { x: 6, y: 91, w: 88, h: 5 },
          {
            source: "deckChrome",
            chromeKind: "footer",
            layout: { frame: { x: 6, y: 91, w: 88, h: 5 }, zIndex: 900 },
          },
        ),
      ],
    };

    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: denseSlide,
        selection,
        hoveredNodeId: "overlap-text",
        focusedNodeId: "overlap-image",
        hiddenNodeIds: new Set(["inline-edit-source"]),
        onMultiResizeHandlePointerDown: () => undefined,
        onMultiRotationHandlePointerDown: () => undefined,
        onCropHandlePointerDown: () => undefined,
        onRotationHandlePointerDown: () => undefined,
        onConnectorEndpointPointerDown: () => undefined,
      }),
    );

    assert.ok(
      html.indexOf("decoration-grid") < html.indexOf("deck-chrome-watermark"),
    );
    assert.ok(
      html.indexOf("deck-chrome-watermark") < html.indexOf("overlap-text"),
    );
    assert.ok(
      html.indexOf("overlap-connector") < html.indexOf("deck-chrome-footer"),
    );
    assert.match(html, /data-node-chrome-frame="preselected"/);
    assert.match(html, /data-node-chrome-frame="selected"/);
    assert.match(html, /border-2 border-dashed border-ds-accent-fill/);
    assert.match(html, /data-multi-resize-handle="nw"/);
    assert.match(html, /data-multi-rotation-handle="true"/);
    assert.doesNotMatch(html, /data-crop-handle="top"/);
    assert.doesNotMatch(html, /data-connector-endpoint="from"/);
    assert.match(
      html,
      /data-node-id="inline-edit-source"[^>]*visibility:hidden/,
    );
  });

  test("keeps selected stage chrome for hidden nodes during inline edit", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "visible-image",
      "hidden-image",
      "visible-connector",
      "hidden-connector",
    ]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          imageNode("visible-image", { x: 10, y: 10, w: 20, h: 20 }),
          imageNode("hidden-image", { x: 35, y: 10, w: 20, h: 20 }),
          renderNode("visible-connector", {
            type: "connector",
            content: {
              from: { kind: "point", point: { x: 0, y: 50 } },
              to: { kind: "point", point: { x: 100, y: 50 } },
            },
          }),
          renderNode("hidden-connector", {
            type: "connector",
            content: {
              from: { kind: "point", point: { x: 0, y: 50 } },
              to: { kind: "point", point: { x: 100, y: 50 } },
            },
          }),
          textNode("hidden-hover", { x: 20, y: 45, w: 20, h: 10 }),
        ]),
        selection,
        hoveredNodeId: "hidden-hover",
        hiddenNodeIds: new Set([
          "hidden-image",
          "hidden-connector",
          "hidden-hover",
        ]),
        onNodePointerDown: () => undefined,
        onMultiResizeHandlePointerDown: () => undefined,
        onMultiRotationHandlePointerDown: () => undefined,
        onResizeHandlePointerDown: () => undefined,
        onCropHandlePointerDown: () => undefined,
        onRotationHandlePointerDown: () => undefined,
        onConnectorEndpointPointerDown: () => undefined,
      }),
    );

    assert.match(html, /data-node-id="hidden-image"[^>]*visibility:hidden/);
    assert.equal(
      (html.match(/data-node-chrome-frame="selected"/g) ?? []).length,
      4,
    );
    assert.equal((html.match(/data-resize-handle="nw"/g) ?? []).length, 0);
    assert.equal((html.match(/data-crop-handle="top"/g) ?? []).length, 0);
    assert.equal((html.match(/data-rotation-handle="true"/g) ?? []).length, 0);
    assert.equal(
      (html.match(/data-connector-endpoint="from"/g) ?? []).length,
      0,
    );
    assert.equal(
      (html.match(/data-multi-resize-handle="nw"/g) ?? []).length,
      1,
    );
    assert.equal((html.match(/data-node-move-handle="top"/g) ?? []).length, 2);
    assert.match(
      html,
      /data-node-chrome-frame="selected"[^>]*data-node-id="visible-image"/,
    );
    assert.match(
      html,
      /data-node-chrome-frame="selected"[^>]*data-node-id="hidden-image"/,
    );
    assert.match(
      html,
      /data-node-chrome-frame="selected"[^>]*data-node-id="hidden-connector"/,
    );
    assert.doesNotMatch(
      html,
      /data-node-chrome-frame="preselected"[^>]*data-node-id="hidden-hover"/,
    );
  });

  test("places connector endpoint handles from node-anchor bindings", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "connector-anchors",
    ]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          renderNode("connector-anchors", {
            type: "connector",
            content: {
              from: { kind: "node", nodeId: "shape-a", anchor: "right" },
              to: { kind: "node", nodeId: "shape-b", anchor: "top" },
            },
          }),
        ]),
        selection,
        onConnectorEndpointPointerDown: () => undefined,
      }),
    );

    assert.match(
      html,
      /data-connector-endpoint="from"[^>]*style="[^"]*left:100%;top:50%/,
    );
    assert.match(
      html,
      /data-connector-endpoint="to"[^>]*style="[^"]*left:50%;top:0%/,
    );
  });

  test("renders transient frame and rotation drafts for live gesture feedback", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "shape-draft",
    ]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          renderNode("shape-draft", {
            type: "shape",
            content: { shape: "rect" },
          }),
        ]),
        selection,
        nodeGestureDrafts: new Map<string, SlideCanvasNodeGestureDraft>([
          [
            "shape-draft",
            {
              frame: { x: 22, y: 24, w: 33, h: 19 },
              rotation: 45,
            },
          ],
        ]),
      }),
    );

    assert.match(
      html,
      /data-node-id="shape-draft"[^>]*style="[^"]*left:22%;top:24%;width:33%;height:19%/,
    );
    assert.match(html, /rotate\(45deg\)/);
  });

  test("renders transient crop and connector drafts for live gesture feedback", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "connector-draft",
    ]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          imageNode("image-draft", { x: 8, y: 8, w: 30, h: 20 }),
          renderNode("connector-draft", {
            type: "connector",
            content: {
              from: { kind: "point", point: { x: 0, y: 50 } },
              to: { kind: "point", point: { x: 100, y: 50 } },
            },
          }),
        ]),
        selection,
        onConnectorEndpointPointerDown: () => undefined,
        assetResolver: () => "https://example.com/image.png",
        nodeGestureDrafts: new Map<string, SlideCanvasNodeGestureDraft>([
          [
            "image-draft",
            {
              crop: { top: 6, right: 4, bottom: 10, left: 8 },
            },
          ],
          [
            "connector-draft",
            {
              connectorEndpoints: {
                from: { kind: "point", point: { x: 25, y: 75 } },
              },
            },
          ],
        ]),
      }),
    );

    assert.match(
      html,
      /style="[^"]*width:112%;height:116%;[^"]*left:-8%;top:-6%/,
    );
    assert.match(
      html,
      /data-connector-endpoint="from"[^>]*style="[^"]*left:25%;top:75%/,
    );
  });

  test("preview canvases suppress interaction chrome and keyboard roles", () => {
    const selection = setSelection(createSelectionState("normal"), [
      "preview-image",
      "preview-connector",
    ]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          imageNode("preview-image", { x: 10, y: 10, w: 30, h: 20 }),
          renderNode("preview-connector", {
            type: "connector",
            content: {
              from: { kind: "point", point: { x: 0, y: 50 } },
              to: { kind: "point", point: { x: 100, y: 50 } },
            },
          }),
        ]),
        selection,
        preview: true,
        onCropHandlePointerDown: () => undefined,
        onRotationHandlePointerDown: () => undefined,
        onConnectorEndpointPointerDown: () => undefined,
      }),
    );

    assert.doesNotMatch(html, /role="button"/);
    assert.doesNotMatch(html, /data-crop-handle/);
    assert.doesNotMatch(html, /data-rotation-handle/);
    assert.doesNotMatch(html, /data-connector-endpoint/);
  });

  test("renders editable table cells with roving cell metadata", () => {
    const selection = setSelection(createSelectionState("normal"), ["table-1"]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          renderNode("table-1", {
            type: "table",
            content: {
              columns: [
                { id: "col-1", label: "A" },
                { id: "col-2", label: "B" },
              ],
              rows: [
                {
                  id: "row-1",
                  cells: [
                    { text: "Alpha" },
                    {
                      text: "Beta",
                      runs: [{ text: "Be", bold: true }, { text: "ta" }],
                    },
                  ],
                },
              ],
            },
          }),
        ]),
        selection,
        tableEditingNodeId: "table-1",
        activeTableCell: { rowIndex: 0, colIndex: 1 },
        onNodePointerDown: () => undefined,
        onTableCellFocus: () => undefined,
        onTableCellCommit: () => undefined,
        onTableCellKeyDown: () => undefined,
      }),
    );

    assert.match(html, /contentEditable="true"/);
    assert.match(html, /data-table-cell="0:1"/);
    assert.match(html, /aria-label="Table cell row 1, column 2, content Beta"/);
    assert.match(html, /Beta/);
    assert.match(html, /Table node editing cells/);
    assert.match(
      html,
      /class="[^"]*focus-visible:ring-ds-focus-ring[^"]*motion-reduce:transition-none[^"]*"[^>]*data-table-cell="0:1"/,
    );
  });

  test("renders editable table cells with header context and content preview", () => {
    const selection = setSelection(createSelectionState("normal"), ["table-1"]);
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          renderNode("table-1", {
            type: "table",
            content: {
              caption: "Quarterly results",
              header: true,
              columns: [
                { id: "region", label: "Region" },
                { id: "revenue", label: "Revenue" },
              ],
              rows: [
                {
                  id: "row-1",
                  cells: [{ text: "North" }, { text: "Up 42 percent" }],
                },
                {
                  id: "row-2",
                  cells: [{ text: "South" }, { text: "" }],
                },
              ],
            },
          }),
        ]),
        selection,
        tableEditingNodeId: "table-1",
        activeTableCell: { rowIndex: 0, colIndex: 1 },
        onNodePointerDown: () => undefined,
      }),
    );

    assert.match(
      html,
      /aria-label="Table cell row 1, column 2, table Quarterly results, column header Revenue, row header North, content Up 42 percent"/,
    );
    assert.match(
      html,
      /aria-label="Table cell row 2, column 2, table Quarterly results, column header Revenue, row header South, content empty"/,
    );
  });

  test("keeps read-only table rendering free of edit metadata and stage overlays", () => {
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          renderNode("table-readonly", {
            type: "table",
            content: {
              columns: [
                { id: "col-1", label: "A" },
                { id: "col-2", label: "B" },
              ],
              rows: [
                {
                  id: "row-1",
                  cells: [{ text: "Alpha" }, { text: "Beta" }],
                },
              ],
            },
          }),
        ]),
      }),
    );

    assert.match(html, /Alpha/);
    assert.match(html, /Beta/);
    assert.doesNotMatch(html, /contentEditable="true"/);
    assert.doesNotMatch(html, /data-table-cell=/);
    assert.doesNotMatch(html, /data-node-chrome-frame=/);
    assert.doesNotMatch(html, /data-node-chrome-overlay=/);
  });

  test("renders paragraph list markers from numbered-list semantics", () => {
    const node = textNode("list-node", { x: 10, y: 10, w: 40, h: 20 });
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([
          {
            ...node,
            content: {
              type: "text",
              content: {
                paragraphs: [
                  { id: "p1", text: "First", list: { kind: "bullet" } },
                  { id: "p2", text: "Second", list: { kind: "number" } },
                  {
                    id: "p3",
                    text: "Third",
                    list: { kind: "number", numberStyle: "lower-alpha" },
                  },
                  { id: "p4", text: "Break" },
                  {
                    id: "p5",
                    text: "Fourth",
                    list: { kind: "number", numberStyle: "lower-roman" },
                  },
                ],
              },
            },
          },
        ]),
      }),
    );

    assert.match(html, />•<\/span>/);
    assert.match(html, />1\.<\/span><span>Second<\/span>/);
    assert.match(html, />b\.<\/span><span>Third<\/span>/);
    assert.match(html, />i\.<\/span><span>Fourth<\/span>/);
  });

  test("renders supported background fill styles and deck canvas fallbacks", () => {
    const fills: ResolvedSlideRenderTree["background"]["fill"][] = [
      { type: "solid", color: "#ffffff" },
      {
        type: "linearGradient",
        from: "#111111",
        to: "#eeeeee",
        stops: [
          { color: "#111111", offsetPct: 0 },
          { color: "#eeeeee", offsetPct: 100 },
        ],
      },
      {
        type: "radialGradient",
        inner: "#111111",
        outer: "#eeeeee",
        cx: 45,
        cy: 55,
      },
      {
        type: "conicGradient",
        stops: [
          { color: "#111111", offsetPct: 0 },
          { color: "#eeeeee", offsetPct: 100 },
        ],
      },
      {
        type: "repeatingLinearGradient",
        angle: 45,
        stops: [
          { color: "#111111", offsetPct: 0 },
          { color: "#eeeeee", offsetPct: 20 },
        ],
      },
      {
        type: "pattern",
        kind: "grid",
        color: "#94a3b8",
        background: "#ffffff",
      },
      {
        type: "pattern",
        kind: "dots",
        color: "#94a3b8",
        background: "#ffffff",
      },
      {
        type: "pattern",
        kind: "scanlines",
        color: "#94a3b8",
        background: "#ffffff",
      },
      { type: "image", assetId: "bg", opacity: 0.4 },
    ];
    const html = fills
      .map((fill) =>
        renderToStaticMarkup(
          createElement(SlideCanvas, {
            slide: {
              ...slide([]),
              background: { fill, decorationLevel: "expressive" },
            },
            canvas: { format: "custom", width: 0, height: 0, unit: "percent" },
            assetResolver: (assetId) => `https://example.com/${assetId}.png`,
            className: "custom-canvas",
          }),
        ),
      )
      .join("\n");
    const deckHtml = renderToStaticMarkup(
      createElement(DeckCanvas, {
        deck: {
          canvas: {
            format: "16:9",
            width: 100,
            height: 56.25,
            unit: "percent",
          },
          theme: {
            tokens: {
              colors: {
                canvas: {
                  fill: "#fff",
                  text: "#111",
                  mutedText: "#666",
                },
                surface: {
                  fill: "#fff",
                  text: "#111",
                  mutedText: "#666",
                },
                accent: { fill: "#2563eb", text: "#fff" },
              },
              fonts: { heading: "Inter", body: "Inter" },
            },
            packageId: "test",
          },
          diagnostics: [],
          slides: [
            slide([textNode("deck-node", { x: 1, y: 1, w: 10, h: 10 })]),
          ],
        },
        activeSlideIndex: 0,
        onNodePointerDown: () => undefined,
        onResizeHandlePointerDown: () => undefined,
        className: "deck-canvas",
      }),
    );
    const missingDeckHtml = renderToStaticMarkup(
      createElement(DeckCanvas, {
        deck: {
          canvas: {
            format: "16:9",
            width: 100,
            height: 56.25,
            unit: "percent",
          },
          theme: {
            tokens: {
              colors: {
                canvas: {
                  fill: "#fff",
                  text: "#111",
                  mutedText: "#666",
                },
                surface: {
                  fill: "#fff",
                  text: "#111",
                  mutedText: "#666",
                },
                accent: { fill: "#2563eb", text: "#fff" },
              },
              fonts: { heading: "Inter", body: "Inter" },
            },
            packageId: "test",
          },
          diagnostics: [],
          slides: [],
        },
        activeSlideIndex: 4,
      }),
    );

    assert.match(html, /linear-gradient/);
    assert.match(html, /radial-gradient/);
    assert.match(html, /conic-gradient/);
    assert.match(html, /repeating-linear-gradient/);
    assert.match(html, /bg.png/);
    assert.match(deckHtml, /deck-canvas/);
    assert.equal(missingDeckHtml, "");
  });

  test("renders a semantic screen-reader deck outline near the stage", () => {
    const selection = setSelection(createSelectionState("normal"), ["body-2"]);
    const deck: ResolvedDeckRenderTree = {
      canvas: {
        format: "16:9",
        width: 100,
        height: 56.25,
        unit: "percent",
      },
      theme: {
        tokens: {
          colors: {
            canvas: { fill: "#fff", text: "#111", mutedText: "#666" },
            surface: { fill: "#fff", text: "#111", mutedText: "#666" },
            accent: { fill: "#2563eb", text: "#fff" },
          },
          fonts: { heading: "Inter", body: "Inter" },
        },
        packageId: "test",
      },
      diagnostics: [],
      slides: [
        {
          ...slide([
            textNode(
              "intro-body",
              { x: 20, y: 20, w: 40, h: 12 },
              {
                accessibility: { readingOrder: 2 },
              },
            ),
            textNode(
              "intro-title",
              { x: 10, y: 10, w: 50, h: 10 },
              {
                role: "title",
                content: {
                  type: "text",
                  content: {
                    paragraphs: [{ id: "intro-title-p1", text: "Overview" }],
                  },
                },
                accessibility: { readingOrder: 1 },
              },
            ),
          ]),
          id: "slide-overview",
        },
        {
          ...slide([
            textNode(
              "title-2",
              { x: 10, y: 10, w: 50, h: 10 },
              {
                role: "title",
                content: {
                  type: "text",
                  content: {
                    paragraphs: [{ id: "title-2-p1", text: "Roadmap" }],
                  },
                },
                accessibility: { readingOrder: 1 },
              },
            ),
            textNode(
              "body-2",
              { x: 20, y: 24, w: 44, h: 14 },
              {
                content: {
                  type: "text",
                  content: {
                    paragraphs: [
                      { id: "body-2-p1", text: "Ship accessible stage" },
                    ],
                  },
                },
                accessibility: { readingOrder: 2 },
              },
            ),
            imageNode(
              "image-2",
              { x: 60, y: 24, w: 20, h: 20 },
              {
                content: {
                  type: "image",
                  content: { assetId: "image-2", alt: "Architecture diagram" },
                },
                accessibility: { readingOrder: 3 },
              },
            ),
          ]),
          id: "slide-roadmap",
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(DeckCanvas, {
        deck,
        activeSlideIndex: 1,
        selection,
        onNodePointerDown: () => undefined,
      }),
    );

    assert.match(html, /data-deck-outline-region="true" role="region"/);
    assert.match(
      html,
      /class="[^"]*sr-only motion-reduce:transition-none[^"]*focus-within:not-sr-only/,
    );
    assert.match(html, /Deck outline/);
    assert.match(
      html,
      /2 slides\. Current slide 2: Roadmap\. 2 texts, 1 image\./,
    );
    assert.match(html, /aria-label="Slides"/);
    assert.match(html, /aria-current="page"/);
    assert.match(
      html,
      /tabindex="0" class="[^"]*motion-reduce:transition-none[^"]*focus-visible:ring-ds-focus-ring[^"]*" aria-current="true" aria-label="text: Body: Ship accessible stage"/,
    );
    assert.match(html, /aria-label="image: Image: Architecture diagram"/);
    assert.ok(
      html.indexOf("Title: Roadmap") <
        html.indexOf("Body: Ship accessible stage"),
    );
    assert.ok(
      html.indexOf("Body: Ship accessible stage") <
        html.indexOf("Image: Architecture diagram"),
    );
  });

  test("applies image background fill opacity on a dedicated layer", () => {
    const html = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: {
          ...slide([
            textNode("foreground-node", { x: 10, y: 10, w: 20, h: 10 }),
          ]),
          background: {
            fill: { type: "image", assetId: "bg", opacity: 0.4 },
            decorationLevel: "none",
          },
        },
        assetResolver: (assetId) => `https://example.com/${assetId}.png`,
      }),
    );

    assert.match(html, /data-slide-background-fill-layer="image"/);
    assert.match(
      html,
      /data-slide-background-fill-layer="image"[^>]*background-image:url\(&quot;https:\/\/example\.com\/bg\.png&quot;\)/,
    );
    assert.match(
      html,
      /data-slide-background-fill-layer="image"[^>]*opacity:0.4/,
    );
    assert.doesNotMatch(html, /data-slide-canvas="true"[^>]*opacity:0.4/);
    assert.match(html, /foreground-node/);
  });

  test("renders deterministic filmstrip thumbnail coverage for editor layout regressions", () => {
    const renderTree: ResolvedDeckRenderTree = {
      canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
      theme: {
        packageId: "test-package",
        tokens: {
          colors: {
            canvas: { fill: "#ffffff", text: "#111111", mutedText: "#64748b" },
            surface: { fill: "#ffffff", text: "#111111", mutedText: "#64748b" },
            accent: { fill: "#2563eb", text: "#ffffff" },
          },
          fonts: { heading: "Inter", body: "Inter" },
        },
      },
      diagnostics: [],
      slides: [
        {
          ...slide([
            textNode("filmstrip-title", { x: 10, y: 10, w: 80, h: 12 }),
          ]),
          id: "filmstrip-title-slide",
        },
        {
          ...slide([
            textNode("filmstrip-overlap-a", { x: 18, y: 20, w: 42, h: 18 }),
            textNode("filmstrip-overlap-b", { x: 36, y: 30, w: 42, h: 18 }),
          ]),
          id: "filmstrip-dense",
          chrome: [
            textNode(
              "deck-chrome-pageNumber",
              { x: 80, y: 91, w: 14, h: 5 },
              {
                source: "deckChrome",
                chromeKind: "pageNumber",
                layout: { frame: { x: 80, y: 91, w: 14, h: 5 }, zIndex: 910 },
              },
            ),
          ],
        },
        {
          ...slide([
            imageNode("filmstrip-image", { x: 12, y: 18, w: 76, h: 48 }),
          ]),
          id: "filmstrip-image-slide",
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(Filmstrip, {
        renderTree,
        activeSlideIndex: 1,
        collapsed: false,
        onSelectSlide: () => undefined,
        onInsertSlide: () => undefined,
        onDuplicateSlide: () => undefined,
        onDeleteSlide: () => undefined,
        onMoveSlide: () => undefined,
      }),
    );
    const collapsedHtml = renderToStaticMarkup(
      createElement(Filmstrip, {
        renderTree,
        activeSlideIndex: 1,
        collapsed: true,
        onSelectSlide: () => undefined,
        onInsertSlide: () => undefined,
        onDuplicateSlide: () => undefined,
        onDeleteSlide: () => undefined,
        onMoveSlide: () => undefined,
      }),
    );

    assert.match(html, /aria-label="Slide filmstrip"/);
    assert.match(html, /aria-label="Slides"/);
    assert.doesNotMatch(html, /role="listbox"/);
    assert.doesNotMatch(html, /role="option"/);
    assert.match(html, /data-slide-index="0"/);
    assert.match(html, /data-slide-index="1"/);
    assert.match(html, /data-slide-index="2"/);
    assert.match(html, /Go to slide 2/);
    assert.match(html, /deck-chrome-pageNumber/);
    assert.match(html, /data-filmstrip-thumbnail-canvas="true"/);
    assert.match(html, /width:960px/);
    assert.match(html, /height:540px/);
    assert.match(html, /transform:scale\(0\.13333333333333333\)/);
    assert.match(html, /aria-label="Add slide"/);
    assert.match(collapsedHtml, /aria-hidden="true"/);
    assert.match(collapsedHtml, /tabindex="-1"/);
  });
});

describe("SlideNodeRenderer resolved node content branches", () => {
  test("converts fill, effect, stroke, radius, shadow, and blend styles to CSS", () => {
    const styles = [
      styleObjectToContainerCss({
        fill: { type: "solid", color: "#ffffff" },
        stroke: { color: "#111827", widthPt: 2, dash: "dotted" },
        radius: { allPt: 8 },
        shadow: { xPt: 1, yPt: 2, blurPt: 4, color: "#000000" },
        effect: { kind: "glass", intensity: "strong" },
        opacity: 0.8,
        clip: { enabled: true },
        blendMode: "multiply",
      }),
      styleObjectToContainerCss({
        fill: {
          type: "linearGradient",
          angle: 45,
          from: "#000000",
          to: "#ffffff",
          stops: [
            { color: "#111111", offsetPct: 0 },
            { color: "#eeeeee", offsetPct: 100 },
          ],
        },
        radius: {
          topLeftPt: 1,
          topRightPt: 2,
          bottomRightPt: 3,
          bottomLeftPt: 4,
        },
        effect: { kind: "blur", radiusPt: 3 },
      }),
      styleObjectToContainerCss({
        fill: {
          type: "radialGradient",
          inner: "#111111",
          outer: "#eeeeee",
          cx: 45,
          cy: 55,
          r: 60,
        },
        effect: { kind: "glow", color: "#4f46e5", blurPt: 6 },
      }),
      styleObjectToContainerCss({
        fill: {
          type: "conicGradient",
          fromAngle: 90,
          stops: [
            { color: "#f00", offsetPct: 0 },
            { color: "#00f", offsetPct: 100 },
          ],
        },
      }),
      styleObjectToContainerCss({
        fill: {
          type: "repeatingLinearGradient",
          angle: 135,
          stops: [
            { color: "#f8fafc", offsetPct: 0 },
            { color: "#cbd5e1", offsetPct: 20 },
          ],
        },
      }),
      styleObjectToContainerCss({
        fill: {
          type: "pattern",
          kind: "grid",
          color: "#94a3b8",
          background: "#ffffff",
        },
      }),
      styleObjectToContainerCss({
        fill: {
          type: "pattern",
          kind: "dots",
          color: "#94a3b8",
          background: "#ffffff",
        },
      }),
      styleObjectToContainerCss({
        fill: {
          type: "pattern",
          kind: "stripes",
          color: "#94a3b8",
          background: "#ffffff",
        },
      }),
      styleObjectToContainerCss(
        { fill: { type: "image", assetId: "bg", opacity: 0.5 } },
        (assetId) => `https://example.com/${assetId}.png`,
      ),
    ];

    assert.match(String(styles[0].border), /dotted/);
    assert.match(String(styles[1].background), /linear-gradient/);
    assert.match(String(styles[2].background), /radial-gradient/);
    assert.match(String(styles[3].background), /conic-gradient/);
    assert.match(String(styles[4].background), /repeating-linear-gradient/);
    assert.match(String(styles[5].backgroundImage), /linear-gradient/);
    assert.match(String(styles[6].backgroundImage), /radial-gradient/);
    assert.match(
      String(styles[7].backgroundImage),
      /repeating-linear-gradient/,
    );
    assert.deepEqual(styles[8], {});
  });

  test("applies text vertical alignment and paragraph spacing in text and shape content", () => {
    const topText = renderResolvedNodeMarkup(
      renderNode(
        "text-top",
        {
          type: "text",
          content: { paragraphs: [{ id: "text-top-p1", text: "Top text" }] },
        },
        { text: { verticalAlign: "top" } },
      ),
    );
    const middleText = renderResolvedNodeMarkup(
      renderNode(
        "text-middle",
        {
          type: "text",
          content: {
            paragraphs: [{ id: "text-middle-p1", text: "Middle text" }],
          },
        },
        { text: { verticalAlign: "middle" } },
      ),
    );
    const bottomText = renderResolvedNodeMarkup(
      renderNode(
        "text-bottom",
        {
          type: "text",
          content: {
            paragraphs: [{ id: "text-bottom-p1", text: "Bottom text" }],
          },
        },
        { text: { verticalAlign: "bottom" } },
      ),
    );
    const spacedText = renderResolvedNodeMarkup(
      renderNode(
        "text-spacing",
        {
          type: "text",
          content: {
            paragraphs: [
              { id: "text-spacing-p1", text: "Paragraph one" },
              { id: "text-spacing-p2", text: "Paragraph two" },
            ],
          },
        },
        { text: { paragraphSpacingPt: 6 } },
      ),
    );
    assert.match(topText, /justify-content:flex-start/);
    assert.match(middleText, /justify-content:center/);
    assert.match(bottomText, /justify-content:flex-end/);
    assert.equal((spacedText.match(/margin-bottom:6pt/g) ?? []).length, 1);
  });

  test("hides shape nodes when they are marked hidden", () => {
    const hiddenShape = renderToStaticMarkup(
      createElement(SlideNodeRenderer, {
        node: renderNode("shape-hidden", {
          type: "shape",
          content: { shape: "rect" },
        }),
        hidden: true,
      }),
    );

    assert.match(
      hiddenShape,
      /data-node-id="shape-hidden"[^>]*visibility:hidden/,
    );
    assert.match(
      hiddenShape,
      /data-node-id="shape-hidden"[^>]*pointer-events:none/,
    );
  });

  test("renders text, shape, media, table, connector, visual, and group node content", () => {
    const richText = renderNode(
      "render-text",
      {
        type: "text",
        content: {
          paragraphs: [
            {
              id: "text-para",
              text: "rich text",
              list: { kind: "bullet", indent: 2 },
              runs: [
                {
                  text: "Docs",
                  bold: true,
                  italic: true,
                  underline: true,
                  strikethrough: true,
                  code: true,
                  link: "https://example.com",
                  localStyle: {
                    color: "#2563eb",
                    fontSizePt: 16,
                    fontFamily: "Inter",
                  },
                },
              ],
            },
          ],
        },
      },
      {
        text: {
          fontFamily: "Inter",
          fontSizePt: 14,
          weight: 600,
          italic: true,
          underline: true,
          color: "#111827",
          lineHeight: 1.2,
          align: "center",
          letterSpacingEm: 0.02,
          textTransform: "uppercase",
        },
      },
    );
    const shape = renderNode(
      "render-shape",
      {
        type: "shape",
        content: {
          shape: "path",
          path: "M 0 0 L 100 0 L 50 100 Z",
        },
      },
      {
        fill: { type: "solid", color: "#dbeafe" },
        stroke: { color: "#2563eb", widthPt: 2 },
      },
    );
    const table = renderNode(
      "render-table",
      {
        type: "table",
        content: {
          columns: [
            { id: "metric", label: "Metric" },
            { id: "value", label: "Value" },
          ],
          rows: [
            {
              id: "row-1",
              cells: [
                { text: "Revenue" },
                { text: "42", runs: [{ text: "42", bold: true }] },
              ],
            },
            { id: "row-2", cells: [{ text: "Cost" }, { text: "12" }] },
          ],
          header: true,
        },
      },
      {
        table: {
          headerFill: { type: "solid", color: "#0f172a" },
          rowFill: { type: "solid", color: "#f8fafc" },
          alternateRowFill: { type: "solid", color: "#e0e7ff" },
          border: { color: "#cbd5e1", widthPt: 1 },
          cellPaddingPt: { top: 1, right: 2, bottom: 1, left: 2 },
        },
      },
    );
    const connector = renderNode(
      "render-connector",
      {
        type: "connector",
        content: {
          from: { kind: "node", nodeId: "a", anchor: "left" },
          to: { kind: "node", nodeId: "b", anchor: "bottom" },
          routing: "curved",
        },
      },
      {
        connector: {
          stroke: { color: "#334155", widthPt: 2, dash: "dashed" },
          startArrow: "filled",
          endArrow: "arrow",
        },
      },
    );
    const image = renderNode(
      "render-image",
      {
        type: "image",
        content: {
          assetId: "asset-image",
          alt: "Resolved image",
          fit: "contain",
          crop: { top: 5, right: 10, bottom: 15, left: 20 },
        },
      },
      { image: { brightness: 1.1, contrast: 0.9, saturation: 1.2 } },
    );
    const missingImage = renderNode("render-image-missing", {
      type: "image",
      content: { assetId: "missing-image", alt: "Missing image" },
    });
    const visual = renderNode("render-visual", {
      type: "visual",
      content: {
        assetId: "asset-visual",
        visualId: "chart-1",
        alt: "Resolved visual",
      },
    });
    const missingVisual = renderNode("render-visual-missing", {
      type: "visual",
      content: { visualId: "chart-2", alt: "Missing visual" },
    });
    const group = renderNode("render-group", { type: "group" });

    const html = [
      richText,
      shape,
      table,
      connector,
      image,
      missingImage,
      visual,
      missingVisual,
      group,
    ]
      .map((node) =>
        renderToStaticMarkup(
          createElement(SlideNodeRenderer, {
            node,
            selected: true,
            hovered: true,
            focused: true,
            interactive: true,
            tabIndex: 0,
            onDoubleClick: () => undefined,
            onPointerDown: () => undefined,
            onFocus: () => undefined,
            assetResolver: (assetId) =>
              assetId.startsWith("missing")
                ? undefined
                : `https://example.com/${assetId}.png`,
          }),
        ),
      )
      .join("\n");

    assert.match(html, /href="https:\/\/example.com"/);
    assert.doesNotMatch(html, /Shape label/);
    assert.match(html, /Revenue/);
    assert.match(html, /connector-start-arrow-presentation-render-connector/);
    assert.match(html, /Resolved image/);
    assert.match(html, /Missing image/);
    assert.match(html, /Resolved visual/);
    assert.match(html, /Missing visual/);
    assert.match(html, /data-node-type="group"/);
  });
});

describe("SlideCanvas E01 rendering coverage", () => {
  test("converts rich container styles for fills, effects, borders, and media backgrounds", () => {
    const assetResolver = (assetId: string) =>
      assetId === "hero" ? "https://example.com/hero.png" : undefined;
    const cases: StyleObject[] = [
      {
        fill: { type: "solid", color: "#ffffff" },
        stroke: { color: "#111111", widthPt: 2, dash: "dashed" },
        radius: { allPt: 8 },
        shadow: { xPt: 1, yPt: 2, blurPt: 3, color: "#000000" },
        effect: { kind: "glass", intensity: "strong" },
        opacity: 0.5,
        clip: { enabled: true },
        blendMode: "multiply",
      },
      {
        fill: {
          type: "linearGradient",
          from: "#000000",
          to: "#ffffff",
          angle: 45,
          stops: [
            { color: "#000000", offsetPct: 0 },
            { color: "#ffffff", offsetPct: 100 },
          ],
        },
      },
      {
        fill: {
          type: "radialGradient",
          inner: "#111111",
          outer: "#eeeeee",
          r: 60,
          cx: 20,
          cy: 30,
        },
        radius: {
          topLeftPt: 1,
          topRightPt: 2,
          bottomRightPt: 3,
          bottomLeftPt: 4,
        },
      },
      {
        fill: {
          type: "conicGradient",
          fromAngle: 30,
          stops: [{ color: "#ff0000", offsetPct: 0 }],
        },
      },
      {
        fill: {
          type: "repeatingLinearGradient",
          angle: 12,
          stops: [{ color: "#00ff00", offsetPct: 20 }],
        },
      },
      {
        fill: {
          type: "pattern",
          kind: "grid",
          color: "#111111",
          background: "#eeeeee",
        },
      },
      {
        fill: { type: "pattern", kind: "dots", color: "#111111" },
      },
      {
        fill: {
          type: "pattern",
          kind: "stripes",
          color: "#111111",
          angle: 20,
        },
      },
      {
        fill: { type: "pattern", kind: "scanlines", color: "#111111" },
      },
      {
        fill: { type: "image", assetId: "hero", opacity: 0.7 },
        effect: { kind: "blur", radiusPt: 4 },
      },
      {
        fill: { type: "image", assetId: "missing" },
        effect: { kind: "glow", color: "#4f46e5", blurPt: 10, opacity: 0.4 },
      },
      {
        effect: { kind: "glass", intensity: "light" },
      },
    ];

    const css = cases.map((style) =>
      styleObjectToContainerCss(style, assetResolver),
    );

    assert.equal(css[0].backgroundColor, "#ffffff");
    assert.equal(css[0].border, "2pt dashed #111111");
    assert.equal(css[0].borderRadius, "8pt");
    assert.equal(css[0].backdropFilter, "blur(22px) saturate(1.25)");
    assert.equal(css[0].mixBlendMode, "multiply");
    assert.equal(
      css[1].background,
      "linear-gradient(45deg, #000000 0%, #ffffff 100%)",
    );
    assert.match(String(css[2].background), /radial-gradient/);
    assert.equal(css[2].borderTopLeftRadius, "1pt");
    assert.match(String(css[3].background), /conic-gradient/);
    assert.match(String(css[4].background), /repeating-linear-gradient/);
    assert.match(String(css[5].backgroundImage), /linear-gradient/);
    assert.match(String(css[6].backgroundImage), /radial-gradient/);
    assert.match(String(css[7].backgroundImage), /repeating-linear-gradient/);
    assert.match(String(css[8].backgroundImage), /0deg/);
    assert.equal(css[9].backgroundImage, undefined);
    assert.equal(css[9].filter, "blur(4pt)");
    assert.equal(css[10].backgroundImage, undefined);
    assert.equal(css[10].filter, "drop-shadow(0 0 10pt #4f46e5)");
    assert.equal(css[11].backdropFilter, "blur(8px) saturate(1.25)");
  });

  test("renders rich text, shapes, media, tables, connectors, and groups", () => {
    const richText = textNode(
      "rich-text",
      { x: 2, y: 4, w: 30, h: 12 },
      {
        layout: {
          frame: { x: 2, y: 4, w: 30, h: 12 },
          zIndex: 2,
          rotation: 12,
          flipX: true,
          flipY: true,
        },
        style: {
          text: {
            fontFamily: "Inter",
            fontSizePt: 16,
            weight: 700,
            italic: true,
            underline: true,
            color: "#111827",
            lineHeight: 1.4,
            align: "center",
            letterSpacingEm: 0.04,
            textTransform: "uppercase",
          },
        },
        content: {
          type: "text",
          content: {
            paragraphs: [
              {
                id: "p1",
                text: "Linked bold",
                runs: [
                  {
                    text: "Linked ",
                    bold: true,
                    link: "https://example.com",
                    localStyle: {
                      color: "#2563eb",
                      fontSizePt: 18,
                      fontFamily: "Mono",
                    },
                  },
                  {
                    text: "bold",
                    italic: true,
                    underline: true,
                    strikethrough: true,
                    code: true,
                  },
                ],
                list: { kind: "bullet", indent: 2 },
              },
            ],
          },
        },
      },
    );

    const triangle = {
      ...textNode("triangle", { x: 4, y: 18, w: 12, h: 12 }),
      type: "shape" as const,
      style: {
        fill: { type: "solid" as const, color: "#f97316" },
        stroke: { color: "#7c2d12", widthPt: 1 },
      },
      content: {
        type: "shape" as const,
        content: { shape: "triangle" as const },
      },
    };
    const diamond = {
      ...triangle,
      id: "diamond",
      content: {
        type: "shape" as const,
        content: { shape: "diamond" as const },
      },
    };
    const pathShape = {
      ...triangle,
      id: "path-shape",
      content: {
        type: "shape" as const,
        content: {
          shape: "path" as const,
          path: "M 0 0 L 100 0 L 50 100 Z",
        },
      },
    };
    const resolvedImage = imageNode(
      "resolved-image",
      { x: 20, y: 18, w: 20, h: 12 },
      {
        style: {
          image: { brightness: 1.1, contrast: 0.9, saturation: 1.2 },
        },
        content: {
          type: "image",
          content: {
            assetId: "image-1",
            alt: "Resolved image",
            fit: "contain",
            crop: { top: 4, right: 6, bottom: 8, left: 10 },
          },
        },
      },
    );
    const missingImage = imageNode(
      "missing-image",
      { x: 42, y: 18, w: 20, h: 12 },
      {
        content: {
          type: "image",
          content: { assetId: "missing", alt: "Missing image" },
        },
      },
    );
    const tableNode = {
      ...textNode("table-node", { x: 2, y: 34, w: 40, h: 18 }),
      type: "table" as const,
      style: {
        table: {
          headerFill: { type: "solid" as const, color: "#e0f2fe" },
          rowFill: { type: "solid" as const, color: "#ffffff" },
          alternateRowFill: { type: "solid" as const, color: "#f8fafc" },
          border: { color: "#0f172a", widthPt: 1 },
          cellPaddingPt: { top: 2, right: 3, bottom: 4, left: 5 },
        },
      },
      content: {
        type: "table" as const,
        content: {
          columns: [
            { id: "metric", label: "Metric" },
            { id: "value", label: "Value" },
          ],
          rows: [
            { id: "r1", cells: [{ text: "ARR" }, { text: "$12M" }] },
            {
              id: "r2",
              cells: [
                { text: "NRR" },
                { text: "118%", runs: [{ text: "118%", bold: true }] },
              ],
            },
          ],
          header: true,
        },
      },
    };
    const visualWithAsset = {
      ...textNode("visual-asset", { x: 44, y: 34, w: 20, h: 12 }),
      type: "visual" as const,
      content: {
        type: "visual" as const,
        content: { assetId: "visual-1", visualId: "chart-1", alt: "Chart" },
      },
    };
    const visualPlaceholder = {
      ...visualWithAsset,
      id: "visual-placeholder",
      content: {
        type: "visual" as const,
        content: { visualId: "chart-2", alt: "Chart placeholder" },
      },
    };
    const connectorCurved = {
      ...textNode("connector-curved", { x: 2, y: 56, w: 24, h: 12 }),
      type: "connector" as const,
      style: {
        connector: {
          stroke: { color: "#2563eb", widthPt: 2, dash: "dotted" as const },
          startArrow: "filled" as const,
          endArrow: "none" as const,
          routing: "curved" as const,
        },
      },
      content: {
        type: "connector" as const,
        content: {
          from: { kind: "node" as const, nodeId: "a", anchor: "top" as const },
          to: { kind: "node" as const, nodeId: "b", anchor: "right" as const },
        },
      },
    };
    const connectorElbow = {
      ...connectorCurved,
      id: "connector-elbow",
      style: {
        stroke: { color: "#16a34a", widthPt: 3, dash: "dashed" as const },
        connector: {
          startArrow: "arrow" as const,
          endArrow: "filled" as const,
        },
      },
      content: {
        type: "connector" as const,
        content: {
          routing: "elbow" as const,
          from: {
            kind: "node" as const,
            nodeId: "a",
            anchor: "bottom" as const,
          },
          to: { kind: "node" as const, nodeId: "b", anchor: "left" as const },
        },
      },
    };
    const group = {
      ...textNode("group-node", { x: 60, y: 56, w: 20, h: 12 }),
      type: "group" as const,
      content: { type: "group" as const },
    };

    const nodes: ResolvedRenderNode[] = [
      richText,
      triangle,
      diamond,
      pathShape,
      resolvedImage,
      missingImage,
      tableNode,
      visualWithAsset,
      visualPlaceholder,
      connectorCurved,
      connectorElbow,
      group,
    ];
    const html = nodes.map(renderResolvedNodeMarkup).join("");

    assert.match(html, /href="https:\/\/example.com"/);
    assert.match(html, /line-through/);
    assert.match(html, /rotate\(12deg\) scaleX\(-1\) scaleY\(-1\)/);
    assert.match(html, /M 50 0 L 100 100 L 0 100 Z/);
    assert.match(html, /M 50 0 L 100 50 L 50 100 L 0 50 Z/);
    assert.match(html, /M 0 0 L 100 0 L 50 100 Z/);
    assert.match(html, /Resolved image/);
    assert.match(html, /brightness\(1.1\) contrast\(0.9\) saturate\(1.2\)/);
    assert.match(html, /Missing image/);
    assert.match(html, /Metric/);
    assert.match(html, /118%/);
    assert.match(html, /Chart/);
    assert.match(html, /Chart placeholder/);
    assert.match(html, /connector-start-arrow-presentation-connector-curved/);
    assert.match(html, /connector-start-arrow-presentation-connector-elbow/);
    assert.match(html, /connector-end-arrow-presentation-connector-elbow/);
    assert.match(html, /stroke-dasharray="1 4"/);
    assert.match(html, /stroke-dasharray="6 4"/);
    assert.match(html, /Group node/);
  });

  test("renders background variants, active handles, hidden nodes, and deck selection", () => {
    const backgroundFills: FillStyle[] = [
      { type: "solid", color: "#ffffff" },
      {
        type: "linearGradient",
        from: "#000000",
        to: "#ffffff",
        stops: [{ color: "#333333", offsetPct: 50 }],
      },
      {
        type: "radialGradient",
        inner: "#111111",
        outer: "#eeeeee",
        rx: 40,
        ry: 50,
      },
      { type: "conicGradient", stops: [{ color: "#ff0000", offsetPct: 0 }] },
      {
        type: "repeatingLinearGradient",
        stops: [{ color: "#00ff00", offsetPct: 25 }],
      },
      {
        type: "pattern",
        kind: "grid",
        color: "#111111",
        background: "#eeeeee",
      },
      { type: "pattern", kind: "dots", color: "#111111" },
      { type: "pattern", kind: "stripes", color: "#111111" },
      { type: "pattern", kind: "scanlines", color: "#111111" },
      { type: "image", assetId: "bg", opacity: 0.6 },
      { type: "image", assetId: "missing" },
    ];
    const backgroundsHtml = backgroundFills
      .map((fill) =>
        renderToStaticMarkup(
          createElement(SlideCanvas, {
            slide: {
              ...slide([]),
              background: { fill, decorationLevel: "default" },
            },
            canvas: { format: "custom", width: 0, height: 0, unit: "percent" },
            assetResolver: (assetId: string) =>
              assetId === "bg" ? "https://example.com/bg.png" : undefined,
          }),
        ),
      )
      .join("");

    const selection = setSelection(createSelectionState("normal"), [
      "resize-me",
      "image-1",
    ]);
    const handlesHtml = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: {
          ...slide([
            textNode("resize-me", { x: 5, y: 5, w: 15, h: 10 }),
            imageNode("image-1", { x: 25, y: 5, w: 15, h: 10 }),
            {
              ...textNode("group-parent", { x: 45, y: 5, w: 15, h: 10 }),
              type: "group",
              content: { type: "group" },
              children: [textNode("group-child", { x: 46, y: 6, w: 10, h: 8 })],
            },
          ]),
          decorations: [
            textNode(
              "decor",
              { x: 1, y: 1, w: 8, h: 8 },
              { source: "themeDecoration" },
            ),
          ],
        },
        selection,
        focusedNodeId: undefined,
        hoveredNodeId: "group-child",
        hiddenNodeIds: new Set(["decor", "group-child"]),
        onNodeDoubleClick: () => undefined,
        onNodePointerDown: () => undefined,
        onNodeFocus: () => undefined,
        onMultiResizeHandlePointerDown: () => undefined,
        onResizeHandlePointerDown: () => undefined,
        onCropHandlePointerDown: () => undefined,
        activeResizeHandle: { nodeId: "resize-me", handle: "se" },
        activeCropHandle: { nodeId: "image-1", handle: "right" },
      }),
    );
    const previewHtml = renderToStaticMarkup(
      createElement(SlideCanvas, {
        slide: slide([textNode("preview-node", { x: 5, y: 5, w: 15, h: 10 })]),
        selection: setSelection(createSelectionState("normal"), [
          "preview-node",
        ]),
        hoveredNodeId: "preview-node",
        preview: true,
      }),
    );
    const deck: ResolvedDeckRenderTree = {
      canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
      theme: {} as ResolvedDeckRenderTree["theme"],
      diagnostics: [],
      slides: [
        slide([textNode("first-slide-node", { x: 5, y: 5, w: 10, h: 8 })]),
        slide([textNode("second-slide-node", { x: 5, y: 5, w: 10, h: 8 })]),
      ],
    };
    const deckHtml = renderToStaticMarkup(
      createElement(DeckCanvas, { deck, activeSlideIndex: 1 }),
    );
    const missingDeckHtml = renderToStaticMarkup(
      createElement(DeckCanvas, { deck, activeSlideIndex: 99 }),
    );

    assert.match(backgroundsHtml, /linear-gradient/);
    assert.match(backgroundsHtml, /radial-gradient/);
    assert.match(backgroundsHtml, /conic-gradient/);
    assert.match(backgroundsHtml, /repeating-linear-gradient/);
    assert.match(backgroundsHtml, /bg.png/);
    assert.match(handlesHtml, /data-multi-resize-handle="se"/);
    assert.doesNotMatch(handlesHtml, /data-resize-handle="se"/);
    assert.doesNotMatch(handlesHtml, /data-crop-handle="right"/);
    assert.match(handlesHtml, /visibility:hidden/);
    assert.match(handlesHtml, /aria-hidden="true"/);
    assert.doesNotMatch(previewHtml, /data-node-chrome-frame/);
    assert.doesNotMatch(previewHtml, /role="button"/);
    assert.match(deckHtml, /second-slide-node/);
    assert.equal(missingDeckHtml, "");
  });
});
type CallableSlideCanvas = {
  type: (props: SlideCanvasProps) => ReactNode;
};

function callableSlideCanvas(component: unknown): CallableSlideCanvas {
  return component as unknown as CallableSlideCanvas;
}
