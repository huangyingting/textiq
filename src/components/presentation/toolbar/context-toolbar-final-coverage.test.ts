import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import type { SlideChildNode } from "@/lib/presentation/schema";
import type { DocumentSourceInsertBlock } from "@/lib/presentation/document-source-commands";
import type { StyleObject, StylePatch } from "@/lib/presentation/style-schema";
import {
  buildImageNode,
  buildShapeNode,
  buildTableNode,
} from "@/test/builders/presentation-deck";

import {
  ContextToolbar,
  routeContextToolbarConnectorArrow,
  routeContextToolbarConnectorRouting,
  routeContextToolbarConnectorStrokeColor,
  routeContextToolbarConnectorStrokeWidth,
  routeContextToolbarImageCropToggle,
  routeContextToolbarImageFit,
  routeContextToolbarTableHeaderToggle,
  seedContextToolbarStyles,
  tableWithAddedRow,
  type ContextToolbarProps,
} from "./context-toolbar";

type ElementLike = ReactElement<Record<string, unknown>>;
type Listener = (event: Record<string, unknown>) => void;

type FakeElement = {
  nodeType: number;
  offsetWidth: number;
  offsetHeight: number;
  focus: () => void;
  blur: () => void;
  contains: (target: unknown) => boolean;
  closest: (selector: string) => FakeElement | null;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
  querySelectorAll: (selector: string) => FakeElement[];
  getBoundingClientRect: () => {
    left: number;
    top: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
  };
};

const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDomRect = Object.getOwnPropertyDescriptor(globalThis, "DOMRect");
const originalResizeObserver = Object.getOwnPropertyDescriptor(
  globalThis,
  "ResizeObserver",
);
const originalMutationObserver = Object.getOwnPropertyDescriptor(
  globalThis,
  "MutationObserver",
);

function restoreGlobal(
  name:
    | "document"
    | "window"
    | "DOMRect"
    | "ResizeObserver"
    | "MutationObserver",
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}

afterEach(() => {
  restoreGlobal("document", originalDocument);
  restoreGlobal("window", originalWindow);
  restoreGlobal("DOMRect", originalDomRect);
  restoreGlobal("ResizeObserver", originalResizeObserver);
  restoreGlobal("MutationObserver", originalMutationObserver);
});

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function fakeElement({
  bounds = rect(40, 80, 200, 100),
  width = bounds.width,
  height = bounds.height,
  focusLog,
  query = [],
  closest,
  disabled = false,
}: {
  bounds?: ReturnType<typeof rect>;
  width?: number;
  height?: number;
  focusLog?: string[];
  query?: FakeElement[];
  closest?: FakeElement | null;
  disabled?: boolean;
} = {}): FakeElement {
  return {
    nodeType: 1,
    offsetWidth: width,
    offsetHeight: height,
    focus: () => focusLog?.push("focus"),
    blur: () => undefined,
    contains: () => false,
    closest: () => closest ?? null,
    hasAttribute: () => disabled,
    getAttribute: (name) =>
      name === "aria-disabled" && disabled ? "true" : null,
    querySelectorAll: () => query,
    getBoundingClientRect: () => bounds,
  };
}

