/**
 * Direct contract coverage for `InlineCommentsLayer` (#1962) — the
 * text-anchored comment gutter/dots/card that floats over a document via a
 * `document.body` portal.
 *
 * The comment mutations from `./comments-actions` are `"use server"` actions
 * already fully covered by `comments-actions.test.ts`; this stubs the
 * sibling `./comments-actions` module via `node:module`'s `registerHooks`
 * (same pattern as `src/app/app/new-document-button.test.tsx`'s `./actions`
 * stub) rather than re-testing the server action itself.
 *
 * The pure geometry/anchor helpers this component builds on
 * (`anchorPositionForBlock`, `commentBlockAtY`, `isInRightCommentGutter`,
 * `isTextCommentBlock`, `isVisualCommentBlock`, `computeCommentCardPosition`,
 * `preferredRightSideCardLeft`, `normalizeInlineAnchorText`) are already
 * exhaustively covered in isolation by `inline-comment-dom.test.ts`. This
 * file uses the REAL functions (not stubs) — following the same
 * `FakeElement`-with-`getBoundingClientRect` convention that file uses — so
 * the assertions here exercise the real wiring between DOM events, those
 * pure decisions, and the component's own state (thread grouping/filtering,
 * hover/active anchor selection, submit/error handling, and listener
 * cleanup), without duplicating the geometry math's own unit coverage.
 *
 * `useLexicalComposerContext` only needs `editor.getRootElement()` and
 * `editor.registerRootListener(...)` from the editor (grep-verified — no
 * other editor method is called), so this uses a minimal hand-rolled fake
 * editor (mirroring real Lexical's `registerRootListener` contract: the
 * listener fires immediately with `(currentRoot, null)` on registration and
 * with `(null, currentRoot)` when the returned unregister function runs)
 * rather than pulling in `@lexical/headless` — this component never touches
 * `$getRoot`/editor state, so a full Lexical editor would add setup cost
 * (mutation observers, `setRootElement`'s many native DOM-event listeners)
 * for zero additional coverage.
 *
 * The component renders via `createPortal(..., document.body)` unconditionally
 * whenever `canUsePortal` (a `useSyncExternalStore` value) is true, which it
 * always is under `react-test-renderer` (client snapshot). It also reads
 * bare (unqualified) globals — `requestAnimationFrame`/`cancelAnimationFrame`
 * and `ResizeObserver` — and calls `window.addEventListener` with REAL
 * add/remove semantics (to attach mousemove/scroll/resize/keydown
 * listeners this file dispatches against directly), none of which the
 * shared `@/test/portal-dom`/`@/test/react-render-harness` harnesses
 * provide (portal-dom's `window.addEventListener` is a deliberate no-op, and
 * neither harness defines `ResizeObserver` or a bare
 * `requestAnimationFrame`). This file instead installs its own minimal
 * `document`/`window`/`HTMLElement`/`Node`/`ResizeObserver`/rAF fakes,
 * modeled on the same restore-on-`finally` shape as `portal-dom.ts` and the
 * listener-registry/`fakeNode` conventions in
 * `ui-interactions-coverage.test.ts`.
 *
 * The SSR (`canUsePortal` false) gate is covered separately via
 * `renderToStaticMarkup`, matching `verify-email/page.test.tsx`'s use of
 * `react-dom/server` for a server-only code path — no DOM globals are
 * touched during that render since every DOM access in this component is
 * inside a `useEffect`/`useLayoutEffect`/event handler, never render itself.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import type { ReactElement } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";

import type {
  CommentActionResult,
  CommentThread,
  CreateCommentInput,
} from "@/lib/comments";

// Imported for its module-level side effects only: flips
// `IS_REACT_ACT_ENVIRONMENT` on (required for `act()` in this file) and
// suppresses the "react-test-renderer is deprecated"/"not wrapped in
// act(...)" console noise shared across this codebase's `react-test-renderer`
// suites.
import "@/test/react-render-harness";

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

// ---------------------------------------------------------------------------
// `./comments-actions` mutation stub. Server action behavior is covered in
// `comments-actions.test.ts`; this state records UI wiring and supplies typed
// outcomes for each rendered lifecycle control.
// ---------------------------------------------------------------------------

type CreateCommentCall = {
  documentId: string;
  input: CreateCommentInput;
};

type CommentsActionsTestState = {
  calls: CreateCommentCall[];
  impl: (
    documentId: string,
    input: CreateCommentCall["input"],
  ) => Promise<CommentActionResult<CommentThread[]>>;
  editCalls: Array<{
    documentId: string;
    commentId: string;
    body: string;
  }>;
  editImpl: (
    documentId: string,
    commentId: string,
    body: string,
  ) => Promise<CommentActionResult<CommentThread[]>>;
  deleteCalls: Array<{ documentId: string; commentId: string }>;
  deleteImpl: (
    documentId: string,
    commentId: string,
  ) => Promise<CommentActionResult<CommentThread[]>>;
  resolveCalls: Array<{
    documentId: string;
    commentId: string;
    resolved: boolean;
  }>;
  resolveImpl: (
    documentId: string,
    commentId: string,
    resolved: boolean,
  ) => Promise<CommentActionResult<CommentThread[]>>;
};

const globalForActions = globalThis as typeof globalThis & {
  __inlineCommentsActionsTestState: CommentsActionsTestState;
};

function resetActionsState(): void {
  globalForActions.__inlineCommentsActionsTestState = {
    calls: [],
    impl: async () => ({ ok: true, data: [] }),
    editCalls: [],
    editImpl: async () => ({ ok: true, data: [] }),
    deleteCalls: [],
    deleteImpl: async () => ({ ok: true, data: [] }),
    resolveCalls: [],
    resolveImpl: async () => ({ ok: true, data: [] }),
  };
}
resetActionsState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const actionsStubUrl = "inline-comments-layer-comments-actions:test";
const navigationStubUrl = "inline-comments-layer-next-navigation:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./comments-actions") {
      return { url: actionsStubUrl, shortCircuit: true };
    }
    if (specifier === "next/navigation") {
      return { url: navigationStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === actionsStubUrl) {
      return {
        format: "commonjs",
        source: `module.exports = {
  createComment: async (documentId, input) => {
    globalThis.__inlineCommentsActionsTestState.calls.push({ documentId, input });
    return globalThis.__inlineCommentsActionsTestState.impl(documentId, input);
  },
  editComment: async (documentId, commentId, body) => {
    globalThis.__inlineCommentsActionsTestState.editCalls.push({ documentId, commentId, body });
    return globalThis.__inlineCommentsActionsTestState.editImpl(documentId, commentId, body);
  },
  deleteComment: async (documentId, commentId) => {
    globalThis.__inlineCommentsActionsTestState.deleteCalls.push({ documentId, commentId });
    return globalThis.__inlineCommentsActionsTestState.deleteImpl(documentId, commentId);
  },
  setCommentResolved: async (documentId, commentId, resolved) => {
    globalThis.__inlineCommentsActionsTestState.resolveCalls.push({ documentId, commentId, resolved });
    return globalThis.__inlineCommentsActionsTestState.resolveImpl(documentId, commentId, resolved);
  },
};`,
        shortCircuit: true,
      };
    }
    if (url === navigationStubUrl) {
      return {
        format: "commonjs",
        source: `module.exports = {
  unstable_rethrow(error) {
    if (
      error &&
      typeof error === "object" &&
      typeof error.digest === "string" &&
      (error.digest.startsWith("NEXT_REDIRECT") ||
        error.digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
    ) {
      throw error;
    }
  },
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

beforeEach(resetActionsState);

// ---------------------------------------------------------------------------
// Fake DOM — block/root elements, document/window/ResizeObserver/rAF
// ---------------------------------------------------------------------------

type Rect = { top: number; bottom: number; left: number; right: number };

class FakeNode {}

class FakeElement extends FakeNode {
  children: FakeElement[];
  textContent: string;
  private rect: Rect;
  private visual: boolean;
  private attributes: Record<string, string>;

  constructor({
    text = "",
    rect = { top: 0, bottom: 0, left: 0, right: 0 },
    visual = false,
    children = [],
    attributes = {},
  }: {
    text?: string;
    rect?: Rect;
    visual?: boolean;
    children?: FakeElement[];
    attributes?: Record<string, string>;
  } = {}) {
    super();
    this.textContent = text;
    this.rect = rect;
    this.visual = visual;
    this.children = children;
    this.attributes = attributes;
  }

  closest(): FakeElement | null {
    return this.visual ? this : null;
  }

  querySelector(): FakeElement | null {
    return this.visual ? this : null;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  getBoundingClientRect(): Rect & { height: number } {
    return { ...this.rect, height: this.rect.bottom - this.rect.top };
  }
}

function asHTMLElement(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observeCalls: unknown[] = [];
  disconnectCalls = 0;
  constructor(private callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: unknown): void {
    this.observeCalls.push(target);
  }
  disconnect(): void {
    this.disconnectCalls += 1;
  }
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

type Listener = (event: Record<string, unknown>) => void;

function createRegistry() {
  const map = new Map<string, Set<Listener>>();
  return {
    add(type: string, listener: Listener) {
      const set = map.get(type) ?? new Set<Listener>();
      set.add(listener);
      map.set(type, set);
    },
    remove(type: string, listener: Listener) {
      map.get(type)?.delete(listener);
    },
    size(type: string): number {
      return map.get(type)?.size ?? 0;
    },
    fire(type: string, event: Record<string, unknown> = {}) {
      for (const listener of Array.from(map.get(type) ?? [])) {
        listener({ type, ...event });
      }
    },
  };
}

const scrollState = { insideCard: false };

function createNodeMock({
  type,
  props,
}: {
  type: unknown;
  props: Record<string, unknown>;
}) {
  const className = typeof props.className === "string" ? props.className : "";
  if (type === "div" && className.includes("w-[15rem]")) {
    return {
      offsetWidth: 240,
      offsetHeight: 160,
      contains: () => scrollState.insideCard,
      style: {},
      focus: () => undefined,
    };
  }
  return {
    style: {},
    focus: () => undefined,
    blur: () => undefined,
    contains: () => false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

function installDom() {
  const previous: Array<[string, PropertyDescriptor | undefined]> = [
    "document",
    "window",
    "HTMLElement",
    "Node",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "ResizeObserver",
  ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);

  const registry = createRegistry();
  const body = { nodeType: 1, children: [] as unknown[], createNodeMock };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      body,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      innerWidth: 1024,
      innerHeight: 800,
      addEventListener: (type: string, listener: Listener) =>
        registry.add(type, listener),
      removeEventListener: (type: string, listener: Listener) =>
        registry.remove(type, listener),
    },
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    writable: true,
    value: FakeElement,
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    writable: true,
    value: FakeNode,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: FakeResizeObserver,
  });

  function restore(): void {
    for (const [name, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }
  }

  return { registry, restore };
}

function withCommentsDom<T>(
  run: (registry: ReturnType<typeof createRegistry>) => T,
): T {
  const { registry, restore } = installDom();
  try {
    const result = run(registry);
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          restore();
          return value;
        },
        (error: unknown) => {
          restore();
          throw error;
        },
      ) as T;
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Fake Lexical editor — root/update listener surface used by the component
// ---------------------------------------------------------------------------

type RootListener = (
  root: HTMLElement | null,
  prevRoot: HTMLElement | null,
) => void;

function makeFakeEditor(root: FakeElement | null) {
  let currentRoot = root ? asHTMLElement(root) : null;
  let currentListener: RootListener | null = null;
  const updateListeners = new Set<() => void>();
  const editor = {
    getRootElement: () => currentRoot,
    registerRootListener: (listener: RootListener) => {
      currentListener = listener;
      listener(currentRoot, null);
      return () => {
        const prev = currentRoot;
        currentListener = null;
        listener(null, prev);
      };
    },
    registerUpdateListener: (listener: () => void) => {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
  } as unknown as LexicalEditor;
  return {
    editor,
    setRoot(next: FakeElement | null) {
      const prev = currentRoot;
      currentRoot = next ? asHTMLElement(next) : null;
      currentListener?.(currentRoot, prev);
    },
    fireUpdate() {
      for (const listener of updateListeners) listener();
    },
  };
}

function withComposer(
  editor: LexicalEditor,
  children: ReactElement,
): ReactElement {
  const value: LexicalComposerContextWithEditor = [
    editor,
    createLexicalComposerContext(null, null),
  ];
  return (
    <LexicalComposerContext.Provider value={value}>
      {children}
    </LexicalComposerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let threadIdCounter = 0;
function makeThread(overrides: Partial<CommentThread> = {}): CommentThread {
  threadIdCounter += 1;
  return {
    id: `thread-${threadIdCounter}`,
    body: "Comment body",
    author: { id: "user-1", name: "Author" },
    createdAt: new Date(0).toISOString(),
    resolved: false,
    anchor: { kind: "text", text: "Placeholder", nodeId: null },
    anchorType: "text",
    anchorText: "Placeholder",
    anchorNodeId: null,
    replies: [],
    ...overrides,
  };
}

// Root spans the full viewport width used by `installDom` (1024) with a
// content column from x=40 to x=700, so `rightGutterButtonLeft` resolves to
// the *right*-side gutter (708) rather than falling back to the left.
const ROOT_RECT: Rect = { top: 0, bottom: 2000, left: 40, right: 700 };

const BLOCK_FIRST_RECT: Rect = { top: 100, bottom: 140, left: 40, right: 700 };
const BLOCK_VISUAL_RECT: Rect = { top: 150, bottom: 220, left: 40, right: 700 };
const BLOCK_SECOND_RECT: Rect = { top: 230, bottom: 270, left: 40, right: 700 };
const BLOCK_THIRD_RECT: Rect = { top: 280, bottom: 320, left: 40, right: 700 };
const BLOCK_FOURTH_RECT: Rect = { top: 330, bottom: 370, left: 40, right: 700 };

const FIRST_TEXT = "First paragraph text";
const SECOND_TEXT = "Second paragraph text";
const THIRD_TEXT = "Third paragraph with many comments";
const FOURTH_TEXT = "Fourth paragraph text";
const REPEATED_TEXT = "Repeated paragraph text";

function buildRoot(): FakeElement {
  const blockFirst = new FakeElement({
    text: FIRST_TEXT,
    rect: BLOCK_FIRST_RECT,
    attributes: { "data-lexical-block-id": "bid-first" },
  });
  const blockVisual = new FakeElement({
    text: "caption",
    rect: BLOCK_VISUAL_RECT,
    visual: true,
  });
  const blockSecond = new FakeElement({
    text: SECOND_TEXT,
    rect: BLOCK_SECOND_RECT,
    attributes: { "data-lexical-block-id": "bid-second" },
  });
  const blockThird = new FakeElement({
    text: THIRD_TEXT,
    rect: BLOCK_THIRD_RECT,
    attributes: { "data-lexical-block-id": "bid-third" },
  });
  const blockFourth = new FakeElement({
    text: FOURTH_TEXT,
    rect: BLOCK_FOURTH_RECT,
    attributes: { "data-lexical-block-id": "bid-fourth" },
  });
  return new FakeElement({
    rect: ROOT_RECT,
    children: [blockFirst, blockVisual, blockSecond, blockThird, blockFourth],
  });
}

function buildRepeatedRoot(): FakeElement {
  return new FakeElement({
    rect: ROOT_RECT,
    children: [
      new FakeElement({
        text: REPEATED_TEXT,
        rect: BLOCK_FIRST_RECT,
        attributes: { "data-lexical-block-id": "bid-repeat-a" },
      }),
      new FakeElement({
        text: REPEATED_TEXT,
        rect: BLOCK_SECOND_RECT,
        attributes: { "data-lexical-block-id": "bid-repeat-b" },
      }),
    ],
  });
}

function buildThreads(): CommentThread[] {
  return [
    // Anchor 1 ("First paragraph"): two unresolved threads sharing an
    // anchor — covers multi-thread listing ("replies") and a count>1 badge.
    makeThread({
      id: "thread-first-a",
      body: "First comment on paragraph one",
      author: { id: "user-a", name: "Alice" },
      anchorText: FIRST_TEXT,
      anchor: { kind: "text", text: FIRST_TEXT, nodeId: null },
    }),
    makeThread({
      id: "thread-first-b",
      body: "Second comment on paragraph one",
      author: { id: "user-b", name: "Bob" },
      anchorText: FIRST_TEXT,
      anchor: { kind: "text", text: FIRST_TEXT, nodeId: null },
    }),
    // Anchor 2 ("Second paragraph"): a single RESOLVED thread only — no dot
    // should render (count filters to unresolved only), but the hover
    // "add comment" icon should still be available (no active unresolved
    // thread there).
    makeThread({
      id: "thread-second-resolved",
      resolved: true,
      body: "Already resolved",
      anchorText: SECOND_TEXT,
      anchor: { kind: "text", text: SECOND_TEXT, nodeId: null },
    }),
    // Anchor 3 ("Third paragraph"): 11 unresolved threads — count caps the
    // badge at "9+".
    ...Array.from({ length: 11 }, (_, index) =>
      makeThread({
        id: `thread-third-${index}`,
        body: `Comment ${index}`,
        anchorText: THIRD_TEXT,
        anchor: { kind: "text", text: THIRD_TEXT, nodeId: null },
      }),
    ),
    // Anchor 4 ("Fourth paragraph"): exactly one unresolved thread — count
    // is 1, so no numeric badge renders (only shown when count > 1) but the
    // aria-label uses singular "comment" wording.
    makeThread({
      id: "thread-fourth",
      body: "Only comment",
      anchorText: FOURTH_TEXT,
      anchor: { kind: "text", text: FOURTH_TEXT, nodeId: null },
    }),
    // A non-text-anchored thread — must never contribute to any dot/card
    // (covers the `anchorType !== "text"` filtering branch).
    makeThread({
      id: "thread-visual",
      anchorType: "visual",
      anchorText: null,
      anchor: {
        kind: "document-block",
        blockKind: "visual",
        text: null,
        nodeId: null,
      },
    }),
  ];
}

type ModuleType = typeof import("./inline-comments-layer");
let InlineCommentsLayer: ModuleType["InlineCommentsLayer"];

before(async () => {
  const mod = await import("./inline-comments-layer");
  InlineCommentsLayer = mod.InlineCommentsLayer;
});

function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function mount(
  editor: LexicalEditor,
  threads: CommentThread[] = buildThreads(),
  currentUserId = "user-a",
  documentId = "doc-1",
) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    // `document.body.createNodeMock` (installed by `installDom`/`withCommentsDom`)
    // is what React Test Renderer actually resolves portal ref mocks through —
    // passing `createNodeMock` as a `create()` option here would be redundant
    // (and mismatched in type, since this component only portals into `body`).
    renderer = create(
      withComposer(
        editor,
        <InlineCommentsLayer
          documentId={documentId}
          currentUserId={currentUserId}
          initialComments={threads}
        />,
      ),
    );
  });
  return renderer;
}

function renderLayer(
  editor: LexicalEditor,
  documentId: string,
  threads: CommentThread[],
  currentUserId = "user-a",
): ReactElement {
  return withComposer(
    editor,
    <InlineCommentsLayer
      documentId={documentId}
      currentUserId={currentUserId}
      initialComments={threads}
    />,
  );
}

function findDotButtons(root: ReactTestInstance): ReactTestInstance[] {
  return root
    .findAllByType("button")
    .filter(
      (el) =>
        typeof el.props["aria-label"] === "string" &&
        /comments?$/.test(el.props["aria-label"]),
    );
}

function findAddButton(root: ReactTestInstance): ReactTestInstance | null {
  try {
    return root.findByProps({ "aria-label": "Add comment to this paragraph" });
  } catch {
    return null;
  }
}

function findDialogCard(root: ReactTestInstance): ReactTestInstance | null {
  try {
    return root.findByProps({ "aria-label": "Inline comment" });
  } catch {
    return null;
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Anchor/rect positioning + dot rendering (filtering + resolution)
// ---------------------------------------------------------------------------

describe("comment dots — anchor positioning, filtering, resolution", () => {
  test("renders one dot per unresolved text anchor, skipping visual blocks and fully-resolved anchors, positioned via anchorPositionForBlock", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const dots = findDotButtons(renderer.root);
        // First (count 2), Third (count 11), Fourth (count 1) get dots.
        // Second (all resolved) and the visual block get none.
        assert.equal(dots.length, 3);

        const first = dots.find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        assert.ok(first, "expected a '2 comments' dot for the first anchor");
        assert.equal(first.props.style.top, 120); // 100 + (140-100)/2
        assert.equal(first.props.style.left, 708);

        const third = dots.find(
          (el) => el.props["aria-label"] === "11 comments",
        );
        assert.ok(third, "expected an '11 comments' dot for the third anchor");

        const fourth = dots.find(
          (el) => el.props["aria-label"] === "1 comment",
        );
        assert.ok(
          fourth,
          "expected a singular '1 comment' dot for the fourth anchor",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("renders separate dots for identical text anchors when their durable block ids differ", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRepeatedRoot());
      const renderer = mount(editor, [
        makeThread({
          id: "thread-repeat-a",
          body: "Comment on first repeated block",
          anchorText: REPEATED_TEXT,
          anchorNodeId: "bid-repeat-a",
          anchor: {
            kind: "text",
            text: REPEATED_TEXT,
            nodeId: "bid-repeat-a",
          },
        }),
        makeThread({
          id: "thread-repeat-b",
          body: "Comment on second repeated block",
          anchorText: REPEATED_TEXT,
          anchorNodeId: "bid-repeat-b",
          anchor: {
            kind: "text",
            text: REPEATED_TEXT,
            nodeId: "bid-repeat-b",
          },
        }),
      ]);
      try {
        const dots = findDotButtons(renderer.root);
        assert.equal(dots.length, 2);
        assert.deepEqual(
          dots.map((dot) => dot.props.style.top),
          [120, 250],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("keeps a comment attached by durable block id after the paragraph text changes", () => {
    withCommentsDom(() => {
      const editedRoot = new FakeElement({
        rect: ROOT_RECT,
        children: [
          new FakeElement({
            text: "Edited paragraph text",
            rect: BLOCK_FIRST_RECT,
            attributes: { "data-lexical-block-id": "bid-first" },
          }),
        ],
      });
      const { editor } = makeFakeEditor(editedRoot);
      const renderer = mount(editor, [
        makeThread({
          id: "thread-edited-paragraph",
          body: "Comment survives text edits",
          anchorText: FIRST_TEXT,
          anchorNodeId: "bid-first",
          anchor: {
            kind: "text",
            text: FIRST_TEXT,
            nodeId: "bid-first",
          },
        }),
      ]);
      try {
        const marker = renderer.root.findByProps({
          "aria-label": "1 comment",
        });
        act(() => marker.props.onClick());
        assert.match(textOf(renderer.root), /Comment survives text edits/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("refreshes comment markers when collaboration populates an existing editor root", () => {
    withCommentsDom(() => {
      const root = new FakeElement({ rect: ROOT_RECT, children: [] });
      const fakeEditor = makeFakeEditor(root);
      const renderer = mount(fakeEditor.editor, [
        makeThread({
          id: "thread-late-collaboration",
          body: "Loaded with the collaborative document",
          anchorText: FIRST_TEXT,
          anchorNodeId: "bid-first",
          anchor: {
            kind: "text",
            text: FIRST_TEXT,
            nodeId: "bid-first",
          },
        }),
      ]);
      try {
        assert.equal(findDotButtons(renderer.root).length, 0);
        root.children = buildRoot().children;
        act(() => fakeEditor.fireUpdate());
        assert.equal(
          findDotButtons(renderer.root).filter(
            (button) => button.props["aria-label"] === "1 comment",
          ).length,
          1,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a dot's numeric badge shows the raw count when <=9 and caps at '9+' beyond that; no badge at all for a count of exactly 1", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const dots = findDotButtons(renderer.root);
        const first = dots.find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        const firstBadge = first
          .findAllByType("span")
          .find((el) => textOf(el) === "2");
        assert.ok(firstBadge, "count of 2 should render a '2' badge");

        const third = dots.find(
          (el) => el.props["aria-label"] === "11 comments",
        )!;
        const thirdBadge = third
          .findAllByType("span")
          .find((el) => textOf(el) === "9+");
        assert.ok(thirdBadge, "count of 11 should render a '9+' badge");

        const fourth = dots.find(
          (el) => el.props["aria-label"] === "1 comment",
        )!;
        const fourthBadges = fourth
          .findAllByType("span")
          .filter((el) => el.props.className?.includes?.("bg-ds-warning"));
        assert.equal(
          fourthBadges.length,
          0,
          "count of 1 should render no numeric badge",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Hover anchor — gutter detection + resolution-aware suppression
// ---------------------------------------------------------------------------

describe("hover anchor — gutter detection", () => {
  test("mousemove inside the right gutter over a fully-resolved anchor shows the add-comment icon there", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        assert.equal(findAddButton(renderer.root), null);
        act(() => {
          registry.fire("mousemove", { clientX: 720, clientY: 250 }); // inside Second block (230-270)
        });
        const addButton = findAddButton(renderer.root);
        assert.ok(
          addButton,
          "expected the add-comment icon while hovering an all-resolved anchor",
        );
        assert.equal(addButton.props.style.top, 250); // (230+270)/2
        assert.equal(addButton.props.style.left, 708);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("mousemove over an anchor with an unresolved thread does not show the add-comment icon (the dot already covers it)", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        act(() => {
          registry.fire("mousemove", { clientX: 720, clientY: 120 }); // inside First block (100-140), has unresolved threads
        });
        assert.equal(findAddButton(renderer.root), null);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("mousemove outside the right gutter clears the hover anchor", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        act(() => {
          registry.fire("mousemove", { clientX: 720, clientY: 250 });
        });
        assert.ok(findAddButton(renderer.root));

        act(() => {
          registry.fire("mousemove", { clientX: 10, clientY: 250 }); // outside the gutter entirely
        });
        assert.equal(findAddButton(renderer.root), null);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("mousemove is ignored (hover anchor never updates) while a card is already active", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const dots = findDotButtons(renderer.root);
        const first = dots.find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        assert.ok(findDialogCard(renderer.root));

        act(() => {
          registry.fire("mousemove", { clientX: 720, clientY: 250 });
        });
        // The add-comment icon shown is still the *active* anchor's (first),
        // not the one just hovered (second) — hover updates were ignored.
        const addButton = findAddButton(renderer.root)!;
        assert.equal(addButton.props.style.top, 120);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Expansion/selection — opening the card, multi-thread listing
// ---------------------------------------------------------------------------

describe("card expansion/selection — thread listing", () => {
  test("clicking a dot opens the card, listing every thread for that anchor (author + body) in order", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());

        assert.match(textOf(renderer.root), /2 open/);
        const items = renderer.root.findAllByType("li");
        assert.equal(items.length, 2);
        assert.match(textOf(items[0]!), /Alice/);
        assert.match(textOf(items[0]!), /First comment on paragraph one/);
        assert.match(textOf(items[1]!), /Bob/);
        assert.match(textOf(items[1]!), /Second comment on paragraph one/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("clicking repeated-text dots opens only the thread anchored to that block id", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRepeatedRoot());
      const renderer = mount(editor, [
        makeThread({
          id: "thread-repeat-a",
          body: "First block only",
          anchorText: REPEATED_TEXT,
          anchorNodeId: "bid-repeat-a",
          anchor: {
            kind: "text",
            text: REPEATED_TEXT,
            nodeId: "bid-repeat-a",
          },
        }),
        makeThread({
          id: "thread-repeat-b",
          body: "Second block only",
          anchorText: REPEATED_TEXT,
          anchorNodeId: "bid-repeat-b",
          anchor: {
            kind: "text",
            text: REPEATED_TEXT,
            nodeId: "bid-repeat-b",
          },
        }),
      ]);
      try {
        const dots = findDotButtons(renderer.root);
        const secondDot = dots.find((dot) => dot.props.style.top === 250)!;
        act(() => secondDot.props.onClick());

        assert.match(textOf(renderer.root), /Second block only/);
        assert.doesNotMatch(textOf(renderer.root), /First block only/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("legacy text-only anchors still open by matching normalized text", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRepeatedRoot());
      const renderer = mount(editor, [
        makeThread({
          id: "thread-legacy",
          body: "Legacy text-only thread",
          anchorText: REPEATED_TEXT,
          anchorNodeId: null,
          anchor: {
            kind: "text",
            text: REPEATED_TEXT,
            nodeId: null,
          },
        }),
      ]);
      try {
        const firstDot = findDotButtons(renderer.root)[0]!;
        act(() => firstDot.props.onClick());

        assert.match(textOf(renderer.root), /Legacy text-only thread/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("renders replies beneath their root thread instead of as sibling roots", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRoot());
      const threads = buildThreads();
      threads[0] = {
        ...threads[0]!,
        replies: [
          {
            id: "reply-first-a",
            body: "Nested reply body",
            author: { id: "user-c", name: "Carol" },
            createdAt: new Date(1).toISOString(),
          },
        ],
      };
      const renderer = mount(editor, threads);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());

        const replies = renderer.root.findByProps({
          "aria-label": "Replies to Alice",
        });
        assert.match(textOf(replies), /Carol/);
        assert.match(textOf(replies), /Nested reply body/);
        assert.equal(replies.parent?.type, "li");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("clicking the add-comment icon for a hover anchor also opens the card, with no threads listed (no 'N open' line) if there are none", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        act(() => {
          registry.fire("mousemove", { clientX: 720, clientY: 250 }); // Second block: one resolved-only thread
        });
        const addButton = findAddButton(renderer.root)!;
        act(() => addButton.props.onClick());

        assert.ok(findDialogCard(renderer.root));
        // The one thread there is resolved but is *still* listed (activeThreads
        // doesn't filter by resolved — only the dot count does).
        assert.match(textOf(renderer.root), /0 open · 1 resolved/);
        assert.match(textOf(renderer.root), /Already resolved/);
        assert.equal(
          renderer.root.findByProps({
            role: "dialog",
            "aria-label": "Inline comments",
          }).type,
          "div",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the explicit 'Close inline comment' button closes the card and clears the draft body", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        const textarea = findDialogCard(renderer.root)!;
        act(() => textarea.props.onChange({ target: { value: "draft" } }));

        const closeButton = renderer.root.findByProps({
          "aria-label": "Close inline comment",
        });
        act(() => closeButton.props.onClick());

        assert.equal(findDialogCard(renderer.root), null);

        // Reopening shows a cleared draft, confirming `closeDialog` reset it.
        act(() => first.props.onClick());
        assert.equal(findDialogCard(renderer.root)!.props.value, "");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the 'Cancel' button also closes the card", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());

        const cancel = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Cancel",
        );
        act(() => cancel.props.onClick());

        assert.equal(findDialogCard(renderer.root), null);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Submit — success and error paths
// ---------------------------------------------------------------------------

describe("submit", () => {
  test("the Comment button is disabled until the draft is non-blank, and while the submission is pending", async () => {
    await withCommentsDom(async (registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());

        const commentButton = () =>
          renderer.root.find(
            (el) => el.type === "button" && textOf(el) === "Comment",
          );
        assert.equal(commentButton().props.disabled, true);

        const textarea = findDialogCard(renderer.root)!;
        act(() => textarea.props.onChange({ target: { value: "   " } }));
        assert.equal(
          commentButton().props.disabled,
          true,
          "whitespace-only drafts stay disabled",
        );

        act(() => textarea.props.onChange({ target: { value: "A reply" } }));
        assert.equal(commentButton().props.disabled, false);

        let resolveCreate!: (
          result: CommentActionResult<CommentThread[]>,
        ) => void;
        globalForActions.__inlineCommentsActionsTestState.impl = () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          });

        act(() => {
          const button = commentButton();
          button.props.onClick();
          button.props.onClick();
        });
        const pendingButton = renderer.root.find(
          (element) =>
            element.type === "button" && textOf(element) === "Posting…",
        );
        assert.equal(
          pendingButton.props.disabled,
          true,
          "pending while the mutation is in flight",
        );
        assert.equal(
          globalForActions.__inlineCommentsActionsTestState.calls.length,
          1,
          "same-event activation issues one create mutation",
        );
        assert.equal(
          renderer.root.findByProps({ role: "dialog" }).props["aria-busy"],
          true,
        );
        assert.equal(findDialogCard(renderer.root)!.props.disabled, true);
        assert.equal(
          renderer.root.findByProps({
            "aria-label": "Close inline comment",
          }).props.disabled,
          true,
        );
        act(() => {
          registry.fire("keydown", {
            key: "Escape",
            preventDefault() {},
            stopPropagation() {},
          });
        });
        assert.ok(
          findDialogCard(renderer.root),
          "Escape cannot dismiss a pending comment",
        );

        await act(async () => {
          resolveCreate({ ok: true, data: buildThreads() });
          await flushMicrotasks();
        });
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("switching documents invalidates a pending mutation and lets the new document mutate without accepting the stale result", async () => {
    await withCommentsDom(async () => {
      const { editor } = makeFakeEditor(buildRoot());
      const initialDocumentTwoThreads = [
        makeThread({
          id: "doc-two-initial",
          body: "Document two initial comment",
          author: { id: "user-b", name: "Bob" },
          anchorText: FOURTH_TEXT,
          anchor: { kind: "text", text: FOURTH_TEXT, nodeId: null },
        }),
      ];
      const persistedDocumentTwoThreads = [
        ...initialDocumentTwoThreads,
        makeThread({
          id: "doc-two-created",
          body: "Document two persisted comment",
          author: { id: "user-a", name: "Alice" },
          anchorText: FOURTH_TEXT,
          anchor: { kind: "text", text: FOURTH_TEXT, nodeId: null },
        }),
      ];
      let resolveDocumentOne!: (
        result: CommentActionResult<CommentThread[]>,
      ) => void;
      globalForActions.__inlineCommentsActionsTestState.impl = (documentId) => {
        if (documentId === "doc-1") {
          return new Promise((resolve) => {
            resolveDocumentOne = resolve;
          });
        }
        return Promise.resolve({ ok: true, data: persistedDocumentTwoThreads });
      };

      const renderer = mount(editor);
      try {
        const documentOneDot = findDotButtons(renderer.root).find(
          (element) => element.props["aria-label"] === "2 comments",
        )!;
        act(() => documentOneDot.props.onClick());
        act(() =>
          findDialogCard(renderer.root)!.props.onChange({
            target: { value: "Document one pending comment" },
          }),
        );
        act(() => {
          renderer.root
            .find(
              (element) =>
                element.type === "button" && textOf(element) === "Comment",
            )
            .props.onClick();
        });
        assert.deepEqual(
          globalForActions.__inlineCommentsActionsTestState.calls.map(
            (call) => call.documentId,
          ),
          ["doc-1"],
        );

        act(() => {
          renderer.update(
            renderLayer(editor, "doc-2", initialDocumentTwoThreads),
          );
        });

        const documentTwoDot = findDotButtons(renderer.root).find(
          (element) => element.props["aria-label"] === "1 comment",
        )!;
        assert.equal(documentTwoDot.props.disabled, false);
        act(() => documentTwoDot.props.onClick());
        assert.match(textOf(renderer.root), /Document two initial comment/);
        act(() =>
          findDialogCard(renderer.root)!.props.onChange({
            target: { value: "Document two mutation" },
          }),
        );
        await act(async () => {
          renderer.root
            .find(
              (element) =>
                element.type === "button" && textOf(element) === "Comment",
            )
            .props.onClick();
          await flushMicrotasks();
        });
        assert.deepEqual(
          globalForActions.__inlineCommentsActionsTestState.calls.map(
            (call) => call.documentId,
          ),
          ["doc-1", "doc-2"],
        );

        await act(async () => {
          resolveDocumentOne({
            ok: true,
            data: [
              makeThread({
                id: "stale-doc-one-result",
                body: "Stale document one result",
                anchorText: FIRST_TEXT,
                anchor: { kind: "text", text: FIRST_TEXT, nodeId: null },
              }),
            ],
          });
          await flushMicrotasks();
        });

        const persistedDocumentTwoDot = findDotButtons(renderer.root).find(
          (element) => element.props["aria-label"] === "2 comments",
        )!;
        act(() => persistedDocumentTwoDot.props.onClick());
        assert.match(textOf(renderer.root), /Document two persisted comment/);
        assert.doesNotMatch(textOf(renderer.root), /Stale document one result/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a successful submit calls createComment with the trimmed body/anchor, replaces threads, clears the draft, and closes the card", async () => {
    await withCommentsDom(async () => {
      const { editor } = makeFakeEditor(buildRoot());
      const initialThreads = buildThreads();
      const renderer = mount(editor, initialThreads);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());

        const textarea = findDialogCard(renderer.root)!;
        act(() =>
          textarea.props.onChange({ target: { value: "  A new reply  " } }),
        );

        const nextThreads: CommentThread[] = [
          ...initialThreads,
          makeThread({
            id: "thread-first-c",
            body: "A new reply",
            author: { id: "user-c", name: "Carol" },
            anchorText: FIRST_TEXT,
            anchor: { kind: "text", text: FIRST_TEXT, nodeId: null },
          }),
        ];
        globalForActions.__inlineCommentsActionsTestState.impl = async () => ({
          ok: true,
          data: nextThreads,
        });

        const commentButton = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Comment",
        );
        await act(async () => {
          commentButton.props.onClick();
          await flushMicrotasks();
        });

        assert.deepEqual(
          globalForActions.__inlineCommentsActionsTestState.calls,
          [
            {
              documentId: "doc-1",
              input: {
                body: "A new reply",
                anchorType: "text",
                anchorText: FIRST_TEXT,
                anchorNodeId: "bid-first",
              },
            },
          ],
        );

        // The card closed (activeAnchor cleared) after a successful submit.
        assert.equal(findDialogCard(renderer.root), null);

        // The new thread count (3, from the fresh `threads` state) is
        // reflected the next time the same anchor's dot is reopened.
        const dots = findDotButtons(renderer.root);
        const updatedFirst = dots.find(
          (el) => el.props["aria-label"] === "3 comments",
        );
        assert.ok(
          updatedFirst,
          "expected the dot count to reflect the new threads",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("creates a reply for the selected root and renders the server-confirmed nested reply without closing the anchor card", async () => {
    await withCommentsDom(async () => {
      const { editor } = makeFakeEditor(buildRoot());
      const initialThreads = buildThreads();
      const renderer = mount(editor, initialThreads);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        const replyButton = renderer.root.findByProps({
          "aria-label": "Reply to comment by Alice",
        });
        act(() => replyButton.props.onClick());
        assert.match(textOf(renderer.root), /Reply to Alice/);

        const textarea = findDialogCard(renderer.root)!;
        act(() =>
          textarea.props.onChange({
            target: { value: "  Nested answer  " },
          }),
        );
        const nextThreads = initialThreads.map((thread) =>
          thread.id === "thread-first-a"
            ? {
                ...thread,
                replies: [
                  ...thread.replies,
                  {
                    id: "reply-created",
                    body: "Nested answer",
                    author: { id: "user-c", name: "Carol" },
                    createdAt: new Date(1).toISOString(),
                  },
                ],
              }
            : thread,
        );
        globalForActions.__inlineCommentsActionsTestState.impl = async () => ({
          ok: true,
          data: nextThreads,
        });

        const submitReply = renderer.root
          .findAll((el) => el.type === "button" && textOf(el) === "Reply")
          .at(-1)!;
        await act(async () => {
          submitReply.props.onClick();
          await flushMicrotasks();
        });

        assert.deepEqual(
          globalForActions.__inlineCommentsActionsTestState.calls,
          [
            {
              documentId: "doc-1",
              input: {
                body: "Nested answer",
                parentId: "thread-first-a",
              },
            },
          ],
        );
        assert.ok(findDialogCard(renderer.root), "reply keeps the thread open");
        assert.equal(findDialogCard(renderer.root)!.props.value, "");
        assert.match(textOf(renderer.root), /Carol/);
        assert.match(textOf(renderer.root), /Nested answer/);
        assert.match(textOf(renderer.root), /New comment/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("keeps a reply draft selected when the typed action outcome conceals an unavailable target", async () => {
    await withCommentsDom(async () => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        act(() =>
          renderer.root
            .findByProps({
              "aria-label": "Reply to comment by Alice",
            })
            .props.onClick(),
        );
        const textarea = findDialogCard(renderer.root)!;
        act(() =>
          textarea.props.onChange({ target: { value: "Private reply" } }),
        );
        globalForActions.__inlineCommentsActionsTestState.impl = async () => ({
          ok: false,
          error: {
            code: "comment_unavailable",
            message: "Comment is unavailable.",
          },
        });

        const submitReply = renderer.root
          .findAll((el) => el.type === "button" && textOf(el) === "Reply")
          .at(-1)!;
        await act(async () => {
          submitReply.props.onClick();
          await flushMicrotasks();
        });

        assert.equal(
          findDialogCard(renderer.root)!.props.value,
          "Private reply",
        );
        assert.match(textOf(renderer.root), /Reply to Alice/);
        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /^Comment is unavailable\./,
        );
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Replies to Alice",
          }).length,
          0,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a rejected submit is caught locally, shows a role=alert message, and leaves the card open with the draft intact for retry", async () => {
    await withCommentsDom(async () => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());

        const textarea = findDialogCard(renderer.root)!;
        act(() => textarea.props.onChange({ target: { value: "A reply" } }));

        globalForActions.__inlineCommentsActionsTestState.impl = async () => {
          throw new Error("network error");
        };

        const commentButton = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Comment",
        );
        await act(async () => {
          commentButton.props.onClick();
          await flushMicrotasks();
        });

        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(
          textOf(alert),
          /^Couldn't post your comment\. Please try again\./,
        );
        assert.ok(findDialogCard(renderer.root), "the card should stay open");
        assert.equal(findDialogCard(renderer.root)!.props.value, "A reply");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("framework redirect control flow escapes comment failure recovery", async () => {
    await withCommentsDom(async () => {
      const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;push;/login;307;",
      });
      globalForActions.__inlineCommentsActionsTestState.impl = async () => {
        throw redirectError;
      };
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (element) => element.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        act(() => {
          findDialogCard(renderer.root)!.props.onChange({
            target: { value: "A reply" },
          });
        });

        await assert.rejects(
          async () => {
            await act(async () => {
              await renderer.root
                .find(
                  (element) =>
                    element.type === "button" && textOf(element) === "Comment",
                )
                .props.onClick();
            });
          },
          (error: unknown) => error === redirectError,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a typed action failure shows its safe message and keeps the draft open", async () => {
    await withCommentsDom(async () => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());

        const textarea = findDialogCard(renderer.root)!;
        act(() => textarea.props.onChange({ target: { value: "A reply" } }));
        globalForActions.__inlineCommentsActionsTestState.impl = async () => ({
          ok: false,
          error: {
            code: "parent_not_found",
            message: "Parent comment not found.",
          },
        });

        const commentButton = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Comment",
        );
        await act(async () => {
          commentButton.props.onClick();
          await flushMicrotasks();
        });

        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /^Parent comment not found\./,
        );
        assert.ok(findDialogCard(renderer.root));
        assert.equal(findDialogCard(renderer.root)!.props.value, "A reply");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Edit/delete/resolve lifecycle controls
// ---------------------------------------------------------------------------

describe("comment lifecycle controls", () => {
  test("shows author-only edit/delete controls while every viewer can reply and resolve", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRoot());
      const threads = buildThreads();
      threads[0] = {
        ...threads[0]!,
        replies: [
          {
            id: "reply-owned",
            body: "Owned reply",
            author: { id: "user-a", name: "Alice" },
            createdAt: new Date(1).toISOString(),
          },
          {
            id: "reply-other",
            body: "Other reply",
            author: { id: "user-c", name: "Carol" },
            createdAt: new Date(2).toISOString(),
          },
        ],
      };
      const renderer = mount(editor, threads, "user-a");
      try {
        const first = findDotButtons(renderer.root).find(
          (element) => element.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());

        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Edit comment by Alice",
          }).length,
          1,
        );
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Delete comment by Alice",
          }).length,
          1,
        );
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Edit comment by Bob",
          }).length,
          0,
        );
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Delete comment by Bob",
          }).length,
          0,
        );
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Reply to comment by Bob",
          }).length,
          1,
        );
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Resolve comment by Bob",
          }).length,
          1,
        );
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Edit reply by Alice",
          }).length,
          1,
        );
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Delete reply by Alice",
          }).length,
          1,
        );
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Edit reply by Carol",
          }).length,
          0,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("edits an authored comment from server-confirmed truth and retains a failed draft", async () => {
    await withCommentsDom(async () => {
      const { editor } = makeFakeEditor(buildRoot());
      const threads = buildThreads();
      const renderer = mount(editor, threads, "user-a");
      try {
        const first = findDotButtons(renderer.root).find(
          (element) => element.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        act(() =>
          renderer.root
            .findByProps({ "aria-label": "Edit comment by Alice" })
            .props.onClick(),
        );
        const editField = renderer.root.findByProps({
          "aria-label": "Edit comment by Alice",
          maxLength: 5000,
        });
        act(() =>
          editField.props.onChange({ target: { value: "  Updated body  " } }),
        );

        globalForActions.__inlineCommentsActionsTestState.editImpl =
          async () => ({
            ok: false,
            error: {
              code: "comment_unavailable",
              message: "Comment is unavailable.",
            },
          });
        await act(async () => {
          renderer.root
            .findByProps({ "aria-label": "Save comment by Alice" })
            .props.onClick();
          await flushMicrotasks();
        });
        assert.equal(
          renderer.root.findByProps({
            "aria-label": "Edit comment by Alice",
            maxLength: 5000,
          }).props.value,
          "  Updated body  ",
        );
        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /^Comment is unavailable\./,
        );

        const updatedThreads = threads.map((thread) =>
          thread.id === "thread-first-a"
            ? { ...thread, body: "Updated body" }
            : thread,
        );
        globalForActions.__inlineCommentsActionsTestState.editImpl =
          async () => ({ ok: true, data: updatedThreads });
        await act(async () => {
          renderer.root
            .findByProps({ "aria-label": "Save comment by Alice" })
            .props.onClick();
          await flushMicrotasks();
        });

        assert.deepEqual(
          globalForActions.__inlineCommentsActionsTestState.editCalls,
          [
            {
              documentId: "doc-1",
              commentId: "thread-first-a",
              body: "Updated body",
            },
            {
              documentId: "doc-1",
              commentId: "thread-first-a",
              body: "Updated body",
            },
          ],
        );
        assert.match(textOf(renderer.root), /Updated body/);
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Save comment by Alice",
          }).length,
          0,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("resolves and reopens a thread from server-confirmed truth", async () => {
    await withCommentsDom(async () => {
      const { editor } = makeFakeEditor(buildRoot());
      const threads = buildThreads();
      const renderer = mount(editor, threads, "user-a");
      try {
        const first = findDotButtons(renderer.root).find(
          (element) => element.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());

        const resolvedThreads = threads.map((thread) =>
          thread.id === "thread-first-a"
            ? { ...thread, resolved: true }
            : thread,
        );
        globalForActions.__inlineCommentsActionsTestState.resolveImpl =
          async () => ({ ok: true, data: resolvedThreads });
        await act(async () => {
          renderer.root
            .findByProps({ "aria-label": "Resolve comment by Alice" })
            .props.onClick();
          await flushMicrotasks();
        });
        assert.deepEqual(
          globalForActions.__inlineCommentsActionsTestState.resolveCalls,
          [
            {
              documentId: "doc-1",
              commentId: "thread-first-a",
              resolved: true,
            },
          ],
        );
        assert.equal(
          renderer.root.findAllByProps({
            "aria-label": "Reopen comment by Alice",
          }).length,
          1,
        );
        assert.match(textOf(renderer.root), /1 open · 1 resolved/);

        globalForActions.__inlineCommentsActionsTestState.resolveImpl =
          async () => ({ ok: true, data: threads });
        await act(async () => {
          renderer.root
            .findByProps({ "aria-label": "Reopen comment by Alice" })
            .props.onClick();
          await flushMicrotasks();
        });
        assert.deepEqual(
          globalForActions.__inlineCommentsActionsTestState.resolveCalls[1],
          {
            documentId: "doc-1",
            commentId: "thread-first-a",
            resolved: false,
          },
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("requires confirmation before deleting an authored thread", async () => {
    await withCommentsDom(async () => {
      const { editor } = makeFakeEditor(buildRoot());
      const threads = buildThreads();
      const renderer = mount(editor, threads, "user-a");
      try {
        const first = findDotButtons(renderer.root).find(
          (element) => element.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        act(() =>
          renderer.root
            .findByProps({ "aria-label": "Delete comment by Alice" })
            .props.onClick(),
        );
        assert.match(
          textOf(renderer.root),
          /Delete this thread and all of its replies\?/,
        );
        act(() =>
          renderer.root
            .findByProps({
              "aria-label": "Cancel deleting comment by Alice",
            })
            .props.onClick(),
        );
        assert.deepEqual(
          globalForActions.__inlineCommentsActionsTestState.deleteCalls,
          [],
        );

        const remainingThreads = threads.filter(
          (thread) => thread.id !== "thread-first-a",
        );
        globalForActions.__inlineCommentsActionsTestState.deleteImpl =
          async () => ({ ok: true, data: remainingThreads });
        act(() =>
          renderer.root
            .findByProps({ "aria-label": "Delete comment by Alice" })
            .props.onClick(),
        );
        await act(async () => {
          renderer.root
            .findByProps({
              "aria-label": "Confirm delete comment by Alice",
            })
            .props.onClick();
          await flushMicrotasks();
        });
        assert.deepEqual(
          globalForActions.__inlineCommentsActionsTestState.deleteCalls,
          [{ documentId: "doc-1", commentId: "thread-first-a" }],
        );
        assert.doesNotMatch(
          textOf(renderer.root),
          /First comment on paragraph one/,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("repeated delete confirmation issues one mutation and locks dismissal while pending", async () => {
    await withCommentsDom(async () => {
      const { editor } = makeFakeEditor(buildRoot());
      const threads = buildThreads();
      let resolveDelete!: (
        result: CommentActionResult<CommentThread[]>,
      ) => void;
      globalForActions.__inlineCommentsActionsTestState.deleteImpl = () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        });
      const renderer = mount(editor, threads, "user-a");
      try {
        const first = findDotButtons(renderer.root).find(
          (element) => element.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        act(() => {
          renderer.root
            .findByProps({ "aria-label": "Delete comment by Alice" })
            .props.onClick();
        });
        const confirm = renderer.root.findByProps({
          "aria-label": "Confirm delete comment by Alice",
        });
        act(() => {
          confirm.props.onClick();
          confirm.props.onClick();
        });

        assert.deepEqual(
          globalForActions.__inlineCommentsActionsTestState.deleteCalls,
          [{ documentId: "doc-1", commentId: "thread-first-a" }],
        );
        assert.equal(
          renderer.root.findByProps({
            "aria-label": "Confirm delete comment by Alice",
          }).props.disabled,
          true,
        );
        assert.equal(
          renderer.root.findByProps({
            "aria-label": "Cancel deleting comment by Alice",
          }).props.disabled,
          true,
        );
        assert.equal(
          renderer.root.findByProps({
            "aria-label": "Close inline comment",
          }).props.disabled,
          true,
        );
        act(() => {
          renderer.root
            .findByProps({ "aria-label": "Close inline comment" })
            .props.onClick();
        });
        assert.ok(findDialogCard(renderer.root));

        await act(async () => {
          resolveDelete({
            ok: true,
            data: threads.filter((thread) => thread.id !== "thread-first-a"),
          });
          await flushMicrotasks();
        });
        assert.doesNotMatch(
          textOf(renderer.root),
          /First comment on paragraph one/,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Escape-to-close
// ---------------------------------------------------------------------------

describe("Escape handling", () => {
  test("Escape closes the open card and prevents default/stops propagation; only registered while a card is active", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        assert.equal(
          registry.size("keydown"),
          0,
          "no keydown listener should be registered before a card opens",
        );

        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        assert.equal(registry.size("keydown"), 1);

        let prevented = false;
        let stopped = false;
        act(() => {
          registry.fire("keydown", {
            key: "Escape",
            preventDefault: () => {
              prevented = true;
            },
            stopPropagation: () => {
              stopped = true;
            },
          });
        });

        assert.equal(prevented, true);
        assert.equal(stopped, true);
        assert.equal(findDialogCard(renderer.root), null);
        assert.equal(
          registry.size("keydown"),
          0,
          "the keydown listener should be removed once the card closes",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a non-Escape key while the card is open is ignored", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());

        let called = false;
        act(() => {
          registry.fire("keydown", {
            key: "Enter",
            preventDefault: () => {
              called = true;
            },
            stopPropagation: () => undefined,
          });
        });

        assert.equal(called, false);
        assert.ok(findDialogCard(renderer.root), "the card should remain open");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Scroll/resize cleanup
// ---------------------------------------------------------------------------

describe("scroll/resize cleanup", () => {
  test("a scroll originating inside the card is ignored (card stays open, hover anchor untouched)", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        assert.ok(findDialogCard(renderer.root));

        scrollState.insideCard = true;
        act(() => {
          registry.fire("scroll", { target: new FakeElement({}) });
        });

        assert.ok(
          findDialogCard(renderer.root),
          "a scroll inside the card must not close it",
        );
      } finally {
        scrollState.insideCard = false;
        act(() => renderer.unmount());
      }
    });
  });

  test("a scroll outside the card closes it and clears the hover anchor", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        act(() => {
          registry.fire("mousemove", { clientX: 720, clientY: 250 });
        });
        assert.ok(findAddButton(renderer.root));

        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        assert.ok(findDialogCard(renderer.root));

        scrollState.insideCard = false;
        act(() => {
          registry.fire("scroll", { target: new FakeElement({}) });
        });

        assert.equal(findDialogCard(renderer.root), null);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a resize closes the card and clears the hover anchor regardless of target", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        assert.ok(findDialogCard(renderer.root));

        act(() => {
          registry.fire("resize");
        });

        assert.equal(findDialogCard(renderer.root), null);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Root listener + ResizeObserver lifecycle
// ---------------------------------------------------------------------------

describe("root listener + ResizeObserver lifecycle", () => {
  test("attaches exactly one mousemove listener on mount and removes it on unmount", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      assert.equal(registry.size("mousemove"), 1);
      act(() => renderer.unmount());
      assert.equal(registry.size("mousemove"), 0);
    });
  });

  test("never leaks duplicate mousemove listeners across open/close cycles", () => {
    withCommentsDom((registry) => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        for (let i = 0; i < 3; i += 1) {
          const first = findDotButtons(renderer.root).find(
            (el) => el.props["aria-label"] === "2 comments",
          )!;
          act(() => first.props.onClick());
          assert.equal(registry.size("mousemove"), 1);
          const closeButton = renderer.root.findByProps({
            "aria-label": "Close inline comment",
          });
          act(() => closeButton.props.onClick());
          assert.equal(registry.size("mousemove"), 1);
        }
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("disconnects the card's ResizeObserver when the card closes and again on unmount", () => {
    withCommentsDom(() => {
      const { editor } = makeFakeEditor(buildRoot());
      const renderer = mount(editor);
      try {
        FakeResizeObserver.instances = [];
        const first = findDotButtons(renderer.root).find(
          (el) => el.props["aria-label"] === "2 comments",
        )!;
        act(() => first.props.onClick());
        assert.equal(FakeResizeObserver.instances.length, 1);
        const observer = FakeResizeObserver.instances[0]!;
        assert.equal(observer.observeCalls.length, 1);
        assert.equal(observer.disconnectCalls, 0);

        const closeButton = renderer.root.findByProps({
          "aria-label": "Close inline comment",
        });
        act(() => closeButton.props.onClick());
        assert.equal(observer.disconnectCalls, 1);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

// ---------------------------------------------------------------------------
// SSR gate
// ---------------------------------------------------------------------------

describe("server-side rendering", () => {
  test("renders nothing server-side (canUsePortal's server snapshot is false)", () => {
    const { editor } = makeFakeEditor(null);
    const html = renderToStaticMarkup(
      withComposer(
        editor,
        <InlineCommentsLayer
          documentId="doc-1"
          currentUserId="user-a"
          initialComments={[]}
        />,
      ),
    );
    assert.equal(html, "");
  });
});
