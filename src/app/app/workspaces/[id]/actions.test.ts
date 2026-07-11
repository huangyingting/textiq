import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";

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

type InviteLink = {
  id: string;
  token: string;
  role: string;
  createdAt: Date;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
};

type MemberTarget = {
  workspaceId: string;
  userId: string;
};

type TestState = {
  calls: unknown[];
  redirect: (url: string) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  requireWorkspaceCapability: (
    userId: string,
    workspaceId: string,
    capability: string,
  ) => Promise<unknown>;
  assertInvitableWorkspaceRole: (role: unknown) => void;
  createWorkspaceInviteLink: (args: {
    workspaceId: string;
    role: string;
    createdById: string;
    options: unknown;
  }) => Promise<InviteLink>;
  getInviteLinkTarget: (
    linkId: string,
  ) => Promise<{ workspaceId: string } | null>;
  revokeWorkspaceInviteLink: (linkId: string) => Promise<void>;
  createWorkspaceDocumentForUser: (
    userId: string,
    workspaceId: string,
    templateId: string,
  ) => Promise<{ id: string }>;
  deleteWorkspaceAndDetachDocuments: (workspaceId: string) => Promise<void>;
  getWorkspaceMemberRemovalTarget: (
    memberId: string,
  ) => Promise<MemberTarget | null>;
  importWorkspaceDocumentForUser: (
    userId: string,
    workspaceId: string,
    content: string,
    rawTitle: string,
  ) => Promise<{ id: string }>;
  leaveWorkspaceForUser: (workspaceId: string, userId: string) => Promise<void>;
  listWorkspaceDocumentsForUser: (
    userId: string,
    workspaceId: string,
  ) => Promise<{ documents: unknown[]; hasMore: boolean }>;
  removeWorkspaceMemberAndDetachDocuments: (
    memberId: string,
    member: MemberTarget,
  ) => Promise<void>;
  renameWorkspaceRecord: (
    workspaceId: string,
    rawName: string,
  ) => Promise<void>;
  transferWorkspaceOwnership: (
    workspaceId: string,
    currentOwnerId: string,
    newOwnerUserId: string,
  ) => Promise<void>;
};

const globalForActions = globalThis as typeof globalThis & {
  __workspaceActionsTestState: TestState;
};

