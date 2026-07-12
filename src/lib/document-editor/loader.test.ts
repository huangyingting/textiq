/**
 * Direct contracts for `loadDocumentEditorViewModel` (#1929).
 *
 * `view-model.test.ts` already exercises `buildDocumentEditorViewModel`'s pure
 * mapping, and `access-query.test.ts` already exercises `accessibleDocumentWhere`'s
 * scoping logic. This file instead covers the loader's *wiring*: that it queries
 * `prisma.document.findFirst` scoped through `accessibleDocumentWhere` for the
 * acting user, returns `null` on a not-found/inaccessible document without
 * touching any of the parallel lookups, and — on success — fans out to
 * comments/tags/theme-package loading and hands the result to the pure builder.
 *
 * `loader.ts` (and its `@/lib/comments`/brand-kit persistence dependencies)
 * import the `server-only` marker package, which throws outside a Next.js
 * Server Component build. Following the module-hooks pattern already used by
 * `src/lib/workspace/service.test.ts` and the various `*-actions.test.ts`
 * files, this stubs the `server-only` specifier to an empty module before
 * dynamically importing `./loader`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, it, type TestContext } from "node:test";

import { accessibleDocumentWhere } from "@/lib/access-query";
import { prisma } from "@/lib/prisma";

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
const serverOnlyStubUrl = "server-only:document-editor-loader-test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: serverOnlyStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === serverOnlyStubUrl) {
      return { format: "commonjs", source: "", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

type LoaderModule = typeof import("./loader");
let loadDocumentEditorViewModel: LoaderModule["loadDocumentEditorViewModel"];

before(async () => {
  const mod = await import("./loader");
  loadDocumentEditorViewModel = mod.loadDocumentEditorViewModel;
});

function mutablePrisma(): Record<string, unknown> {
  return prisma as unknown as Record<string, unknown>;
}

/** Overrides a prisma delegate for the duration of one test, restored via `t.after`. */
function replacePrismaProperty(t: TestContext, key: string, value: unknown) {
  const target = mutablePrisma();
  const original = target[key];
  target[key] = value;
  t.after(() => {
    target[key] = original;
  });
}

function trackedCalls<T>(implementation: (...args: unknown[]) => T): {
  fn: (...args: unknown[]) => T;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  return {
    calls,
    fn: (...args: unknown[]) => {
      calls.push(args);
      return implementation(...args);
    },
  };
}

/** A minimal, self-owned document row satisfying every field the view-model builder reads. */
function baseDocumentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Roadmap",
    contentJson: { root: { children: [] } },
    deckJson: null,
    deckRevisionToken: null,
    isShared: false,
    shareId: null,
    slug: null,
    shareExpiresAt: null,
    shareEmbedEnabled: false,
    sharePresentEnabled: false,
    sharePasscodeHash: null,
    shareMetadataMode: "generic",
    shareDiscoverable: false,
    ownerId: "user-1",
    workspaceId: null,
    tags: [],
    workspace: null,
    ...overrides,
  };
}

function allowDocumentContext() {
  return async (_documentId: string, _capability: "view") =>
    ({ user: { id: "user-1" } }) as { user: { id: string } };
}

