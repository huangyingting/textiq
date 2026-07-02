import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BottomSheetSurface,
  Card,
  ChoiceGroup,
  ColorPicker,
  Dialog,
  EmptyState,
  FieldRow,
  FormField,
  IconActionCluster,
  Kbd,
  MenuItem,
  ModalSurface,
  OverlayProvider,
  PanelSurface,
  PopoverSection,
  SegmentedControl,
  SelectMenu,
  StatusPill,
  Tabs,
  Tooltip,
  ToolbarButton,
  ToolbarMenuItem,
} from ".";

type ElementLike = ReactElement<Record<string, unknown>>;
type Listener = (event: Record<string, unknown>) => void;
type ComponentResolver = (props: Record<string, unknown>) => ReactNode;
type FakeElement = {
  nodeType: number;
  offsetWidth: number;
  offsetHeight: number;
  style: Record<string, string>;
  focus: () => void;
  blur: () => void;
  contains: (target: unknown) => boolean;
  closest: () => null;
  querySelectorAll: () => FakeElement[];
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

const functionComponentsToResolve = new Set([
  "SelectMenu",
  "ColorPicker",
  "FloatingSurface",
  "Tooltip",
  "ModalSurface",
  "BottomSheetSurface",
]);

afterEach(() => {
  restoreGlobal("document", originalDocument);
  restoreGlobal("window", originalWindow);
  restoreGlobal("DOMRect", originalDomRect);
  restoreGlobal("ResizeObserver", originalResizeObserver);
  restoreGlobal("MutationObserver", originalMutationObserver);
});

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

function rect(left = 10, top = 20, width = 120, height = 32) {
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
  contains = false,
  bounds = rect(),
  width = bounds.width,
  height = bounds.height,
  focusLog,
  query = [],
}: {
  contains?: boolean;
  bounds?: ReturnType<typeof rect>;
  width?: number;
  height?: number;
  focusLog?: string[];
  query?: FakeElement[];
} = {}): FakeElement {
  return {
    nodeType: 1,
    offsetWidth: width,
    offsetHeight: height,
    style: {},
    focus: () => focusLog?.push("focus"),
    blur: () => undefined,
    contains: () => contains,
    closest: () => null,
    querySelectorAll: () => query,
    getBoundingClientRect: () => bounds,
  };
}

