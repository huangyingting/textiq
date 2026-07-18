/**
 * Direct coverage for `src/app/app/documents/[id]/slides/page.tsx` (#1959).
 *
 * `DocumentSlidesPage` composes four collaborators that each require a live
 * request/database context — `@/lib/session`'s `requireUser`,
 * `@/lib/document-editor/loader`'s `loadDocumentEditorViewModel` (already
 * exhaustively covered by its own `loader.test.ts`, and itself backed by
 * `@/lib/prisma`), `../document-context`'s `requireDocumentActionContext`
 * (backed by `@/lib/auth/document-permissions` + `@/lib/session`, also
 * DB-touching), and `next/navigation`'s `redirect`/`notFound`/`useRouter`
 * (which throw a Next.js-internal sentinel, or require a real App Router
 * context, outside of a real request). Following the module-hooks pattern
 * established by `trash/page.test.tsx`, all of these are stubbed via
 * `node:module` `registerHooks`, then the real `./page` and
 * `./slide-editor-route-client` are imported so the returned
 * `SlideEditorRouteClient` element can be identity- and prop-compared
 * directly. The client component is never invoked (only inspected via its
 * React element), so none of its hooks ever run here — including its own
 * `../actions`/`../slide-asset-actions` server-action imports, which are
 * stubbed too (importing them for real would reach `@/lib/prisma` and
 * `@/lib/slides/asset-store`'s `server-only` guard, which throws
 * unconditionally outside of Next's bundler).
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

type StubUser = { id: string; name: string | null; email: string | null };
type StubViewModel = {
  documentId: string;
  initialTitle: string;
  initialStateJson: string | null;
  initialDeckJson: unknown;
  initialDeckRevisionToken: string | null;
  initialIsShared: boolean;
  initialShareId: string | null;
  initialSlug: string | null;
  initialSharePresentEnabled: boolean;
  canEdit: boolean;
  canManage: boolean;
  userId: string;
  userName: string;
  activeCustomThemePackage?: unknown;
  customThemeCatalogEntries: unknown[];
};

declare global {
  var __slidesPageTestState:
    | {
        calls: unknown[][];
        user: StubUser | null;
        viewModel: StubViewModel | null;
      }
    | undefined;
}

const stubPrefix = "textiq-slides-page-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        globalThis.__slidesPageTestState.calls.push(["requireUser"]);
        const user = globalThis.__slidesPageTestState.user;
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
        globalThis.__slidesPageTestState.calls.push(["loadDocumentEditorViewModel", args]);
        return globalThis.__slidesPageTestState.viewModel;
      }
    `,
  ],
  [
    "../document-context",
    `
      export function requireDocumentActionContext() {
        globalThis.__slidesPageTestState.calls.push(["requireDocumentActionContext"]);
        throw new Error("requireDocumentActionContext should not be invoked directly by the page");
      }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(url) {
        globalThis.__slidesPageTestState.calls.push(["redirect", url]);
        throw new Error("NEXT_REDIRECT:" + url);
      }
      export function notFound() {
        globalThis.__slidesPageTestState.calls.push(["notFound"]);
        throw new Error("NEXT_NOT_FOUND");
      }
      export function useRouter() {
        return { push() {} };
      }
    `,
  ],
  [
    "../actions",
    `
      export async function fetchDeckJson() {
        throw new Error("not used by page.test.tsx");
      }
      export async function saveDeckJson() {
        throw new Error("not used by page.test.tsx");
      }
      export async function toggleDocumentSharing() {
        throw new Error("not used by page.test.tsx");
      }
    `,
  ],
  [
    "../brand-kit-actions",
    `
      export async function saveBrandKitDraft() {
        throw new Error("not used by page.test.tsx");
      }
    `,
  ],
  [
    "../slide-asset-actions",
    `
      export async function uploadSlideAsset() {
        throw new Error("not used by page.test.tsx");
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
 * `SlideEditorRouteClient` (a real client component with hooks) never runs
 * outside of a real React render pass.
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

function baseViewModel(overrides: Partial<StubViewModel> = {}): StubViewModel {
  return {
    documentId: "doc-1",
    initialTitle: "Quarterly review",
    initialStateJson: '{"root":{"type":"root","children":[]}}',
    initialDeckJson: { schemaVersion: 7, slides: [] },
    initialDeckRevisionToken: "rev-1",
    initialIsShared: false,
    initialShareId: null,
    initialSlug: null,
    initialSharePresentEnabled: false,
    canEdit: true,
    canManage: false,
    userId: "user-1",
    userName: "Ada Lovelace",
    customThemeCatalogEntries: [],
    ...overrides,
  };
}

describe("DocumentSlidesPage", () => {
  let DocumentSlidesPage: typeof import("./page").default;
  let metadata: typeof import("./page").metadata;
  let SlideEditorRouteClient: typeof import("./slide-editor-route-client").SlideEditorRouteClient;

  before(async () => {
    const pageMod = await import("./page");
    DocumentSlidesPage = pageMod.default;
    metadata = pageMod.metadata;
    ({ SlideEditorRouteClient } = await import("./slide-editor-route-client"));
  });

  beforeEach(() => {
    globalThis.__slidesPageTestState = {
      calls: [],
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
      viewModel: baseViewModel(),
    };
  });

  it("exposes the slides page metadata title", () => {
    assert.equal(metadata.title, "Slides — TextIQ");
  });

  it("redirects unauthenticated visitors to /login without loading a view model", async () => {
    const state = globalThis.__slidesPageTestState;
    if (!state) throw new Error("test state missing");
    state.user = null;

    await assert.rejects(
      () => DocumentSlidesPage({ params: Promise.resolve({ id: "doc-1" }) }),
      /NEXT_REDIRECT:\/login/,
    );

    assert.deepEqual(state.calls, [["requireUser"], ["redirect", "/login"]]);
  });

  it("scopes the view-model lookup to the authenticated user and the route's document id", async () => {
    const state = globalThis.__slidesPageTestState;
    if (!state) throw new Error("test state missing");

    await DocumentSlidesPage({ params: Promise.resolve({ id: "doc-42" }) });

    const loadCall = state.calls.find(
      (call) => call[0] === "loadDocumentEditorViewModel",
    );
    assert.ok(loadCall, "expected loadDocumentEditorViewModel to be called");
    const args = loadCall?.[1] as {
      documentId: string;
      userId: string;
      userName: string;
      requireDocumentContext: unknown;
    };
    assert.equal(args.documentId, "doc-42");
    assert.equal(args.userId, "user-1");
    assert.equal(args.userName, "Ada Lovelace");
    // Passed through by reference, never invoked directly by the page itself.
    assert.equal(typeof args.requireDocumentContext, "function");
    assert.ok(
      !state.calls.some((call) => call[0] === "requireDocumentActionContext"),
      "requireDocumentActionContext must not be invoked by the page directly",
    );
  });

  it("falls back userName from name → email → 'Anonymous'", async () => {
    const state = globalThis.__slidesPageTestState;
    if (!state) throw new Error("test state missing");

    state.user = { id: "user-1", name: null, email: "ada@example.com" };
    await DocumentSlidesPage({ params: Promise.resolve({ id: "doc-1" }) });
    let args = state.calls.find(
      (call) => call[0] === "loadDocumentEditorViewModel",
    )?.[1] as { userName: string };
    assert.equal(args.userName, "ada@example.com");

    state.calls = [];
    state.user = { id: "user-1", name: null, email: null };
    await DocumentSlidesPage({ params: Promise.resolve({ id: "doc-1" }) });
    args = state.calls.find(
      (call) => call[0] === "loadDocumentEditorViewModel",
    )?.[1] as { userName: string };
    assert.equal(args.userName, "Anonymous");
  });

  it("renders notFound() when no document is accessible (null view model)", async () => {
    const state = globalThis.__slidesPageTestState;
    if (!state) throw new Error("test state missing");
    state.viewModel = null;

    await assert.rejects(
      () => DocumentSlidesPage({ params: Promise.resolve({ id: "doc-1" }) }),
      /NEXT_NOT_FOUND/,
    );
    assert.ok(state.calls.some((call) => call[0] === "notFound"));
  });

  it("renders notFound() when the document exists but the user cannot edit it (view-only permission)", async () => {
    const state = globalThis.__slidesPageTestState;
    if (!state) throw new Error("test state missing");
    state.viewModel = baseViewModel({ canEdit: false });

    await assert.rejects(
      () => DocumentSlidesPage({ params: Promise.resolve({ id: "doc-1" }) }),
      /NEXT_NOT_FOUND/,
    );
    assert.ok(state.calls.some((call) => call[0] === "notFound"));
  });

  it("composes the real SlideEditorRouteClient with every view-model field wired through", async () => {
    const state = globalThis.__slidesPageTestState;
    if (!state) throw new Error("test state missing");
    state.viewModel = baseViewModel({
      documentId: "doc-99",
      initialTitle: "Board deck",
      initialDeckJson: { schemaVersion: 7, id: "deck-99", slides: [] },
      initialDeckRevisionToken: "rev-99",
      initialStateJson: '{"root":{"type":"root","children":[]}}',
      initialIsShared: true,
      initialShareId: "share-99",
      initialSlug: "board-deck",
      initialSharePresentEnabled: true,
      canEdit: true,
      canManage: true,
      userId: "user-1",
      userName: "Ada Lovelace",
      activeCustomThemePackage: { id: "custom-1", version: "1.0.0" },
      customThemeCatalogEntries: [
        {
          package: { id: "custom-1", version: "2.0.0" },
          source: "custom",
          createdAt: "2026-02-03T04:05:06.000Z",
        },
      ],
    });

    const tree = await DocumentSlidesPage({
      params: Promise.resolve({ id: "doc-99" }),
    });
    const elements = collectElements(tree);
    const client = elements.find(
      (element) => element.type === SlideEditorRouteClient,
    );
    assert.ok(client, "expected a SlideEditorRouteClient element");

    const props = client?.props as Record<string, unknown>;
    assert.equal(props.documentId, "doc-99");
    assert.equal(props.documentTitle, "Board deck");
    assert.deepEqual(props.initialDeckJson, {
      schemaVersion: 7,
      id: "deck-99",
      slides: [],
    });
    assert.equal(props.initialDeckRevisionToken, "rev-99");
    assert.equal(
      props.initialContentJson,
      '{"root":{"type":"root","children":[]}}',
    );
    assert.equal(props.initialIsShared, true);
    assert.equal(props.initialShareId, "share-99");
    assert.equal(props.initialSlug, "board-deck");
    assert.equal(props.initialSharePresentEnabled, true);
    assert.equal(props.canManage, true);
    assert.equal(props.userId, "user-1");
    assert.equal(props.userName, "Ada Lovelace");
    assert.deepEqual(props.activeCustomThemePackage, {
      id: "custom-1",
      version: "1.0.0",
    });
    assert.deepEqual(props.customThemeCatalogEntries, [
      {
        package: { id: "custom-1", version: "2.0.0" },
        source: "custom",
        createdAt: "2026-02-03T04:05:06.000Z",
      },
    ]);
    assert.equal(typeof props.saveBrandKitDraftAction, "function");
  });
});
