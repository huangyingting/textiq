/**
 * Direct coverage for `src/app/app/documents/[id]/page.tsx` (#1958).
 *
 * `DocumentEditorPage` composes three collaborators that each require a live
 * request/database context: `requireUser` (auth), `loadDocumentEditorViewModel`
 * (document scoping — access-checked by `accessibleDocumentWhere`, already
 * covered by its own persistence tests), and `next/navigation`'s
 * `notFound`/`redirect`. Following the module-hooks pattern used by
 * `src/app/app/trash/page.test.tsx`, this stubs `@/lib/session`,
 * `@/lib/document-editor/loader`, `./document-context`, `next/navigation`,
 * and `./lexical-editor` itself (an identity-marker function component),
 * then imports the real `./page` so the returned element's `.type` can be
 * matched by function name (see `isLexicalEditorElement`) and its props
 * inspected directly. `LexicalEditor` is a `"use client"` component with its
 * own hooks and full sibling import graph (block-spark, table-controls,
 * visual-card, etc.) — all covered directly by `lexical-editor.test.tsx`
 * and each surface's own dedicated test file. Stubbing it here (rather than
 * loading the real module just to read `.type`/`.props` off an unrendered
 * element) keeps this file's coverage instrumentation scoped to `page.tsx`
 * itself: importing the real `./lexical-editor` module executes its entire
 * top-level import graph unconditionally (ES module semantics), which was
 * previously pulling ~15 otherwise-untested sibling files into this run's
 * coverage totals at their low, never-exercised percentages and dragging
 * down the combined coverage gate. `LexicalEditor` is only ever inspected
 * as a React element here, never invoked.
 *
 * Coverage: unauthenticated redirect (no view-model load attempted), the
 * view-model load being scoped to the resolved route id and authenticated
 * user (with the `userName` -> `email` -> "Anonymous" fallback chain),
 * `notFound()` firing when the loader returns null (deleted/forbidden/
 * missing document), and every view-model field the page forwards reaching
 * `LexicalEditor` unchanged.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

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

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

type FakeViewModel = {
  documentId: string;
  initialTitle: string;
  initialStateJson: string | null;
  initialDeckJson: unknown;
  initialIsShared: boolean;
  initialShareId: string | null;
  initialSlug: string | null;
  initialShareExpiresAt: string | null;
  initialShareEmbedEnabled: boolean;
  initialSharePresentEnabled: boolean;
  initialSharePasscodeEnabled: boolean;
  initialShareMetadataMode: string;
  initialShareDiscoverable: boolean;
  canEdit: boolean;
  canManage: boolean;
  workspaceName: string | null;
  userId: string;
  userName: string;
  initialComments: unknown[];
  initialTags: unknown[];
  allTags: unknown[];
};

declare global {
  var __documentEditorPageTestState:
    | {
        calls: unknown[][];
        user: {
          id: string;
          name?: string | null;
          email?: string | null;
        } | null;
        viewModel: FakeViewModel | null;
      }
    | undefined;
}

const stubPrefix = "textiq-document-editor-page-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        globalThis.__documentEditorPageTestState.calls.push(["requireUser"]);
        const user = globalThis.__documentEditorPageTestState.user;
        if (!user) {
          redirect("/login");
          throw new Error("redirect() was expected to throw");
        }
        return user;
      }
    `,
  ],
  [
    "@/lib/document-editor/loader",
    `
      export async function loadDocumentEditorViewModel(args) {
        globalThis.__documentEditorPageTestState.calls.push([
          "loadDocumentEditorViewModel",
          args.documentId,
          args.userId,
          args.userName,
          typeof args.requireDocumentContext,
        ]);
        return globalThis.__documentEditorPageTestState.viewModel;
      }
    `,
  ],
  [
    "./document-context",
    `
      export function requireDocumentActionContext() {
        throw new Error("requireDocumentActionContext should not be invoked directly by the page");
      }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(url) {
        globalThis.__documentEditorPageTestState.calls.push(["redirect", url]);
        throw new Error("NEXT_REDIRECT:" + url);
      }
      export function notFound() {
        globalThis.__documentEditorPageTestState.calls.push(["notFound"]);
        throw new Error("NEXT_NOT_FOUND");
      }
    `,
  ],
  [
    "./lexical-editor",
    `
      export function LexicalEditor(props) {
        return null;
      }
    `,
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbedModules.has(specifier)) {
      return {
        url: `${stubPrefix}${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(stubPrefix)) {
      const specifier = decodeURIComponent(url.slice(stubPrefix.length));
      return {
        format: "module",
        source: stubbedModules.get(specifier) ?? "",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type ElementLike = ReactElement<Record<string, unknown>>;

/**
 * Collects every element in the tree, expanding host (string-type) elements'
 * children. Function components are recorded as leaves — NOT invoked — so
 * the stubbed `LexicalEditor` never runs outside of a real render pass.
 */
