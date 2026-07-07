import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import type { SlideChildNode } from "@/lib/presentation/schema";
import type { StyleObject, StylePatch } from "@/lib/presentation/style-schema";
import {
  buildImageNode,
  buildShapeNode,
  buildTableNode,
} from "@/test/builders/presentation-deck";

import {
  ContextToolbar,
  buildSlideToolInsertActions,
  contextToolbarTextRoleFontSizePt,
  isContextToolbarInlineTextCommandEnabled,
  isContextToolbarTextRole,
  resolveContextToolbarTextRole,
  routeContextToolbarDeleteSlide,
  routeContextToolbarDetachDecoration,
  routeContextToolbarDistribute,
  routeContextToolbarHideSelection,
  routeContextToolbarLockToggle,
  routeContextToolbarMatchSize,
  routeContextToolbarSlideBackground,
  seedContextToolbarStyles,
  tableWithAddedColumn,
  tableWithDeletedLastColumn,
  tableWithDeletedLastRow,
  type ContextToolbarProps,
  type SelectionDistributeMode,
  type SelectionMatchSizeMode,
} from "./context-toolbar";

type ElementLike = ReactElement<Record<string, unknown>>;
type Listener = (event: { type: string; detail?: unknown }) => void;

const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  if (originalDocument) {
    Object.defineProperty(globalThis, "document", originalDocument);
  } else {
    Reflect.deleteProperty(globalThis, "document");
  }
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

function installDom() {
  const listeners = new Map<string, Listener[]>();
  const focusLog: string[] = [];
  const button = {
    nodeType: 1,
    offsetWidth: 320,
    offsetHeight: 36,
    focus: () => focusLog.push("focus"),
    blur: () => undefined,
    contains: () => false,
    closest: () => null,
    querySelectorAll: () => [button],
    getBoundingClientRect: () => ({
      left: 40,
      top: 80,
      right: 240,
      bottom: 180,
      width: 200,
      height: 100,
    }),
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: button,
      activeElement: button,
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener: (type: string, listener: Listener) => {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((entry) => entry !== listener),
        );
      },
      querySelector: () => button,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerWidth: 1024,
      innerHeight: 768,
      scrollX: 0,
      scrollY: 0,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => undefined,
      visualViewport: {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    },
  });
  return focusLog;
}

