/**
 * Shared harness for direct behavior tests of client Lexical/editor
 * components (#1958) — the nine `src/app/app/documents/[id]/*` surfaces that
 * were previously (invalidly) covered only by skipped/mapped E2E specs.
 *
 * There is no jsdom/testing-library in this repo; component tests are built
 * from two primitives only: `@lexical/headless`'s `createHeadlessEditor` (a
 * real, non-DOM Lexical editor) and `react-test-renderer`. This module
 * factors out the handful of conventions already proven across
 * `document-export-button.test.tsx`, `use-editing-surface.test.ts`, and
 * `editor-context-provider.test.ts` so each per-component test file states
 * its scenario, not its plumbing:
 *
 * - `makeHeadlessEditor` / `composerContextFor` / `mountWithComposer`: wire a
 *   real headless editor into `LexicalComposerContext.Provider` and mount
 *   with `act`/`create` (NOT the `react-render-harness`'s non-committing
 *   `run()`, which cannot propagate context to nested consumers).
 * - `installFakeDom`: a portal-safe fake `document`/`window`. Critically,
 *   `document.body`/`document.head` expose a real `children: []` array —
 *   `react-test-renderer`'s host config indexes into a portal container's
 *   `.children` (via `indexOf`/`splice` in `appendChild`/`removeChild`/
 *   `insertBefore`), so `createPortal(x, document.body)` throws without it.
 *   The repo's existing `installFakeDom` (in `document-export-button.test.tsx`)
 *   predates this discovery and only works because its own tests never
 *   render a portal into `document.body` from inside the mounted tree in a
 *   way that exercises those host-config paths; new tests should use this
 *   version instead of copying that one.
 * - `textOf` / `waitForAsyncDrain` / `createDeferred`: unchanged from the
 *   established `document-export-button.test.tsx` conventions.
 * - `withMatchMedia`: flips the fake `window.matchMedia` result, matching
 *   `use-editing-surface.test.ts`'s helper of the same name.
 *
 * Importing this module also imports `@/test/react-render-harness` for its
 * side effect (flips `IS_REACT_ACT_ENVIRONMENT` on and installs a baseline
 * document/window if none exists yet), matching every other direct test in
 * this subsystem.
 */
import { createElement, type ReactElement, type ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type TestRendererOptions,
} from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import type { Klass, LexicalEditor, LexicalNode } from "lexical";

// Side effect only: flips `IS_REACT_ACT_ENVIRONMENT` on and installs a
// baseline document/window (if none is already present) for effects that run
// before an individual test installs its own fake DOM.
import "@/test/react-render-harness";

export function makeHeadlessEditor(options: {
  namespace: string;
  nodes?: ReadonlyArray<Klass<LexicalNode>>;
  onError?: (error: Error) => void;
}): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: options.namespace,
    nodes: options.nodes,
    onError(error) {
      if (options.onError) {
        options.onError(error);
        return;
      }
      throw error;
    },
  });
  // A real, unmounted browser editor returns `null` from these; the headless
  // implementations instead *throw* "not supported in headless mode" (see
  // `@lexical/headless`'s `LexicalHeadless.dev.js`). Components that read the
  // DOM through the editor (e.g. `EditorContextProvider`) are written to
  // tolerate the real "no DOM yet" case, so default to matching it here.
  // Individual tests can still override either method per scenario to
  // observe the DOM-derived branches (`editor.getRootElement = () => el`).
  editor.getRootElement = (() => null) as typeof editor.getRootElement;
  editor.getElementByKey = (() => null) as typeof editor.getElementByKey;
  return editor;
}

export function composerContextFor(
  editor: LexicalEditor,
): LexicalComposerContextWithEditor {
  return [editor, createLexicalComposerContext(null, null)];
}

/** Mounts `element` inside a real `LexicalComposerContext.Provider`. */
export function mountWithComposer(
  editor: LexicalEditor,
  element: ReactElement,
  options?: TestRendererOptions,
): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      createElement(
        LexicalComposerContext.Provider,
        { value: composerContextFor(editor) },
        element,
      ),
      options,
    );
  });
  return renderer;
}

/** Mounts `element` directly, with no Lexical composer context. */
export function mount(
  element: ReactElement,
  options?: TestRendererOptions,
): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element, options);
  });
  return renderer;
}

export function unmount(renderer: ReactTestRenderer): void {
  act(() => {
    renderer.unmount();
  });
}

/** Recursively flattens a `ReactTestInstance` subtree into visible text. */
export function textOf(node: ReactTestInstance | string | number): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  return node.children.map(textOf).join("");
}

export function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Forces any pending, non-`discrete` editor update to commit synchronously.
 * `editor.dispatchCommand`'s own internal `editor.update()` call (used by
 * e.g. `tool.run`'s `FORMAT_TEXT_COMMAND` dispatch) is not itself discrete, so
 * the resulting state change isn't guaranteed visible to a synchronous
 * `editor.getEditorState().read(...)` immediately afterward — an empty
 * discrete update flushes it.
 */
export function flushEditor(editor: LexicalEditor): void {
  editor.update(() => undefined, { discrete: true });
}

export function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
}

