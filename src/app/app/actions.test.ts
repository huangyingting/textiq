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

type PrismaStub = {
  user: {
    updateMany: (args: unknown) => Promise<unknown>;
  };
};

type DashboardActionsTestState = {
  calls: unknown[];
  prisma: PrismaStub;
  redirect: (url: string) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  requireDocumentCapability: (
    userId: string,
    documentId: string,
    capability: string,
    options?: { includeDeleted?: boolean },
  ) => Promise<unknown>;
  createDocumentFromTemplateForUser: (
    userId: string,
    templateId: string,
  ) => Promise<{ id: string }>;
  createDocumentFromImportForUser: (
    userId: string,
    content: string,
    rawTitle: string,
  ) => Promise<{ id: string }>;
  duplicateDocumentForUser: (
    userId: string,
    id: string,
  ) => Promise<{ id: string }>;
  searchDocumentsForUser: (
    userId: string,
    rawQuery: string,
  ) => Promise<{ results: unknown[]; hasMore: boolean }>;
  renameDocumentTitle: (id: string, title: string) => Promise<void>;
  toggleDocumentFavorite: (id: string) => Promise<{ favorite: boolean }>;
  restoreDocumentFromTrash: (id: string) => Promise<void>;
  softDeleteDocument: (id: string) => Promise<void>;
};

const globalForActions = globalThis as typeof globalThis & {
  __dashboardActionsTestState: DashboardActionsTestState;
};

function createDefaultState(): DashboardActionsTestState {
  const calls: unknown[] = [];
  return {
    calls,
    prisma: {
      user: {
        async updateMany(args) {
          calls.push(["prisma.user.updateMany", args]);
          return { count: 1 };
        },
      },
    },
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
    async createDocumentFromTemplateForUser(userId, templateId) {
      calls.push(["createDocumentFromTemplateForUser", userId, templateId]);
      return { id: "doc-template-1" };
    },
    async createDocumentFromImportForUser(userId, content, rawTitle) {
      calls.push([
        "createDocumentFromImportForUser",
        userId,
        content,
        rawTitle,
      ]);
      return { id: "doc-import-1" };
    },
    async duplicateDocumentForUser(userId, id) {
      calls.push(["duplicateDocumentForUser", userId, id]);
      return { id: "doc-copy-1" };
    },
    async searchDocumentsForUser(userId, rawQuery) {
      calls.push(["searchDocumentsForUser", userId, rawQuery]);
      return { results: [{ id: "doc-1" }], hasMore: false };
    },
    async renameDocumentTitle(id, title) {
      calls.push(["renameDocumentTitle", id, title]);
    },
    async toggleDocumentFavorite(id) {
      calls.push(["toggleDocumentFavorite", id]);
      return { favorite: true };
    },
    async restoreDocumentFromTrash(id) {
      calls.push(["restoreDocumentFromTrash", id]);
    },
    async softDeleteDocument(id) {
      calls.push(["softDeleteDocument", id]);
    },
  };
}

globalForActions.__dashboardActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-dashboard-action-test:";