function installDom() {
  const documentListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const activeFocus: string[] = [];
  const activeElement = fakeElement({ focusLog: activeFocus });
  const body = fakeElement();
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

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body,
      activeElement,
      addEventListener: (type: string, listener: Listener) =>
        addListener(documentListeners, type, listener),
      removeEventListener: (type: string, listener: Listener) =>
        removeListener(documentListeners, type, listener),
      querySelector: () => fakeElement({ bounds: rect(30, 40, 160, 90) }),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerWidth: 320,
      innerHeight: 240,
      scrollX: 5,
      scrollY: 6,
      addEventListener: (type: string, listener: Listener) =>
        addListener(windowListeners, type, listener),
      removeEventListener: (type: string, listener: Listener) =>
        removeListener(windowListeners, type, listener),
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => undefined,
      visualViewport: {
        addEventListener: (type: string, listener: Listener) =>
          addListener(windowListeners, `viewport:${type}`, listener),
        removeEventListener: (type: string, listener: Listener) =>
          removeListener(windowListeners, `viewport:${type}`, listener),
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
    activeFocus,
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
    contextValue?: unknown;
    runEffects?: boolean;
  },
  callback: (setters: unknown[]) => T,
): T {
  const original = {
    useCallback: React.useCallback,
    useContext: React.useContext,
    useEffect: React.useEffect,
    useId: React.useId,
    useLayoutEffect: React.useLayoutEffect,
    useMemo: React.useMemo,
    useRef: React.useRef,
    useState: React.useState,
    useSyncExternalStore: React.useSyncExternalStore,
  };
  let stateIndex = 0;
  let refIndex = 0;
  let idIndex = 0;
  const setters: unknown[] = [];
  Object.assign(React, {
    useCallback: <TCallback extends (...args: never[]) => unknown>(
      fn: TCallback,
    ) => fn,
    useContext: () => options.contextValue ?? null,
    useEffect: (effect: () => void | (() => void)) => {
      if (options.runEffects) effect();
    },
    useId: () => `fake-id-${++idIndex}`,
    useLayoutEffect: (effect: () => void | (() => void)) => {
      if (options.runEffects) effect();
    },
    useMemo: <TValue>(factory: () => TValue) => factory(),
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
  if (!isValidElement(node)) {
    const portalChildren = (node as { children?: ReactNode } | null)?.children;
    if (portalChildren) walk(portalChildren, visit);
    return;
  }
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
    key: "Enter",
    currentTarget: { value: "" },
    target: fakeElement(),
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    shiftKey: false,
    clientX: 0,
    clientY: 0,
    ...overrides,
  };
}

function attachButtonRefs(buttons: ElementLike[]) {
  for (const [index, button] of buttons.entries()) {
    const ref = button.props.ref as ((node: FakeElement) => void) | undefined;
    ref?.(fakeElement({ focusLog: [`button-${index}`] }));
  }
}

test("chrome, tabs, dialog, and overlay provider primitives render remaining variants", () => {
  const tabChanges: string[] = [];
  const tabs = Tabs({
    value: "three",
    "aria-label": "Sections",
    size: "sm",
    getTabId: (value) => `tab-${value}`,
    getPanelId: (value) => `panel-${value}`,
    options: [
      { value: "one", label: "One", icon: "①" },
      { value: "two", label: "Two", badge: "2" },
      { value: "three", label: "Three" },
      { value: "four", label: "Four", disabled: true },
      { value: "five", label: "Five" },
    ],
    onChange: (value) => tabChanges.push(value),
  });
  const tabButtons = findAll(tabs, (element) => element.type === "button");
  (tabButtons[0]?.props.onClick as () => void)();
  (tabButtons[3]?.props.onClick as () => void)();

  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        Card,
        { elevation: "popover", padding: "lg" },
        "Card",
      ),
      React.createElement(Card, { padding: "none" }, "Flat card"),
      React.createElement(
        EmptyState,
        {
          title: "Nothing here",
          description: "Create something",
          action: React.createElement("button", null, "Start"),
        },
        null,
      ),
      React.createElement(Kbd, null, "⌘K"),
      React.createElement(MenuItem, { inset: true }, "Indented item"),
      React.createElement(ToolbarMenuItem, { icon: "★" }, "Toolbar item"),
      React.createElement(
        FormField,
        {
          label: "Name",
          htmlFor: "name",
          hint: "Helpful hint",
          error: "Required",
          labelProps: { className: "custom-label" },
        },
        React.createElement("input", { id: "name" }),
      ),
      React.createElement(
        FormField,
        { label: "Plain label" },
        React.createElement("input", null),
      ),
      React.createElement(
        ToolbarButton,
        {
          active: true,
          iconOnly: false,
          size: "lg",
          tone: "surface",
          shape: "pill",
        },
        "Active",
      ),
      React.createElement(
        ToolbarButton,
        { active: false, size: "md", disabled: true },
        "Disabled",
      ),
      React.createElement(
        PanelSurface,
        { bordered: false, padding: "md", radius: "md", elevation: "popover" },
        "Panel",
      ),
      React.createElement(
        PopoverSection,
        { title: "Section", headingClassName: "heading" },
        "Body",
      ),
      React.createElement(
        FieldRow,
        { label: "Field", htmlFor: "field", hint: "Hint", error: "Error" },
        React.createElement("input", { id: "field" }),
      ),
      React.createElement(
        FieldRow,
        { label: "Field span" },
        React.createElement("input", null),
      ),
      React.createElement(IconActionCluster, { bordered: false }, "Cluster"),
      React.createElement(StatusPill, { tone: "success" }, "Success"),
      React.createElement(StatusPill, { tone: "warning" }, "Warning"),
      React.createElement(StatusPill, { tone: "danger" }, "Danger"),
      tabs,
      Dialog({
        open: false,
        onClose: () => undefined,
        "aria-labelledby": "heading",
        "aria-busy": true,
        className: "dialog",
        children: "Dialog body",
      }),
    ),
  );

  installDom();
  const provider = withFakeReact(
    { states: [[{ id: "first" }]], runEffects: true },
    (setters) => {
      const tree = OverlayProvider({ children: "Layer" }) as ElementLike;
      const value = tree.props.value as {
        register: (entry: { id: string; onEscape?: () => void }) => () => void;
        topId: string | null;
      };
      const unregister = value.register({ id: "second" });
      unregister();
      return { setters, topId: value.topId };
    },
  );

  assert.match(html, /Nothing here/);
  assert.match(html, /Required/);
  assert.match(html, /Toolbar item/);
  assert.match(html, /Success/);
  assert.deepEqual(tabChanges, ["one"]);
  assert.equal(provider.topId, "first");
  assert.equal(provider.setters.length, 2);
});

