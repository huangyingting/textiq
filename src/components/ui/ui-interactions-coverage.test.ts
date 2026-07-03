import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  GeneratingIndicator,
  VisualSkeleton,
} from "@/components/motion/generation-status";
import {
  BottomSheetSurface,
  ColorPicker,
  DrawerSurface,
  FloatingSurface,
  ModalSurface,
  OverlayProvider,
  Popover,
  SelectMenu,
  Tooltip,
} from ".";

type ElementLike = ReactElement<Record<string, unknown>>;
type Listener = (event: Record<string, unknown>) => void;
type ComponentResolver = (props: Record<string, unknown>) => ReactNode;

function listenerEvent(event: unknown): Record<string, unknown> {
  return event as unknown as Record<string, unknown>;
}

function testHTMLElement(element: unknown): HTMLElement {
  return element as unknown as HTMLElement;
}

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

const functionComponentsToResolve = new Set([
  "SelectMenu",
  "ColorPicker",
  "FloatingSurface",
  "Popover",
  "Tooltip",
  "OverlayProvider",
  "ModalSurface",
  "DrawerSurface",
  "BottomSheetSurface",
  "GeneratingIndicator",
  "VisualSkeleton",
  "ThinkingIndicator",
]);

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

function fakeRect(left = 10, top = 20, width = 120, height = 32) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function fakeNode({
  contains = false,
  rect = fakeRect(),
  width = 120,
  height = 32,
}: {
  contains?: boolean;
  rect?: ReturnType<typeof fakeRect>;
  width?: number;
  height?: number;
} = {}) {
  return {
    nodeType: 1,
    offsetWidth: width,
    offsetHeight: height,
    contains: () => contains,
    focus: () => undefined,
    closest: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => rect,
  };
}

function installDom() {
  const documentListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const body = fakeNode();
  const activeElement = { blur: () => undefined };

  const addListener = (
    listeners: Map<string, Listener[]>,
    type: string,
    listener: Listener,
  ) => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  };
  const removeListener = (
    listeners: Map<string, Listener[]>,
    type: string,
    listener: Listener,
  ) => {
    listeners.set(
      type,
      (listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  };

  const documentValue = {
    body,
    activeElement,
    addEventListener: (type: string, listener: Listener) =>
      addListener(documentListeners, type, listener),
    removeEventListener: (type: string, listener: Listener) =>
      removeListener(documentListeners, type, listener),
    dispatchEvent: (event: { type: string }) => {
      for (const listener of documentListeners.get(event.type) ?? []) {
        listener(listenerEvent(event));
      }
      return true;
    },
    querySelector: () => fakeNode({ rect: fakeRect(40, 50, 240, 120) }),
  };
  const viewportListeners = new Map<string, Listener[]>();
  const windowValue = {
    innerWidth: 640,
    innerHeight: 480,
    scrollX: 3,
    scrollY: 4,
    addEventListener: (type: string, listener: Listener) =>
      addListener(windowListeners, type, listener),
    removeEventListener: (type: string, listener: Listener) =>
      removeListener(windowListeners, type, listener),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
    visualViewport: {
      addEventListener: (type: string, listener: Listener) =>
        addListener(viewportListeners, type, listener),
      removeEventListener: (type: string, listener: Listener) =>
        removeListener(viewportListeners, type, listener),
    },
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentValue,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowValue,
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
      observe() {}
      disconnect() {}
    },
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: class MutationObserver {
      observe() {}
      disconnect() {}
    },
  });

  return {
    documentListeners,
    fireDocument(type: string, event: Record<string, unknown>) {
      for (const listener of documentListeners.get(type) ?? []) {
        listener({ type, ...event });
      }
    },
  };
}

