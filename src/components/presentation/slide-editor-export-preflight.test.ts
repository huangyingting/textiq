import assert from "node:assert/strict";
import { describe, test } from "node:test";
import React, {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { act } from "react-test-renderer";

import type { PresentationExportPreflightResult } from "@/lib/presentation/export-preflight";
import { Dialog } from "@/components/ui/dialog";
import { Popover } from "@/components/ui/popover";
import { ExportPreflightDialog } from "./export-preflight-dialog";
import { SlideCommandPalette } from "./slide-command-palette";
import { SlideEditor } from "./slide-editor";
import { SlideEditorTopToolbar } from "./slide-editor-top-toolbar";
import {
  buildDeck,
  buildImageNode,
  buildMinimalThemePackage,
  buildSlide,
  buildVisualNode,
} from "@/test/builders/presentation-deck";
import {
  createReactRenderHarness,
  withDefaultDom,
} from "@/test/react-render-harness";
import { waitForAsyncDrain } from "@/test/render-text";

type ElementLike = ReactElement<Record<string, unknown>>;
type Listener = (event: Record<string, unknown>) => void;

function collectElements(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
  collected: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  if (predicate(element)) collected.push(element);
  collectElements(element.props.children as ReactNode, predicate, collected);
  return collected;
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (!isValidElement(node)) return "";
  return flattenText((node.props as { children?: ReactNode }).children);
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    key: "Enter",
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    ...overrides,
  };
}

function createFocusable(
  name: string,
  setActive: (element: HTMLElement) => void,
  focusLog: string[],
) {
  return {
    tagName: "BUTTON",
    parentElement: null,
    focus: function focus(this: HTMLElement) {
      focusLog.push(name);
      setActive(this);
    },
    getAttribute: () => null,
    hasAttribute: () => false,
  } as unknown as HTMLElement;
}

function withModalDom(
  callback: (dom: {
    focusLog: string[];
    makeFocusable(name: string): HTMLElement;
    fireDocument(type: string, event: Record<string, unknown>): void;
  }) => void,
) {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const listeners = new Map<string, Listener[]>();
  const focusLog: string[] = [];
  let activeElement: HTMLElement;
  const setActive = (element: HTMLElement) => {
    activeElement = element;
  };
  const trigger = createFocusable("export trigger", setActive, focusLog);
  activeElement = trigger;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: { nodeType: 1, style: {} },
      get activeElement() {
        return activeElement;
      },
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener: (type: string, listener: Listener) => {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((entry) => entry !== listener),
        );
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: () => ({
        addEventListener: () => undefined,
        matches: false,
        removeEventListener: () => undefined,
      }),
    },
  });

  try {
    callback({
      focusLog,
      makeFocusable(name) {
        return createFocusable(name, setActive, focusLog);
      },
      fireDocument(type, firedEvent) {
        for (const listener of listeners.get(type) ?? []) {
          listener({ type, ...firedEvent });
        }
      },
    });
  } finally {
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

function withPatchedReact<T>(
  refs: unknown[],
  callback: (cleanups: Array<() => void>) => T,
): T {
  const mutableReact = React as unknown as Record<string, unknown>;
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
  const cleanups: Array<() => void> = [];
  let refIndex = 0;
  mutableReact.useCallback = (fn: unknown) => fn;
  mutableReact.useContext = () => null;
  mutableReact.useEffect = (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup);
  };
  mutableReact.useId = () => "fake-id";
  mutableReact.useLayoutEffect = (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup);
  };
  mutableReact.useMemo = (factory: () => unknown) => factory();
  mutableReact.useRef = (initial: unknown) => ({
    current: refIndex < refs.length ? refs[refIndex++] : initial,
  });
  mutableReact.useState = (initial: unknown) => [
    typeof initial === "function" ? (initial as () => unknown)() : initial,
    () => undefined,
  ];
  mutableReact.useSyncExternalStore = (
    _subscribe: unknown,
    getSnapshot: () => unknown,
  ) => getSnapshot();
  try {
    return callback(cleanups);
  } finally {
    Object.assign(React, original);
  }
}

