/**
 * Direct contract coverage for `WorkspacesPage` (issue #1957).
 *
 * `WorkspacesPage` is an async Server Component with no hooks of its own,
 * so it is invoked directly (`await WorkspacesPage()`) and its *unrendered*
 * React element tree is asserted via structural traversal
 * (`collectElements`/`firstElement`, reading `.type`/`.props` off the plain
 * JSX data) — never mounted through `react-test-renderer`. `WorkspacesPage`
 * composes `CreateWorkspaceButton`, which already has dedicated direct
 * behavior coverage (`create-workspace-button.test.tsx`) elsewhere in this
 * issue's file set; never invoking React's reconciler here means its hooks
 * never run and its own covered behavior is not re-asserted — only
 * `WorkspacesPage`'s own wiring (auth, owned/member workspace merge, role
 * derivation, empty-state vs list, singular/plural copy) is exercised.
 *
 * Because `CreateWorkspaceButton` is loaded for real (relative imports
 * cannot be intercepted by `node:module` `registerHooks`) and it in turn
 * imports its own sibling `./actions` module for real, this file reuses the
 * exact alias stub set already established by
 * `create-workspace-button.test.tsx` (session, workspace service, next/cache,
 * next/navigation) plus a `@/components/ui` stub that keeps the real
 * `Button`/tokens but no-ops `Dialog` (see that file and the `[id]/*.test.tsx`
 * files for why a real `Dialog` cannot survive this Node test environment).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  EMPTY_STATE_CHROME,
  FIELD_CONTROL,
  PANEL_CHROME,
  cx,
} from "@/components/ui/tokens";

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

type WorkspaceCountRow = {
  id: string;
  name: string;
  updatedAt: Date;
  _count: { members: number; documents: number };
};

type MemberWorkspaceRow = WorkspaceCountRow & {
  members: { role: string }[];
};

type WorkspacesPageTestState = {
  calls: unknown[][];
  user: { id: string };
  ownedWorkspaces: WorkspaceCountRow[];
  memberWorkspaces: MemberWorkspaceRow[];
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  findManyWorkspace: (args: {
    where: Record<string, unknown>;
  }) => Promise<WorkspaceCountRow[] | MemberWorkspaceRow[]>;
};

const globalForWorkspacesPage = globalThis as typeof globalThis & {
  __workspacesPageTestState: WorkspacesPageTestState;
};

function createDefaultState(): WorkspacesPageTestState {
  const calls: unknown[][] = [];
  return {
    calls,
    user: { id: "user-1" },
    ownedWorkspaces: [],
    memberWorkspaces: [],
    async requireUser() {
      calls.push(["requireUser"]);
      return state().user;
    },
    async findManyWorkspace(args) {
      calls.push(["prisma.workspace.findMany", args]);
      // Owned-workspace queries filter by a plain `ownerId` equality;
      // member-workspace queries filter by a `members.some` clause. Branch
      // on that shape (rather than call order) so the stub stays correct
      // regardless of how the route sequences its two queries.
      if ("members" in args.where) {
        return state().memberWorkspaces;
      }
      return state().ownedWorkspaces;
    },
  };
}

globalForWorkspacesPage.__workspacesPageTestState = createDefaultState();
// Node 22's synchronous require(esm) interop path can drop the export from
// a synthetic `export { Button } from "@/components/ui/button"` re-export
// evaluated inside a module-hook-provided source string (reproduced via
// direct experiment: "The requested module '@/components/ui/button' does
// not provide an export named 'Button'", even though the real module
// unambiguously exports it — see `members-list.test.tsx` for the full
// investigation). Node 24 does not exhibit this. To stay on the real
// `Button`/token implementations without tripping that interop bug, the
// real bindings are imported normally above (resolved through the default
// loader, before any hooks are registered) and bridged into the synthetic
// `@/components/ui` module below via a global instead of a nested
// `export ... from` statement.
(
  globalThis as typeof globalThis & {
    __workspacesPageUiBridge: {
      Button: unknown;
      EMPTY_STATE_CHROME: unknown;
      FIELD_CONTROL: unknown;
      PANEL_CHROME: unknown;
      cx: unknown;
    };
  }
).__workspacesPageUiBridge = {
  Button,
  EMPTY_STATE_CHROME,
  FIELD_CONTROL,
  PANEL_CHROME,
  cx,
};

function state(): WorkspacesPageTestState {
  return globalForWorkspacesPage.__workspacesPageTestState;
}

function callsOf(tag: string): unknown[][] {
  return state().calls.filter((c) => c[0] === tag);
}

function denyAuth() {
  state().requireUser = async (redirect) => {
    redirect("/login");
    throw new Error("unreachable");
  };
}

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-workspaces-page-test:";

const stubbedModules = new Map<string, string>([
  [
    "@/components/ui",
    `
      export const Button = globalThis.__workspacesPageUiBridge.Button;
      export const EMPTY_STATE_CHROME = globalThis.__workspacesPageUiBridge.EMPTY_STATE_CHROME;
      export const FIELD_CONTROL = globalThis.__workspacesPageUiBridge.FIELD_CONTROL;
      export const PANEL_CHROME = globalThis.__workspacesPageUiBridge.PANEL_CHROME;
      export const cx = globalThis.__workspacesPageUiBridge.cx;
      // Real Dialog/ModalSurface cannot survive an open transition in a
      // Node process with no document; already covered elsewhere and never
      // rendered here anyway (this file never mounts through React).
      export function Dialog() { return null; }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(url) {
        throw new Error("NEXT_REDIRECT:" + url);
      }
      export function useRouter() {
        return { push() {}, replace() {}, refresh() {} };
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath() {}
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__workspacesPageTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/workspace/service",
    `
      export async function createWorkspaceForUser() {
        throw new Error("createWorkspaceForUser should not be called");
      }
    `,
  ],
  [
    "@/lib/prisma",
    `
      export const prisma = {
        workspace: {
          findMany(args) {
            return globalThis.__workspacesPageTestState.findManyWorkspace(args);
          },
        },
      };
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

type WorkspacesPageModule = typeof import("./page");

let WorkspacesPage: WorkspacesPageModule["default"];

before(async () => {
  ({ default: WorkspacesPage } = await import("./page"));
});

beforeEach(() => {
  globalForWorkspacesPage.__workspacesPageTestState = createDefaultState();
});

type ElementLike = ReactElement & { props: Record<string, unknown> };

function collectElements(
  node: ReactNode,
  collected: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  collectElements(element.props.children as ReactNode, collected);
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

function allElements(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike[] {
  return collectElements(node).filter(predicate);
}

function byComponentName(name: string) {
  return (element: ElementLike) =>
    typeof element.type === "function" && element.type.name === name;
}

function ownedWorkspace(overrides: Partial<WorkspaceCountRow> = {}) {
  return {
    id: "ws-owned-1",
    name: "Owned Space",
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    _count: { members: 0, documents: 2 },
    ...overrides,
  };
}

function memberWorkspace(overrides: Partial<MemberWorkspaceRow> = {}) {
  return {
    id: "ws-member-1",
    name: "Shared Space",
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    _count: { members: 2, documents: 5 },
    members: [{ role: "EDITOR" }],
    ...overrides,
  };
}

describe("WorkspacesPage", () => {
  it("redirects unauthenticated visitors to /login without querying any workspaces", async () => {
    denyAuth();

    await assert.rejects(() => WorkspacesPage(), /NEXT_REDIRECT:\/login/);

    assert.equal(callsOf("prisma.workspace.findMany").length, 0);
  });

  it("queries owned workspaces (by ownerId) and member workspaces (excluding ones the caller owns)", async () => {
    state().user = { id: "user-9" };

    await WorkspacesPage();

    assert.deepEqual(callsOf("prisma.workspace.findMany")[0]?.[1], {
      where: { ownerId: "user-9" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        _count: { select: { members: true, documents: true } },
      },
    });
    assert.deepEqual(callsOf("prisma.workspace.findMany")[1]?.[1], {
      where: {
        members: {
          some: {
            userId: "user-9",
            role: { in: ["EDITOR", "VIEWER"] },
          },
        },
        ownerId: { not: "user-9" },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        _count: { select: { members: true, documents: true } },
        members: {
          where: { userId: "user-9", role: { in: ["EDITOR", "VIEWER"] } },
          select: { role: true },
        },
      },
    });
  });

  it("renders the empty state (with a 'create your first workspace' CTA) when the caller has no workspaces", async () => {
    const result = (await WorkspacesPage()) as ReactElement;
    const elements = collectElements(result);

    assert.ok(elements.some((el) => el.props.children === "No workspaces yet"));

    const createButtons = allElements(
      result,
      byComponentName("CreateWorkspaceButton"),
    );
    assert.equal(createButtons.length, 2);
    assert.ok(
      createButtons.some(
        (el) => el.props.children === "Create your first workspace",
      ),
    );
    assert.equal(
      elements.some((el) => el.type === "ul"),
      false,
    );
  });

  it("renders owned and member workspaces merged into one list, with the owner role forced to OWNER", async () => {
    state().ownedWorkspaces = [ownedWorkspace()];
    state().memberWorkspaces = [memberWorkspace()];

    const result = (await WorkspacesPage()) as ReactElement;
    const links = allElements(
      result,
      (el) =>
        typeof el.props.href === "string" &&
        el.props.href.startsWith("/app/workspaces/"),
    );

    assert.equal(links.length, 2);
    assert.equal(links[0]?.props.href, "/app/workspaces/ws-owned-1");
    assert.equal(links[1]?.props.href, "/app/workspaces/ws-member-1");

    const ownedRole = firstElement(
      links[0] as unknown as ReactNode,
      (el) => el.props.children === "OWNER",
    );
    assert.ok(ownedRole);
    const memberRole = firstElement(
      links[1] as unknown as ReactNode,
      (el) => el.props.children === "EDITOR",
    );
    assert.ok(memberRole);
  });

  it("fails explicitly when a member workspace row has no caller membership role", async () => {
    state().memberWorkspaces = [memberWorkspace({ members: [] })];

    await assert.rejects(
      () => WorkspacesPage(),
      /missing the caller membership row/i,
    );
  });

  it("fails explicitly when a member workspace role is unrecognized", async () => {
    state().memberWorkspaces = [
      memberWorkspace({ members: [{ role: "SOME_UNKNOWN_ROLE" }] }),
    ];

    await assert.rejects(
      () => WorkspacesPage(),
      /Workspace member role must be one of: EDITOR, VIEWER/,
    );
  });

  it("renders singular member/document copy at counts of exactly one", async () => {
    state().ownedWorkspaces = [
      ownedWorkspace({ _count: { members: 0, documents: 1 } }),
    ];

    const result = (await WorkspacesPage()) as ReactElement;
    const link = firstElement(
      result,
      (el) => el.props.href === "/app/workspaces/ws-owned-1",
    );
    const text = JSON.stringify(
      collectElements(link).map((el) =>
        Array.isArray(el.props.children)
          ? el.props.children.join("")
          : typeof el.props.children === "object"
            ? null
            : el.props.children,
      ),
    );

    assert.match(text, /1 member(?!s)/);
    assert.match(text, /1 document(?!s)/);
  });

  it("renders plural member/document copy at counts other than one", async () => {
    state().ownedWorkspaces = [
      ownedWorkspace({ _count: { members: 3, documents: 0 } }),
    ];

    const result = (await WorkspacesPage()) as ReactElement;
    const link = firstElement(
      result,
      (el) => el.props.href === "/app/workspaces/ws-owned-1",
    );
    const text = JSON.stringify(
      collectElements(link).map((el) =>
        Array.isArray(el.props.children)
          ? el.props.children.join("")
          : typeof el.props.children === "object"
            ? null
            : el.props.children,
      ),
    );

    // members: 3 + 1 (owner) = 4
    assert.match(text, /4 members/);
    assert.match(text, /0 documents/);
  });
});
