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

type TrashActionsTestState = {
  calls: unknown[];
  redirect: (url: string) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  requireDocumentCapability: (
    userId: string,
    documentId: string,
    capability: string,
    options?: { includeDeleted?: boolean },
  ) => Promise<unknown>;
  permanentDeleteDocument: (id: string) => Promise<void>;
};

const globalForActions = globalThis as typeof globalThis & {
  __trashActionsTestState: TrashActionsTestState;
};

function createDefaultState(): TrashActionsTestState {
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
    async requireDocumentCapability(userId, documentId, capability, options) {
      calls.push([
        "requireDocumentCapability",
        userId,
        documentId,
        capability,
        options,
      ]);
      return {
        role: "owner",
        canView: true,
        canEdit: true,
        canManage: true,
        document: { id: documentId, ownerId: userId, workspaceId: null },
      };
    },
    async permanentDeleteDocument(id) {
      calls.push(["permanentDeleteDocument", id]);
    },
  };
}

globalForActions.__trashActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-trash-action-test:";

const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__trashActionsTestState.redirect(url);
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__trashActionsTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__trashActionsTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/auth/document-permissions",
    `
      export async function requireDocumentCapability(userId, documentId, capability, options) {
        return globalThis.__trashActionsTestState.requireDocumentCapability(
          userId, documentId, capability, options,
        );
      }
    `,
  ],
  [
    "@/lib/document/trash",
    `
      export async function permanentDeleteDocument(id) {
        return globalThis.__trashActionsTestState.permanentDeleteDocument(id);
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

type TrashActions = typeof import("./actions");

let actions: TrashActions;

before(async () => {
  actions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__trashActionsTestState = createDefaultState();
});

function state(): TrashActionsTestState {
  return globalForActions.__trashActionsTestState;
}

function callsOf(tag: string): unknown[][] {
  return (state().calls as unknown[][]).filter((c) => c[0] === tag);
}

/** Makes requireUser simulate an unauthenticated caller by invoking the redirect. */
function denyAuth() {
  state().requireUser = async (redir) => {
    redir("/login");
    throw new Error("unreachable");
  };
}

/** Makes requireDocumentCapability simulate a rejection (not found or forbidden). */
function denyCapability(message = "Document not found.") {
  state().requireDocumentCapability = async () => {
    const err = new Error(message);
    err.name = "DocumentPermissionError";
    throw err;
  };
}

// ---------------------------------------------------------------------------
// permanentDeleteDocument
// ---------------------------------------------------------------------------

describe("permanentDeleteDocument", () => {
  it("redirects unauthenticated callers without checking capability or deleting", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.permanentDeleteDocument("doc-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("requireDocumentCapability").length, 0);
    assert.equal(callsOf("permanentDeleteDocument").length, 0);
  });

  it("requires manage capability including soft-deleted rows before hard-deleting", async () => {
    await actions.permanentDeleteDocument("doc-1");

    assert.deepEqual(callsOf("requireDocumentCapability"), [
      [
        "requireDocumentCapability",
        "user-1",
        "doc-1",
        "manage",
        { includeDeleted: true },
      ],
    ]);
  });

  it("propagates a permission denial without hard-deleting or revalidating", async () => {
    denyCapability("Document not found.");

    await assert.rejects(
      () => actions.permanentDeleteDocument("doc-404"),
      /Document not found\./,
    );
    assert.equal(callsOf("permanentDeleteDocument").length, 0);
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("hard-deletes the document and revalidates both the trash and dashboard views", async () => {
    await actions.permanentDeleteDocument("doc-1");

    assert.deepEqual(callsOf("permanentDeleteDocument"), [
      ["permanentDeleteDocument", "doc-1"],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [
      ["revalidatePath", "/app/trash"],
      ["revalidatePath", "/app"],
    ]);
  });
});