function walkPortal(node: ReactNode, visit: (element: ElementLike) => void) {
  if (Array.isArray(node)) {
    for (const child of node) walkPortal(child, visit);
    return;
  }
  if (!isValidElement(node)) {
    const portalChildren = (node as { children?: ReactNode } | null)?.children;
    if (portalChildren) walkPortal(portalChildren, visit);
    return;
  }
  const element = node as ElementLike;
  visit(element);
  walkPortal(element.props.children as ReactNode, visit);
}

function collectElementsFromPortal(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
) {
  const matches: ElementLike[] = [];
  walkPortal(node, (element) => {
    if (predicate(element)) matches.push(element);
  });
  return matches;
}

function resolveDialogSurface(dialog: ElementLike) {
  const surface = (
    dialog.type as (props: Record<string, unknown>) => ReactNode
  )(dialog.props) as ElementLike;
  return (surface.type as (props: Record<string, unknown>) => ReactNode)(
    surface.props,
  );
}

function createHookRenderer() {
  return createReactRenderHarness();
}

function findRequiredElement(
  root: ReactNode,
  predicate: (element: ElementLike) => boolean,
  message: string,
): ElementLike {
  const [element] = collectElements(root, predicate);
  assert.ok(element, message);
  return element;
}

function renderTopToolbar(root: ReactNode): ReactNode {
  const toolbar = findRequiredElement(
    root,
    (element) => element.type === SlideEditorTopToolbar,
    "expected top toolbar",
  );
  return SlideEditorTopToolbar(
    toolbar.props as unknown as Parameters<typeof SlideEditorTopToolbar>[0],
  );
}

function buildWarningPreflight(): PresentationExportPreflightResult {
  return {
    format: "pptx",
    label: "PPTX",
    diagnostics: [],
    fatalDiagnostics: [],
    warningDiagnostics: [],
    fallbackTiers: ["native"],
    hasFatal: false,
    hasWarnings: true,
    canExport: true,
  };
}

/**
 * Runs `body` inside a `withDefaultDom` scope and drains a few event-loop
 * ticks before that scope's `document`/`window` are torn down.
 *
 * Each test below clicks an export menu item's `onClick` directly (bypassing
 * React's synthetic event system), which makes the resulting
 * `setExportPreflight` update settle via React's real scheduler rather than
 * `act()`'s synchronous flush. That leaves `SlideEditor`'s keydown effect
 * cleanup/re-registration (`window.removeEventListener`) still pending a
 * macrotask after `body`'s last `renderer.run()` call — i.e. after
 * `createHookRenderer()`'s harness would otherwise already have torn down
 * its `document`/`window` — so it must observe the fake DOM installed by
 * this (outer, nesting-safe — see `react-render-harness.test.ts`) scope
 * instead of throwing "window is not defined".
 */
async function runWithSettledDom(body: () => Promise<void> | void) {
  await withDefaultDom(async () => {
    await body();
    await act(async () => {
      await waitForAsyncDrain();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });
  });
}