test("ChoiceGroup and SegmentedControl exercise disabled, wrap, icon-only, and roving keyboard branches", () => {
  const changes: string[] = [];
  const tree = withFakeReact({}, () =>
    React.createElement(
      React.Fragment,
      null,
      ChoiceGroup({
        value: "one",
        "aria-label": "Numbers",
        wrap: true,
        options: [
          { value: "one", label: "One", title: "First" },
          { value: "two", label: "Two", disabled: true },
          { value: "three", label: "Three", ariaLabel: "Third" },
        ],
        onChange: (value) => changes.push(String(value)),
      }),
      SegmentedControl({
        value: "grid",
        "aria-label": "Views",
        size: "lg",
        stretch: true,
        options: [
          { value: "list", label: "List" },
          { value: "grid", label: "Grid", icon: "▦" },
          { value: "map", label: "Map", icon: "◎", iconOnly: true },
          { value: "off", label: "Off", disabled: true },
        ],
        onChange: (value) => changes.push(value),
      }),
    ),
  );

  const buttons = findAll(tree, (element) => element.type === "button");
  attachButtonRefs(buttons);
  const byLabel = new Map(
    buttons.map((button) => [textContent(button), button]),
  );
  const iconOnly = buttons.find(
    (button) => button.props["aria-label"] === "Map",
  );
  const gridButton = buttons.find((button) =>
    textContent(button).includes("Grid"),
  );
  assert.ok(iconOnly);
  assert.ok(gridButton);
  assert.equal(textContent(iconOnly), "◎");

  (byLabel.get("One")?.props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowLeft" }),
  );
  (byLabel.get("One")?.props.onKeyDown as (key: unknown) => void)(
    event({ key: "PageDown" }),
  );
  (byLabel.get("Three")?.props.onKeyDown as (key: unknown) => void)(
    event({ key: "Home" }),
  );
  (byLabel.get("Two")?.props.onClick as () => void)();
  (iconOnly.props.onClick as () => void)();
  (byLabel.get("List")?.props.onKeyDown as (key: unknown) => void)(
    event({ key: "End" }),
  );
  (gridButton.props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowUp" }),
  );
  (gridButton.props.onKeyDown as (key: unknown) => void)(
    event({ key: "Escape" }),
  );

  assert.ok(changes.includes("three"));
  assert.ok(changes.includes("one"));
  assert.ok(changes.includes("map"));
});

