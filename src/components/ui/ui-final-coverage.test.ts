import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { SelectMenu } from "./select-menu";
import { Tooltip } from "./tooltip";

type ElementLike = ReactElement<Record<string, unknown>>;
type Listener = (event: Record<string, unknown>) => void;
type ComponentResolver = (props: Record<string, unknown>) => ReactNode;

type FakeElement = {
  nodeType: number;
  offsetWidth: number;
  offsetHeight: number;
  focus: () => void;
  contains: (target: unknown) => boolean;
  closest: (selector: string) => FakeElement | null;
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
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

const functionComponentsToResolve = new Set(["SelectMenu", "Tooltip"]);

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
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

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
  bounds = rect(),
  width = bounds.width,
  height = bounds.height,
  contains = false,
  closest,
  focusLog,
}: {
  bounds?: ReturnType<typeof rect>;
  width?: number;
  height?: number;
  contains?: boolean;
  closest?: FakeElement | null;
  focusLog?: string[];
} = {}): FakeElement {
  return {
    nodeType: 1,
    offsetWidth: width,
    offsetHeight: height,
    focus: () => focusLog?.push("focus"),
    contains: () => contains,
    closest: () => closest ?? null,
    getBoundingClientRect: () => bounds,
  };
}

function installDom() {
  const documentListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const body = fakeElement();
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
      body,
      addEventListener: (type: string, listener: Listener) =>
        addListener(documentListeners, type, listener),
      removeEventListener: (type: string, listener: Listener) =>
        removeListener(documentListeners, type, listener),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerWidth: 360,
      innerHeight: 240,
      scrollX: 7,
      scrollY: 9,
      addEventListener: (type: string, listener: Listener) =>
        addListener(windowListeners, type, listener),
      removeEventListener: (type: string, listener: Listener) =>
        removeListener(windowListeners, type, listener),
    },
  });
  return {
    fireDocument(type: string, event: Record<string, unknown>) {
      for (const listener of documentListeners.get(type) ?? []) {
        listener({ type, ...event });
      }
    },
  };
}