function installDom({ activeElement }: { activeElement?: FakeElement } = {}) {
  const documentListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const observed: string[] = [];
  const stage = fakeElement({ bounds: rect(10, 20, 360, 220) });
  const selectedA = fakeElement({ bounds: rect(100, 120, 80, 40) });
  const selectedB = fakeElement({ bounds: rect(220, 90, 40, 120) });
  const addListener = (
    listeners: Map<string, Listener[]>,
    type: string,
    listener: Listener,
  ) => listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  const removeListener = (
    listeners: Map<string, Listener[]>,
    type: string,
    listener: Listener,
  ) =>
    listeners.set(
      type,
      (listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: stage,
      activeElement: activeElement ?? selectedA,
      addEventListener: (type: string, listener: Listener) =>
        addListener(documentListeners, type, listener),
      removeEventListener: (type: string, listener: Listener) =>
        removeListener(documentListeners, type, listener),
      querySelector: (selector: string) => {
        if (selector.includes("node-a")) return selectedA;
        if (selector.includes("node-b")) return selectedB;
        if (selector.includes("data-slide-stage-frame")) return stage;
        return null;
      },
      dispatchEvent: () => true,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerWidth: 640,
      innerHeight: 480,
      scrollX: 3,
      scrollY: 4,
      addEventListener: (type: string, listener: Listener) =>
        addListener(windowListeners, type, listener),
      removeEventListener: (type: string, listener: Listener) =>
        removeListener(windowListeners, type, listener),
      requestAnimationFrame: (callback: () => void) => {
        callback();
        return 1;
      },
      cancelAnimationFrame: () => undefined,
      visualViewport: {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    },
  });
  Object.defineProperty(globalThis, "DOMRect", {
    configurable: true,
    value: class DOMRect {
      left: number;
      top: number;
      width: number;
      height: number;
      right: number;
      bottom: number;

      constructor(left = 0, top = 0, width = 0, height = 0) {
        this.left = left;
        this.top = top;
        this.width = width;
        this.height = height;
        this.right = left + width;
        this.bottom = top + height;
      }
    },
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserver {
      observe() {
        observed.push("resize");
      }
      disconnect() {
        observed.push("resize-disconnect");
      }
    },
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: class MutationObserver {
      observe() {
        observed.push("mutation");
      }
      disconnect() {
        observed.push("mutation-disconnect");
      }
    },
  });
  return { observed };
}

function withFakeReact<T>(
  options: { states?: unknown[]; refs?: unknown[]; runEffects?: boolean },
  callback: (setters: unknown[]) => T,
): T {
  const original = {
    useEffect: React.useEffect,
    useId: React.useId,
    useLayoutEffect: React.useLayoutEffect,
    useRef: React.useRef,
    useState: React.useState,
  };
  let stateIndex = 0;
  let refIndex = 0;
  let idIndex = 0;
  const setters: unknown[] = [];
  Object.assign(React, {
    useEffect: (effect: () => void | (() => void)) => {
      if (options.runEffects) effect();
    },
    useId: () => `final-toolbar-${++idIndex}`,
    useLayoutEffect: (effect: () => void | (() => void)) => {
      if (options.runEffects) effect();
    },
    useRef: (initial: unknown) => {
      const index = refIndex;
      refIndex += 1;
      return {
        current:
          index < (options.refs?.length ?? 0) ? options.refs?.[index] : initial,
      };
    },
    useState: (initial: unknown) => {
      const index = stateIndex;
      stateIndex += 1;
      const value =
        index < (options.states?.length ?? 0)
          ? options.states?.[index]
          : typeof initial === "function"
            ? (initial as () => unknown)()
            : initial;
      const setter = (next: unknown) =>
        setters.push(typeof next === "function" ? next(value) : next);
      return [value, setter];
    },
  });
  try {
    return callback(setters);
  } finally {
    Object.assign(React, original);
  }
}

function walk(node: ReactNode, visit: (element: ElementLike) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isValidElement(node)) return;
  const element = node as ElementLike;
  visit(element);
  walk(element.props.children as ReactNode, visit);
  walk(element.props.trigger as ReactNode, visit);
}

function findAll(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike[] {
  const matches: ElementLike[] = [];
  walk(node, (element) => {
    if (predicate(element)) matches.push(element);
  });
  return matches;
}

function componentName(element: ElementLike): string {
  const type = element.type;
  return typeof type === "function" ? type.name : String(type);
}

function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement(node)) {
    return textContent((node as ElementLike).props.children as ReactNode);
  }
  return "";
}

function keyEvent(key: string, target: unknown = {}) {
  return {
    key,
    target,
    currentTarget: target,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  };
}