test("SelectMenu covers empty options, disabled navigation, placeholders, and missing layout refs", () => {
  installDom();
  const changes: string[] = [];
  const openChanges: boolean[] = [];

  const disabledTree = withFakeReact(
    { states: [false, 0, { top: 0, left: 0, width: 0 }], runEffects: true },
    () =>
      resolveKnown(
        SelectMenu({
          value: "missing",
          "aria-label": "Disabled menu",
          placeholder: "Pick something",
          showSelectedLabel: true,
          showChevron: false,
          showCheck: false,
          scrollable: false,
          align: "center",
          options: [{ value: "locked", label: "Locked", disabled: true }],
          onChange: (value) => changes.push(value),
          onOpenChange: (open) => openChanges.push(open),
        }),
      ),
  );
  const trigger = findAll(
    disabledTree,
    (element) =>
      element.type === "button" && textContent(element) === "Pick something",
  )[0];
  (trigger.props.onClick as () => void)();
  (trigger.props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowDown" }),
  );
  (trigger.props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowUp" }),
  );

  const emptyTree = withFakeReact(
    { states: [true, 0, { top: 2, left: 3, width: 4 }], runEffects: true },
    () =>
      resolveKnown(
        SelectMenu({
          value: "",
          "aria-label": "Empty menu",
          placeholder: "Empty",
          triggerIcon: "∅",
          options: [],
          onChange: (value) => changes.push(value),
          onOpenChange: (open) => openChanges.push(open),
        }),
      ),
  );
  const listbox = findAll(emptyTree, (element) => element.type === "ul")[0];
  (listbox.props.onKeyDown as (key: unknown) => void)(event({ key: "Enter" }));
  (listbox.props.onKeyDown as (key: unknown) => void)(event({ key: " " }));
  (listbox.props.onKeyDown as (key: unknown) => void)(event({ key: "Escape" }));

  assert.deepEqual(changes, []);
  assert.ok(openChanges.includes(true));
  assert.ok(openChanges.includes(false));
});

test("ColorPicker covers fallback colors, red HSV branches, focus trap, and preset-only mode", () => {
  installDom();
  const changes: string[] = [];
  const focusables = [fakeElement(), fakeElement()];
  const content = fakeElement({ query: focusables });

  const customTree = withFakeReact(
    {
      states: [
        true,
        { top: 18, left: 20 },
        { source: "#ff0000", value: "#ff0000" },
        "custom",
        0,
      ],
      refs: [
        fakeElement({ bounds: rect(260, 10, 40, 20) }),
        null,
        content,
        false,
        fakeElement({ bounds: rect(0, 0, 100, 100) }),
        null,
        fakeElement({ bounds: rect(0, 0, 100, 10) }),
      ],
      runEffects: true,
    },
    () =>
      resolveKnown(
        ColorPicker({
          color: "#ff0000",
          onChange: (value) => changes.push(value),
          "aria-label": "Brand",
          customOnly: true,
        }),
      ),
  );
  const sliders = findAll(
    customTree,
    (element) => element.props.role === "slider",
  );
  assert.equal(sliders.length, 2);
  (sliders[0].props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowRight" }),
  );
  (sliders[0].props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowUp", shiftKey: true }),
  );
  (sliders[1].props.onKeyDown as (key: unknown) => void)(
    event({ key: "ArrowRight", shiftKey: true }),
  );
  (sliders[1].props.onPointerDown as (pointer: unknown) => void)(
    event({ clientX: 25, clientY: 0 }),
  );

  const pickerContent = findAll(
    customTree,
    (element) => element.props["data-ds-floating"] === "color-picker",
  )[0];
  Object.defineProperty(globalThis.document, "activeElement", {
    configurable: true,
    value: focusables[1],
  });
  (pickerContent.props.onKeyDown as (key: unknown) => void)(
    event({ key: "Tab" }),
  );
  Object.defineProperty(globalThis.document, "activeElement", {
    configurable: true,
    value: focusables[0],
  });
  (pickerContent.props.onKeyDown as (key: unknown) => void)(
    event({ key: "Tab", shiftKey: true }),
  );

  const presetOnlyTree = withFakeReact(
    {
      states: [
        true,
        { top: 10, left: 12 },
        { source: "#123456", value: "#123456" },
        "swatches",
        0,
      ],
      refs: [fakeElement(), fakeElement(), fakeElement(), false],
      runEffects: true,
    },
    () =>
      resolveKnown(
        ColorPicker({
          color: "currentColor",
          fallback: "#123456",
          onChange: (value) => changes.push(value),
          "aria-label": "Fallback color",
          allowCustom: false,
          presets: ["bad-color", "#00ff00"],
        }),
      ),
  );
  const badPreset = findAll(
    presetOnlyTree,
    (element) =>
      element.type === "button" && element.props["aria-label"] === "bad-color",
  )[0];
  (badPreset.props.onClick as () => void)();

  assert.ok(changes.includes("bad-color"));
  assert.ok(changes.length >= 4);
});