const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__dashboardActionsTestState.redirect(url);
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__dashboardActionsTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__dashboardActionsTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/auth/document-permissions",
    `
      export async function requireDocumentCapability(userId, documentId, capability, options) {
        return globalThis.__dashboardActionsTestState.requireDocumentCapability(
          userId, documentId, capability, options,
        );
      }
    `,
  ],
  [
    "@/lib/prisma",
    `
      export const prisma = {
        user: {
          updateMany(args) {
            return globalThis.__dashboardActionsTestState.prisma.user.updateMany(args);
          },
        },
      };
    `,
  ],
  [
    "@/lib/document/create",
    `
      // Real clamp semantics (DOCUMENT_TITLE_MAX_LENGTH = 200) mirrored here so
      // rename boundary wiring can be asserted without re-deriving the create
      // service's own clamp-length test matrix (see src/lib/document/create.test.ts).
      export function clampDocumentTitle(rawTitle, fallback) {
        return rawTitle.trim().slice(0, 200) || fallback;
      }
      export async function createDocumentFromTemplateForUser(userId, templateId) {
        return globalThis.__dashboardActionsTestState.createDocumentFromTemplateForUser(
          userId, templateId,
        );
      }
      export async function createDocumentFromImportForUser(userId, content, rawTitle) {
        return globalThis.__dashboardActionsTestState.createDocumentFromImportForUser(
          userId, content, rawTitle,
        );
      }
    `,
  ],
  [
    "@/lib/document/duplicate",
    `
      export async function duplicateDocumentForUser(userId, id) {
        return globalThis.__dashboardActionsTestState.duplicateDocumentForUser(userId, id);
      }
    `,
  ],
  [
    "@/lib/document/list",
    `
      export async function searchDocumentsForUser(userId, rawQuery) {
        return globalThis.__dashboardActionsTestState.searchDocumentsForUser(userId, rawQuery);
      }
    `,
  ],
  [
    "@/lib/document/mutations",
    `
      export async function renameDocumentTitle(id, title) {
        return globalThis.__dashboardActionsTestState.renameDocumentTitle(id, title);
      }
      export async function toggleDocumentFavorite(id) {
        return globalThis.__dashboardActionsTestState.toggleDocumentFavorite(id);
      }
    `,
  ],
  [
    "@/lib/document/trash",
    `
      export async function restoreDocumentFromTrash(id) {
        return globalThis.__dashboardActionsTestState.restoreDocumentFromTrash(id);
      }
      export async function softDeleteDocument(id) {
        return globalThis.__dashboardActionsTestState.softDeleteDocument(id);
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

type DashboardActions = typeof import("./actions");

let actions: DashboardActions;

before(async () => {
  actions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__dashboardActionsTestState = createDefaultState();
});

function state(): DashboardActionsTestState {
  return globalForActions.__dashboardActionsTestState;
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
// createDocumentFromTemplate
// ---------------------------------------------------------------------------

describe("createDocumentFromTemplate", () => {
  it("redirects unauthenticated callers without creating a document", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.createDocumentFromTemplate("blank"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("createDocumentFromTemplateForUser").length, 0);
  });

  it("creates the document for the session user, revalidates, and redirects to the editor", async () => {
    await assert.rejects(
      () => actions.createDocumentFromTemplate("starter-1"),
      /NEXT_REDIRECT:\/app\/documents\/doc-template-1/,
    );

    assert.deepEqual(callsOf("createDocumentFromTemplateForUser"), [
      ["createDocumentFromTemplateForUser", "user-1", "starter-1"],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [["revalidatePath", "/app"]]);
  });
});

// ---------------------------------------------------------------------------
// createDocumentFromImport
// ---------------------------------------------------------------------------

describe("createDocumentFromImport", () => {
  it("redirects unauthenticated callers without importing a document", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.createDocumentFromImport("# Doc", "Imported"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("createDocumentFromImportForUser").length, 0);
  });

  it("imports the document for the session user, revalidates, and redirects to the editor", async () => {
    await assert.rejects(
      () => actions.createDocumentFromImport("# Doc body", "Imported title"),
      /NEXT_REDIRECT:\/app\/documents\/doc-import-1/,
    );

    assert.deepEqual(callsOf("createDocumentFromImportForUser"), [
      [
        "createDocumentFromImportForUser",
        "user-1",
        "# Doc body",
        "Imported title",
      ],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [["revalidatePath", "/app"]]);
  });
});

// ---------------------------------------------------------------------------
// renameDocument
// ---------------------------------------------------------------------------

describe("renameDocument", () => {
  it("redirects unauthenticated callers without checking capability or writing", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.renameDocument("doc-1", "New title"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("requireDocumentCapability").length, 0);
    assert.equal(callsOf("renameDocumentTitle").length, 0);
  });

  it("requires edit capability scoped to the target document before writing", async () => {
    await actions.renameDocument("doc-1", "New title");

    assert.deepEqual(callsOf("requireDocumentCapability"), [
      ["requireDocumentCapability", "user-1", "doc-1", "edit", undefined],
    ]);
  });

  it("propagates a permission denial without writing the title", async () => {
    denyCapability("Document not found.");

    await assert.rejects(
      () => actions.renameDocument("doc-404", "New title"),
      /Document not found\./,
    );
    assert.equal(callsOf("renameDocumentTitle").length, 0);
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("trims and clamps the title, writes it, revalidates, and returns the normalized value", async () => {
    const result = await actions.renameDocument("doc-1", "  Roadmap  ");

    assert.deepEqual(result, { title: "Roadmap" });
    assert.deepEqual(callsOf("renameDocumentTitle"), [
      ["renameDocumentTitle", "doc-1", "Roadmap"],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [["revalidatePath", "/app"]]);
  });

  it("falls back to Untitled for a blank title", async () => {
    const result = await actions.renameDocument("doc-1", "   ");

    assert.deepEqual(result, { title: "Untitled" });
    const [renameCall] = callsOf("renameDocumentTitle") as [unknown[]];
    assert.equal(renameCall[2], "Untitled");
  });
});

// ---------------------------------------------------------------------------
// duplicateDocument
// ---------------------------------------------------------------------------

describe("duplicateDocument", () => {
  it("redirects unauthenticated callers without duplicating", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.duplicateDocument("doc-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("duplicateDocumentForUser").length, 0);
  });

  it("requires view capability scoped to the source document", async () => {
    await actions.duplicateDocument("doc-1");

    assert.deepEqual(callsOf("requireDocumentCapability"), [
      ["requireDocumentCapability", "user-1", "doc-1", "view", undefined],
    ]);
  });

  it("propagates a permission denial without duplicating", async () => {
    denyCapability("Document not found.");

    await assert.rejects(
      () => actions.duplicateDocument("doc-404"),
      /Document not found\./,
    );
    assert.equal(callsOf("duplicateDocumentForUser").length, 0);
  });

  it("duplicates into a document owned by the session user and revalidates", async () => {
    await actions.duplicateDocument("doc-1");

    assert.deepEqual(callsOf("duplicateDocumentForUser"), [
      ["duplicateDocumentForUser", "user-1", "doc-1"],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [["revalidatePath", "/app"]]);
  });
});

// ---------------------------------------------------------------------------
// toggleFavorite
// ---------------------------------------------------------------------------

describe("toggleFavorite", () => {
  it("redirects unauthenticated callers without toggling", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.toggleFavorite("doc-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("toggleDocumentFavorite").length, 0);
  });

  it("requires edit capability, toggles, revalidates, and returns the new flag", async () => {
    const result = await actions.toggleFavorite("doc-1");

    assert.deepEqual(result, { favorite: true });
    assert.deepEqual(callsOf("requireDocumentCapability"), [
      ["requireDocumentCapability", "user-1", "doc-1", "edit", undefined],
    ]);
    assert.deepEqual(callsOf("toggleDocumentFavorite"), [
      ["toggleDocumentFavorite", "doc-1"],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [["revalidatePath", "/app"]]);
  });

  it("propagates a permission denial without toggling", async () => {
    denyCapability("Document not found.");

    await assert.rejects(
      () => actions.toggleFavorite("doc-404"),
      /Document not found\./,
    );
    assert.equal(callsOf("toggleDocumentFavorite").length, 0);
  });
});

// ---------------------------------------------------------------------------
// deleteDocument
// ---------------------------------------------------------------------------

describe("deleteDocument", () => {
  it("redirects unauthenticated callers without soft-deleting", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.deleteDocument("doc-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("softDeleteDocument").length, 0);
  });

  it("requires manage capability, scoped to the target document, before soft-deleting", async () => {
    await actions.deleteDocument("doc-1");

    assert.deepEqual(callsOf("requireDocumentCapability"), [
      ["requireDocumentCapability", "user-1", "doc-1", "manage", undefined],
    ]);
    assert.deepEqual(callsOf("softDeleteDocument"), [
      ["softDeleteDocument", "doc-1"],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [["revalidatePath", "/app"]]);
  });

  it("propagates a permission denial without soft-deleting", async () => {
    denyCapability("Document not found.");

    await assert.rejects(
      () => actions.deleteDocument("doc-404"),
      /Document not found\./,
    );
    assert.equal(callsOf("softDeleteDocument").length, 0);
    assert.equal(callsOf("revalidatePath").length, 0);
  });
});

// ---------------------------------------------------------------------------
// restoreDocument
// ---------------------------------------------------------------------------

describe("restoreDocument", () => {
  it("redirects unauthenticated callers without restoring", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.restoreDocument("doc-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("restoreDocumentFromTrash").length, 0);
  });

  it("requires manage capability including deleted rows before restoring", async () => {
    await actions.restoreDocument("doc-1");

    assert.deepEqual(callsOf("requireDocumentCapability"), [
      [
        "requireDocumentCapability",
        "user-1",
        "doc-1",
        "manage",
        { includeDeleted: true },
      ],
    ]);
    assert.deepEqual(callsOf("restoreDocumentFromTrash"), [
      ["restoreDocumentFromTrash", "doc-1"],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [["revalidatePath", "/app"]]);
  });

  it("propagates a permission denial without restoring", async () => {
    denyCapability("Document not found.");

    await assert.rejects(
      () => actions.restoreDocument("doc-404"),
      /Document not found\./,
    );
    assert.equal(callsOf("restoreDocumentFromTrash").length, 0);
  });
});

// ---------------------------------------------------------------------------
// searchDocuments
// ---------------------------------------------------------------------------

describe("searchDocuments", () => {
  it("redirects unauthenticated callers without querying", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.searchDocuments("roadmap"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("searchDocumentsForUser").length, 0);
  });

  it("scopes the search to the session user and returns the service result verbatim", async () => {
    const result = await actions.searchDocuments("roadmap");

    assert.deepEqual(result, { results: [{ id: "doc-1" }], hasMore: false });
    assert.deepEqual(callsOf("searchDocumentsForUser"), [
      ["searchDocumentsForUser", "user-1", "roadmap"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// dismissOnboarding
// ---------------------------------------------------------------------------

describe("dismissOnboarding", () => {
  it("redirects unauthenticated callers without writing", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.dismissOnboarding(),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("prisma.user.updateMany").length, 0);
  });

  it("stamps onboardingDismissed for the session user and revalidates", async () => {
    await actions.dismissOnboarding();

    assert.deepEqual(callsOf("prisma.user.updateMany"), [
      [
        "prisma.user.updateMany",
        { where: { id: "user-1" }, data: { onboardingDismissed: true } },
      ],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [["revalidatePath", "/app"]]);
  });
});