function createDefaultState(): TestState {
  const calls: unknown[] = [];
  return {
    calls,
    redirect(url: string): never {
      calls.push(["redirect", url]);
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
    revalidatePath(path: string) {
      calls.push(["revalidatePath", path]);
    },
    async requireUser() {
      calls.push(["requireUser"]);
      return { id: "user-1" };
    },
    async requireWorkspaceCapability(userId, workspaceId, capability) {
      calls.push([
        "requireWorkspaceCapability",
        userId,
        workspaceId,
        capability,
      ]);
      return { role: "OWNER", canView: true, canMutate: true, canManage: true };
    },
    assertInvitableWorkspaceRole(role) {
      calls.push(["assertInvitableWorkspaceRole", role]);
      if (role !== "EDITOR" && role !== "VIEWER") {
        throw new Error(`Invalid invite role: ${String(role)}.`);
      }
    },
    async createWorkspaceInviteLink(args) {
      calls.push(["createWorkspaceInviteLink", args]);
      return {
        id: "link-1",
        token: "tok-abc",
        role: args.role,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        expiresAt: null,
        maxUses: null,
        useCount: 0,
      };
    },
    async getInviteLinkTarget(linkId) {
      calls.push(["getInviteLinkTarget", linkId]);
      return { workspaceId: "workspace-1" };
    },
    async revokeWorkspaceInviteLink(linkId) {
      calls.push(["revokeWorkspaceInviteLink", linkId]);
    },
    async createWorkspaceDocumentForUser(userId, workspaceId, templateId) {
      calls.push([
        "createWorkspaceDocumentForUser",
        userId,
        workspaceId,
        templateId,
      ]);
      return { id: "doc-1" };
    },
    async deleteWorkspaceAndDetachDocuments(workspaceId) {
      calls.push(["deleteWorkspaceAndDetachDocuments", workspaceId]);
    },
    async getWorkspaceMemberRemovalTarget(memberId) {
      calls.push(["getWorkspaceMemberRemovalTarget", memberId]);
      return { workspaceId: "workspace-1", userId: "user-2" };
    },
    async importWorkspaceDocumentForUser(
      userId,
      workspaceId,
      content,
      rawTitle,
    ) {
      calls.push([
        "importWorkspaceDocumentForUser",
        userId,
        workspaceId,
        content,
        rawTitle,
      ]);
      return { id: "doc-2" };
    },
    async leaveWorkspaceForUser(workspaceId, userId) {
      calls.push(["leaveWorkspaceForUser", workspaceId, userId]);
    },
    async listWorkspaceDocumentsForUser(userId, workspaceId) {
      calls.push(["listWorkspaceDocumentsForUser", userId, workspaceId]);
      return {
        documents: [
          { id: "doc-1", title: "Doc", updatedAt: new Date("2026-01-01") },
        ],
        hasMore: false,
      };
    },
    async removeWorkspaceMemberAndDetachDocuments(memberId, member) {
      calls.push(["removeWorkspaceMemberAndDetachDocuments", memberId, member]);
    },
    async renameWorkspaceRecord(workspaceId, rawName) {
      calls.push(["renameWorkspaceRecord", workspaceId, rawName]);
    },
    async transferWorkspaceOwnership(
      workspaceId,
      currentOwnerId,
      newOwnerUserId,
    ) {
      calls.push([
        "transferWorkspaceOwnership",
        workspaceId,
        currentOwnerId,
        newOwnerUserId,
      ]);
    },
  };
}

globalForActions.__workspaceActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-workspace-action-test:";

const stubbedModules = new Map<string, string>([
  // Silence server-only guard so the module loads in Node test context.
  ["server-only", ""],
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__workspaceActionsTestState.redirect(url);
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__workspaceActionsTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__workspaceActionsTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/auth/workspace-capabilities",
    `
      export async function requireWorkspaceCapability(userId, workspaceId, capability) {
        return globalThis.__workspaceActionsTestState.requireWorkspaceCapability(
          userId, workspaceId, capability,
        );
      }
    `,
  ],
  [
    "@/lib/workspace/invite-service",
    `
      export function assertInvitableWorkspaceRole(role) {
        return globalThis.__workspaceActionsTestState.assertInvitableWorkspaceRole(role);
      }
      export async function createWorkspaceInviteLink(args) {
        return globalThis.__workspaceActionsTestState.createWorkspaceInviteLink(args);
      }
      export async function getInviteLinkTarget(linkId) {
        return globalThis.__workspaceActionsTestState.getInviteLinkTarget(linkId);
      }
      export async function revokeWorkspaceInviteLink(linkId) {
        return globalThis.__workspaceActionsTestState.revokeWorkspaceInviteLink(linkId);
      }
    `,
  ],
  [
    "@/lib/workspace/service",
    `
      export async function createWorkspaceDocumentForUser(userId, workspaceId, templateId) {
        return globalThis.__workspaceActionsTestState.createWorkspaceDocumentForUser(
          userId, workspaceId, templateId,
        );
      }
      export async function deleteWorkspaceAndDetachDocuments(workspaceId) {
        return globalThis.__workspaceActionsTestState.deleteWorkspaceAndDetachDocuments(workspaceId);
      }
      export async function getWorkspaceMemberRemovalTarget(memberId) {
        return globalThis.__workspaceActionsTestState.getWorkspaceMemberRemovalTarget(memberId);
      }
      export async function importWorkspaceDocumentForUser(userId, workspaceId, content, rawTitle) {
        return globalThis.__workspaceActionsTestState.importWorkspaceDocumentForUser(
          userId, workspaceId, content, rawTitle,
        );
      }
      export async function leaveWorkspaceForUser(workspaceId, userId) {
        return globalThis.__workspaceActionsTestState.leaveWorkspaceForUser(workspaceId, userId);
      }
      export async function listWorkspaceDocumentsForUser(userId, workspaceId) {
        return globalThis.__workspaceActionsTestState.listWorkspaceDocumentsForUser(userId, workspaceId);
      }
      export async function removeWorkspaceMemberAndDetachDocuments(memberId, member) {
        return globalThis.__workspaceActionsTestState.removeWorkspaceMemberAndDetachDocuments(
          memberId, member,
        );
      }
      export async function renameWorkspaceRecord(workspaceId, rawName) {
        return globalThis.__workspaceActionsTestState.renameWorkspaceRecord(workspaceId, rawName);
      }
      export async function transferWorkspaceOwnership(workspaceId, currentOwnerId, newOwnerUserId) {
        return globalThis.__workspaceActionsTestState.transferWorkspaceOwnership(
          workspaceId, currentOwnerId, newOwnerUserId,
        );
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

type WorkspaceActions = typeof import("./actions");

let actions: WorkspaceActions;

before(async () => {
  actions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__workspaceActionsTestState = createDefaultState();
});

function state(): TestState {
  return globalForActions.__workspaceActionsTestState;
}

/** Makes requireUser simulate an unauthenticated caller by invoking the redirect. */
function denyAuth() {
  state().requireUser = async (redir) => {
    redir("/login");
    throw new Error("unreachable");
  };
}

/** Makes requireWorkspaceCapability simulate an insufficient-privilege rejection. */
function denyCapability() {
  state().requireWorkspaceCapability = async () => {
    const err = new Error("Insufficient workspace capability.");
    err.name = "WorkspacePermissionError";
    throw err;
  };
}

// ---------------------------------------------------------------------------
// createInviteLink
// ---------------------------------------------------------------------------

describe("createInviteLink", () => {
  it("redirects unauthenticated callers and makes no invite calls", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.createInviteLink("ws-1", "EDITOR"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "createWorkspaceInviteLink",
      ).length,
      0,
    );
  });

  it("rejects non-invitable OWNER role before capability check", async () => {
    await assert.rejects(
      () => actions.createInviteLink("ws-1", "OWNER" as "EDITOR"),
      /Invalid invite role/,
    );
    assert.deepEqual(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "requireWorkspaceCapability",
      ).length,
      0,
    );
    assert.deepEqual(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "createWorkspaceInviteLink",
      ).length,
      0,
    );
  });

  it("throws for insufficient manage capability and makes no invite calls", async () => {
    denyCapability();
    await assert.rejects(
      () => actions.createInviteLink("ws-1", "EDITOR"),
      /WorkspacePermissionError|Insufficient workspace capability/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "createWorkspaceInviteLink",
      ).length,
      0,
    );
  });

  it("creates an EDITOR invite link, revalidates workspace route, and returns the link", async () => {
    const link = await actions.createInviteLink("ws-1", "EDITOR", {
      expiresInDays: null,
      maxUses: null,
    });

    assert.equal(link.id, "link-1");
    assert.equal(link.role, "EDITOR");
    assert.equal(link.token, "tok-abc");
    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["assertInvitableWorkspaceRole", "EDITOR"],
      ["requireWorkspaceCapability", "user-1", "ws-1", "manage"],
      [
        "createWorkspaceInviteLink",
        {
          workspaceId: "ws-1",
          role: "EDITOR",
          createdById: "user-1",
          options: { expiresInDays: null, maxUses: null },
        },
      ],
      ["revalidatePath", "/app/workspaces/ws-1"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// revokeInviteLink
// ---------------------------------------------------------------------------

describe("revokeInviteLink", () => {
  it("redirects unauthenticated callers and makes no revoke calls", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.revokeInviteLink("link-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "revokeWorkspaceInviteLink",
      ).length,
      0,
    );
  });

  it("throws when invite link is not found and skips capability and revoke calls", async () => {
    state().getInviteLinkTarget = async (linkId) => {
      state().calls.push(["getInviteLinkTarget", linkId]);
      return null;
    };
    await assert.rejects(
      () => actions.revokeInviteLink("missing-link"),
      /Invite link not found/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "requireWorkspaceCapability",
      ).length,
      0,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "revokeWorkspaceInviteLink",
      ).length,
      0,
    );
  });

  it("throws for insufficient manage capability and does not revoke", async () => {
    denyCapability();
    await assert.rejects(
      () => actions.revokeInviteLink("link-1"),
      /WorkspacePermissionError|Insufficient workspace capability/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "revokeWorkspaceInviteLink",
      ).length,
      0,
    );
  });

  it("revokes the link and revalidates the workspace route", async () => {
    await actions.revokeInviteLink("link-1");

    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["getInviteLinkTarget", "link-1"],
      ["requireWorkspaceCapability", "user-1", "workspace-1", "manage"],
      ["revokeWorkspaceInviteLink", "link-1"],
      ["revalidatePath", "/app/workspaces/workspace-1"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

describe("removeMember", () => {
  it("redirects unauthenticated callers and makes no removal calls", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.removeMember("member-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(
      state().calls.filter(
        (c) =>
          (c as unknown[])[0] === "removeWorkspaceMemberAndDetachDocuments",
      ).length,
      0,
    );
  });

  it("throws when member is not found and skips capability and removal calls", async () => {
    state().getWorkspaceMemberRemovalTarget = async (memberId) => {
      state().calls.push(["getWorkspaceMemberRemovalTarget", memberId]);
      return null;
    };
    await assert.rejects(
      () => actions.removeMember("missing-member"),
      /Member not found/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "requireWorkspaceCapability",
      ).length,
      0,
    );
    assert.equal(
      state().calls.filter(
        (c) =>
          (c as unknown[])[0] === "removeWorkspaceMemberAndDetachDocuments",
      ).length,
      0,
    );
  });

  it("throws for insufficient manage capability and does not remove", async () => {
    denyCapability();
    await assert.rejects(
      () => actions.removeMember("member-1"),
      /WorkspacePermissionError|Insufficient workspace capability/,
    );
    assert.equal(
      state().calls.filter(
        (c) =>
          (c as unknown[])[0] === "removeWorkspaceMemberAndDetachDocuments",
      ).length,
      0,
    );
  });

  it("removes member by id, checks manage capability, and revalidates app and workspace routes", async () => {
    await actions.removeMember("member-1");

    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["getWorkspaceMemberRemovalTarget", "member-1"],
      ["requireWorkspaceCapability", "user-1", "workspace-1", "manage"],
      [
        "removeWorkspaceMemberAndDetachDocuments",
        "member-1",
        { workspaceId: "workspace-1", userId: "user-2" },
      ],
      ["revalidatePath", "/app"],
      ["revalidatePath", "/app/workspaces/workspace-1"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// renameWorkspace
// ---------------------------------------------------------------------------

describe("renameWorkspace", () => {
  it("redirects unauthenticated callers and makes no rename calls", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.renameWorkspace("ws-1", "New Name"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "renameWorkspaceRecord",
      ).length,
      0,
    );
  });

  it("throws for insufficient manage capability and does not rename", async () => {
    denyCapability();
    await assert.rejects(
      () => actions.renameWorkspace("ws-1", "New Name"),
      /WorkspacePermissionError|Insufficient workspace capability/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "renameWorkspaceRecord",
      ).length,
      0,
    );
  });

  it("renames workspace, checks manage capability, and revalidates workspaces routes", async () => {
    await actions.renameWorkspace("ws-1", "Renamed Workspace");

    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["requireWorkspaceCapability", "user-1", "ws-1", "manage"],
      ["renameWorkspaceRecord", "ws-1", "Renamed Workspace"],
      ["revalidatePath", "/app/workspaces"],
      ["revalidatePath", "/app/workspaces/ws-1"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// deleteWorkspace
// ---------------------------------------------------------------------------

describe("deleteWorkspace", () => {
  it("redirects unauthenticated callers and makes no delete calls", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.deleteWorkspace("ws-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "deleteWorkspaceAndDetachDocuments",
      ).length,
      0,
    );
  });

  it("throws for insufficient manage capability and does not delete", async () => {
    denyCapability();
    await assert.rejects(
      () => actions.deleteWorkspace("ws-1"),
      /WorkspacePermissionError|Insufficient workspace capability/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "deleteWorkspaceAndDetachDocuments",
      ).length,
      0,
    );
  });

  it("deletes workspace, revalidates app and workspaces routes, then redirects to /app/workspaces", async () => {
    await assert.rejects(
      () => actions.deleteWorkspace("ws-1"),
      /NEXT_REDIRECT:\/app\/workspaces$/,
    );
    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["requireWorkspaceCapability", "user-1", "ws-1", "manage"],
      ["deleteWorkspaceAndDetachDocuments", "ws-1"],
      ["revalidatePath", "/app"],
      ["revalidatePath", "/app/workspaces"],
      ["redirect", "/app/workspaces"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// leaveWorkspace
// ---------------------------------------------------------------------------

describe("leaveWorkspace", () => {
  it("redirects unauthenticated callers and makes no leave calls", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.leaveWorkspace("ws-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "leaveWorkspaceForUser",
      ).length,
      0,
    );
  });

  it("propagates service errors when the owner attempts to leave", async () => {
    state().leaveWorkspaceForUser = async (workspaceId, userId) => {
      state().calls.push(["leaveWorkspaceForUser", workspaceId, userId]);
      throw new Error("Cannot leave: you are the workspace owner.");
    };
    await assert.rejects(
      () => actions.leaveWorkspace("ws-1"),
      /Cannot leave.*owner/,
    );
    // Redirect must not fire when service rejects.
    assert.equal(
      state().calls.filter((c) => (c as unknown[])[0] === "redirect").length,
      0,
    );
  });

  it("leaves workspace as a non-owner member, revalidates routes, then redirects to /app/workspaces", async () => {
    await assert.rejects(
      () => actions.leaveWorkspace("ws-1"),
      /NEXT_REDIRECT:\/app\/workspaces$/,
    );
    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["leaveWorkspaceForUser", "ws-1", "user-1"],
      ["revalidatePath", "/app"],
      ["revalidatePath", "/app/workspaces"],
      ["redirect", "/app/workspaces"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// transferOwnership
// ---------------------------------------------------------------------------

describe("transferOwnership", () => {
  it("redirects unauthenticated callers and makes no transfer calls", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.transferOwnership("ws-1", "user-2"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "transferWorkspaceOwnership",
      ).length,
      0,
    );
  });

  it("throws for insufficient manage capability and does not transfer", async () => {
    denyCapability();
    await assert.rejects(
      () => actions.transferOwnership("ws-1", "user-2"),
      /WorkspacePermissionError|Insufficient workspace capability/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "transferWorkspaceOwnership",
      ).length,
      0,
    );
  });

  it("transfers ownership to new member, checks manage capability, and revalidates all workspace routes", async () => {
    await actions.transferOwnership("ws-1", "user-2");

    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["requireWorkspaceCapability", "user-1", "ws-1", "manage"],
      ["transferWorkspaceOwnership", "ws-1", "user-1", "user-2"],
      ["revalidatePath", "/app"],
      ["revalidatePath", "/app/workspaces"],
      ["revalidatePath", "/app/workspaces/ws-1"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// getWorkspaceDocuments
// ---------------------------------------------------------------------------

describe("getWorkspaceDocuments", () => {
  it("redirects unauthenticated callers and makes no document listing calls", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.getWorkspaceDocuments("ws-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "listWorkspaceDocumentsForUser",
      ).length,
      0,
    );
  });

  it("returns document list with hasMore flag for authenticated caller", async () => {
    const result = await actions.getWorkspaceDocuments("ws-1");

    assert.equal(result.hasMore, false);
    assert.equal(result.documents.length, 1);
    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["listWorkspaceDocumentsForUser", "user-1", "ws-1"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// createWorkspaceDocument
// ---------------------------------------------------------------------------

describe("createWorkspaceDocument", () => {
  it("redirects unauthenticated callers and makes no document creation calls", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.createWorkspaceDocument("ws-1", "flowchart"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "createWorkspaceDocumentForUser",
      ).length,
      0,
    );
  });

  it("creates document from template, revalidates routes, and redirects to document editor", async () => {
    await assert.rejects(
      () => actions.createWorkspaceDocument("ws-1", "flowchart"),
      /NEXT_REDIRECT:\/app\/documents\/doc-1$/,
    );
    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["createWorkspaceDocumentForUser", "user-1", "ws-1", "flowchart"],
      ["revalidatePath", "/app"],
      ["revalidatePath", "/app/workspaces/ws-1"],
      ["redirect", "/app/documents/doc-1"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// importWorkspaceDocument
// ---------------------------------------------------------------------------

describe("importWorkspaceDocument", () => {
  it("redirects unauthenticated callers and makes no import calls", async () => {
    denyAuth();
    await assert.rejects(
      () =>
        actions.importWorkspaceDocument("ws-1", "# Content", "Imported Doc"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(
      state().calls.filter(
        (c) => (c as unknown[])[0] === "importWorkspaceDocumentForUser",
      ).length,
      0,
    );
  });

  it("imports content into workspace, revalidates routes, and redirects to document editor", async () => {
    await assert.rejects(
      () => actions.importWorkspaceDocument("ws-1", "# Hello", "  My Import  "),
      /NEXT_REDIRECT:\/app\/documents\/doc-2$/,
    );
    assert.deepEqual(state().calls, [
      ["requireUser"],
      [
        "importWorkspaceDocumentForUser",
        "user-1",
        "ws-1",
        "# Hello",
        "  My Import  ",
      ],
      ["revalidatePath", "/app"],
      ["revalidatePath", "/app/workspaces/ws-1"],
      ["redirect", "/app/documents/doc-2"],
    ]);
  });
});