function withFakeReact<T>(
  options: { states?: unknown[]; refs?: unknown[]; runEffects?: boolean },
  callback: (setters: unknown[]) => T,
): T {
  const original = {
    useCallback: React.useCallback,
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
    useCallback: <TCallback extends (...args: never[]) => unknown>(
      fn: TCallback,
    ) => fn,
    useEffect: (effect: () => void | (() => void)) => {
      if (options.runEffects) effect();
    },
    useId: () => `final-ui-${++idIndex}`,
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

function resolveKnown(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(resolveKnown);
  if (!isValidElement(node)) {
    const portalChildren = (node as { children?: ReactNode } | null)?.children;
    return portalChildren ? resolveKnown(portalChildren) : node;
  }
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
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement(node)) {
    return textContent((node as ElementLike).props.children as ReactNode);
  }
  return "";
}

function keyEvent(key: string) {
  return { key, preventDefault: () => undefined };
}

test("Tooltip final hidden, delayed, escape, and no-document branches remain accessible", () => {
  Reflect.deleteProperty(globalThis, "document");
  let timeoutCalls = 0;
  let clearCalls = 0;
  globalThis.setTimeout = ((callback: () => void) => {
    timeoutCalls += 1;
    callback();
    return timeoutCalls;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {
    clearCalls += 1;
  }) as typeof clearTimeout;

  const tree = withFakeReact(
    {
      states: [false, { top: -1000, left: -1000 }],
      refs: [null, false, false, null, null],
    },
    (setters) => {
      const result = resolveKnown(
        Tooltip({
          label: "Hidden tip",
          delay: 10,
          children: React.createElement("button", null, "Target"),
        }),
      );
      const trigger = findAll(result, (element) => element.type === "span")[0];
      assert.equal(trigger.props["aria-describedby"], undefined);
      (trigger.props.onMouseEnter as () => void)();
      (trigger.props.onFocus as () => void)();
      (trigger.props.onKeyDown as (event: unknown) => void)(keyEvent("Tab"));
      (trigger.props.onKeyDown as (event: unknown) => void)(keyEvent("Escape"));
      (trigger.props.onMouseLeave as () => void)();
      (trigger.props.onBlur as () => void)();
      return { result, setters };
    },
  );

  assert.equal(
    findAll(tree.result, (element) => element.props.role === "tooltip").length,
    0,
  );
  assert.deepEqual(tree.setters, [true, true, false]);
  assert.equal(timeoutCalls, 2);
  assert.equal(clearCalls, 2);
});

test("Tooltip final open reposition clamps bottom placement and listens for viewport changes", () => {
  installDom();
  const triggerNode = fakeElement({ bounds: rect(330, 220, 40, 20) });
  const tooltipNode = fakeElement({ width: 90, height: 24 });

  const tree = withFakeReact(
    {
      states: [true, { top: 0, left: 0 }],
      refs: [null, false, false, triggerNode, tooltipNode],
      runEffects: true,
    },
    (setters) => {
      const result = resolveKnown(
        Tooltip({
          label: "Bottom tip",
          side: "bottom",
          delay: 0,
          children: React.createElement("button", null, "Target"),
        }),
      );
      assert.ok(
        setters.some((value) => JSON.stringify(value).includes("left")),
      );
      return result;
    },
  );

  assert.equal(
    findAll(tree, (element) => element.props.role === "tooltip").length,
    1,
  );
});

test("SelectMenu final toolbar alignment, pointer-away closing, and hidden trigger chrome branches stay wired", () => {
  const dom = installDom();
  const focusLog: string[] = [];
  const toolbar = fakeElement({ bounds: rect(200, 30, 140, 24) });
  const trigger = fakeElement({
    bounds: rect(220, 36, 60, 20),
    closest: toolbar,
    focusLog,
  });
  const menu = fakeElement({ width: 180, height: 90, contains: true });
  const changes: string[] = [];
  const openChanges: boolean[] = [];

  const tree = withFakeReact(
    {
      states: [true, 2, { top: 44, left: 120, width: 60 }],
      refs: [trigger, menu],
      runEffects: true,
    },
    (setters) => {
      const result = resolveKnown(
        SelectMenu({
          value: "missing",
          options: [
            { value: "one", label: "One", icon: "①" },
            {
              value: "two",
              label: "Two",
              description: "Second",
              disabled: true,
            },
            { value: "three", label: "Three" },
          ],
          onChange: (value) => changes.push(value),
          onOpenChange: (open) => openChanges.push(open),
          "aria-label": "Final menu",
          showSelectedLabel: false,
          showChevron: false,
          showCheck: false,
          scrollable: false,
          align: "center",
          anchor: "toolbar",
          tooltipLabel: "Open final menu",
          triggerIcon: "◎",
          menuClassName: "custom-menu",
        }),
      );
      assert.ok(
        setters.some((value) => JSON.stringify(value).includes("width")),
      );
      return result;
    },
  );

  const button = findAll(
    tree,
    (element) =>
      element.type === "button" && element.props["aria-label"] === "Final menu",
  )[0];
  assert.equal(button.props["aria-expanded"], true);
  assert.equal(textContent(button), "◎");
  assert.doesNotMatch(String(button.props.className), /focus-visible:ring/);
  (button.props.onClick as () => void)();
  (button.props.onKeyDown as (event: unknown) => void)(keyEvent("ArrowDown"));
  (button.props.onKeyDown as (event: unknown) => void)(keyEvent("Escape"));

  const listbox = findAll(tree, (element) => element.type === "ul")[0];
  (listbox.props.onKeyDown as (event: unknown) => void)(keyEvent("ArrowUp"));
  (listbox.props.onKeyDown as (event: unknown) => void)(keyEvent(" "));
  dom.fireDocument("pointerdown", { target: fakeElement() });

  assert.deepEqual(changes, ["three"]);
  assert.ok(openChanges.includes(false));
  assert.ok(openChanges.includes(true));
  assert.deepEqual(focusLog, ["focus"]);
});