function withFakeReact<T>(
  options: {
    states?: unknown[];
    refs?: unknown[];
    reducerState?: unknown;
    runEffects?: boolean;
  },
  callback: (setters: unknown[], dispatches: unknown[]) => T,
): T {
  const original = {
    useCallback: React.useCallback,
    useContext: React.useContext,
    useEffect: React.useEffect,
    useId: React.useId,
    useLayoutEffect: React.useLayoutEffect,
    useMemo: React.useMemo,
    useReducer: React.useReducer,
    useRef: React.useRef,
    useState: React.useState,
    useSyncExternalStore: React.useSyncExternalStore,
  };
  let stateIndex = 0;
  let refIndex = 0;
  let idIndex = 0;
  const setters: unknown[] = [];
  const dispatches: unknown[] = [];
  Object.assign(React, {
    useCallback: <TCallback extends (...args: never[]) => unknown>(
      fn: TCallback,
    ) => fn,
    useContext: () => null,
    useEffect: (effect: () => void | (() => void)) => {
      if (options.runEffects) effect();
    },
    useId: () => `fake-id-${++idIndex}`,
    useLayoutEffect: (effect: () => void | (() => void)) => {
      if (options.runEffects) effect();
    },
    useMemo: <TValue>(factory: () => TValue) => factory(),
    useReducer: (
      _reducer: unknown,
      initialState: unknown,
    ): [unknown, (action: unknown) => void] => [
      options.reducerState ?? initialState,
      (action: unknown) => dispatches.push(action),
    ],
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
    useSyncExternalStore: (
      _subscribe: unknown,
      getSnapshot: () => unknown,
    ): unknown => getSnapshot(),
  });
  try {
    return callback(setters, dispatches);
  } finally {
    Object.assign(React, original);
  }
}

function walk(node: ReactNode, visit: (element: ElementLike) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isValidElement(node)) {
    const portalChildren = (node as { children?: ReactNode } | null)?.children;
    if (portalChildren) walk(portalChildren, visit);
    return;
  }
  const element = node as ElementLike;
  visit(element);
  const props = element.props;
  walk(props.children as ReactNode, visit);
  walk(props.trigger as ReactNode, visit);
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

function resolveKnown(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(resolveKnown);
  if (!isValidElement(node)) return node;
  const element = node as ElementLike;
  const type = element.type;
  if (
    typeof type === "function" &&
    functionComponentsToResolve.has(type.name)
  ) {
    return resolveKnown((type as ComponentResolver)(element.props));
  }
  const children = resolveKnown(element.props.children as ReactNode);
  return React.cloneElement(element, undefined, children);
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    currentTarget: { value: "" },
    target: fakeNode(),
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    shiftKey: false,
    ...overrides,
  };
}

test("SelectMenu exposes selected state, keyboard navigation, disabled options, and open changes", () => {
  installDom();
  const changes: string[] = [];
  const openChanges: boolean[] = [];
  const tree = withFakeReact(
    {
      states: [true, 1, { top: 24, left: 32, width: 96 }],
      runEffects: true,
    },
    () =>
      resolveKnown(
        SelectMenu({
          value: "medium",
          "aria-label": "Choose size",
          tooltipLabel: "Size menu",
          textSize: "sm",
          variant: "field",
          align: "end",
          anchor: "toolbar",
          options: [
            { value: "small", label: "Small", description: "Compact" },
            { value: "medium", label: "Medium", icon: "M" },
            { value: "large", label: "Large" },
            { value: "disabled", label: "Disabled", disabled: true },
          ],
          onChange: (value) => changes.push(value),
          onOpenChange: (open) => openChanges.push(open),
        }),
      ),
  );

  const trigger = findAll(
    tree,
    (element) =>
      element.type === "button" &&
      element.props["aria-label"] === "Choose size",
  )[0];
  assert.equal(trigger.props["aria-expanded"], true);
  (trigger.props.onClick as () => void)();
  (trigger.props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowUp" }),
  );

  const listbox = findAll(tree, (element) => element.type === "ul")[0];
  assert.equal(listbox.props.role, "listbox");
  (listbox.props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowDown" }),
  );
  (listbox.props.onKeyDown as (key: unknown) => void)(event({ key: "Enter" }));
  (listbox.props.onKeyDown as (key: unknown) => void)(event({ key: "Escape" }));

  const optionButtons = findAll(
    tree,
    (element) => element.type === "button" && textContent(element) === "Large",
  );
  (optionButtons[0].props.onMouseEnter as () => void)();
  (optionButtons[0].props.onClick as () => void)();

  const disabledButton = findAll(
    tree,
    (element) =>
      element.type === "button" && textContent(element) === "Disabled",
  )[0];
  assert.equal(disabledButton.props.disabled, true);
  (disabledButton.props.onClick as () => void)();

  assert.deepEqual(changes, ["medium", "large"]);
  assert.deepEqual(openChanges, [false, true, false, false, false]);
});

