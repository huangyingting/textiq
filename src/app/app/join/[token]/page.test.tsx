/**
 * Direct contract coverage for `JoinWorkspacePage` (issue #1957).
 *
 * `JoinWorkspacePage` is an async Server Component invoked directly (no
 * client-side hooks, so no `react-test-renderer` `act()` ceremony is needed
 * for state) with its module dependencies stubbed via `node:module`
 * `registerHooks`: `@/lib/prisma` (raw invite-link/member lookups),
 * `@/lib/session` (auth), `@/lib/workspace/invite-service`
 * (`acceptWorkspaceInvite`, already covered by `invite-service.test.ts` and
 * not re-asserted here), and `next/navigation` (`redirect`/`notFound`,
 * matched to their real "throws with a sentinel digest" behavior). The pure
 * `@/lib/invite-access` policy (`evaluateInviteAccess`) is imported for
 * real — it is framework-free, already exhaustively covered by
 * `invite-access.test.ts`, and importing it for real lets this file assert
 * genuine end-to-end reason-threading instead of re-deriving the policy's
 * own branch matrix.
 *
 * Covers: unauthenticated visitors redirected to `/login` before any invite
 * lookup; a missing invite token producing `notFound()`; workspace-owner and
 * existing-member short-circuits that redirect straight to the workspace
 * without touching acceptance; denied invites (revoked / invalid stored
 * role) rendering the `InviteInvalid` safe-failure state with the correct
 * message; a successful join redirecting to the workspace with the
 * server-validated role and link id threaded through exactly; an
 * `already-member` acceptance race still redirecting home; and a
 * `cap-exhausted` acceptance race (the link filled up between the read and
 * the atomic accept) rendering the exhausted `InviteInvalid` state.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import { isValidElement, type ReactElement } from "react";
import { act, create } from "react-test-renderer";

import "@/test/react-render-harness";

// `InviteInvalid`'s "Back to dashboard" link is a real `next/link`, whose
// prefetch-on-visibility hook falls back to `requestIdleCallback`'s
// polyfill (`next/dist/client/request-idle-callback.js`), which dereferences
// the bare `self` global. This is a standard Node/browser global alias
// (`self === globalThis` everywhere `self` exists), not a DOM/jsdom shim.
if (typeof (globalThis as { self?: unknown }).self === "undefined") {
  (globalThis as { self?: unknown }).self = globalThis;
}

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

type InviteLinkRow = {
  id: string;
  workspaceId: string;
  isRevoked: boolean;
  role: string;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  workspace: { ownerId: string };
};

type AcceptResult =
  | { outcome: "joined" }
  | { outcome: "cap-exhausted" }
  | { outcome: "already-member" };

type JoinPageTestState = {
  calls: unknown[][];
  user: { id: string } | null;
  inviteLink: InviteLinkRow | null;
  existingMember: { id: string } | null;
  acceptResult: AcceptResult;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  findUniqueInviteLink: (args: unknown) => Promise<InviteLinkRow | null>;
  findFirstMember: (args: unknown) => Promise<{ id: string } | null>;
  acceptWorkspaceInvite: (args: unknown) => Promise<AcceptResult>;
};

const globalForJoinPage = globalThis as typeof globalThis & {
  __joinPageTestState: JoinPageTestState;
};

function defaultInviteLink(): InviteLinkRow {
  return {
    id: "invite-1",
    workspaceId: "ws-1",
    isRevoked: false,
    role: "VIEWER",
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    workspace: { ownerId: "owner-1" },
  };
}

function createDefaultState(): JoinPageTestState {
  const calls: unknown[][] = [];
  return {
    calls,
    user: { id: "user-1" },
    inviteLink: defaultInviteLink(),
    existingMember: null,
    acceptResult: { outcome: "joined" },
    async requireUser() {
      calls.push(["requireUser"]);
      return state().user ?? { id: "user-1" };
    },
    async findUniqueInviteLink(args) {
      calls.push(["prisma.inviteLink.findUnique", args]);
      return state().inviteLink;
    },
    async findFirstMember(args) {
      calls.push(["prisma.workspaceMember.findFirst", args]);
      return state().existingMember;
    },
    async acceptWorkspaceInvite(args) {
      calls.push(["acceptWorkspaceInvite", args]);
      return state().acceptResult;
    },
  };
}

globalForJoinPage.__joinPageTestState = createDefaultState();

function state(): JoinPageTestState {
  return globalForJoinPage.__joinPageTestState;
}

function callsOf(tag: string): unknown[][] {
  return state().calls.filter((c) => c[0] === tag);
}

/** Makes `requireUser` simulate an unauthenticated caller, matching the real dependency's own redirect-then-throw contract. */
function denyAuth() {
  state().requireUser = async (redirect) => {
    redirect("/login");
    throw new Error("unreachable");
  };
}

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-join-page-test:";