describe("loadDocumentEditorViewModel", () => {
  it("returns null and skips every parallel lookup when the document is not found or inaccessible", async (t) => {
    const findFirst = trackedCalls(async () => null);
    replacePrismaProperty(t, "document", { findFirst: findFirst.fn });
    const tagFindMany = trackedCalls(async () => {
      throw new Error(
        "tag.findMany should not run when the document lookup misses",
      );
    });
    replacePrismaProperty(t, "tag", { findMany: tagFindMany.fn });
    const commentFindMany = trackedCalls(async () => {
      throw new Error(
        "comment.findMany should not run when the document lookup misses",
      );
    });
    replacePrismaProperty(t, "comment", { findMany: commentFindMany.fn });

    const result = await loadDocumentEditorViewModel({
      documentId: "doc-missing",
      userId: "user-1",
      userName: "Ada",
      requireDocumentContext: allowDocumentContext(),
    });

    assert.equal(result, null);
    assert.equal(findFirst.calls.length, 1);
    assert.equal(tagFindMany.calls.length, 0);
    assert.equal(commentFindMany.calls.length, 0);
  });

  it("scopes the document lookup through accessibleDocumentWhere for the acting user", async (t) => {
    const findFirst = trackedCalls(async () => null);
    replacePrismaProperty(t, "document", { findFirst: findFirst.fn });
    replacePrismaProperty(t, "tag", {
      findMany: async () => [],
    });

    await loadDocumentEditorViewModel({
      documentId: "doc-42",
      userId: "user-7",
      userName: "Grace",
      requireDocumentContext: allowDocumentContext(),
    });

    assert.equal(findFirst.calls.length, 1);
    const [args] = findFirst.calls[0] as [
      { where: unknown; select: Record<string, unknown> },
    ];
    assert.deepEqual(args.where, accessibleDocumentWhere("user-7", "doc-42"));
    // Selection must carry every field the view-model builder reads.
    for (const key of [
      "id",
      "title",
      "contentJson",
      "deckJson",
      "isShared",
      "shareId",
      "ownerId",
      "workspaceId",
      "tags",
      "workspace",
    ]) {
      assert.equal(
        key in args.select,
        true,
        `expected select to request "${key}"`,
      );
    }
  });

  it("loads tags, comments, and returns a fully composed view model on success", async (t) => {
    const documentRow = baseDocumentRow({
      title: "Q3 Plan",
      tags: [{ id: "tag-1", name: "Plan", slug: "plan" }],
      ownerId: "user-1",
    });
    const findFirst = trackedCalls(async () => documentRow);
    replacePrismaProperty(t, "document", { findFirst: findFirst.fn });
    const tagFindMany = trackedCalls(async () => [
      { id: "tag-1", name: "Plan", slug: "plan" },
      { id: "tag-2", name: "Draft", slug: "draft" },
    ]);
    replacePrismaProperty(t, "tag", { findMany: tagFindMany.fn });
    const commentFindMany = trackedCalls(async () => [
      {
        id: "comment-1",
        body: "Looks good",
        resolved: false,
        anchorType: "text",
        anchorText: "Roadmap",
        anchorNodeId: "node-1",
        slideId: null,
        elementId: null,
        anchorGeometry: null,
        createdAt: new Date("2026-02-03T04:05:06.000Z"),
        author: { id: "user-1", name: "Ada", email: "ada@example.com" },
        replies: [],
      },
    ]);
    replacePrismaProperty(t, "comment", { findMany: commentFindMany.fn });

    const viewModel = await loadDocumentEditorViewModel({
      documentId: "doc-1",
      userId: "user-1",
      userName: "Ada",
      requireDocumentContext: allowDocumentContext(),
    });

    assert.ok(viewModel);
    assert.equal(viewModel?.documentId, "doc-1");
    assert.equal(viewModel?.initialTitle, "Q3 Plan");
    assert.equal(viewModel?.userId, "user-1");
    assert.equal(viewModel?.userName, "Ada");
    assert.equal(viewModel?.canEdit, true);
    assert.equal(viewModel?.canManage, true);
    assert.equal(viewModel?.allTags.length, 2);
    assert.deepEqual(viewModel?.initialTags, documentRow.tags as unknown[]);
    assert.equal(viewModel?.initialComments.length, 1);
    assert.equal(viewModel?.initialComments[0]?.body, "Looks good");
    // No custom theme packages: deckJson is null, so the brand-kit lookup short-circuits.
    assert.deepEqual(viewModel?.customThemePackages, []);
    assert.equal(findFirst.calls.length, 1);
    assert.equal(tagFindMany.calls.length, 1);
    assert.equal(commentFindMany.calls.length, 1);
  });

  it("derives non-owner capabilities from the workspace membership role", async (t) => {
    const documentRow = baseDocumentRow({
      ownerId: "owner-1",
      workspaceId: "ws-1",
      workspace: {
        name: "Acme",
        ownerId: "owner-1",
        members: [{ userId: "user-2", role: "VIEWER" }],
      },
    });
    replacePrismaProperty(t, "document", {
      findFirst: async () => documentRow,
    });
    replacePrismaProperty(t, "tag", { findMany: async () => [] });
    replacePrismaProperty(t, "comment", { findMany: async () => [] });

    const viewModel = await loadDocumentEditorViewModel({
      documentId: "doc-1",
      userId: "user-2",
      userName: "Viewer",
      requireDocumentContext: allowDocumentContext(),
    });

    assert.ok(viewModel);
    assert.equal(viewModel?.canEdit, false);
    assert.equal(viewModel?.canManage, false);
    assert.equal(viewModel?.workspaceName, "Acme");
  });

  it("propagates a denial thrown by requireDocumentContext instead of swallowing it", async (t) => {
    replacePrismaProperty(t, "document", {
      findFirst: async () => baseDocumentRow(),
    });
    replacePrismaProperty(t, "tag", { findMany: async () => [] });
    replacePrismaProperty(t, "comment", {
      findMany: async () => {
        throw new Error(
          "comment.findMany should not run when requireDocumentContext denies access",
        );
      },
    });

    await assert.rejects(
      () =>
        loadDocumentEditorViewModel({
          documentId: "doc-1",
          userId: "user-9",
          userName: "Intruder",
          requireDocumentContext: async () => {
            throw new Error("forbidden");
          },
        }),
      /forbidden/,
    );
  });
});
