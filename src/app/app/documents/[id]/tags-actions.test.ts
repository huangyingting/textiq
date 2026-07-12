import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";

import type { DocumentTag } from "@/lib/document/tags";

// This suite exercises the tags-actions.ts action boundary only: auth/
// capability-check ordering, exact argument threading into
// addDocumentTag/disconnectDocumentTag, revalidation, and error propagation.
// Tag lookup/creation/slug-collision/no-op rules are addDocumentTag's and
// disconnectDocumentTag's responsibility and are already covered by
// src/lib/document/tags.test.ts; they are not re-asserted here.

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

type TagsActionsState = {
  calls: unknown[];
  redirect: (...args: unknown[]) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: unknown) => Promise<{ id: string }>;
  requireDocumentCapability: (
    userId: string,
    documentId: string,
    capability: string,
  ) => Promise<unknown>;
  addDocumentTag: (
    documentId: string,
    ownerId: string,
    rawName: string,
  ) => Promise<DocumentTag[]>;
  disconnectDocumentTag: (
    documentId: string,
    tagId: string,
  ) => Promise<DocumentTag[]>;
};

const globalForTags = globalThis as typeof globalThis & {
  __tagsActionsState: TagsActionsState;
};

function state(): TagsActionsState {
  return globalForTags.__tagsActionsState;
}

function createDefaultState(): TagsActionsState {
  const calls: unknown[] = [];
  return {
    calls,
    redirect() {
      throw new Error("NEXT_REDIRECT");
    },
    revalidatePath(path) {
      calls.push(["revalidatePath", path]);
    },
    async requireUser() {
      calls.push(["requireUser"]);
      return { id: "user-1" };
    },
    async requireDocumentCapability(userId, documentId, capability) {
      calls.push(["requireDocumentCapability", userId, documentId, capability]);
      return { canEdit: true };
    },
    async addDocumentTag(documentId, ownerId, rawName) {
      calls.push(["addDocumentTag", documentId, ownerId, rawName]);
      return [{ id: "tag-1", name: rawName.trim(), slug: "tag-slug" }];
    },
    async disconnectDocumentTag(documentId, tagId) {
      calls.push(["disconnectDocumentTag", documentId, tagId]);
      return [];
    },
  };
}

globalForTags.__tagsActionsState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-tags-actions-test:";
const stubbedModules = new Map<string, string>([
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__tagsActionsState.revalidatePath(path);
      }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(...args) {
        return globalThis.__tagsActionsState.redirect(...args);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(...args) {
        return globalThis.__tagsActionsState.requireUser(...args);
      }
    `,
  ],
  [
    "@/lib/auth/document-permissions",
    `
      export async function requireDocumentCapability(...args) {
        return globalThis.__tagsActionsState.requireDocumentCapability(...args);
      }
    `,
  ],
  [
    "@/lib/document/tags",
    `
      export async function addDocumentTag(...args) {
        return globalThis.__tagsActionsState.addDocumentTag(...args);
      }
      export async function disconnectDocumentTag(...args) {
        return globalThis.__tagsActionsState.disconnectDocumentTag(...args);
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

let tagsActions: typeof import("./tags-actions");

before(async () => {
  tagsActions = await import("./tags-actions");
});

beforeEach(() => {
  globalForTags.__tagsActionsState = createDefaultState();
});

describe("tags actions authorization ordering", () => {
  it("requires authentication before checking edit capability or touching tags", async () => {
    state().requireUser = async () => {
      throw new Error("NEXT_REDIRECT");
    };

    await assert.rejects(
      () => tagsActions.addTag("doc-1", "Launch"),
      /NEXT_REDIRECT/,
    );
    assert.deepEqual(state().calls, []);

    await assert.rejects(
      () => tagsActions.removeTag("doc-1", "tag-1"),
      /NEXT_REDIRECT/,
    );
    assert.deepEqual(state().calls, []);
  });

  it("denies mutation when edit capability is rejected, without touching tags", async () => {
    state().requireDocumentCapability = async (
      userId,
      documentId,
      capability,
    ) => {
      state().calls.push([
        "requireDocumentCapability",
        userId,
        documentId,
        capability,
      ]);
      throw new Error("You do not have permission to edit this document.");
    };

    await assert.rejects(
      () => tagsActions.addTag("doc-1", "Launch"),
      /You do not have permission to edit this document\./,
    );
    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["requireDocumentCapability", "user-1", "doc-1", "edit"],
    ]);

    state().calls.length = 0;
    await assert.rejects(
      () => tagsActions.removeTag("doc-1", "tag-1"),
      /You do not have permission to edit this document\./,
    );
    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["requireDocumentCapability", "user-1", "doc-1", "edit"],
    ]);
  });
});

describe("tags actions happy paths", () => {
  it("adds a tag scoped to the exact document and owner, then revalidates the workspace", async () => {
    const tags = await tagsActions.addTag("doc-1", "Launch");

    assert.deepEqual(tags, [{ id: "tag-1", name: "Launch", slug: "tag-slug" }]);
    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["requireDocumentCapability", "user-1", "doc-1", "edit"],
      ["addDocumentTag", "doc-1", "user-1", "Launch"],
      ["revalidatePath", "/app"],
    ]);
  });

  it("removes a tag scoped to the exact document and tag id, then revalidates the workspace", async () => {
    const tags = await tagsActions.removeTag("doc-1", "tag-9");

    assert.deepEqual(tags, []);
    assert.deepEqual(state().calls, [
      ["requireUser"],
      ["requireDocumentCapability", "user-1", "doc-1", "edit"],
      ["disconnectDocumentTag", "doc-1", "tag-9"],
      ["revalidatePath", "/app"],
    ]);
  });
});

describe("tags actions error propagation", () => {
  it("propagates addDocumentTag failures without revalidating", async () => {
    state().addDocumentTag = async () => {
      throw new Error("Failed to create a unique tag slug.");
    };

    await assert.rejects(
      () => tagsActions.addTag("doc-1", "Launch"),
      /Failed to create a unique tag slug\./,
    );
    assert.deepEqual(
      state().calls.filter(
        (call) => (call as unknown[])[0] === "revalidatePath",
      ),
      [],
    );
  });

  it("propagates disconnectDocumentTag failures without revalidating", async () => {
    state().disconnectDocumentTag = async () => {
      throw new Error("database unavailable");
    };

    await assert.rejects(
      () => tagsActions.removeTag("doc-1", "tag-9"),
      /database unavailable/,
    );
    assert.deepEqual(
      state().calls.filter(
        (call) => (call as unknown[])[0] === "revalidatePath",
      ),
      [],
    );
  });
});