type FakeDomNode = {
  nodeType: 1;
  children: unknown[];
  style: Record<string, string>;
  appendChild: (child: unknown) => unknown;
  removeChild: (child: unknown) => unknown;
  setAttribute: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  getBoundingClientRect: () => DOMRect;
  /**
   * `react-test-renderer` resolves refs for portalled content (anything
   * rendered via `createPortal(x, document.body)`, which every
   * `FloatingSurface`-based popover/toolbar/menu does) through *this*
   * container's own `createNodeMock`, not the `options.createNodeMock`
   * passed to the top-level `create()`/`mount()` call — portals push their
   * own `containerInfo` as the host context's root instance. Defaults to
   * React's own no-op (`() => null`); tests that need real ref behavior for
   * portalled elements (e.g. roving-tabindex focus management) reassign
   * `document.body.createNodeMock` directly for the scope that needs it.
   */
  createNodeMock: (element: ReactElement) => unknown;
};

function fakeRect(): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * A portal-safe fake DOM element: a real `children` array so
 * `react-test-renderer`'s host config can treat it as a portal container.
 */
function createFakeDomNode(): FakeDomNode {
  const children: unknown[] = [];
  return {
    nodeType: 1,
    children,
    style: {},
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    removeChild: (child) => {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      return child;
    },
    setAttribute: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getBoundingClientRect: fakeRect,
    createNodeMock: () => null,
  };
}

export type FakeDomOverrides = {
  document?: Record<string, unknown>;
  window?: Record<string, unknown>;
  navigator?: Record<string, unknown>;
};

/**
 * A minimal, subclassable `HTMLElement` stand-in. Several hooks (e.g.
 * `useActiveTableCaptionKey`) do `document.activeElement instanceof
 * HTMLElement`, which throws under Node unless *some* `HTMLElement` global
 * exists (even when `activeElement` itself is `null` — `x instanceof
 * undefined` throws regardless of `x`). `installFakeDom` installs this as the
 * global by default; tests that need a focused element construct one
 * directly (optionally with a `closest()` match) and assign it to
 * `document.activeElement`.
 */
export class FakeHTMLElement {
  dataset: Record<string, string>;
  private readonly closestSelector: string | null;
  private readonly closestMatch: FakeHTMLElement | null;

  constructor(
    dataset: Record<string, string> = {},
    closestMatch: FakeHTMLElement | null = null,
    closestSelector: string | null = null,
  ) {
    this.dataset = dataset;
    this.closestMatch = closestMatch;
    this.closestSelector = closestSelector;
  }

  closest(selector: string): FakeHTMLElement | null {
    return selector === this.closestSelector ? this.closestMatch : null;
  }
}

/**
 * Installs a portal-safe fake `document`/`window`/`navigator`/`HTMLElement`,
 * returning a restore function. Safe to nest with the baseline stubs
 * `react-render-harness` installs — this always replaces whatever is
 * currently there and restores the exact prior descriptor on cleanup.
 */
export function installFakeDom(overrides: FakeDomOverrides = {}): () => void {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const previousHTMLElement = Object.getOwnPropertyDescriptor(
    globalThis,
    "HTMLElement",
  );

  const body = createFakeDomNode();
  const head = createFakeDomNode();

  const fakeDocument = {
    body,
    head,
    activeElement: null as unknown,
    createElement: () => createFakeDomNode(),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    ...overrides.document,
  };

  const fakeWindow = {
    document: fakeDocument,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getSelection: () => null,
    matchMedia: (query: string) => ({
      media: query,
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => undefined,
    innerWidth: 1024,
    innerHeight: 768,
    ...overrides.window,
  };

  const fakeNavigator = {
    ...overrides.navigator,
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: fakeDocument,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: fakeWindow,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: fakeNavigator,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    writable: true,
    value: FakeHTMLElement,
  });

  return () => {
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      delete (globalThis as { document?: unknown }).document;
    }
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
    if (previousHTMLElement) {
      Object.defineProperty(globalThis, "HTMLElement", previousHTMLElement);
    } else {
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    }
  };
}

/** Flips the *currently installed* fake `window.matchMedia` result. */
export function withMatchMedia<T>(matches: boolean, run: () => T): T {
  const fakeWindow = globalThis.window as unknown as {
    matchMedia: (query: string) => {
      matches: boolean;
      addEventListener: () => void;
      removeEventListener: () => void;
    };
  };
  const original = fakeWindow.matchMedia;
  fakeWindow.matchMedia = () => ({
    matches,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  try {
    return run();
  } finally {
    fakeWindow.matchMedia = original;
  }
}

export function findAllByRole(
  renderer: ReactTestRenderer,
  role: string,
): ReactTestInstance[] {
  return renderer.root.findAll((instance) => instance.props.role === role);
}

export function findByRole(
  renderer: ReactTestRenderer,
  role: string,
): ReactTestInstance {
  const matches = findAllByRole(renderer, role);
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one element with role "${role}", found ${matches.length}`,
    );
  }
  return matches[0] as ReactTestInstance;
}

export function findByLabel(
  renderer: ReactTestRenderer,
  type: string,
  label: string,
): ReactTestInstance {
  return renderer.root.find(
    (instance) =>
      instance.type === type && instance.props["aria-label"] === label,
  );
}

export type {
  ReactTestInstance,
  ReactTestRenderer,
  ReactNode,
  TestRendererOptions,
};