function connectorNode(): SlideChildNode {
  return {
    id: "node-a",
    type: "connector",
    role: "connector",
    layout: { frame: { x: 0, y: 0, w: 30, h: 20 }, zIndex: 1 },
    localStyle: {
      connector: {
        stroke: { color: "#0f172a", widthPt: 2 },
        startArrow: "arrow",
        endArrow: "filled",
      },
    },
    content: {
      from: { kind: "point", point: { x: 0, y: 0 } },
      to: { kind: "point", point: { x: 100, y: 100 } },
      routing: "straight",
    },
  };
}

function createRecorder() {
  return {
    actions: [] as string[],
    content: [] as Record<string, unknown>[],
    localStyle: [] as StylePatch[],
    attributes: [] as Array<{ locked?: boolean; hidden?: boolean }>,
    slideStyle: [] as StylePatch[],
    layout: [] as Array<{ rotation?: number }>,
    align: [] as string[],
    distribute: [] as string[],
    matchSize: [] as string[],
  };
}

function toolbarProps(
  selectedNode: SlideChildNode | undefined,
  recorder: ReturnType<typeof createRecorder>,
  overrides: Partial<ContextToolbarProps> = {},
): ContextToolbarProps {
  return {
    selectedIds: selectedNode ? [selectedNode.id] : [],
    selectedNode,
    selectedResolvedStyle: {
      text: { color: "#111827", fontSizePt: 18 },
      fill: { type: "solid", color: "#f8fafc" },
      stroke: { color: "#334155", widthPt: 2 },
      connector: {
        stroke: { color: "#475569", widthPt: 3 },
        startArrow: "none",
        endArrow: "arrow",
      },
    } satisfies StyleObject,
    isInlineEditing: false,
    isDragging: false,
    isDecorationSelected: false,
    onDelete: () => recorder.actions.push("delete"),
    onCut: () => recorder.actions.push("cut"),
    onDuplicate: () => recorder.actions.push("duplicate"),
    onGroup: () => recorder.actions.push("group"),
    onUngroup: () => recorder.actions.push("ungroup"),
    onBringForward: () => recorder.actions.push("forward"),
    onSendBackward: () => recorder.actions.push("backward"),
    onBringToFront: () => recorder.actions.push("front"),
    onSendToBack: () => recorder.actions.push("back"),
    onAlignSelection: (mode) => recorder.align.push(mode),
    onDistributeSelection: (mode) => recorder.distribute.push(mode),
    onMatchSize: (mode) => recorder.matchSize.push(mode),
    onUpdateSelectedContent: (patch) => recorder.content.push(patch),
    onUpdateSelectedLayout: (patch) => recorder.layout.push(patch),
    onUpdateSelectedLocalStyle: (patch) => recorder.localStyle.push(patch),
    onUpdateSelectedAttributes: (patch) => recorder.attributes.push(patch),
    onReplaceImage: () => recorder.actions.push("replace-image"),
    onResetImageCrop: () => recorder.actions.push("reset-crop"),
    onEnterTableEdit: () => recorder.actions.push("edit-table"),
    slideBackgroundColor: "#ffffff",
    onUpdateSlideLocalStyle: (patch) => recorder.slideStyle.push(patch),
    onInsertSlide: () => recorder.actions.push("insert-slide"),
    onInsertText: () => recorder.actions.push("insert-text"),
    onInsertShape: () => recorder.actions.push("insert-shape"),
    onInsertImage: () => recorder.actions.push("insert-image"),
    onInsertVisual: () => recorder.actions.push("insert-visual"),
    onInsertConnector: () => recorder.actions.push("insert-connector"),
    onInsertTable: () => recorder.actions.push("insert-table"),
    onDuplicateSlide: () => recorder.actions.push("duplicate-slide"),
    onDeleteSlide: () => recorder.actions.push("delete-slide"),
    canDeleteSlide: true,
    onDetachDecoration: () => recorder.actions.push("detach"),
    onRequestStageFocus: () => recorder.actions.push("focus-stage"),
    ...overrides,
  };
}