function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  if (typeof element.type === "function") {
    return collected;
  }
  const props = element.props as { children?: ReactNode };
  collectElements(props.children, collected);
  return collected;
}

function firstElement(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike {
  const element = collectElements(node).find(predicate);
  assert.ok(element, "expected a matching element");
  return element;
}

/**
 * Matches the stubbed `LexicalEditor` element by its function `.name`
 * rather than by reference. The `./lexical-editor` stub module ends up
 * instantiated twice under this repo's Node version: once via this file's
 * own `await import("./lexical-editor")`, and once via `page.tsx`'s static
 * import — both resolve through the same `registerHooks` stub URL, but
 * Node's synchronous customization hooks and `tsx`'s own asynchronous
 * loader hooks don't share a single module cache, so comparing
 * `element.type === LexicalEditor` (reference equality) does not match the
 * element actually returned by `DocumentEditorPage`. Matching by name
 * sidesteps that (the same pattern used by `findVisualEditor` in
 * `visual-card.test.tsx`), since both instances are the identical stub
 * source.
 */
function isLexicalEditorElement(element: ElementLike): boolean {
  return (
    typeof element.type === "function" &&
    (element.type as { name?: string }).name === "LexicalEditor"
  );
}

function baseViewModel(overrides: Partial<FakeViewModel> = {}): FakeViewModel {
  return {
    documentId: "doc-1",
    initialTitle: "Q3 Strategy",
    initialStateJson: '{"root":{}}',
    initialDeckJson: { schemaVersion: 1 },
    initialIsShared: false,
    initialShareId: null,
    initialSlug: null,
    initialShareExpiresAt: null,
    initialShareEmbedEnabled: false,
    initialSharePresentEnabled: false,
    initialSharePasscodeEnabled: false,
    initialShareMetadataMode: "generic",
    initialShareDiscoverable: false,
    canEdit: true,
    canManage: true,
    workspaceName: "Acme Workspace",
    userId: "user-1",
    userName: "Ada Lovelace",
    initialComments: [{ id: "c-1" }],
    initialTags: [{ id: "t-1" }],
    allTags: [{ id: "t-1" }, { id: "t-2" }],
    ...overrides,
  };
}

describe("DocumentEditorPage", () => {
  let DocumentEditorPage: typeof import("./page").default;
  let metadata: typeof import("./page").metadata;

  before(async () => {
    const pageMod = await import("./page");
    DocumentEditorPage = pageMod.default;
    metadata = pageMod.metadata;
  });

  beforeEach(() => {
    globalThis.__documentEditorPageTestState = {
      calls: [],
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
      viewModel: baseViewModel(),
    };
  });

  it("exposes the editor page metadata title", () => {
    assert.equal(metadata.title, "Editor — TextIQ");
  });

  it("redirects unauthenticated visitors to /login without loading a view model", async () => {
    const state = globalThis.__documentEditorPageTestState;
    if (!state) throw new Error("test state missing");
    state.user = null;

    await assert.rejects(
      () => DocumentEditorPage({ params: Promise.resolve({ id: "doc-1" }) }),
      /NEXT_REDIRECT:\/login/,
    );

    assert.deepEqual(state.calls, [["requireUser"], ["redirect", "/login"]]);
  });

  it("scopes the view-model load to the resolved route id and authenticated user", async () => {
    const state = globalThis.__documentEditorPageTestState;
    if (!state) throw new Error("test state missing");

    await DocumentEditorPage({ params: Promise.resolve({ id: "doc-42" }) });

    assert.deepEqual(state.calls, [
      ["requireUser"],
      [
        "loadDocumentEditorViewModel",
        "doc-42",
        "user-1",
        "Ada Lovelace",
        "function",
      ],
    ]);
  });

  it("falls back to the user's email when name is unset", async () => {
    const state = globalThis.__documentEditorPageTestState;
    if (!state) throw new Error("test state missing");
    state.user = { id: "user-1", name: null, email: "ada@example.com" };

    await DocumentEditorPage({ params: Promise.resolve({ id: "doc-1" }) });

    const [, loadCall] = state.calls;
    assert.equal(loadCall?.[3], "ada@example.com");
  });

  it("falls back to 'Anonymous' when both name and email are unset", async () => {
    const state = globalThis.__documentEditorPageTestState;
    if (!state) throw new Error("test state missing");
    state.user = { id: "user-1", name: null, email: null };

    await DocumentEditorPage({ params: Promise.resolve({ id: "doc-1" }) });

    const [, loadCall] = state.calls;
    assert.equal(loadCall?.[3], "Anonymous");
  });

  it("calls notFound() when the view model loader returns null (missing/forbidden document)", async () => {
    const state = globalThis.__documentEditorPageTestState;
    if (!state) throw new Error("test state missing");
    state.viewModel = null;

    await assert.rejects(
      () =>
        DocumentEditorPage({ params: Promise.resolve({ id: "doc-missing" }) }),
      /NEXT_NOT_FOUND/,
    );

    assert.deepEqual(state.calls, [
      ["requireUser"],
      [
        "loadDocumentEditorViewModel",
        "doc-missing",
        "user-1",
        "Ada Lovelace",
        "function",
      ],
      ["notFound"],
    ]);
  });

  it("forwards every view-model field the page reads through to LexicalEditor unchanged", async () => {
    const state = globalThis.__documentEditorPageTestState;
    if (!state) throw new Error("test state missing");
    const viewModel = baseViewModel({
      documentId: "doc-99",
      initialTitle: "Roadmap",
      canEdit: false,
      canManage: false,
      workspaceName: null,
    });
    state.viewModel = viewModel;

    const tree = await DocumentEditorPage({
      params: Promise.resolve({ id: "doc-99" }),
    });
    const editorElement = firstElement(tree, isLexicalEditorElement);

    assert.equal(editorElement.props.documentId, viewModel.documentId);
    assert.equal(editorElement.props.initialTitle, viewModel.initialTitle);
    assert.equal(
      editorElement.props.initialStateJson,
      viewModel.initialStateJson,
    );
    assert.equal(
      editorElement.props.initialDeckJson,
      viewModel.initialDeckJson,
    );
    assert.equal(
      editorElement.props.initialIsShared,
      viewModel.initialIsShared,
    );
    assert.equal(editorElement.props.initialShareId, viewModel.initialShareId);
    assert.equal(editorElement.props.initialSlug, viewModel.initialSlug);
    assert.equal(
      editorElement.props.initialShareExpiresAt,
      viewModel.initialShareExpiresAt,
    );
    assert.equal(
      editorElement.props.initialShareEmbedEnabled,
      viewModel.initialShareEmbedEnabled,
    );
    assert.equal(
      editorElement.props.initialSharePresentEnabled,
      viewModel.initialSharePresentEnabled,
    );
    assert.equal(
      editorElement.props.initialSharePasscodeEnabled,
      viewModel.initialSharePasscodeEnabled,
    );
    assert.equal(
      editorElement.props.initialShareMetadataMode,
      viewModel.initialShareMetadataMode,
    );
    assert.equal(
      editorElement.props.initialShareDiscoverable,
      viewModel.initialShareDiscoverable,
    );
    assert.equal(editorElement.props.canEdit, viewModel.canEdit);
    assert.equal(editorElement.props.canManage, viewModel.canManage);
    assert.equal(editorElement.props.workspaceName, viewModel.workspaceName);
    assert.equal(editorElement.props.userId, viewModel.userId);
    assert.equal(editorElement.props.userName, viewModel.userName);
    assert.equal(
      editorElement.props.initialComments,
      viewModel.initialComments,
    );
    assert.equal(editorElement.props.initialTags, viewModel.initialTags);
    assert.equal(editorElement.props.allTags, viewModel.allTags);
  });
});