test("ColorPicker covers swatch, reset, custom hex, slider, keyboard, and pointer interactions", () => {
  installDom();
  const changes: string[] = [];
  let resets = 0;

  const swatchTree = withFakeReact(
    {
      states: [
        true,
        { top: 12, left: 16 },
        { source: "#336699", value: "#336699" },
        "swatches",
        210,
      ],
      runEffects: true,
    },
    () =>
      resolveKnown(
        ColorPicker({
          color: "#336699",
          onChange: (value) => changes.push(value),
          onReset: () => {
            resets += 1;
          },
          "aria-label": "Accent color",
          icon: "A",
          active: true,
          triggerChrome: "toolbar",
          presets: ["#336699", "#00ff00"],
          preserveSelection: true,
        }),
      ),
  );

  const trigger = findAll(
    swatchTree,
    (element) =>
      element.type === "button" &&
      element.props["aria-label"] === "Accent color",
  )[0];
  assert.equal(trigger.props["aria-pressed"], true);
  (trigger.props.onMouseDown as (mouse: unknown) => void)(event());
  (trigger.props.onClick as () => void)();

  const reset = findAll(
    swatchTree,
    (element) => element.type === "button" && textContent(element) === "Reset",
  )[0];
  (reset.props.onMouseDown as (mouse: unknown) => void)(event());
  (reset.props.onClick as () => void)();

  const preset = findAll(
    swatchTree,
    (element) =>
      element.type === "button" && element.props["aria-label"] === "#00ff00",
  )[0];
  (preset.props.onMouseDown as (mouse: unknown) => void)(event());
  (preset.props.onClick as () => void)();

  const customTab = findAll(
    swatchTree,
    (element) => element.type === "button" && textContent(element) === "custom",
  )[0];
  (customTab.props.onClick as () => void)();

  const customTree = withFakeReact(
    {
      states: [
        true,
        { top: 18, left: 20 },
        { source: "#336699", value: "#336699" },
        "custom",
        210,
      ],
      refs: [
        fakeNode(),
        null,
        fakeNode(),
        false,
        fakeNode({ rect: fakeRect(0, 0, 100, 100) }),
        null,
        fakeNode({ rect: fakeRect(0, 0, 100, 10) }),
      ],
      runEffects: true,
    },
    () =>
      resolveKnown(
        ColorPicker({
          color: "#336699",
          onChange: (value) => changes.push(value),
          "aria-label": "Accent color",
          customOnly: true,
          preserveSelection: true,
        }),
      ),
  );

  const sliders = findAll(
    customTree,
    (element) => element.props.role === "slider",
  );
  assert.equal(sliders.length, 2);
  (sliders[0].props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowRight", shiftKey: true }),
  );
  (sliders[0].props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowDown" }),
  );
  (sliders[0].props.onPointerDown as (pointer: unknown) => void)(
    event({ clientX: 75, clientY: 25 }),
  );
  (sliders[1].props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowLeft" }),
  );
  (sliders[1].props.onPointerDown as (pointer: unknown) => void)(
    event({ clientX: 25, clientY: 0 }),
  );

  const hexInput = findAll(
    customTree,
    (element) =>
      element.type === "input" &&
      element.props["aria-label"] === "Accent color hex value",
  )[0];
  (hexInput.props.onChange as (change: unknown) => void)(
    event({ target: { value: "#ABCDEF" } }),
  );
  (hexInput.props.onChange as (change: unknown) => void)(
    event({ target: { value: "not-a-hex" } }),
  );
  (hexInput.props.onBlur as () => void)();

  assert.equal(resets, 1);
  assert.ok(changes.includes("#00ff00"));
  assert.ok(changes.includes("#abcdef"));
  assert.ok(changes.length >= 5);
});