test("ContextToolbar final geometry, observers, keyboard navigation, and menu commands stay wired", () => {
  const focusLog: string[] = [];
  const controls = [
    fakeElement({ focusLog }),
    fakeElement({ focusLog }),
    fakeElement({ focusLog }),
  ];
  const menuItems = [fakeElement({ focusLog }), fakeElement({ focusLog })];
  const toolbarNode = fakeElement({ width: 280, height: 32, query: controls });
  const moreMenu = fakeElement({ query: menuItems });
  const moreTrigger = fakeElement({ focusLog });
  const { observed } = installDom({ activeElement: controls[1] });
  const recorder = createRecorder();

  const tree = withFakeReact(
    {
      states: [{ top: -1000, left: -1000 }, false, "https://", true],
      refs: [toolbarNode, moreMenu, moreTrigger],
      runEffects: true,
    },
    (setters) => {
      const result = ContextToolbar(
        toolbarProps(connectorNode(), recorder, {
          selectedIds: ["node-a", "node-b"],
        }),
      );
      assert.ok(
        setters.some((value) => JSON.stringify(value).includes("left")),
      );
      return result;
    },
  );

  const toolbarDiv = findAll(
    tree,
    (element) =>
      element.type === "div" && typeof element.props.onKeyDown === "function",
  )[0];
  (toolbarDiv.props.onKeyDown as (event: unknown) => void)(keyEvent("Home"));
  (toolbarDiv.props.onKeyDown as (event: unknown) => void)(keyEvent("End"));
  (toolbarDiv.props.onKeyDown as (event: unknown) => void)(
    keyEvent("ArrowRight"),
  );
  (toolbarDiv.props.onKeyDown as (event: unknown) => void)(keyEvent("Escape"));

  const menuDiv = findAll(
    tree,
    (element) =>
      element.type === "div" && element.props.id === "final-toolbar-1",
  )[0];
  (menuDiv.props.onKeyDown as (event: unknown) => void)(
    keyEvent("ArrowDown", menuItems[0]),
  );
  (menuDiv.props.onKeyDown as (event: unknown) => void)(keyEvent("Escape"));
  const alignLeft = findAll(
    tree,
    (element) =>
      componentName(element) === "ContextToolbarButton" &&
      element.props.label === "Align left",
  )[0];
  (alignLeft.props.onClick as () => void)();
  const connectorRouting = findAll(
    tree,
    (element) =>
      componentName(element) === "ContextToolbarSelect" &&
      element.props.label === "Connector routing",
  )[0];
  const lineColor = findAll(
    tree,
    (element) =>
      componentName(element) === "ContextToolbarColorInput" &&
      element.props.label === "Line color",
  )[0];
  const lineWidth = findAll(
    tree,
    (element) =>
      componentName(element) === "ContextToolbarNumberInput" &&
      element.props.label === "Line width",
  )[0];
  const endArrow = findAll(
    tree,
    (element) =>
      componentName(element) === "ContextToolbarSelect" &&
      element.props.label === "End arrow",
  )[0];
  (connectorRouting.props.onChange as (value: string) => void)("curved");
  (lineColor.props.onChange as (value: string) => void)("#abcdef");
  (lineWidth.props.onChange as (value: number) => void)(4);
  (endArrow.props.onChange as (value: string) => void)("none");

  assert.ok(focusLog.length >= 5);
  assert.ok(observed.includes("resize"));
  assert.ok(observed.includes("mutation"));
  assert.ok(recorder.align.includes("left"));
  assert.ok(recorder.actions.includes("focus-stage"));
});

