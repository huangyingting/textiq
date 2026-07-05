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
  document: {
    findUnique: (...args: unknown[]) => Promise<unknown>;
  };
  documentVersion: {
    findMany: (...args: unknown[]) => Promise<unknown[]>;
    findUnique: (...args: unknown[]) => Promise<unknown>;
  };
};

type ActionTestState = {
  calls: unknown[];
  prisma: PrismaStub;
  redirect: (...args: unknown[]) => never;
  revalidatePath: (path: string) => void;
  requireDocumentActionContext: (
    documentId: string,
    capability: string,
  ) => Promise<{ user: { id: string }; authorization: unknown }>;
  requireUser: (redirect: unknown) => Promise<{ id: string }>;
  requireDocumentCapability: (
    userId: string,
    documentId: string,
    capability: string,
  ) => Promise<unknown>;
  stampBlockIds: (value: unknown) => unknown;
  atomicSaveDocumentLexical: (
    documentId: string,
    content: unknown,
    userId: string,
  ) => Promise<unknown>;
  rebuildMirror: (documentId: string, content: unknown) => Promise<unknown>;
  persistDeck: (
    documentId: string,
    deckJson: unknown,
    clientToken: string | null | undefined,
    options: unknown,
  ) => Promise<unknown>;
  setDocumentSharing: (
    documentId: string,
    isShared: boolean,
  ) => Promise<unknown>;
  regenerateDocumentShareLink: (documentId: string) => Promise<unknown>;
  updateDocumentSharePolicyData: (
    documentId: string,
    data: Record<string, unknown>,
  ) => Promise<unknown>;
  restoreVersion: (
    documentId: string,
    versionId: string,
    userId: string,
  ) => Promise<unknown>;
  logError: (...args: unknown[]) => void;
  logInfo: (...args: unknown[]) => void;
};

const globalForActions = globalThis as typeof globalThis & {
  __documentActionsTestState: ActionTestState;
};

const prisma: PrismaStub = {
  document: {
    async findUnique() {
      return null;
    },
  },
  documentVersion: {
    async findMany() {
      return [];
    },
    async findUnique() {
      return null;
    },
  },
};