test("Floating surfaces, overlays, popovers, tooltips, and generation status handle open branches", () => {
  const dom = installDom();
  const closed: string[] = [];
  const stopEvents: string[] = [];
  const preventEvents: string[] = [];
  const surfaceRef = fakeNode({ contains: false, width: 200, height: 100 });
  const triggerRef = fakeNode({
    contains: true,
    rect: fakeRect(500, 8, 80, 28),
  });
  const panelRef = fakeNode({
    contains: false,
    rect: fakeRect(500, 8, 120, 60),
    width: 180,
    height: 72,
  });

  const tree = withFakeReact(
    {
      states: [{ top: 999, left: -10 }],
      refs: [surfaceRef],
      runEffects: true,
    },
    () =>
      resolveKnown(
        FloatingSurface({
          open: true,
          onClose: () => closed.push("floating"),
          position: { top: 900, left: -20 },
          "aria-label": "Floating actions",
          clickAwayIgnoreRef: { current: testHTMLElement(triggerRef) },
          keepSelection: true,
          children: "Floating content",
        }),
      ),
  );
  const floatingPanel = findAll(
    tree,
    (element) => element.props["aria-label"] === "Floating actions",
  )[0];
  assert.equal(floatingPanel.props.role, "dialog");
  (floatingPanel.props.onMouseDown as (mouse: unknown) => void)(
    event({ preventDefault: () => preventEvents.push("mouse") }),
  );
  (floatingPanel.props.onPointerMove as (pointer: unknown) => void)(
    event({ stopPropagation: () => stopEvents.push("pointer") }),
  );
  dom.fireDocument("mousedown", { target: fakeNode() });
  dom.fireDocument("keydown", { key: "Escape" });

  const popover = withFakeReact(
    {
      states: [{ top: 0, left: 0 }],
      refs: [triggerRef, panelRef],
      runEffects: true,
    },
    () =>
      resolveKnown(
        Popover({
          open: true,
          onClose: () => closed.push("popover"),
          trigger: React.createElement("button", null, "Open"),
          placement: "top",
          align: "start",
          portal: true,
          anchor: "toolbar",
          "aria-label": "Popover panel",
          children: "Panel",
        }),
      ),
  );
  const popoverPanel = findAll(
    popover,
    (element) => element.props["aria-label"] === "Popover panel",
  )[0];
  (popoverPanel.props.onPointerDown as (pointer: unknown) => void)(
    event({ stopPropagation: () => stopEvents.push("popover-pointer") }),
  );
  (popoverPanel.props.onMouseMove as (mouse: unknown) => void)(
    event({ stopPropagation: () => stopEvents.push("popover-mouse") }),
  );
  dom.fireDocument("keydown", { key: "Escape" });
  dom.fireDocument("mousedown", { target: fakeNode() });

  const tooltip = withFakeReact(
    {
      states: [true, { top: 5, left: 6 }],
      refs: [
        fakeNode({ rect: fakeRect(100, 200, 40, 20) }),
        fakeNode({ width: 80, height: 24 }),
      ],
      runEffects: true,
    },
    () =>
      resolveKnown(
        Tooltip({
          label: "Helpful tip",
          side: "bottom",
          delay: 0,
          children: React.createElement("button", null, "Hover"),
        }),
      ),
  );
  const tooltipTrigger = findAll(
    tooltip,
    (element) => element.type === "span",
  )[0];
  assert.match(String(tooltipTrigger.props["aria-describedby"]), /fake-id/);
  (tooltipTrigger.props.onMouseEnter as () => void)();
  (tooltipTrigger.props.onFocus as () => void)();
  (tooltipTrigger.props.onKeyDown as (key: unknown) => void)(
    event({ key: "Escape" }),
  );
  (tooltipTrigger.props.onBlur as () => void)();
  (tooltipTrigger.props.onMouseLeave as () => void)();

  const overlays = withFakeReact(
    { reducerState: { stageLabel: "Drafting visuals…", showEta: true } },
    () =>
      resolveKnown(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(
            OverlayProvider,
            null,
            React.createElement(
              React.Fragment,
              null,
              ModalSurface({
                open: true,
                onClose: () => closed.push("modal"),
                "aria-label": "Modal",
                "aria-busy": true,
                children: "Modal body",
              }),
              DrawerSurface({
                open: true,
                onClose: () => closed.push("drawer"),
                "aria-label": "Drawer",
                children: "Drawer body",
              }),
              BottomSheetSurface({
                open: true,
                onClose: () => closed.push("sheet"),
                "aria-label": "Sheet",
                children: "Sheet body",
              }),
            ),
          ),
          React.createElement(GeneratingIndicator, {
            isLoading: true,
            className: "busy",
          }),
          React.createElement(GeneratingIndicator, { isLoading: false }),
          React.createElement(VisualSkeleton, { className: "skeleton" }),
        ),
      ),
  );

  for (const label of ["Modal", "Drawer", "Sheet"]) {
    assert.ok(
      findAll(overlays, (element) => element.props["aria-label"] === label)
        .length >= 1,
    );
  }
  assert.match(textContent(overlays), /Drafting visuals/);
  assert.match(textContent(overlays), /ETA/);
  assert.ok(preventEvents.includes("mouse"));
  assert.ok(stopEvents.includes("pointer"));
  assert.ok(closed.includes("floating"));
  assert.ok(closed.includes("popover"));
});
