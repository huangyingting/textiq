/**
 * Direct contract coverage for `WorkspacePage` (issue #1957).
 *
 * `WorkspacePage` is an async Server Component with no hooks of its own, so
 * it is invoked directly (`await WorkspacePage({ params })`) and its
 * *unrendered* React element tree is asserted via structural traversal
 * (`collectElements`/`firstElement`, reading `.type`/`.props` off the plain
 * JSX data) — never mounted through `react-test-renderer`. `WorkspacePage`
 * composes `MembersList`, `InviteLinkManager`, `WorkspaceDocuments`, and
 * `WorkspaceSettings` — all four already have dedicated direct behavior
 * coverage elsewhere in this issue's file set — so never invoking React's
 * reconciler here means none of their hooks run and none of their own
 * covered behavior is re-asserted; only `WorkspacePage`'s own wiring (auth,
 * workspace lookup, owner/member role derivation, prop threading, singular/
 * plural copy) is exercised.
 *
 * Because those four sibling components are loaded for real (relative
 * imports cannot be intercepted by `node:module` `registerHooks`), and each
 * imports the shared sibling `./actions` module for real in turn, this file
 * reuses the exact alias stub set already established across
 * `invite-link-manager.test.tsx` / `members-list.test.tsx` /
 * `workspace-documents.test.tsx` / `workspace-settings.test.tsx` (session,
 * workspace capability check, invite-service, workspace service, next/cache,
 * next/navigation, server-only, and a `@/components/ui` stub that keeps the
 * real `Button`/tokens but no-ops `Dialog` — see those files for why) so
 * `./actions` loads without touching a real database or a real `Dialog`
 * portal. `@/lib/access-query` (`accessibleWorkspaceWhere`) and
 * `@/lib/workspace/roles` (strict role parsing) are pure and already covered
 * (`access-query.test.ts`, `roles.test.ts`) so they are imported for real.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FIELD_CONTROL, PANEL_CHROME, cx } from "@/components/ui/tokens";

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

type MemberRow = {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: { email: string; name: string | null };
};

type InviteLinkRow = {
  id: string;
  token: string;
  role: string;
  createdAt: Date;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
};

type WorkspaceRow = {
  id: string;
  name: string;
  ownerId: string;
  owner: { email: string; name: string | null };
  members: MemberRow[];
  inviteLinks: InviteLinkRow[];
  _count: { documents: number };
};

function defaultWorkspace(): WorkspaceRow {
  return {
    id: "ws-1",
    name: "Acme Docs",
    ownerId: "owner-1",
    owner: { email: "owner@example.com", name: "Owner Person" },
    members: [
      {
        id: "member-1",
        userId: "user-1",
        role: "EDITOR",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        user: { email: "person@example.com", name: "Person" },
      },
    ],
    inviteLinks: [
      {
        id: "invite-1",
        token: "tok-abc",
        role: "VIEWER",
        createdAt: new Date("2024-01-02T00:00:00Z"),
        expiresAt: null,
        maxUses: null,
        useCount: 0,
      },
    ],
    _count: { documents: 3 },
  };
}

type WorkspacePageTestState = {
  calls: unknown[][];
  user: { id: string };
  workspace: WorkspaceRow | null;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  findFirstWorkspace: (args: unknown) => Promise<WorkspaceRow | null>;
};

const globalForWorkspacePage = globalThis as typeof globalThis & {
  __workspacePageTestState: WorkspacePageTestState;
};

function createDefaultState(): WorkspacePageTestState {
  const calls: unknown[][] = [];
  return {
    calls,
    user: { id: "user-1" },
    workspace: defaultWorkspace(),
    async requireUser() {
      calls.push(["requireUser"]);
      return state().user;
    },
    async findFirstWorkspace(args) {
      calls.push(["prisma.workspace.findFirst", args]);
      return state().workspace;
    },
  };
}

globalForWorkspacePage.__workspacePageTestState = createDefaultState();
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
    __workspacePageUiBridge: {
      Button: unknown;
      FIELD_CONTROL: unknown;
      PANEL_CHROME: unknown;
      cx: unknown;
    };
  }
).__workspacePageUiBridge = { Button, FIELD_CONTROL, PANEL_CHROME, cx };

function state(): WorkspacePageTestState {
  return globalForWorkspacePage.__workspacePageTestState;
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

const stubPrefix = "textiq-workspace-page-test:";

const stubbedModules = new Map<string, string>([
  ["server-only", ""],
  [
    "@/components/ui",
    `
      export const Button = globalThis.__workspacePageUiBridge.Button;
      export const FIELD_CONTROL = globalThis.__workspacePageUiBridge.FIELD_CONTROL;
      export const PANEL_CHROME = globalThis.__workspacePageUiBridge.PANEL_CHROME;
      export const cx = globalThis.__workspacePageUiBridge.cx;
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
      export function notFound() {
        throw new Error("NEXT_NOT_FOUND");
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
        return globalThis.__workspacePageTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/auth/workspace-capabilities",
    `
      export async function requireWorkspaceCapability() {
        throw new Error("requireWorkspaceCapability should not be called");
      }
    `,
  ],
  [
    "@/lib/workspace/invite-service",
    `
      export function assertInvitableWorkspaceRole() {}
      export async function createWorkspaceInviteLink() { throw new Error("unused"); }
      export async function getInviteLinkTarget() { return null; }
      export async function revokeWorkspaceInviteLink() {}
    `,
  ],
  [
    "@/lib/workspace/service",
    `
      export async function createWorkspaceDocumentForUser() {}
      export async function deleteWorkspaceAndDetachDocuments() {}
      export async function getWorkspaceMemberRemovalTarget() { return null; }
      export async function importWorkspaceDocumentForUser() {}
      export async function leaveWorkspaceForUser() {}
      export async function listWorkspaceDocumentsForUser() {
        return { documents: [], hasMore: false };
      }
      export async function removeWorkspaceMemberAndDetachDocuments() {}
      export async function renameWorkspaceRecord() {}
      export async function transferWorkspaceOwnership() {}
    `,
  ],
  [
    "@/lib/prisma",
    `
      export const prisma = {
        workspace: {
          findFirst(args) {
            return globalThis.__workspacePageTestState.findFirstWorkspace(args);
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

type WorkspacePageModule = typeof import("./page");

let WorkspacePage: WorkspacePageModule["default"];

before(async () => {
  ({ default: WorkspacePage } = await import("./page"));
});

beforeEach(() => {
  globalForWorkspacePage.__workspacePageTestState = createDefaultState();
});

function invoke(id = "ws-1") {
  return WorkspacePage({ params: Promise.resolve({ id }) });
}

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

function findElement(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike | undefined {
  return collectElements(node).find(predicate);
}

function byComponentName(name: string) {
  return (element: ElementLike) =>
    typeof element.type === "function" && element.type.name === name;
}

/**
 * Reads the workspace header's document/member count sentence. Its JSX
 * interpolates several expressions inside one `<p>`, so `children` compiles
 * to an array of primitive strings/numbers (never nested elements) — safe
 * to join directly without the `JSON.stringify`-on-raw-elements circular-ref
 * hazard documented in the sibling test files (there is no element here).
 */
