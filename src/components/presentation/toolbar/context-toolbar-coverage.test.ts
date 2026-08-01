import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { ContextToolbar, type ContextToolbarProps } from "./context-toolbar";
import { ContextToolbarColorInput } from "./context-toolbar-primitives";
import type { SlideChildNode } from "@/lib/presentation/schema";
import type { StyleObject, StylePatch } from "@/lib/presentation/style-schema";
import {
  buildImageNode,
  buildShapeNode,
  buildTableNode,
  buildTextNode,
  buildVisualNode,
} from "@/test/builders/presentation-deck";

type ElementLike = ReactElement<Record<string, unknown>>;
type Listener = (event: { type: string; detail?: unknown }) => void;

const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalCustomEvent = Object.getOwnPropertyDescriptor(
  globalThis,
  "CustomEvent",
);

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
  if (originalCustomEvent) {
    Object.defineProperty(globalThis, "CustomEvent", originalCustomEvent);
  } else {
    Reflect.deleteProperty(globalThis, "CustomEvent");
  }
});

function installCommandDom() {
  const events: Array<{ type: string; detail?: unknown }> = [];
  const listeners = new Map<string, Listener[]>();
  const node = {
    nodeType: 1,
    offsetWidth: 320,
    offsetHeight: 36,
    focus: () => undefined,
    blur: () => undefined,
    querySelectorAll: () => [],
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
      body: node,
      activeElement: node,
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener: (type: string, listener: Listener) => {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((entry) => entry !== listener),
        );
      },
      dispatchEvent: (event: { type: string; detail?: unknown }) => {
        events.push({ type: event.type, detail: event.detail });
        for (const listener of listeners.get(event.type) ?? []) listener(event);
        return true;
      },
      querySelector: () => node,
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
  Object.defineProperty(globalThis, "CustomEvent", {
    configurable: true,
    value: class CustomEvent {
      type: string;
      detail: unknown;

      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
  });
  return events;
}

function withFakeReact<T>(
  states: unknown[],
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
  let idIndex = 0;
  const setters: unknown[] = [];
  Object.assign(React, {
    useEffect: () => undefined,
    useId: () => `toolbar-test-${++idIndex}`,
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
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement(node)) {
    return textContent((node as ElementLike).props.children as ReactNode);
  }
  return "";
}

function event(value = "next") {
  return {
    key: "Escape",
    target: {},
    currentTarget: { value },
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  };
}

function connectorNode(): SlideChildNode {
  return {
    id: "connector-1",
    type: "connector",
    role: "connector",
    layout: { frame: { x: 10, y: 10, w: 40, h: 20 }, zIndex: 3 },
    localStyle: {
      connector: {
        stroke: { color: "#0f172a", widthPt: 2 },
        startArrow: "none",
        endArrow: "arrow",
      },
    },
    content: {
      from: { kind: "point", point: { x: 0, y: 0 } },
      to: { kind: "point", point: { x: 100, y: 100 } },
      routing: "elbow",
    },
  };
}

const selectedStyle: StyleObject = {
  text: {
    color: "#111827",
    fontSizePt: 22,
    align: "left",
    weight: 700,
    italic: true,
    underline: true,
    strikethrough: false,
  },
  fill: { type: "solid", color: "#f8fafc" },
  stroke: { color: "#334155", widthPt: 2 },
  opacity: 0.72,
  connector: {
    stroke: { color: "#475569", widthPt: 3 },
    startArrow: "arrow",
    endArrow: "filled",
  },
};

function createRecorder() {
  return {
    actions: [] as string[],
    content: [] as Record<string, unknown>[],
    layout: [] as Array<{ rotation?: number }>,
    localStyle: [] as StylePatch[],
    attributes: [] as Array<{
      role?: SlideChildNode["role"];
      locked?: boolean;
      hidden?: boolean;
    }>,
    slideStyle: [] as StylePatch[],
    align: [] as string[],
    distribute: [] as string[],
    matchSize: [] as string[],
    panels: [] as string[],
  };
}

function toolbarProps(
  selectedNode: SlideChildNode | undefined,
  recorder: ReturnType<typeof createRecorder>,
  overrides: Partial<ContextToolbarProps> = {},
): ContextToolbarProps {
  const selectedIds = selectedNode ? [selectedNode.id] : [];
  return {
    selectedIds,
    selectedNode,
    selectedResolvedStyle: selectedStyle,
    isInlineEditing: false,
    isDragging: false,
    isDecorationSelected: false,
    onDelete: () => recorder.actions.push("delete"),
    onCut: () => recorder.actions.push("cut"),
    onDuplicate: () => recorder.actions.push("duplicate"),
    onGroup: () => recorder.actions.push("group"),
    onUngroup: () => recorder.actions.push("ungroup"),
    onBringForward: () => recorder.actions.push("bring-forward"),
    onSendBackward: () => recorder.actions.push("send-backward"),
    onBringToFront: () => recorder.actions.push("bring-front"),
    onSendToBack: () => recorder.actions.push("send-back"),
    onAlignSelection: (mode) => recorder.align.push(mode),
    onDistributeSelection: (mode) => recorder.distribute.push(mode),
    onMatchSize: (mode) => recorder.matchSize.push(mode),
    onUpdateSelectedContent: (patch) => recorder.content.push(patch),
    onUpdateSelectedLayout: (patch) => recorder.layout.push(patch),
    onUpdateSelectedLocalStyle: (patch) => recorder.localStyle.push(patch),
    onUpdateSelectedAttributes: (patch) => recorder.attributes.push(patch),
    onReplaceImage: () => recorder.actions.push("replace-image"),
    onReplaceVisual: () => recorder.actions.push("replace-visual"),
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
    onDetachDecoration: () => recorder.actions.push("detach-decoration"),
    onRequestStageFocus: () => recorder.actions.push("focus-stage"),
    onOpenInspectorPanel: (panel) => recorder.panels.push(panel),
    ...overrides,
  };
}

function valueForSelect(label: string) {
  return (
    {
      "Text role": "caption",
      "Image fit": "contain",
      "Visual theme": "accent",
      "Connector routing": "curved",
      "Start arrow": "filled",
      "End arrow": "none",
    }[label] ?? "body"
  );
}

function valueForNumber(label: string) {
  return (
    {
      "Font size": 30,
      Opacity: 55,
      "Line width": 4,
    }[label] ?? 1
  );
}

test("context toolbar color pickers use the dropdown tier below panels and reserve tooltip", () => {
  const element = ContextToolbarColorInput({
    label: "Slide background",
    value: "#ffffff",
    onChange: () => undefined,
  });
  assert.equal(element.props.layer, "dropdown");
});

function exerciseToolbarTree(tree: ReactNode) {
  const labels: string[] = [];
  const privateToolbarComponents = new Set([
    "ContextToolbarButton",
    "ContextToolbarDivider",
    "ContextToolbarColorInput",
    "ContextToolbarSelect",
    "ContextToolbarNumberInput",
  ]);

  for (const colorInput of findAll(
    tree,
    (element) => componentName(element) === "ContextToolbarColorInput",
  )) {
    labels.push(String(colorInput.props.label));
    (colorInput.props.onChange as (value: string) => void)("#abcdef");
  }

  for (const select of findAll(
    tree,
    (element) => componentName(element) === "ContextToolbarSelect",
  )) {
    const label = String(select.props.label);
    labels.push(label);
    (select.props.onChange as (value: string) => void)(valueForSelect(label));
  }

  for (const numberInput of findAll(
    tree,
    (element) => componentName(element) === "ContextToolbarNumberInput",
  )) {
    const label = String(numberInput.props.label);
    labels.push(label);
    (numberInput.props.onChange as (value: number) => void)(
      valueForNumber(label),
    );
  }

  for (const button of findAll(
    tree,
    (element) => componentName(element) === "ContextToolbarButton",
  )) {
    const label = String(button.props.label);
    labels.push(label);
    if (button.props.disabled !== true) {
      (button.props.onClick as () => void)();
    }
  }

  for (const form of findAll(tree, (element) => element.type === "form")) {
    (form.props.onSubmit as (submit: unknown) => void)(
      event("https://example.test"),
    );
  }
  for (const input of findAll(tree, (element) => element.type === "input")) {
    if (typeof input.props.onChange === "function") {
      (input.props.onChange as (change: unknown) => void)(event("44"));
    }
  }
  for (const button of findAll(tree, (element) => element.type === "button")) {
    if (button.props["aria-label"])
      labels.push(String(button.props["aria-label"]));
    if (button.props.role === "menuitem" || textContent(button) === "Detach") {
      (button.props.onClick as () => void)();
    }
  }
  for (const div of findAll(tree, (element) => element.type === "div")) {
    if (typeof div.props.onKeyDown === "function") {
      (div.props.onKeyDown as (key: unknown) => void)(event());
      (div.props.onKeyDown as (key: unknown) => void)({
        ...event(),
        key: "ArrowDown",
      });
    }
  }
  for (const component of findAll(tree, (element) =>
    privateToolbarComponents.has(componentName(element)),
  )) {
    const type = component.type as (
      props: Record<string, unknown>,
    ) => ReactNode;
    assert.doesNotThrow(() => type(component.props));
  }

  return labels;
}

function renderAndExercise(props: ContextToolbarProps, states: unknown[] = []) {
  return withFakeReact(states, () => {
    const tree = ContextToolbar(props);
    return {
      tree,
      labels: exerciseToolbarTree(tree),
    };
  });
}

test("ContextToolbar render branches route slide, text, shape, image, visual, connector, table, and arrange controls", () => {
  const commandEvents = installCommandDom();
  const recorder = createRecorder();
  const cases: Array<{
    name: string;
    props: ContextToolbarProps;
    states?: unknown[];
  }> = [
    {
      name: "slide",
      props: toolbarProps(undefined, recorder, { selectedIds: [] }),
    },
    {
      name: "text",
      props: toolbarProps(
        buildTextNode({ id: "text-1", role: "title" }),
        recorder,
      ),
    },
    {
      name: "inline text link",
      props: toolbarProps(
        buildTextNode({ id: "text-2", role: "body" }),
        recorder,
        {
          isInlineEditing: true,
        },
      ),
      states: [{ top: 1, left: 2 }, true, " https://example.test ", false],
    },
    {
      name: "shape",
      props: toolbarProps(buildShapeNode({ id: "shape-1" }), recorder),
    },
    {
      name: "image",
      props: toolbarProps(
        buildImageNode("asset-1", {
          id: "image-1",
          content: {
            assetId: "asset-1",
            fit: "cover",
            crop: { top: 4, right: 4, bottom: 4, left: 4 },
          },
        }),
        recorder,
      ),
      states: [{ top: 1, left: 2 }, false, "https://", true],
    },
    {
      name: "visual",
      props: toolbarProps(buildVisualNode({ id: "visual-1" }), recorder),
      states: [{ top: 1, left: 2 }, false, "https://", true],
    },
    {
      name: "connector",
      props: toolbarProps(connectorNode(), recorder),
    },
    {
      name: "table",
      props: toolbarProps(buildTableNode({ id: "table-1" }), recorder),
    },
    {
      name: "multi",
      props: toolbarProps(buildShapeNode({ id: "shape-2" }), recorder, {
        selectedIds: ["shape-2", "shape-3", "shape-4"],
      }),
    },
    {
      name: "decoration",
      props: toolbarProps(buildShapeNode({ id: "shape-5" }), recorder, {
        isDecorationSelected: true,
      }),
      states: [{ top: 1, left: 2 }, false, "https://", true],
    },
    {
      name: "more menu open",
      props: toolbarProps(
        {
          ...buildShapeNode({ id: "shape-6" }),
          locked: true,
        },
        recorder,
      ),
      states: [{ top: 1, left: 2 }, false, "https://", true],
    },
  ];

  const labelsByCase = new Map<string, string[]>();
  for (const item of cases) {
    const { labels } = renderAndExercise(item.props, item.states);
    labelsByCase.set(item.name, labels);
  }

  assert.ok(labelsByCase.get("slide")?.includes("Insert visual"));
  assert.ok(labelsByCase.get("text")?.includes("Bold"));
  assert.ok(labelsByCase.get("inline text link")?.includes("Link"));
  assert.ok(labelsByCase.get("shape")?.includes("Fill color"));
  assert.ok(labelsByCase.get("image")?.includes("Image fit"));
  assert.ok(labelsByCase.get("visual")?.includes("Transparent background"));
  assert.ok(labelsByCase.get("connector")?.includes("Line width"));
  assert.ok(labelsByCase.get("table")?.includes("Insert column"));
  assert.ok(labelsByCase.get("multi")?.includes("Distribute horizontally"));
  assert.ok(
    labelsByCase
      .get("decoration")
      ?.includes("Open Generated element inspector"),
  );

  assert.ok(recorder.actions.includes("edit-table"));
  assert.ok(recorder.align.includes("left"));
  assert.ok(recorder.distribute.includes("horizontal"));
  assert.ok(recorder.matchSize.includes("width"));
  assert.ok(recorder.content.some((patch) => "fit" in patch));
  assert.ok(recorder.content.some((patch) => "routing" in patch));
  assert.ok(recorder.content.some((patch) => "rows" in patch));
  assert.ok(recorder.localStyle.some((patch) => patch.text !== undefined));
  assert.ok(recorder.localStyle.some((patch) => patch.connector !== undefined));
  assert.ok(recorder.panels.includes("shape"));
  assert.ok(recorder.panels.includes("decoration"));
  assert.ok(recorder.slideStyle.length >= 1);
  assert.ok(
    commandEvents.some((entry) =>
      JSON.stringify(entry.detail).includes("font-size"),
    ),
  );
  assert.ok(
    commandEvents.some((entry) =>
      JSON.stringify(entry.detail).includes("link"),
    ),
  );
});