const stubbedModules = new Map<string, string>([
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
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__joinPageTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/prisma",
    `
      export const prisma = {
        inviteLink: {
          findUnique(args) {
            return globalThis.__joinPageTestState.findUniqueInviteLink(args);
          },
        },
        workspaceMember: {
          findFirst(args) {
            return globalThis.__joinPageTestState.findFirstMember(args);
          },
        },
      };
    `,
  ],
  [
    "@/lib/workspace/invite-service",
    `
      export async function acceptWorkspaceInvite(args) {
        return globalThis.__joinPageTestState.acceptWorkspaceInvite(args);
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

type JoinPageModule = typeof import("./page");

let JoinWorkspacePage: JoinPageModule["default"];

before(async () => {
  ({ default: JoinWorkspacePage } = await import("./page"));
});

beforeEach(() => {
  globalForJoinPage.__joinPageTestState = createDefaultState();
});

function invoke(token = "tok-1") {
  return JoinWorkspacePage({ params: Promise.resolve({ token }) });
}

/** Renders a resolved page result (a plain, hook-free React element) and returns its serialized text tree. */
function renderText(element: ReactElement): string {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(element);
  });
  const json = renderer?.toJSON();
  act(() => {
    renderer?.unmount();
  });
  return JSON.stringify(json);
}

describe("JoinWorkspacePage", () => {
  it("redirects unauthenticated visitors to /login without looking up the invite", async () => {
    denyAuth();

    await assert.rejects(() => invoke(), /NEXT_REDIRECT:\/login/);

    assert.equal(callsOf("prisma.inviteLink.findUnique").length, 0);
  });

  it("calls notFound() when the invite token does not resolve to a link", async () => {
    state().inviteLink = null;

    await assert.rejects(() => invoke("missing-token"), /NEXT_NOT_FOUND/);

    assert.deepEqual(callsOf("prisma.inviteLink.findUnique")[0]?.[1], {
      where: { token: "missing-token" },
      select: {
        id: true,
        workspaceId: true,
        isRevoked: true,
        role: true,
        expiresAt: true,
        maxUses: true,
        useCount: true,
        workspace: { select: { ownerId: true } },
      },
    });
    assert.equal(callsOf("prisma.workspaceMember.findFirst").length, 0);
    assert.equal(callsOf("acceptWorkspaceInvite").length, 0);
  });

  it("redirects a workspace owner straight to the workspace without checking membership or accepting", async () => {
    state().user = { id: "owner-1" };
    state().inviteLink = {
      ...defaultInviteLink(),
      workspace: { ownerId: "owner-1" },
    };

    await assert.rejects(
      () => invoke(),
      /NEXT_REDIRECT:\/app\/workspaces\/ws-1/,
    );

    assert.equal(callsOf("prisma.workspaceMember.findFirst").length, 0);
    assert.equal(callsOf("acceptWorkspaceInvite").length, 0);
  });

  it("redirects an existing workspace member straight to the workspace without accepting again", async () => {
    state().existingMember = { id: "member-1" };

    await assert.rejects(
      () => invoke(),
      /NEXT_REDIRECT:\/app\/workspaces\/ws-1/,
    );

    assert.deepEqual(callsOf("prisma.workspaceMember.findFirst")[0]?.[1], {
      where: { workspaceId: "ws-1", userId: "user-1" },
      select: { id: true },
    });
    assert.equal(callsOf("acceptWorkspaceInvite").length, 0);
  });

  it("renders the invalid-invite state for a revoked link without attempting acceptance", async () => {
    state().inviteLink = { ...defaultInviteLink(), isRevoked: true };

    const result = (await invoke()) as ReactElement;
    assert.ok(isValidElement(result));

    const text = renderText(result);
    assert.match(text, /Invite no longer valid/);
    assert.match(
      text,
      /This invite link has been revoked by a workspace owner\./,
    );
    assert.equal(callsOf("acceptWorkspaceInvite").length, 0);
  });

  it("renders the invalid-invite state for a link with a non-invitable stored role", async () => {
    state().inviteLink = { ...defaultInviteLink(), role: "OWNER" };

    const result = (await invoke()) as ReactElement;
    const text = renderText(result);

    assert.match(
      text,
      /This invite link is misconfigured and can no longer be used\./,
    );
    assert.equal(callsOf("acceptWorkspaceInvite").length, 0);
  });

  it("accepts a valid invite and redirects to the workspace with the server-validated role threaded through", async () => {
    state().inviteLink = {
      ...defaultInviteLink(),
      id: "invite-9",
      workspaceId: "ws-9",
      maxUses: 5,
      role: "EDITOR",
      workspace: { ownerId: "owner-9" },
    };

    await assert.rejects(
      () => invoke(),
      /NEXT_REDIRECT:\/app\/workspaces\/ws-9/,
    );

    assert.deepEqual(callsOf("acceptWorkspaceInvite"), [
      [
        "acceptWorkspaceInvite",
        {
          inviteLinkId: "invite-9",
          maxUses: 5,
          workspaceId: "ws-9",
          userId: "user-1",
          role: "EDITOR",
        },
      ],
    ]);
  });

  it("redirects to the workspace when acceptance races into an already-member outcome", async () => {
    state().acceptResult = { outcome: "already-member" };

    await assert.rejects(
      () => invoke(),
      /NEXT_REDIRECT:\/app\/workspaces\/ws-1/,
    );
  });

  it("renders the exhausted invalid-invite state when acceptance races into a cap-exhausted outcome", async () => {
    state().acceptResult = { outcome: "cap-exhausted" };

    const result = (await invoke()) as ReactElement;
    const text = renderText(result);

    assert.match(
      text,
      /This invite link has reached its maximum number of uses\./,
    );
  });
});
