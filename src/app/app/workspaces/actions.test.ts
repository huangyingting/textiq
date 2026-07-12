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

type WorkspaceActionsTestState = {
  calls: unknown[];
  redirect: (url: string) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  createWorkspaceForUser: (
    ownerId: string,
    rawName: string,
  ) => Promise<{ id: string }>;
};

const globalForActions = globalThis as typeof globalThis & {
  __createWorkspaceActionsTestState: WorkspaceActionsTestState;
};

function createDefaultState(): WorkspaceActionsTestState {
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
    async createWorkspaceForUser(ownerId, rawName) {
      calls.push(["createWorkspaceForUser", ownerId, rawName]);
      return { id: "workspace-1" };
    },
  };
}

globalForActions.__createWorkspaceActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-create-workspace-action-test:";

const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__createWorkspaceActionsTestState.redirect(url);
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__createWorkspaceActionsTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__createWorkspaceActionsTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/workspace/service",
    `
      export async function createWorkspaceForUser(ownerId, rawName) {
        return globalThis.__createWorkspaceActionsTestState.createWorkspaceForUser(
          ownerId, rawName,
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

type WorkspacesActions = typeof import("./actions");

let actions: WorkspacesActions;

before(async () => {
  actions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__createWorkspaceActionsTestState = createDefaultState();
});

function state(): WorkspaceActionsTestState {
  return globalForActions.__createWorkspaceActionsTestState;
}

function callsOf(tag: string): unknown[][] {
  return (state().calls as unknown[][]).filter((c) => c[0] === tag);
}

function makeFormData(entries: Record<string, FormDataEntryValue>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    fd.append(k, v);
  }
  return fd;
}

/** Makes requireUser simulate an unauthenticated caller by invoking the redirect. */
function denyAuth() {
  state().requireUser = async (redir) => {
    redir("/login");
    throw new Error("unreachable");
  };
}

// ---------------------------------------------------------------------------
// createWorkspace
// ---------------------------------------------------------------------------

describe("createWorkspace", () => {
  it("redirects unauthenticated callers without creating a workspace", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.createWorkspace(null, makeFormData({ name: "Acme" })),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("createWorkspaceForUser").length, 0);
  });

  it("rejects a missing name field with a validation message and no service call", async () => {
    const result = await actions.createWorkspace(null, new FormData());

    assert.equal(result, "Workspace name is required.");
    assert.equal(callsOf("createWorkspaceForUser").length, 0);
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("rejects an empty name with a validation message and no service call", async () => {
    const result = await actions.createWorkspace(
      null,
      makeFormData({ name: "" }),
    );

    assert.equal(result, "Workspace name is required.");
    assert.equal(callsOf("createWorkspaceForUser").length, 0);
  });

  it("rejects a whitespace-only name with a validation message and no service call", async () => {
    const result = await actions.createWorkspace(
      null,
      makeFormData({ name: "   " }),
    );

    assert.equal(result, "Workspace name is required.");
    assert.equal(callsOf("createWorkspaceForUser").length, 0);
  });

  it("creates the workspace for the session user, revalidates, and returns the new workspace path", async () => {
    const result = await actions.createWorkspace(
      null,
      makeFormData({ name: "Acme Inc" }),
    );

    assert.equal(result, "/app/workspaces/workspace-1");
    assert.deepEqual(callsOf("createWorkspaceForUser"), [
      ["createWorkspaceForUser", "user-1", "Acme Inc"],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [
      ["revalidatePath", "/app/workspaces"],
    ]);
  });

  it("passes the raw, untrimmed name through to the service (trimming is the service's responsibility)", async () => {
    await actions.createWorkspace(null, makeFormData({ name: "  Acme Inc  " }));

    const [createCall] = callsOf("createWorkspaceForUser") as [unknown[]];
    assert.equal(createCall[2], "  Acme Inc  ");
  });
});