test("ContextToolbar final slide, table, image, connector, and decoration branches route optional callbacks", () => {
  installDom();
  const recorder = createRecorder();
  const table = buildTableNode({ id: "node-a" });
  const oneCellTable: Extract<SlideChildNode, { type: "table" }> = {
    ...table,
    content: {
      ...table.content,
      columns: table.content.columns.slice(0, 1),
      rows: table.content.rows.slice(0, 1).map((row) => ({
        ...row,
        cells: row.cells.slice(0, 1),
      })),
      header: false,
    },
  };
  const uncroppedImage = buildImageNode("asset-1", {
    id: "node-a",
    content: { assetId: "asset-1", fit: "cover" },
  });
  const croppedImage = buildImageNode("asset-2", {
    id: "node-a",
    content: {
      assetId: "asset-2",
      fit: "contain",
      crop: { top: 1, right: 2, bottom: 3, left: 4 },
    },
  });

  const slideTree = withFakeReact(
    { refs: [fakeElement(), fakeElement(), fakeElement()], runEffects: true },
    () =>
      ContextToolbar(
        toolbarProps(undefined, recorder, {
          selectedIds: [],
          canDeleteSlide: false,
          onDeleteSlide: undefined,
        }),
      ),
  );
  const deleteSlide = findAll(
    slideTree,
    (element) =>
      componentName(element) === "ContextToolbarButton" &&
      element.props.label === "Delete slide",
  )[0];
  assert.equal(deleteSlide.props.disabled, true);
  const slideBackground = findAll(
    slideTree,
    (element) =>
      componentName(element) === "ContextToolbarColorInput" &&
      element.props.label === "Slide background",
  )[0];
  (slideBackground.props.onChange as (value: string) => void)("#111827");

  const tableTree = withFakeReact(
    { refs: [fakeElement(), fakeElement(), fakeElement()], runEffects: true },
    () => ContextToolbar(toolbarProps(oneCellTable, recorder)),
  );
  for (const button of findAll(
    tableTree,
    (element) => componentName(element) === "ContextToolbarButton",
  )) {
    if (button.props.disabled !== true) {
      (button.props.onClick as () => void)();
    }
  }
  assert.ok(recorder.actions.includes("edit-table"));
  assert.ok(recorder.content.some((patch) => "rows" in patch));
  assert.ok(recorder.content.some((patch) => "columns" in patch));
  assert.ok(recorder.content.some((patch) => "header" in patch));

  routeContextToolbarImageCropToggle({
    selectedNode: undefined,
    onUpdateSelectedContent: (patch) => recorder.content.push(patch),
    onResetImageCrop: () => recorder.actions.push("reset-crop"),
  });
  routeContextToolbarImageCropToggle({
    selectedNode: uncroppedImage,
    onUpdateSelectedContent: (patch) => recorder.content.push(patch),
    onResetImageCrop: () => recorder.actions.push("reset-crop"),
  });
  routeContextToolbarImageCropToggle({
    selectedNode: croppedImage,
    onUpdateSelectedContent: (patch) => recorder.content.push(patch),
    onResetImageCrop: () => recorder.actions.push("reset-crop"),
  });
  routeContextToolbarImageFit({
    fit: "none",
    onUpdateSelectedContent: (patch) => recorder.content.push(patch),
  });
  routeContextToolbarConnectorRouting({
    routing: "curved",
    onUpdateSelectedContent: (patch) => recorder.content.push(patch),
  });
  routeContextToolbarConnectorStrokeColor({
    color: "#123456",
    connectorStrokeWidth: 5,
    onUpdateSelectedLocalStyle: (patch) => recorder.localStyle.push(patch),
  });
  routeContextToolbarConnectorStrokeWidth({
    widthPt: 6,
    connectorStrokeColor: "#654321",
    onUpdateSelectedLocalStyle: (patch) => recorder.localStyle.push(patch),
  });
  routeContextToolbarConnectorArrow({
    selectedNode: connectorNode(),
    edge: "endArrow",
    value: "none",
    onUpdateSelectedLocalStyle: (patch) => recorder.localStyle.push(patch),
  });
  routeContextToolbarTableHeaderToggle({
    selectedNode: oneCellTable,
    onUpdateSelectedContent: (patch) => recorder.content.push(patch),
  });

  const decorationTree = withFakeReact(
    { refs: [fakeElement(), fakeElement(), fakeElement()], runEffects: true },
    () =>
      ContextToolbar(
        toolbarProps(buildShapeNode({ id: "node-a" }), recorder, {
          isDecorationSelected: true,
        }),
      ),
  );
  const detach = findAll(
    decorationTree,
    (element) => element.type === "button" && textContent(element) === "Detach",
  )[0];
  (detach.props.onClick as () => void)();

  assert.ok(recorder.actions.includes("reset-crop"));
  assert.ok(recorder.actions.includes("detach"));
  assert.ok(recorder.content.some((patch) => "crop" in patch));
  assert.ok(recorder.content.some((patch) => patch.fit === "none"));
  assert.ok(recorder.content.some((patch) => patch.routing === "curved"));
  assert.ok(recorder.localStyle.some((patch) => patch.connector !== undefined));
  assert.equal(tableWithAddedRow(oneCellTable).rows.length, 2);
});

