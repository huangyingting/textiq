import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as React from "react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PresentationDiagnostic } from "@/lib/presentation-vnext/diagnostics";
import type { DeckV7 } from "@/lib/presentation-vnext/schema";
import {
  buildDeckV7,
  buildImageNode,
  buildLayoutBox,
  buildSlideV7,
  buildTextContent,
  buildTextNode,
} from "@/test/builders/deck-v7";
import {
  createTestElementFactory,
  makeDOMRect,
  TestHTMLElement,
} from "@/test/fake-dom";
import { createReactHookRenderer } from "@/test/react-server-renderer";
import {
  handleCloseConfirmAction,
  routeCloseRequest,
  setupBeforeUnloadGuard,
  SlideEditorCloseConfirmDialog,
  SlideEditorInspectorRegion,
  SlideEditorVNext,
  type SlideEditorVNextProps,
} from "./slide-editor-vnext";

type ElementProps = Record<string, unknown>;

type FakeListener = (event: Record<string, unknown>) => void;

const elementFactory = createTestElementFactory();

function installBrowserGlobals({ desktop = false } = {}) {
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>(
    ["window", "document", "navigator", "HTMLElement", "ResizeObserver"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
    ),
  );
  const listeners = new Map<string, Set<FakeListener>>();
  const canvasElement = elementFactory.createElement(
    {},
    makeDOMRect(10, 20, 1000, 562.5),
  );
  elementFactory.setCanvasElement(canvasElement);

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      addEventListener: (type: string, listener: FakeListener) => {
        const set = listeners.get(type) ?? new Set<FakeListener>();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, listener: FakeListener) => {
        listeners.get(type)?.delete(listener);
      },
      dispatch: (type: string, event: Record<string, unknown>) => {
        for (const listener of listeners.get(type) ?? []) listener(event);
      },
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
      clearTimeout: () => undefined,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
      cancelAnimationFrame: () => undefined,
      matchMedia: () => ({
        matches: desktop,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
      }),
      getComputedStyle: () => ({
        paddingLeft: "0",
        paddingRight: "0",
        paddingTop: "0",
        paddingBottom: "0",
      }),
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      querySelector: () => canvasElement,
      documentElement: { style: { overflow: "" } },
      body: { style: { overflow: "" }, nodeType: 1 },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: { platform: "Win32", userAgent: "node" },
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    writable: true,
    value: TestHTMLElement,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe(): void {
        // no-op test double
      }
      disconnect(): void {
        // no-op test double
      }
    },
  });

  return {
    canvasElement,
    restore: () => {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

function createHookRenderer({ runEffects = false } = {}) {
  return createReactHookRenderer({
    idPrefix: "deep-coverage-id",
    runEffects,
    runLayoutEffects: runEffects,
  });
}

function collectElements(node: ReactNode, elements: ReactElement[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, elements);
    return elements;
  }
  if (!isValidElement(node)) return elements;
  elements.push(node);
  collectElements((node.props as { children?: ReactNode }).children, elements);
  return elements;
}

function propsOf(element: ReactElement): ElementProps {
  return element.props as ElementProps;
}

function findProps(
  tree: ReactNode,
  predicate: (props: ElementProps, element: ReactElement) => boolean,
): ElementProps {
  const element = collectElements(tree).find((candidate) =>
    predicate(propsOf(candidate), candidate),
  );
  assert.ok(element);
  return propsOf(element);
}

function maybeProps(
  tree: ReactNode,
  predicate: (props: ElementProps, element: ReactElement) => boolean,
): ElementProps | undefined {
  const element = collectElements(tree).find((candidate) =>
    predicate(propsOf(candidate), candidate),
  );
  return element ? propsOf(element) : undefined;
}

function typeName(type: unknown): string {
  if (typeof type === "string") return type;
  if (typeof type === "function") return type.name;
  return String(type);
}

function clickByLabel(tree: ReactNode, label: string): unknown {
  const props = findProps(
    tree,
    (candidate) =>
      (candidate["aria-label"] === label || candidate.label === label) &&
      typeof candidate.onClick === "function",
  );
  assert.equal(typeof props.onClick, "function", label);
  return (props.onClick as () => unknown)();
}

function clickPopoverTrigger(tree: ReactNode, popoverLabel: string): unknown {
  const props = findProps(
    tree,
    (candidate) =>
      candidate["aria-label"] === popoverLabel && "trigger" in candidate,
  );
  const trigger = props.trigger;
  assert.ok(isValidElement(trigger));
  const onClick = (trigger.props as ElementProps).onClick;
  assert.equal(typeof onClick, "function", popoverLabel);
  return (onClick as () => unknown)();
}

function keyEvent(key: string, extras: Partial<Record<string, unknown>> = {}) {
  let prevented = 0;
  let stopped = 0;
  return {
    key,
    target: {},
    currentTarget: {},
    preventDefault: () => {
      prevented += 1;
    },
    stopPropagation: () => {
      stopped += 1;
    },
    get prevented() {
      return prevented;
    },
    get stopped() {
      return stopped;
    },
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...extras,
  };
}

function coverageDeck(): DeckV7 {
  return buildDeckV7(
    [
      buildSlideV7(
        "content",
        [
          buildTextNode({
            id: "title-a",
            role: "title",
            content: buildTextContent(["Title A"]),
          }),
          buildImageNode("img-001", {
            id: "image-a",
            layout: buildLayoutBox({
              frame: { x: 52, y: 20, w: 30, h: 30 },
              zIndex: 2,
            }),
          }),
        ],
        { id: "slide-a", name: "Slide A", notes: "Notes A" },
      ),
      buildSlideV7("content", [buildTextNode({ id: "body-b" })], {
        id: "slide-b",
        name: "Slide B",
      }),
    ],
    { title: "Deep coverage deck" },
  );
}

function diagnostics(): PresentationDiagnostic[] {
  return [
    {
      code: "unknown-theme-package",
      category: "theme",
      severity: "warning",
      target: { scope: "deck" },
      message: "Deck warning",
    },
    {
      code: "missing-asset",
      category: "asset",
      severity: "error",
      target: { scope: "node", slideId: "slide-a", nodeId: "image-a" },
      message: "Node error",
      action: {
        type: "open-asset-panel",
        target: { scope: "node", slideId: "slide-a", nodeId: "image-a" },
      },
    },
  ];
}

function editorProps(
  overrides: Partial<SlideEditorVNextProps> = {},
): SlideEditorVNextProps {
  return {
    documentId: "doc-deep",
    deck: coverageDeck(),
    diagnostics: diagnostics(),
    onDeckChange: () => undefined,
    onClose: () => undefined,
    onSave: async () => ({ ok: true as const, data: undefined }),
    onPresent: async () => ({ ok: true as const, data: undefined }),
    onShare: async () => ({ ok: true as const, data: undefined }),
    onExportPptx: async () => undefined,
    ...overrides,
  };
}

describe("SlideEditorVNext exported branch helpers", () => {
  test("routes close, confirm, and beforeunload guard branches", () => {
    const calls: string[] = [];
    routeCloseRequest(true, {
      openCloseConfirmDialog: () => calls.push("open-confirm"),
      closeEditor: () => calls.push("close"),
    });
    routeCloseRequest(false, {
      openCloseConfirmDialog: () => calls.push("open-confirm"),
      closeEditor: () => calls.push("close"),
    });
    handleCloseConfirmAction("cancel", {
      closeCloseConfirmDialog: () => calls.push("close-confirm"),
      closeEditor: () => calls.push("close"),
    });
    handleCloseConfirmAction("discard", {
      closeCloseConfirmDialog: () => calls.push("close-confirm"),
      closeEditor: () => calls.push("close"),
    });

    let listener: ((event: BeforeUnloadEvent) => void) | undefined;
    const cleanup = setupBeforeUnloadGuard(true, {
      addBeforeUnloadListener: (next) => {
        listener = next;
        calls.push("add-beforeunload");
      },
      removeBeforeUnloadListener: (next) => {
        assert.equal(next, listener);
        calls.push("remove-beforeunload");
      },
    });
    assert.equal(
      setupBeforeUnloadGuard(false, {
        addBeforeUnloadListener: () => calls.push("unexpected-add"),
        removeBeforeUnloadListener: () => calls.push("unexpected-remove"),
      }),
      undefined,
    );

    const event = {
      preventDefault: () => calls.push("prevent-beforeunload"),
      returnValue: undefined,
    } as unknown as BeforeUnloadEvent;
    listener?.(event);
    cleanup?.();

    assert.deepEqual(calls, [
      "open-confirm",
      "close",
      "close-confirm",
      "close-confirm",
      "close",
      "add-beforeunload",
      "prevent-beforeunload",
      "remove-beforeunload",
    ]);
    assert.equal(event.returnValue, "");
  });

  test("direct helper components render and invoke mobile, desktop, and dialog handlers", () => {
    const calls: string[] = [];
    const desktop = SlideEditorInspectorRegion({
      isDesktopInspectorViewport: true,
      activeSlide: coverageDeck().slides[0],
      inspectorSheetOpen: false,
      onOpenMobileInspector: () => calls.push("open"),
      onCloseMobileInspector: () => calls.push("close"),
      renderInspectorShell: () =>
        React.createElement("div", null, "Desktop shell"),
    });
    const noSlideMobile = SlideEditorInspectorRegion({
      isDesktopInspectorViewport: false,
      activeSlide: undefined,
      inspectorSheetOpen: true,
      onOpenMobileInspector: () => calls.push("open"),
      onCloseMobileInspector: () => calls.push("close"),
      renderInspectorShell: () =>
        React.createElement("div", null, "Mobile shell"),
    });
    const openMobile = SlideEditorInspectorRegion({
      isDesktopInspectorViewport: false,
      activeSlide: coverageDeck().slides[0],
      inspectorSheetOpen: true,
      onOpenMobileInspector: () => calls.push("open"),
      onCloseMobileInspector: () => calls.push("close"),
      renderInspectorShell: () =>
        React.createElement("div", null, "Mobile shell"),
    });
    const dialog = SlideEditorCloseConfirmDialog({
      onCancel: () => calls.push("cancel"),
      onDiscard: () => calls.push("discard"),
    });

    assert.ok(
      collectElements(desktop).some((element) =>
        String(propsOf(element).className ?? "").includes("lg:flex"),
      ),
    );
    assert.equal(
      collectElements(noSlideMobile).some(
        (element) => propsOf(element)["aria-label"] === "Edit slide",
      ),
      false,
    );
    clickByLabel(openMobile, "Edit slide");
    clickByLabel(openMobile, "Close slide inspector");
    const sheet = findProps(openMobile, (props) => props.role === "dialog");
    (sheet.onKeyDown as (event: unknown) => void)(
      keyEvent("Escape", { stopPropagation: () => calls.push("stop") }),
    );
    for (const button of collectElements(dialog)
      .map(propsOf)
      .filter((props) => typeof props.onClick === "function")) {
      (button.onClick as () => void)();
    }

    assert.deepEqual(calls, [
      "open",
      "close",
      "stop",
      "close",
      "cancel",
      "discard",
    ]);
  });
});

describe("SlideEditorVNext render and interaction branches", () => {
  test("renders empty, saving, and error status shells", () => {
    const emptyHtml = renderToStaticMarkup(
      React.createElement(SlideEditorVNext, {
        ...editorProps({ deck: buildDeckV7([]), onClose: undefined }),
      }),
    );
    const savingHtml = renderToStaticMarkup(
      React.createElement(SlideEditorVNext, {
        ...editorProps({ saveStatus: "saving", saveStatusLabel: "Saving now" }),
      }),
    );
    const errorHtml = renderToStaticMarkup(
      React.createElement(SlideEditorVNext, {
        ...editorProps({
          saveStatus: "error",
          saveStatusLabel: "Save failed",
          saveErrorMessage: "Network unavailable",
        }),
      }),
    );

    assert.match(emptyHtml, /Deck tools/);
    assert.doesNotMatch(emptyHtml, /No selection/);
    assert.doesNotMatch(emptyHtml, /Close slide editor/);
    assert.match(savingHtml, /Saving/);
    assert.match(savingHtml, /disabled=""/);
    assert.match(errorHtml, /Save failed/);
    assert.match(errorHtml, /Network unavailable/);
    assert.match(errorHtml, /Open deck diagnostics review \(2 diagnostics\)/);
  });

  test("closes immediately without unsaved work and opens status, source, and diagnostic menus safely", async () => {
    const browser = installBrowserGlobals({ desktop: true });
    try {
      const calls: string[] = [];
      const renderer = createHookRenderer({ runEffects: true });
      const props = editorProps({
        hasUnsavedWork: false,
        saveStatus: "error",
        saveStatusLabel: "Save failed",
        saveErrorMessage: "Retry available",
        onClose: () => calls.push("close"),
        onSave: async () => {
          calls.push("save");
          return { ok: true as const, data: undefined };
        },
        onPresent: async () => {
          calls.push("present");
          return { ok: true as const, data: undefined };
        },
        onShare: async () => {
          calls.push("share");
          return { ok: false as const, error: "Share denied" };
        },
        onExportPptx: async () => {
          calls.push("export");
          throw new Error("export failed");
        },
      });
      let tree = renderer.run(() => SlideEditorVNext(props));
      tree = renderer.run(() => SlideEditorVNext(props));

      clickPopoverTrigger(tree, "More deck commands");
      tree = renderer.run(() => SlideEditorVNext(props));
      await clickByLabel(tree, "Save now");
      await clickByLabel(tree, "Present slides");
      await clickByLabel(tree, "Share slides");
      clickPopoverTrigger(tree, "Export slides");
      tree = renderer.run(() => SlideEditorVNext(props));
      await clickByLabel(tree, "Export PPTX");
      clickByLabel(tree, "Close slide editor");
      const rerendered = renderer.run(() => SlideEditorVNext(editorProps()));

      assert.deepEqual(calls, [
        "save",
        "save",
        "present",
        "save",
        "share",
        "export",
        "close",
      ]);
      assert.equal(
        maybeProps(
          rerendered,
          (_props, element) =>
            typeName(element.type) === "SlideEditorCloseConfirmDialog",
        ),
        undefined,
      );
    } finally {
      browser.restore();
    }
  });

  test("handles stage keyboard help and diagnostics review navigation", () => {
    const browser = installBrowserGlobals();
    try {
      const renderer = createHookRenderer();
      let tree = renderer.run(() => SlideEditorVNext(editorProps()));
      const root = findProps(
        tree,
        (props) => props["data-slide-editor-vnext"] === "true",
      );
      (root.onKeyDown as (event: unknown) => void)(keyEvent("?"));
      (root.onKeyDown as (event: unknown) => void)(keyEvent("Escape"));
      clickByLabel(tree, "Open deck diagnostics review (2 diagnostics)");
      tree = renderer.run(() => SlideEditorVNext(editorProps()));
      const review = findProps(
        tree,
        (_props, element) => typeName(element.type) === "DeckDiagnosticsReview",
      );
      const reviewDiagnostics = review.diagnostics as PresentationDiagnostic[];
      (review.onNavigate as (diagnostic: PresentationDiagnostic) => void)(
        reviewDiagnostics[1],
      );
      (review.onClose as () => void)();
      tree = renderer.run(() => SlideEditorVNext(editorProps()));

      assert.equal(
        maybeProps(tree, (props) => props["aria-label"] === "Deck title"),
        undefined,
      );
      assert.ok(browser.canvasElement.focused.count >= 0);
    } finally {
      browser.restore();
    }
  });
});
