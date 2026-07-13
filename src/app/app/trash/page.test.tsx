/**
 * Direct coverage for `src/app/app/trash/page.tsx` (#1948).
 *
 * `TrashPage` composes three collaborators that each require a live
 * request/database context (`requireUser`, `listTrashDocumentsForUser`,
 * `next/navigation`'s `redirect`). Following the module-hooks pattern used
 * by `src/app/app/trash/actions.test.ts` and `src/app/login/actions.test.ts`,
 * this stubs `@/lib/session`, `@/lib/document/trash`, and `next/navigation`,
 * then imports the real `./page` and `./trash-list` so the rendered
 * `TrashList` element can be identity- and prop-compared directly. No client
 * component is ever invoked (only inspected via its React element), so
 * `TrashList`'s own `useState`/`useTransition` hooks never run here.
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

type TrashDocument = {
  id: string;
  title: string;
  deletedAtMs: number;
  remainingMs: number;
};

declare global {
  var __trashPageTestState:
    | {
        calls: unknown[][];
        user: { id: string } | null;
        documents: TrashDocument[];
        redirectThrows: boolean;
      }
    | undefined;
}

const stubPrefix = "textiq-trash-page-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        globalThis.__trashPageTestState.calls.push(["requireUser"]);
        const user = globalThis.__trashPageTestState.user;
        if (!user) {
          redirect("/login");
          throw new Error("redirect() was expected to throw");
        }
        return user;
      }
    `,
  ],
  [
    "@/lib/document/trash",
    `
      export async function listTrashDocumentsForUser(userId) {
        globalThis.__trashPageTestState.calls.push(["listTrashDocumentsForUser", userId]);
        return globalThis.__trashPageTestState.documents;
      }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(url) {
        globalThis.__trashPageTestState.calls.push(["redirect", url]);
        throw new Error("NEXT_REDIRECT:" + url);
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
 * Collects every element in the tree, expanding host (string-type)
 * elements' children. Function components are recorded as leaves — NOT
 * invoked — so `TrashList` (which calls `useState`/`useTransition`) never
 * runs outside of a real React render pass.
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

describe("TrashPage", () => {
  let TrashPage: typeof import("./page").default;
  let metadata: typeof import("./page").metadata;
  let TrashList: typeof import("./trash-list").TrashList;

  before(async () => {
    const pageMod = await import("./page");
    TrashPage = pageMod.default;
    metadata = pageMod.metadata;
    ({ TrashList } = await import("./trash-list"));
  });

  beforeEach(() => {
    globalThis.__trashPageTestState = {
      calls: [],
      user: { id: "user-1" },
      documents: [
        { id: "doc-1", title: "Q3 plan", deletedAtMs: 1000, remainingMs: 500 },
        { id: "doc-2", title: "Notes", deletedAtMs: 2000, remainingMs: 600 },
      ],
      redirectThrows: true,
    };
  });

  it("exposes the trash page metadata title", () => {
    assert.equal(metadata.title, "Trash — TextIQ");
  });

  it("redirects unauthenticated visitors to /login without fetching trash documents", async () => {
    const state = globalThis.__trashPageTestState;
    if (!state) throw new Error("test state missing");
    state.user = null;

    await assert.rejects(() => TrashPage(), /NEXT_REDIRECT:\/login/);

    assert.deepEqual(state.calls, [["requireUser"], ["redirect", "/login"]]);
  });

  it("scopes the trash lookup to the authenticated user's id", async () => {
    const state = globalThis.__trashPageTestState;
    if (!state) throw new Error("test state missing");

    await TrashPage();

    assert.deepEqual(state.calls, [
      ["requireUser"],
      ["listTrashDocumentsForUser", "user-1"],
    ]);
  });

  it("passes the fetched documents through to TrashList unchanged (same reference)", async () => {
    const state = globalThis.__trashPageTestState;
    if (!state) throw new Error("test state missing");

    const tree = await TrashPage();
    const trashList = firstElement(
      tree,
      (element) => element.type === TrashList,
    );

    assert.equal(trashList.props.documents, state.documents);
  });

  it("renders the heading and a back-to-dashboard link to /app", async () => {
    const tree = await TrashPage();
    const elements = collectElements(tree);

    const heading = elements.find(
      (element) =>
        element.type === "h1" &&
        (element.props as { children?: ReactNode }).children === "Trash",
    );
    assert.ok(heading, "expected an <h1> reading 'Trash'");

    const backLink = elements.find(
      (element) => (element.props as { href?: string }).href === "/app",
    );
    assert.ok(backLink, "expected a link back to /app");
  });
});