function countsSentence(result: ReactNode): string {
  const paragraph = firstElement(
    result,
    (el) =>
      el.type === "p" &&
      typeof el.props.className === "string" &&
      el.props.className.includes("text-ds-text-secondary"),
  );
  const children = paragraph.props.children;
  return (Array.isArray(children) ? children : [children]).join("");
}

describe("WorkspacePage", () => {
  it("redirects unauthenticated visitors to /login without looking up the workspace", async () => {
    denyAuth();

    await assert.rejects(() => invoke(), /NEXT_REDIRECT:\/login/);

    assert.equal(callsOf("prisma.workspace.findFirst").length, 0);
  });

  it("calls notFound() when the workspace query returns nothing", async () => {
    state().workspace = null;

    await assert.rejects(() => invoke("missing-ws"), /NEXT_NOT_FOUND/);

    assert.deepEqual(callsOf("prisma.workspace.findFirst")[0]?.[1], {
      where: {
        id: "missing-ws",
        OR: [
          { ownerId: "user-1" },
          { members: { some: { userId: "user-1" } } },
        ],
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        owner: { select: { email: true, name: true } },
        members: {
          select: {
            id: true,
            userId: true,
            role: true,
            createdAt: true,
            user: { select: { email: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        inviteLinks: {
          where: { isRevoked: false },
          select: {
            id: true,
            token: true,
            role: true,
            createdAt: true,
            expiresAt: true,
            maxUses: true,
            useCount: true,
          },
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { documents: true } },
      },
    });
  });

  it("calls notFound() when the workspace has neither an owner nor a membership match for the caller", async () => {
    // Defense-in-depth: even though `accessibleWorkspaceWhere` should already
    // scope the query, the route re-derives the role server-side and denies
    // if neither check resolves (e.g. a stale/inconsistent read).
    state().workspace = {
      ...defaultWorkspace(),
      ownerId: "someone-else",
      members: [],
    };

    await assert.rejects(() => invoke(), /NEXT_NOT_FOUND/);
  });

  it("renders the owner view: MembersList/InviteLinkManager/WorkspaceDocuments/WorkspaceSettings all wired for the owner", async () => {
    state().user = { id: "owner-1" };
    state().workspace = defaultWorkspace();

    const result = (await invoke()) as ReactElement;

    const membersList = firstElement(result, byComponentName("MembersList"));
    assert.equal(membersList.props.isOwner, true);
    assert.equal(membersList.props.currentUserId, "owner-1");
    assert.deepEqual(
      (membersList.props.workspace as WorkspaceRow).members.map((m) => m.role),
      ["EDITOR"],
    );

    const inviteManager = firstElement(
      result,
      byComponentName("InviteLinkManager"),
    );
    assert.equal(inviteManager.props.workspaceId, "ws-1");
    assert.deepEqual(
      (inviteManager.props.inviteLinks as InviteLinkRow[]).map((l) => l.role),
      ["VIEWER"],
    );

    const documents = firstElement(
      result,
      byComponentName("WorkspaceDocuments"),
    );
    assert.equal(documents.props.workspaceId, "ws-1");
    assert.equal(documents.props.userRole, "owner");

    const settings = firstElement(result, byComponentName("WorkspaceSettings"));
    assert.equal(settings.props.workspaceId, "ws-1");
    assert.equal(settings.props.name, "Acme Docs");
    assert.equal(settings.props.isOwner, true);

    const elements = collectElements(result);
    assert.ok(
      elements.some((el) => el.props.children === "Workspace settings"),
    );
  });

  it("renders the member view: no InviteLinkManager section, WorkspaceSettings/WorkspaceDocuments reflect the member role", async () => {
    state().user = { id: "user-1" };
    state().workspace = defaultWorkspace();

    const result = (await invoke()) as ReactElement;

    const membersList = firstElement(result, byComponentName("MembersList"));
    assert.equal(membersList.props.isOwner, false);
    assert.equal(membersList.props.currentUserId, "user-1");

    assert.equal(
      findElement(result, byComponentName("InviteLinkManager")),
      undefined,
    );

    const documents = firstElement(
      result,
      byComponentName("WorkspaceDocuments"),
    );
    assert.equal(documents.props.userRole, "editor");

    const settings = firstElement(result, byComponentName("WorkspaceSettings"));
    assert.equal(settings.props.isOwner, false);

    const elements = collectElements(result);
    assert.ok(elements.some((el) => el.props.children === "Membership"));
    assert.equal(
      elements.some((el) => el.props.children === "Workspace settings"),
      false,
    );
  });

  it("renders a stable integrity-invalid state for an unrecognized stored member role", async () => {
    state().user = { id: "user-1" };
    state().workspace = {
      ...defaultWorkspace(),
      members: [
        {
          ...defaultWorkspace().members[0],
          role: "SOME_UNKNOWN_ROLE",
        },
      ],
    };

    const result = (await invoke()) as ReactElement;
    const invalidState = firstElement(
      result,
      byComponentName("WorkspaceMembershipIntegrityInvalid"),
    );
    assert.equal(invalidState.props.workspaceId, "ws-1");
    assert.equal(invalidState.props.errorCode, "invalid-workspace-member-role");
  });

  it("renders a stable integrity-invalid state for a non-owner OWNER membership row", async () => {
    state().user = { id: "user-1" };
    state().workspace = {
      ...defaultWorkspace(),
      ownerId: "owner-1",
      members: [
        {
          ...defaultWorkspace().members[0],
          role: "OWNER",
        },
      ],
    };

    const result = (await invoke()) as ReactElement;
    const invalidState = firstElement(
      result,
      byComponentName("WorkspaceMembershipIntegrityInvalid"),
    );
    assert.equal(invalidState.props.workspaceId, "ws-1");
    assert.equal(invalidState.props.errorCode, "owner-membership-row");
  });

  it("renders singular document/member copy at counts of exactly one", async () => {
    state().user = { id: "owner-1" };
    state().workspace = {
      ...defaultWorkspace(),
      _count: { documents: 1 },
      members: [],
    };

    const result = (await invoke()) as ReactElement;
    const sentence = countsSentence(result);

    assert.match(sentence, /1 document(?!s)/);
    assert.match(sentence, /1 member(?!s)/);
  });

  it("renders plural document/member copy at counts other than one", async () => {
    state().workspace = {
      ...defaultWorkspace(),
      _count: { documents: 0 },
      members: [
        defaultWorkspace().members[0],
        {
          ...defaultWorkspace().members[0],
          id: "member-2",
          userId: "user-2",
        },
      ],
    };

    const result = (await invoke()) as ReactElement;
    const sentence = countsSentence(result);

    assert.match(sentence, /0 documents/);
    assert.match(sentence, /3 members/);
  });

  it("renders a Back to workspaces link pointing at /app/workspaces", async () => {
    const result = (await invoke()) as ReactElement;
    const backLink = firstElement(
      result,
      (el) => el.props.href === "/app/workspaces",
    );
    assert.ok(backLink);
  });
});