describe("SlideEditor export preflight", () => {
  test("routes export preflight through Dialog focus management and restores focus to the export trigger", () => {
    withModalDom((dom) => {
      let closeCalls = 0;
      let continueCalls = 0;
      const cancel = dom.makeFocusable("cancel");
      const continueExport = dom.makeFocusable("continue");
      const panel = {
        focus: () => dom.focusLog.push("panel"),
        querySelectorAll: () => [cancel, continueExport],
      };
      const dialog = ExportPreflightDialog({
        result: buildWarningPreflight(),
        onClose: () => {
          closeCalls += 1;
        },
        onContinue: () => {
          continueCalls += 1;
        },
      }) as ElementLike;

      assert.equal(dialog.type, Dialog);
      assert.equal(dialog.props.open, true);
      assert.match(String(dialog.props.className), /max-w-xl/);

      withPatchedReact([panel], (cleanups) => {
        const portal = resolveDialogSurface(dialog);
        const [dialogPanel] = collectElementsFromPortal(
          portal,
          (element) => element.props.role === "dialog",
        );
        assert.ok(dialogPanel, "expected Dialog to render a modal panel");
        assert.deepEqual(dom.focusLog, ["cancel"]);

        (dialogPanel.props.onKeyDown as (key: unknown) => void)(
          event({ key: "Tab" }),
        );
        assert.deepEqual(dom.focusLog, ["cancel", "continue"]);

        (dialogPanel.props.onKeyDown as (key: unknown) => void)(
          event({ key: "Tab", shiftKey: true }),
        );
        assert.deepEqual(dom.focusLog, ["cancel", "continue", "cancel"]);

        dom.fireDocument("keydown", event({ key: "Escape" }));
        const cancelButton = collectElements(dialog, () => true).find(
          (element) =>
            element.type === "button" && flattenText(element) === "Cancel",
        );
        assert.ok(cancelButton, "expected Cancel button");
        (cancelButton.props.onClick as () => void)();
        cleanups.forEach((cleanup) => cleanup());
      });

      assert.equal(closeCalls, 2);
      assert.equal(continueCalls, 0);
      assert.equal(dom.focusLog.at(-1), "export trigger");
    });
  });

  test("portals the export menu so real pointer activation escapes toolbar clipping", () => {
    const renderer = createHookRenderer();
    try {
      const tree = renderer.run(() =>
        SlideEditor({
          documentId: "doc-export-menu-pointer",
          deck: buildDeck([
            buildSlide("content", [], {
              id: "slide-1",
            }),
          ]),
          themePackage: buildMinimalThemePackage(),
          onDeckChange: () => undefined,
          onExportPptx: async () => undefined,
        }),
      );
      const toolbar = renderTopToolbar(tree);
      const exportPopover = findRequiredElement(
        toolbar,
        (element) =>
          element.type === Popover &&
          element.props["aria-label"] === "Export slides",
        "expected export popover",
      );
      const exportPptx = findRequiredElement(
        toolbar,
        (element) =>
          element.type === "button" &&
          element.props["aria-label"] === "Export PPTX",
        "expected PPTX export menu item",
      );

      assert.equal(exportPopover.props.portal, true);
      assert.equal(typeof exportPptx.props.onClick, "function");
    } finally {
      renderer.cleanup();
    }
  });

  // Clicking the export menu item below calls its `onClick` directly
  // (bypassing React's synthetic event system), which makes the resulting
  // `setExportPreflight` update settle via React's real scheduler rather
  // than `act()`'s synchronous flush — see `runWithSettledDom`'s docstring.
  test("blocks PDF download behind a fatal format preflight", () =>
    runWithSettledDom(() => {
      const deck = buildDeck([
        buildSlide(
          "content",
          [
            buildImageNode("missing-image", {
              id: "image-missing",
            }),
          ],
          { id: "slide-1" },
        ),
      ]);
      const renderer = createHookRenderer();
      let pdfExports = 0;

      let tree = renderer.run(() =>
        SlideEditor({
          documentId: "doc-export-preflight",
          deck,
          themePackage: buildMinimalThemePackage(),
          onDeckChange: () => undefined,
          onExportPdf: async () => {
            pdfExports += 1;
          },
        }),
      );

      const requestPdfExport = findRequiredElement(
        renderTopToolbar(tree),
        (element) =>
          element.type === "button" &&
          element.props["aria-label"] === "Export PDF",
        "expected PDF export menu item",
      ).props.onClick;
      if (typeof requestPdfExport !== "function") {
        throw new TypeError("Expected PDF export menu item to be clickable");
      }
      requestPdfExport();

      tree = renderer.run(() =>
        SlideEditor({
          documentId: "doc-export-preflight",
          deck,
          themePackage: buildMinimalThemePackage(),
          onDeckChange: () => undefined,
          onExportPdf: async () => {
            pdfExports += 1;
          },
        }),
      );

      const dialogElement = findRequiredElement(
        tree,
        (element) => element.type === ExportPreflightDialog,
        "expected PDF export preflight dialog",
      );
      const result = dialogElement.props
        .result as PresentationExportPreflightResult;
      const dialog = ExportPreflightDialog({
        result,
        onClose: () => undefined,
        onContinue: () => undefined,
      });
      const continueButton = findRequiredElement(
        dialog,
        (element) =>
          element.type === "button" &&
          flattenText(element).includes("Continue export"),
        "expected continue button",
      );

      assert.equal(pdfExports, 0);
      assert.equal(result.canExport, false);
      assert.match(result.fatalDiagnostics[0]?.message ?? "", /missing-image/);
      assert.equal(continueButton.props.disabled, true);
      assert.match(flattenText(dialog), /Fix blockers/);
    }));

  test("routes command palette PDF export through the same preflight gate", () =>
    runWithSettledDom(() => {
      const deck = buildDeck([
        buildSlide(
          "content",
          [
            buildImageNode("missing-image", {
              id: "image-missing",
            }),
          ],
          { id: "slide-1" },
        ),
      ]);
      const renderer = createHookRenderer();
      let pdfExports = 0;

      let tree = renderer.run(() =>
        SlideEditor({
          documentId: "doc-command-palette-export-preflight",
          deck,
          themePackage: buildMinimalThemePackage(),
          onDeckChange: () => undefined,
          onExportPdf: async () => {
            pdfExports += 1;
          },
        }),
      );

      const commandPalette = findRequiredElement(
        tree,
        (element) => element.type === SlideCommandPalette,
        "expected slide command palette",
      );
      const commands = commandPalette.props.commands as ReadonlyArray<{
        id: string;
        disabledReason?: string;
      }>;
      const pdfExportCommand = commands.find(
        (command) => command.id === "export.pdf",
      );
      assert.ok(pdfExportCommand, "expected PDF export command");
      assert.equal(pdfExportCommand.disabledReason, undefined);

      const runCommand = commandPalette.props.onRun;
      if (typeof runCommand !== "function") {
        throw new TypeError("Expected command palette to expose a runner");
      }
      runCommand(pdfExportCommand);

      tree = renderer.run(() =>
        SlideEditor({
          documentId: "doc-command-palette-export-preflight",
          deck,
          themePackage: buildMinimalThemePackage(),
          onDeckChange: () => undefined,
          onExportPdf: async () => {
            pdfExports += 1;
          },
        }),
      );

      const dialogElement = findRequiredElement(
        tree,
        (element) => element.type === ExportPreflightDialog,
        "expected command palette export preflight dialog",
      );
      const result = dialogElement.props
        .result as PresentationExportPreflightResult;

      assert.equal(pdfExports, 0);
      assert.equal(result.format, "pdf");
      assert.equal(result.canExport, false);
      assert.match(result.fatalDiagnostics[0]?.message ?? "", /missing-image/);
    }));

  test("continues PPTX export after warning preflight review", () =>
    runWithSettledDom(async () => {
      const deck = buildDeck([
        buildSlide(
          "content",
          [
            buildVisualNode({
              id: "visual-warning",
              content: { visualId: "visual-without-rendered-asset" },
            }),
          ],
          { id: "slide-1" },
        ),
      ]);
      const renderer = createHookRenderer();
      let pptxExports = 0;

      let tree = renderer.run(() =>
        SlideEditor({
          documentId: "doc-export-preflight-warning",
          deck,
          themePackage: buildMinimalThemePackage(),
          onDeckChange: () => undefined,
          onExportPptx: async () => {
            pptxExports += 1;
          },
        }),
      );

      const requestPptxExport = findRequiredElement(
        renderTopToolbar(tree),
        (element) =>
          element.type === "button" &&
          element.props["aria-label"] === "Export PPTX",
        "expected PPTX export menu item",
      ).props.onClick;
      if (typeof requestPptxExport !== "function") {
        throw new TypeError("Expected PPTX export menu item to be clickable");
      }
      await requestPptxExport();

      tree = renderer.run(() =>
        SlideEditor({
          documentId: "doc-export-preflight-warning",
          deck,
          themePackage: buildMinimalThemePackage(),
          onDeckChange: () => undefined,
          onExportPptx: async () => {
            pptxExports += 1;
          },
        }),
      );

      const dialogElement = findRequiredElement(
        tree,
        (element) => element.type === ExportPreflightDialog,
        "expected PPTX export preflight dialog",
      );
      const result = dialogElement.props
        .result as PresentationExportPreflightResult;

      assert.equal(result.canExport, true);
      assert.equal(result.hasWarnings, true);
      assert.equal(pptxExports, 0);

      const continueExport = dialogElement.props.onContinue;
      if (typeof continueExport !== "function") {
        throw new TypeError("Expected export preflight to be continuable");
      }
      continueExport();

      assert.equal(pptxExports, 1);
    }));
});