function withFakeReact<T>(states: unknown[], callback: () => T): T {
  const original = {
    useEffect: React.useEffect,
    useId: React.useId,
    useLayoutEffect: React.useLayoutEffect,
    useRef: React.useRef,
    useState: React.useState,
  };
  let stateIndex = 0;
  let idIndex = 0;
  Object.assign(React, {
    useEffect: () => undefined,
    useId: () => `remaining-toolbar-${++idIndex}`,
    useLayoutEffect: () => undefined,
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => {
      const index = stateIndex;
      stateIndex += 1;
      const value =
        index < states.length
          ? states[index]
          : typeof initial === "function"
            ? (initial as () => unknown)()
            : initial;
      return [value, () => undefined];
    },
  });
  try {
    return callback();
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

function createRecorder() {
  return {
    actions: [] as string[],
    distribute: [] as SelectionDistributeMode[],
    matchSize: [] as SelectionMatchSizeMode[],
    attributes: [] as Array<{ locked?: boolean; hidden?: boolean }>,
    slideStyle: [] as StylePatch[],
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
      fill: { type: "solid", color: "#ffffff" },
      stroke: { color: "#111827", widthPt: 1 },
    },
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
    onDistributeSelection: (mode) => recorder.distribute.push(mode),
    onMatchSize: (mode) => recorder.matchSize.push(mode),
    onUpdateSelectedAttributes: (patch) => recorder.attributes.push(patch),
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
    onRequestStageFocus: () => recorder.actions.push("focus"),
    ...overrides,
  };
}

test("context toolbar exported route helpers cover remaining no-op and optional callback branches", () => {
  const recorder = createRecorder();
  const unlockedShape = buildShapeNode({ id: "shape-1" });
  const lockedShape = { ...unlockedShape, locked: true };

  assert.equal(isContextToolbarInlineTextCommandEnabled("link", false), false);
  assert.equal(isContextToolbarInlineTextCommandEnabled("bold", false), true);
  assert.equal(isContextToolbarTextRole("caption"), true);
  assert.equal(isContextToolbarTextRole("headline"), false);
  assert.equal(
    resolveContextToolbarTextRole("unknown" as SlideChildNode["role"]),
    "body",
  );
  assert.equal(contextToolbarTextRoleFontSizePt("quote"), 26);
  assert.deepEqual(
    buildSlideToolInsertActions({
      onInsertText: () => recorder.actions.push("text"),
      onInsertTable: () => recorder.actions.push("table"),
    }).map((action) => action.label),
    ["Insert text", "Insert table"],
  );

  const fallbackSeed = seedContextToolbarStyles(undefined, undefined);
  assert.equal(fallbackSeed.fillColor, "#ffffff");
  assert.equal(fallbackSeed.connectorStartArrow, "none");
  assert.equal(fallbackSeed.connectorEndArrow, "arrow");

  const nodeSeed = seedContextToolbarStyles(
    {
      ...unlockedShape,
      localStyle: {
        fill: { type: "solid", color: 5 } as StylePatch["fill"],
        stroke: { color: "#64748b", widthPt: 3 },
        connector: {
          stroke: { color: "#0f172a", widthPt: 4 },
          startArrow: "filled",
          endArrow: "none",
        },
      },
    },
    { fill: { type: "solid", color: "#f8fafc" } } as StyleObject,
  );
  assert.equal(nodeSeed.fillColor, "#f8fafc");
  assert.equal(nodeSeed.shapeStrokeWidth, 3);
  assert.equal(nodeSeed.connectorStrokeWidth, 4);

  routeContextToolbarDistribute({
    mode: "vertical",
    onDistributeSelection: (mode) => recorder.distribute.push(mode),
  });
  routeContextToolbarMatchSize({
    mode: "both",
    onMatchSize: (mode) => recorder.matchSize.push(mode),
  });
  routeContextToolbarLockToggle({
    selectedNode: unlockedShape,
    onUpdateSelectedAttributes: (patch) => recorder.attributes.push(patch),
  });
  routeContextToolbarLockToggle({
    selectedNode: lockedShape,
    onUpdateSelectedAttributes: (patch) => recorder.attributes.push(patch),
  });
  routeContextToolbarHideSelection({
    onUpdateSelectedAttributes: (patch) => recorder.attributes.push(patch),
  });
  routeContextToolbarSlideBackground({
    color: "#abcdef",
    onUpdateSlideLocalStyle: (patch) => recorder.slideStyle.push(patch),
  });
  assert.equal(
    routeContextToolbarDeleteSlide({
      canDeleteSlide: false,
      onDeleteSlide: () => recorder.actions.push("blocked-delete"),
    }),
    false,
  );
  assert.equal(
    routeContextToolbarDeleteSlide({
      canDeleteSlide: true,
      onDeleteSlide: () => recorder.actions.push("delete-slide"),
    }),
    true,
  );
  routeContextToolbarDetachDecoration({
    onDetachDecoration: () => recorder.actions.push("detach"),
  });
  routeContextToolbarDistribute({
    mode: "horizontal",
    onDistributeSelection: undefined,
  });
  routeContextToolbarMatchSize({ mode: "width", onMatchSize: undefined });

  assert.deepEqual(recorder.distribute, ["vertical"]);
  assert.deepEqual(recorder.matchSize, ["both"]);
  assert.deepEqual(recorder.attributes, [
    { locked: true },
    { locked: false },
    { hidden: true },
  ]);
  assert.ok(
    recorder.slideStyle.some((patch) =>
      JSON.stringify(patch).includes("#abcdef"),
    ),
  );
  assert.ok(recorder.actions.includes("delete-slide"));
  assert.ok(recorder.actions.includes("detach"));
});

test("context toolbar table helpers keep single-row tables stable and expand multi-column cells", () => {
  const table = buildTableNode({ id: "table-remaining" });
  const added = tableWithAddedColumn(table);
  assert.equal(added.columns.length, table.content.columns.length + 1);
  assert.equal(
    added.rows[0]?.cells.length,
    table.content.rows[0]?.cells.length + 1,
  );

  const single: Extract<SlideChildNode, { type: "table" }> = {
    ...table,
    content: {
      ...table.content,
      columns: table.content.columns.slice(0, 1),
      rows: table.content.rows.slice(0, 1).map((row) => ({
        ...row,
        cells: row.cells.slice(0, 1),
      })),
    },
  };
  assert.equal(tableWithDeletedLastRow(single).rows.length, 1);
  assert.equal(tableWithDeletedLastColumn(single).columns.length, 1);
});

test("ContextToolbar remaining render branches include disabled slide delete, hidden slide tools, and menu labels", () => {
  installDom();
  const recorder = createRecorder();
  const slideToolbar = withFakeReact([], () =>
    ContextToolbar(
      toolbarProps(undefined, recorder, {
        selectedIds: [],
        canDeleteSlide: false,
        onDeleteSlide: undefined,
      }),
    ),
  );
  const slideDelete = findAll(
    slideToolbar,
    (element) =>
      componentName(element) === "ContextToolbarButton" &&
      element.props.label === "Delete slide",
  )[0];
  assert.equal(slideDelete.props.disabled, true);

  const hiddenToolbar = withFakeReact([], () =>
    ContextToolbar(
      toolbarProps(undefined, recorder, {
        selectedIds: [],
        onUpdateSlideLocalStyle: undefined,
        onInsertSlide: undefined,
        onInsertText: undefined,
        onInsertShape: undefined,
        onInsertImage: undefined,
        onInsertVisual: undefined,
        onInsertConnector: undefined,
        onInsertTable: undefined,
      }),
    ),
  );
  assert.equal(
    findAll(
      hiddenToolbar,
      (element) =>
        componentName(element) === "ContextToolbarButton" &&
        element.props.label === "Add slide",
    ).length,
    0,
  );

  const uncroppedImage = buildImageNode("asset-1", {
    id: "image-remaining",
    content: { assetId: "asset-1", fit: "contain" },
  });
  const imageToolbar = withFakeReact([], () =>
    ContextToolbar(
      toolbarProps(uncroppedImage, recorder, {
        onReplaceImage: undefined,
        onResetImageCrop: () => recorder.actions.push("reset-crop"),
      }),
    ),
  );
  const resetCrop = findAll(
    imageToolbar,
    (element) =>
      componentName(element) === "ContextToolbarButton" &&
      element.props.label === "Reset crop",
  )[0];
  assert.equal(resetCrop.props.disabled, true);
});