test("seedContextToolbarStyles final fallbacks prefer local values when resolved fields are absent", () => {
  const seed = seedContextToolbarStyles(
    {
      ...connectorNode(),
      localStyle: {
        fill: { type: "solid", color: "#fef3c7" },
        stroke: { color: "#92400e", widthPt: 4 },
        connector: {
          stroke: { color: "#1d4ed8", widthPt: 7 },
          startArrow: "filled",
          endArrow: "none",
        },
        text: { color: "#111111", fontSizePt: 21, strikethrough: true },
        opacity: 0.42,
      },
    },
    { fill: { type: "image", assetId: "asset" } } as StyleObject,
  );

  assert.equal(seed.fillColor, "#fef3c7");
  assert.equal(seed.shapeStrokeColor, "#92400e");
  assert.equal(seed.connectorStrokeColor, "#1d4ed8");
  assert.equal(seed.connectorStrokeWidth, 7);
  assert.equal(seed.connectorStartArrow, "filled");
  assert.equal(seed.connectorEndArrow, "none");
  assert.equal(seed.opacity, 0.42);
});

test("ContextToolbar From document insert menu opens, navigates, and inserts", () => {
  const focusLog: string[] = [];
  const menuItems = [fakeElement({ focusLog }), fakeElement({ focusLog })];
  const toolbarNode = fakeElement({ width: 280, height: 32 });
  const moreMenu = fakeElement();
  const moreTrigger = fakeElement({ focusLog });
  const fromDocMenu = fakeElement({ query: menuItems });
  const fromDocTrigger = fakeElement({ focusLog });
  installDom();
  const recorder = createRecorder();
  const inserted: string[] = [];
  const blocks = [
    { kind: "text", id: "block-1", displayLabel: "Intro paragraph" },
    { kind: "table", id: "block-2", displayLabel: "Metrics table" },
  ] as unknown as DocumentSourceInsertBlock[];

  const tree = withFakeReact(
    {
      states: [{ top: -1000, left: -1000 }, false, "https://", false, true],
      refs: [toolbarNode, moreMenu, moreTrigger, fromDocMenu, fromDocTrigger],
      runEffects: true,
    },
    () =>
      ContextToolbar(
        toolbarProps(undefined, recorder, {
          documentInsertBlocks: blocks,
          onInsertDocumentSourceBlock: (block) => inserted.push(block.id),
        }),
      ),
  );

  const trigger = findAll(
    tree,
    (element) =>
      componentName(element) === "ContextToolbarButton" &&
      element.props.label === "From document",
  )[0];
  assert.ok(trigger);
  (trigger.props.onClick as () => void)();

  const menuDiv = findAll(
    tree,
    (element) =>
      element.type === "div" && element.props.id === "final-toolbar-2",
  )[0];
  assert.ok(menuDiv);
  (menuDiv.props.onKeyDown as (event: unknown) => void)(
    keyEvent("ArrowDown", menuItems[0]),
  );
  (menuDiv.props.onKeyDown as (event: unknown) => void)(keyEvent("Escape"));

  const insertItem = findAll(
    tree,
    (element) =>
      element.type === "button" &&
      element.props.role === "menuitem" &&
      textContent(element).includes("Metrics table"),
  )[0];
  assert.ok(insertItem);
  (insertItem.props.onClick as () => void)();

  assert.deepEqual(inserted, ["block-2"]);
  assert.ok(focusLog.length >= 1);
});