test("Tooltip top placement and overlay stack escape/focus branches remain accessible", () => {
  const dom = installDom();
  const closed: string[] = [];
  const focusLog: string[] = [];
  const panel = fakeElement({
    query: [fakeElement({ focusLog }), fakeElement({ focusLog })],
  });

  const tooltip = withFakeReact(
    {
      states: [true, { top: 0, left: 0 }],
      refs: [
        fakeElement({ bounds: rect(6, 5, 40, 18) }),
        fakeElement({ width: 90, height: 24 }),
      ],
      runEffects: true,
    },
    () =>
      resolveKnown(
        Tooltip({
          label: "Top tip",
          side: "top",
          delay: 25,
          children: React.createElement("button", null, "Hover target"),
        }),
      ),
  );
  const tooltipTrigger = findAll(
    tooltip,
    (element) => element.type === "span",
  )[0];
  assert.match(String(tooltipTrigger.props["aria-describedby"]), /fake-id/);
  (tooltipTrigger.props.onMouseEnter as () => void)();
  (tooltipTrigger.props.onMouseLeave as () => void)();
  (tooltipTrigger.props.onFocus as () => void)();
  (tooltipTrigger.props.onBlur as () => void)();

  const sameTopOverlay = withFakeReact(
    {
      refs: [panel, fakeElement(), "overlay-fake-id-1", () => undefined],
      contextValue: {
        topId: "overlay-fake-id-1",
        register: () => () => closed.push("unregistered"),
      },
      runEffects: true,
    },
    () =>
      resolveKnown(
        ModalSurface({
          open: true,
          onClose: () => closed.push("modal"),
          "aria-label": "Stacked modal",
          children: React.createElement("button", null, "Inside"),
        }),
      ),
  );
  const dialog = findAll(
    sameTopOverlay,
    (element) => element.props["aria-label"] === "Stacked modal",
  )[0];
  (dialog.props.onKeyDown as (key: unknown) => void)(event({ key: "Tab" }));
  (dialog.props.onKeyDown as (key: unknown) => void)(
    event({ key: "Tab", shiftKey: true }),
  );
  dom.fireDocument("keydown", {
    key: "Escape",
    preventDefault: () => closed.push("prevented"),
    stopPropagation: () => closed.push("stopped"),
  });

  const nestedDom = installDom();
  withFakeReact(
    {
      refs: [panel, fakeElement(), "overlay-fake-id-2", () => undefined],
      contextValue: {
        topId: "overlay-other",
        register: () => () => undefined,
      },
      runEffects: true,
    },
    () =>
      resolveKnown(
        BottomSheetSurface({
          open: true,
          onClose: () => closed.push("sheet"),
          "aria-label": "Nested sheet",
          children: "Sheet",
        }),
      ),
  );
  nestedDom.fireDocument("keydown", { key: "Escape" });

  assert.ok(closed.includes("modal"));
  assert.ok(!closed.includes("sheet"));
  assert.ok(focusLog.length >= 1);
});