globalForActions.__documentActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-document-action-test:";
const stubbedModules = new Map<string, string>([
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__documentActionsTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(...args) {
        return globalThis.__documentActionsTestState.redirect(...args);
      }
    `,
  ],
  [
    "./document-context",
    `
      export async function requireDocumentActionContext(...args) {
        return globalThis.__documentActionsTestState.requireDocumentActionContext(...args);
      }
    `,
  ],
  [
    "@/lib/prisma",
    `
      export const prisma = globalThis.__documentActionsTestState.prisma;
    `,
  ],
  [
    "@/lib/log",
    `
      export function logError(...args) {
        globalThis.__documentActionsTestState.logError(...args);
      }
      export function logInfo(...args) {
        globalThis.__documentActionsTestState.logInfo(...args);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(...args) {
        return globalThis.__documentActionsTestState.requireUser(...args);
      }
    `,
  ],
  [
    "@/lib/auth/document-permissions",
    `
      export async function requireDocumentCapability(...args) {
        return globalThis.__documentActionsTestState.requireDocumentCapability(...args);
      }
    `,
  ],
  [
    "@/lib/lexical/block-id",
    `
      export function stampBlockIds(value) {
        return globalThis.__documentActionsTestState.stampBlockIds(value);
      }
    `,
  ],
  [
    "@/lib/document/persistence-service",
    `
      export async function atomicSaveDocumentLexical(...args) {
        return globalThis.__documentActionsTestState.atomicSaveDocumentLexical(...args);
      }
      export async function rebuildMirror(...args) {
        return globalThis.__documentActionsTestState.rebuildMirror(...args);
      }
      export async function persistDeck(...args) {
        return globalThis.__documentActionsTestState.persistDeck(...args);
      }
      export async function setDocumentSharing(...args) {
        return globalThis.__documentActionsTestState.setDocumentSharing(...args);
      }
      export async function regenerateDocumentShareLink(...args) {
        return globalThis.__documentActionsTestState.regenerateDocumentShareLink(...args);
      }
      export async function updateDocumentSharePolicyData(...args) {
        return globalThis.__documentActionsTestState.updateDocumentSharePolicyData(...args);
      }
      export async function restoreVersion(...args) {
        return globalThis.__documentActionsTestState.restoreVersion(...args);
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

type DeckActions = typeof import("./deck-actions");
type LexicalActions = typeof import("./lexical-actions");
type SharingActions = typeof import("./sharing-actions");
type VersioningActions = typeof import("./versioning-actions");

let deckActions: DeckActions;
let lexicalActions: LexicalActions;
let sharingActions: SharingActions;
let versioningActions: VersioningActions;

before(async () => {
  [deckActions, lexicalActions, sharingActions, versioningActions] =
    await Promise.all([
      import("./deck-actions"),
      import("./lexical-actions"),
      import("./sharing-actions"),
      import("./versioning-actions"),
    ]);
});

beforeEach(() => {
  globalForActions.__documentActionsTestState = createDefaultState();
});

function createDefaultState(): ActionTestState {
  const calls: unknown[] = [];
  return {
    calls,
    prisma,
    redirect() {
      throw new Error("NEXT_REDIRECT");
    },
    revalidatePath(path) {
      calls.push(["revalidatePath", path]);
    },
    async requireDocumentActionContext(documentId, capability) {
      calls.push(["requireDocumentActionContext", documentId, capability]);
      return { user: { id: "user-1" }, authorization: { canView: true } };
    },
    async requireUser() {
      calls.push(["requireUser"]);
      return { id: "user-1" };
    },
    async requireDocumentCapability(userId, documentId, capability) {
      calls.push(["requireDocumentCapability", userId, documentId, capability]);
      return { canEdit: true };
    },
    stampBlockIds(value) {
      calls.push(["stampBlockIds", value]);
      return { stamped: value };
    },
    async atomicSaveDocumentLexical(documentId, content, userId) {
      calls.push(["atomicSaveDocumentLexical", documentId, content, userId]);
      return { created: 1, updated: 0, deleted: 0, skipped: 0, invalid: 0 };
    },
    async rebuildMirror(documentId, content) {
      calls.push(["rebuildMirror", documentId, content]);
      return { created: 0, updated: 1, deleted: 0, skipped: 0, invalid: 0 };
    },
    async persistDeck(documentId, deckJson, clientToken, options) {
      calls.push(["persistDeck", documentId, deckJson, clientToken, options]);
      return { ok: true, revisionToken: "rev-2" };
    },
    async setDocumentSharing(documentId, isShared) {
      calls.push(["setDocumentSharing", documentId, isShared]);
      return { isShared, shareId: isShared ? "share-1" : null };
    },
    async regenerateDocumentShareLink(documentId) {
      calls.push(["regenerateDocumentShareLink", documentId]);
      return { isShared: true, shareId: "share-2" };
    },
    async updateDocumentSharePolicyData(documentId, data) {
      calls.push(["updateDocumentSharePolicyData", documentId, data]);
      return { isShared: true, shareId: "share-1", ...data };
    },
    async restoreVersion(documentId, versionId, userId) {
      calls.push(["restoreVersion", documentId, versionId, userId]);
      return { documentId, versionId, deckJson: null };
    },
    logError(...args) {
      calls.push(["logError", ...args]);
    },
    logInfo(...args) {
      calls.push(["logInfo", ...args]);
    },
  };
}

function state(): ActionTestState {
  return globalForActions.__documentActionsTestState;
}

describe("deck server actions", () => {
  it("fetches deck JSON, missing documents, and storage failures", async () => {
    prisma.document.findUnique = async () => ({
      deckJson: { slides: [] },
      deckRevisionToken: "rev-1",
    });
    assert.deepEqual(await deckActions.fetchDeckJson("doc-1"), {
      ok: true,
      deckJson: { slides: [] },
      revisionToken: "rev-1",
    });

    prisma.document.findUnique = async () => null;
    assert.deepEqual(await deckActions.fetchDeckJson("missing"), {
      ok: false,
      deckJson: null,
      revisionToken: null,
      error: "Document not found.",
      failure: { code: "document_not_found", retryable: false },
    });

    prisma.document.findUnique = async () => {
      throw new Error("database down");
    };
    const failure = await deckActions.fetchDeckJson("doc-1");
    assert.equal(failure.ok, false);
    assert.equal(failure.failure.code, "storage_unavailable");
    assert.equal(failure.failure.retryable, true);
  });

  it("saves full deck snapshots with revalidation and storage errors", async () => {
    const result = await deckActions.saveDeckJson(
      "doc-1",
      { slides: [] },
      "rev-1",
    );

    assert.deepEqual(result, { ok: true, revisionToken: "rev-2" });
    assert.deepEqual(state().calls.slice(0, 3), [
      ["requireDocumentActionContext", "doc-1", "edit"],
      ["persistDeck", "doc-1", { slides: [] }, "rev-1", { userId: "user-1" }],
      ["revalidatePath", "/app/documents/doc-1"],
    ]);

    state().persistDeck = async () => {
      throw new Error("database down");
    };
    assert.deepEqual(await deckActions.saveDeckJson("doc-1", {}, null), {
      ok: false,
      error: "Failed to save deck. Please try again.",
      failure: { code: "storage_unavailable", retryable: true },
    });
  });
});

describe("lexical server actions", () => {
  it("rejects oversized and invalid serialized editor state before writes", async () => {
    const tooLarge = "x".repeat(2_000_001);
    const oversize = await lexicalActions.saveDocumentLexical(
      "doc-1",
      tooLarge,
    );
    assert.equal(oversize.ok, false);
    assert.equal(oversize.error, "Document is too large to save.");

    const invalid = await lexicalActions.saveDocumentLexical("doc-1", "{");
    assert.deepEqual(invalid, { ok: false, error: "Invalid editor state." });
    assert.deepEqual(state().calls, [["requireUser"], ["requireUser"]]);
  });

  it("stamps, authorizes, persists, and revalidates valid editor state", async () => {
    const result = await lexicalActions.saveDocumentLexical(
      "doc-1",
      JSON.stringify({ root: { children: [] } }),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["stampBlockIds", { root: { children: [] } }],
      ["requireDocumentCapability", "user-1", "doc-1", "edit"],
      [
        "atomicSaveDocumentLexical",
        "doc-1",
        { stamped: { root: { children: [] } } },
        "user-1",
      ],
      ["revalidatePath", "/app"],
    ]);
  });

  it("rebuilds visual mirrors across missing, empty, success, and failure paths", async () => {
    prisma.document.findUnique = async () => null;
    assert.deepEqual(await lexicalActions.rebuildVisualMirror("missing"), {
      ok: false,
      error: "Document not found.",
    });

    prisma.document.findUnique = async () => ({ contentJson: null });
    assert.deepEqual(await lexicalActions.rebuildVisualMirror("doc-empty"), {
      ok: true,
      data: { created: 0, updated: 0, deleted: 0, skipped: 0, invalid: 0 },
    });

    prisma.document.findUnique = async () => ({ contentJson: { root: {} } });
    assert.deepEqual(await lexicalActions.rebuildVisualMirror("doc-1"), {
      ok: true,
      data: { created: 0, updated: 1, deleted: 0, skipped: 0, invalid: 0 },
    });
    assert.deepEqual(state().calls.at(-2), [
      "rebuildMirror",
      "doc-1",
      { root: {} },
    ]);
    assert.deepEqual(state().calls.at(-1), ["revalidatePath", "/app"]);

    state().rebuildMirror = async () => {
      throw new Error("mirror failed");
    };
    assert.deepEqual(await lexicalActions.rebuildVisualMirror("doc-1"), {
      ok: false,
      error: "Failed to rebuild visual mirror.",
    });
  });
});

describe("sharing server actions", () => {
  it("toggles sharing and revalidates document and list routes", async () => {
    assert.deepEqual(
      await sharingActions.toggleDocumentSharing("doc-1", true),
      {
        ok: true,
        data: { isShared: true, shareId: "share-1" },
      },
    );

    assert.deepEqual(state().calls, [
      ["requireDocumentActionContext", "doc-1", "manage"],
      ["setDocumentSharing", "doc-1", true],
      ["revalidatePath", "/app/documents/doc-1"],
      ["revalidatePath", "/app"],
    ]);
  });

  it("regenerates enabled share links and rejects disabled sharing", async () => {
    assert.deepEqual(await sharingActions.regenerateShareLink("doc-1"), {
      ok: true,
      data: { isShared: true, shareId: "share-2" },
    });

    state().regenerateDocumentShareLink = async () => null;
    assert.deepEqual(await sharingActions.regenerateShareLink("doc-1"), {
      ok: false,
      error: "Enable sharing before regenerating the link.",
    });
  });

  it("validates share policy expiry and metadata", async () => {
    assert.deepEqual(
      await sharingActions.updateSharePolicy("doc-1", {
        expiresAt: "not-a-date",
      }),
      { ok: false, error: "Invalid expiry date." },
    );
    assert.deepEqual(
      await sharingActions.updateSharePolicy("doc-1", {
        expiresAt: "9999-01-01T00:00:00.000Z",
      }),
      { ok: false, error: "Expiry date is too far in the future." },
    );
    assert.deepEqual(
      await sharingActions.updateSharePolicy("doc-1", {
        metadataMode: "raw" as "generic",
      }),
      { ok: false, error: "Invalid metadata mode." },
    );
  });

  it("persists normalized share policy fields and revalidates", async () => {
    const result = await sharingActions.updateSharePolicy("doc-1", {
      expiresAt: "",
      embedEnabled: false,
      presentEnabled: true,
      metadataMode: "title-excerpt",
      discoverable: true,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(state().calls.slice(1), [
      [
        "updateDocumentSharePolicyData",
        "doc-1",
        {
          shareExpiresAt: null,
          shareEmbedEnabled: false,
          sharePresentEnabled: true,
          shareMetadataMode: "title-excerpt",
          shareDiscoverable: true,
        },
      ],
      ["revalidatePath", "/app/documents/doc-1"],
      ["revalidatePath", "/app"],
    ]);

    state().calls.length = 0;
    await sharingActions.updateSharePolicy("doc-1", {
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    const persisted = state().calls[1] as [
      string,
      string,
      { shareExpiresAt: Date },
    ];
    assert.equal(persisted[0], "updateDocumentSharePolicyData");
    assert.equal(
      persisted[2].shareExpiresAt.toISOString(),
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("versioning server actions", () => {
  it("lists versions newest-first with author fallback metadata", async () => {
    prisma.documentVersion.findMany = async () => [
      {
        id: "version-created-by",
        createdAt: new Date("2026-01-02T00:00:00Z"),
        label: "Edited",
        deckJson: { slides: [] },
        createdBy: { name: null, email: "editor@example.test" },
        document: { owner: { name: "Owner", email: "owner@example.test" } },
      },
      {
        id: "version-owner",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        label: null,
        deckJson: null,
        createdBy: null,
        document: { owner: { name: null, email: "owner@example.test" } },
      },
    ];

    assert.deepEqual(await versioningActions.listDocumentVersions("doc-1"), [
      {
        id: "version-created-by",
        createdAt: "2026-01-02T00:00:00.000Z",
        label: "Edited",
        authorName: "editor@example.test",
        hasDeck: true,
      },
      {
        id: "version-owner",
        createdAt: "2026-01-01T00:00:00.000Z",
        label: null,
        authorName: "owner@example.test",
        hasDeck: false,
      },
    ]);
  });

  it("restores versions, rejects missing snapshots, and reports restore errors", async () => {
    prisma.documentVersion.findUnique = async () => null;
    assert.deepEqual(
      await versioningActions.restoreDocumentVersion("missing"),
      {
        ok: false,
        error: "Version not found.",
      },
    );

    prisma.documentVersion.findUnique = async () => ({ documentId: "doc-1" });
    assert.deepEqual(
      await versioningActions.restoreDocumentVersion("version-1"),
      {
        ok: true,
        data: { documentId: "doc-1", versionId: "version-1", deckJson: null },
      },
    );
    assert.deepEqual(state().calls.slice(-4), [
      ["requireDocumentCapability", "user-1", "doc-1", "edit"],
      ["restoreVersion", "doc-1", "version-1", "user-1"],
      ["revalidatePath", "/app/documents/doc-1"],
      ["revalidatePath", "/app"],
    ]);

    state().restoreVersion = async () => {
      throw new Error("restore failed");
    };
    assert.deepEqual(
      await versioningActions.restoreDocumentVersion("version-1"),
      {
        ok: false,
        error: "Failed to restore document version.",
      },
    );
  });
});
