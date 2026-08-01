/**
 * Direct contract coverage for `PresentButton` (issue #1933).
 *
 * `prepareDeckForOpen` (the deck-fetch/validate/fallback decision) already
 * has full pure-function coverage in `deck-open-preparation.test.ts`, so
 * this file focuses on the component's own wiring: the toolbar button's
 * accessible label/disabled/pending state, the loading state around the
 * async `handlePresent` call, composing the correct child (`PresentMode` on
 * success, the local `PresentOpenRecovery` dialog on failure) with the right
 * props, and the close callback resetting state.
 *
 * `createReactRenderHarness().run()` renders `PresentButton` on a real fiber
 * (so hooks execute for real and persist across calls) but never deep-
 * reconciles the returned element tree — so the real, heavy `<PresentMode>`
 * child is captured as a plain, un-executed element descriptor instead of
 * being mounted. `PresentOpenRecovery` is a small local function with no
 * hooks, so its element's `.type` (the function itself) can be invoked
 * directly to inspect its rendered markup without any source changes.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import React, {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { act } from "react-test-renderer";

import { buildMinimalDeck } from "@/test/builders/presentation-deck";
import { createReactRenderHarness } from "@/test/react-render-harness";

import type { FetchDeckResult } from "@/lib/document/persistence-types";
import { createBlankDeck } from "@/lib/presentation/empty-deck";
import { PresentMode } from "@/components/presentation/present-mode";
import { Dialog } from "@/components/ui/dialog";

import { PresentButton } from "./present-button";

type Listener = (event: Record<string, unknown>) => void;

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createDeferred<T>() {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((reason: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason: unknown) => reject?.(reason),
  };
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
  const trigger = createFocusable("present trigger", setActive, focusLog);
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

function stubDeckPort(
  fetchDeckJson: (documentId: string) => Promise<FetchDeckResult>,
) {
  return { fetchDeckJson };
}

type ElementLike = ReactElement<Record<string, unknown>>;

function fragmentChildren(node: ReactNode): ElementLike[] {
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: ReactNode }).children;
  const list = Array.isArray(children) ? children : [children];
  return list.filter((child): child is ElementLike => isValidElement(child));
}

function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  collectElements(
    (element.props as { children?: ReactNode }).children,
    collected,
  );
  return collected;
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

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function findButton(tree: ReactNode): ElementLike {
  // `<EditorToolbarButton>` is always the first child of the returned
  // fragment (the composed `PresentMode`/`PresentOpenRecovery` slots follow).
  const [button] = fragmentChildren(tree);
  assert.ok(button, "expected the EditorToolbarButton element");
  return button;
}

function clickPresentButton(tree: ReactNode): Promise<void> {
  return (findButton(tree).props.onClick as () => Promise<void>)();
}

function findByType(tree: ReactNode, type: unknown): ElementLike | undefined {
  return fragmentChildren(tree).find((element) => element.type === type);
}

describe("PresentButton", () => {
  test("idle render exposes an accessible, enabled toolbar button and no overlay", () => {
    const harness = createReactRenderHarness();
    try {
      const tree = harness.run(() =>
        PresentButton({
          documentId: "doc-1",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: null,
            revisionToken: null,
            themeDiagnostics: [],
          })),
        }),
      );
      const button = findButton(tree);
      assert.equal(button.props.label, "Present");
      assert.equal(button.props.tooltip, "Present fullscreen");
      assert.equal(button.props["aria-label"], "Present document");
      assert.equal(button.props.disabled, false);
      assert.equal(button.props.iconOnly, false);
      assert.equal(fragmentChildren(tree).length, 1);
    } finally {
      harness.cleanup();
    }
  });

  test("uses the document title in the accessible label and forwards iconOnly", () => {
    const harness = createReactRenderHarness();
    try {
      const tree = harness.run(() =>
        PresentButton({
          documentId: "doc-1",
          documentTitle: "Q3 Board Deck",
          iconOnly: true,
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: null,
            revisionToken: null,
            themeDiagnostics: [],
          })),
        }),
      );
      const button = findButton(tree);
      assert.equal(button.props["aria-label"], "Present Q3 Board Deck");
      assert.equal(button.props.iconOnly, true);
    } finally {
      harness.cleanup();
    }
  });

  test("duplicate activation shares one pending deck fetch", async () => {
    const harness = createReactRenderHarness();
    const deferred = createDeferred<FetchDeckResult>();
    let fetchCount = 0;
    try {
      const tree = harness.run(() =>
        PresentButton({
          documentId: "doc-once",
          deckPort: stubDeckPort(() => {
            fetchCount += 1;
            return deferred.promise;
          }),
        }),
      );
      let first!: Promise<void>;
      let second!: Promise<void>;
      act(() => {
        first = clickPresentButton(tree);
        second = clickPresentButton(tree);
      });

      assert.equal(fetchCount, 1);
      deferred.resolve({
        ok: true,
        deckJson: null,
        revisionToken: null,
        themeDiagnostics: [],
      });
      await act(async () => {
        await Promise.all([first, second]);
      });
    } finally {
      harness.cleanup();
    }
  });

  test("unmounting invalidates a pending presentation before it reads detached visuals", async () => {
    const harness = createReactRenderHarness();
    const deferred = createDeferred<FetchDeckResult>();
    let getVisualsCount = 0;
    const tree = harness.run(() =>
      PresentButton({
        documentId: "doc-late-present",
        deckPort: stubDeckPort(() => deferred.promise),
        getVisuals: () => {
          getVisualsCount += 1;
          return {};
        },
      }),
    );
    let settled!: Promise<void>;
    act(() => {
      settled = clickPresentButton(tree);
    });
    assert.equal(getVisualsCount, 0);

    harness.cleanup();
    deferred.resolve({
      ok: true,
      deckJson: buildMinimalDeck(),
      revisionToken: "rev-late",
      themeDiagnostics: [],
    });
    await act(async () => {
      await settled;
      await waitForAsyncDrain();
    });

    assert.equal(getVisualsCount, 0);
  });

  test("switching documents invalidates the old presentation request and unlocks the new document", async () => {
    const harness = createReactRenderHarness();
    const oldRequest = createDeferred<FetchDeckResult>();
    let oldVisualReads = 0;
    let tree = harness.run(() =>
      PresentButton({
        documentId: "doc-old",
        deckPort: stubDeckPort(() => oldRequest.promise),
        getVisuals: () => {
          oldVisualReads += 1;
          return {};
        },
      }),
    );
    let settled!: Promise<void>;
    act(() => {
      settled = clickPresentButton(tree);
    });

    tree = harness.run(() =>
      PresentButton({
        documentId: "doc-new",
        documentTitle: "New document",
        deckPort: stubDeckPort(async () => ({
          ok: true,
          deckJson: null,
          revisionToken: null,
          themeDiagnostics: [],
        })),
      }),
    );
    assert.equal(findButton(tree).props.disabled, false);
    assert.equal(findButton(tree).props["aria-label"], "Present New document");

    oldRequest.resolve({
      ok: true,
      deckJson: buildMinimalDeck(),
      revisionToken: "rev-old",
      themeDiagnostics: [],
    });
    await act(async () => {
      await settled;
      await waitForAsyncDrain();
    });
    tree = harness.run(() =>
      PresentButton({
        documentId: "doc-new",
        documentTitle: "New document",
        deckPort: stubDeckPort(async () => ({
          ok: true,
          deckJson: null,
          revisionToken: null,
          themeDiagnostics: [],
        })),
      }),
    );

    assert.equal(oldVisualReads, 0);
    assert.equal(findByType(tree, PresentMode), undefined);
    assert.equal(findButton(tree).props.disabled, false);
    harness.cleanup();
  });

  test("disables the button while the deck fetch is pending, then re-enables it", async () => {
    const harness = createReactRenderHarness();
    const deferred = createDeferred<FetchDeckResult>();
    let seenDocumentId: string | undefined;
    try {
      let tree = harness.run(() =>
        PresentButton({
          documentId: "doc-77",
          deckPort: stubDeckPort((documentId) => {
            seenDocumentId = documentId;
            return deferred.promise;
          }),
        }),
      );
      let clickResult: Promise<void> | undefined;
      act(() => {
        clickResult = clickPresentButton(tree);
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-77",
          deckPort: stubDeckPort(() => deferred.promise),
        }),
      );
      assert.equal(findButton(tree).props.disabled, true);

      await act(async () => {
        deferred.resolve({
          ok: true,
          deckJson: null,
          revisionToken: null,
          themeDiagnostics: [],
        });
        await clickResult;
        await waitForAsyncDrain();
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-77",
          deckPort: stubDeckPort(() => deferred.promise),
        }),
      );
      assert.equal(findButton(tree).props.disabled, false);
      assert.equal(seenDocumentId, "doc-77");
    } finally {
      harness.cleanup();
    }
  });

  test("a missing saved deck falls back to a blank deck rendered through PresentMode", async () => {
    const harness = createReactRenderHarness();
    try {
      let tree = harness.run(() =>
        PresentButton({
          documentId: "doc-blank",
          documentTitle: "Untitled talk",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: null,
            revisionToken: "rev-0",
            themeDiagnostics: [],
          })),
        }),
      );
      await act(async () => {
        await clickPresentButton(tree);
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-blank",
          documentTitle: "Untitled talk",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: null,
            revisionToken: "rev-0",
            themeDiagnostics: [],
          })),
        }),
      );
      const presentMode = findByType(tree, PresentMode);
      assert.ok(presentMode, "expected PresentMode to be composed");
      assert.deepEqual(
        presentMode!.props.deck,
        createBlankDeck({
          documentId: "doc-blank",
          title: "Untitled talk",
        }),
      );
      assert.deepEqual(presentMode!.props.visuals, {});
      assert.equal(typeof presentMode!.props.onClose, "function");
      assert.equal(findByType(tree, "PresentOpenRecovery"), undefined);
    } finally {
      harness.cleanup();
    }
  });

  test("an existing deck is opened through PresentMode with the resolved theme package and injected visuals", async () => {
    const harness = createReactRenderHarness();
    const deck = buildMinimalDeck();
    const visuals = { "visual-1": { id: "visual-1" } as unknown };
    try {
      let tree = harness.run(() =>
        PresentButton({
          documentId: "doc-9",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: deck,
            revisionToken: "rev-9",
            themeDiagnostics: [],
          })),
          getVisuals: () => visuals as never,
        }),
      );
      await act(async () => {
        await clickPresentButton(tree);
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-9",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: deck,
            revisionToken: "rev-9",
            themeDiagnostics: [],
          })),
          getVisuals: () => visuals as never,
        }),
      );
      const presentMode = findByType(tree, PresentMode);
      assert.ok(presentMode);
      assert.deepEqual(presentMode!.props.deck, deck);
      assert.deepEqual(presentMode!.props.visuals, visuals);
      assert.ok(presentMode!.props.themePackage);

      // Closing resets the composed child.
      act(() => {
        (presentMode!.props.onClose as () => void)();
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-9",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: deck,
            revisionToken: "rev-9",
            themeDiagnostics: [],
          })),
          getVisuals: () => visuals as never,
        }),
      );
      assert.equal(findByType(tree, PresentMode), undefined);
    } finally {
      harness.cleanup();
    }
  });

  test("a rejected deck fetch recovers with a friendly diagnostic dialog, and Close resets state", async () => {
    const harness = createReactRenderHarness();
    try {
      let tree = harness.run(() =>
        PresentButton({
          documentId: "doc-err",
          deckPort: stubDeckPort(async () => {
            throw new Error("connection reset");
          }),
        }),
      );
      await act(async () => {
        await clickPresentButton(tree);
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-err",
          deckPort: stubDeckPort(async () => {
            throw new Error("connection reset");
          }),
        }),
      );
      // No PresentMode composed while recovering.
      assert.equal(findByType(tree, PresentMode), undefined);
      const recovery = fragmentChildren(tree).find(
        (element) => typeof element.type === "function",
      );
      assert.ok(recovery, "expected the PresentOpenRecovery dialog element");
      const rendered = (recovery!.type as (props: unknown) => ReactNode)(
        recovery!.props,
      ) as ElementLike;
      assert.equal(rendered.type, Dialog);
      assert.equal(rendered.props.open, true);
      assert.equal(rendered.props["aria-labelledby"], "present-recovery-title");
      assert.match(
        textContent(rendered),
        /Presentation deck could not be opened/,
      );
      assert.match(
        textContent(rendered),
        /Check your connection and retry\.\s*\(connection reset\)/,
      );

      // The Close button in the recovery dialog wires back to onClose.
      const closeButton = collectElements(rendered).find(
        (element) => element.type === "button",
      );
      assert.ok(closeButton);
      act(() => {
        (closeButton!.props.onClick as () => void)();
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-err",
          deckPort: stubDeckPort(async () => {
            throw new Error("connection reset");
          }),
        }),
      );
      assert.equal(fragmentChildren(tree).length, 1);
    } finally {
      harness.cleanup();
    }
  });

  test("recovery dialog traps focus, closes on Escape, and restores focus to the Present trigger", async () => {
    const harness = createReactRenderHarness();
    const renderButton = () =>
      PresentButton({
        documentId: "doc-focus",
        deckPort: stubDeckPort(async () => {
          throw new Error("invalid deck");
        }),
      });
    const openRecovery = async () => {
      let tree = harness.run(renderButton);
      await act(async () => {
        await clickPresentButton(tree);
      });
      tree = harness.run(renderButton);
      const recovery = fragmentChildren(tree).find(
        (element) => typeof element.type === "function",
      );
      assert.ok(recovery, "expected recovery dialog");
      return (recovery!.type as (props: unknown) => ReactNode)(
        recovery!.props,
      ) as ElementLike;
    };

    try {
      let rendered = await openRecovery();
      assert.equal(rendered.type, Dialog);

      withModalDom((dom) => {
        const close = dom.makeFocusable("close");
        const panel = {
          focus: () => dom.focusLog.push("panel"),
          querySelectorAll: () => [close],
        };

        withPatchedReact([panel], (cleanups) => {
          const portal = resolveDialogSurface(rendered);
          const [dialogPanel] = collectElementsFromPortal(
            portal,
            (element) => element.props.role === "dialog",
          );
          assert.ok(dialogPanel, "expected Dialog to render a modal panel");
          assert.deepEqual(dom.focusLog, ["close"]);

          (dialogPanel.props.onKeyDown as (key: unknown) => void)(
            event({ key: "Tab" }),
          );
          assert.deepEqual(dom.focusLog, ["close", "close"]);

          act(() => {
            dom.fireDocument("keydown", event({ key: "Escape" }));
          });
          cleanups.forEach((cleanup) => cleanup());
        });

        assert.equal(dom.focusLog.at(-1), "present trigger");
      });

      let tree = harness.run(renderButton);
      assert.equal(fragmentChildren(tree).length, 1);

      rendered = await openRecovery();
      withModalDom((dom) => {
        const close = dom.makeFocusable("close");
        const panel = {
          focus: () => dom.focusLog.push("panel"),
          querySelectorAll: () => [close],
        };
        withPatchedReact([panel], (cleanups) => {
          resolveDialogSurface(rendered);
          const closeButton = collectElements(rendered).find(
            (element) => element.type === "button",
          );
          assert.ok(closeButton, "expected Close button");
          act(() => {
            (closeButton!.props.onClick as () => void)();
          });
          cleanups.forEach((cleanup) => cleanup());
        });
        assert.equal(dom.focusLog.at(-1), "present trigger");
      });

      tree = harness.run(renderButton);
      assert.equal(fragmentChildren(tree).length, 1);
    } finally {
      harness.cleanup();
    }
  });
});
