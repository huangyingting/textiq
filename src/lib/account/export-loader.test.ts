/**
 * Direct contract coverage for `loadAccountExport` (#1945).
 *
 * `buildAccountExport`'s pure JSON-shaping contract is already covered by
 * `export.test.ts`. This file instead covers the loader's *wiring*: it
 * short-circuits (skipping every parallel lookup) when the user is not
 * found, scopes every entity query to the acting `userId`, applies the
 * document `sharePolicy` nullish-coalescing defaults, derives each invite
 * link use's `workspaceId` from the related invite link, falls back
 * `subscription` to `null`, and hands a fully assembled payload to
 * `buildAccountExport`.
 *
 * `export-loader.ts` (like `document-editor/loader.ts`) carries `import
 * "server-only"`, which throws outside a Next.js Server Component build.
 * Following the module-hooks pattern used by
 * `src/lib/document-editor/loader.test.ts`, this stubs the `server-only`
 * specifier to an empty module before dynamically importing `./export-loader`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, type TestContext, describe, it } from "node:test";

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
const serverOnlyStubUrl = "server-only:export-loader-test";

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

type ExportLoaderModule = typeof import("./export-loader");
let loadAccountExport: ExportLoaderModule["loadAccountExport"];

before(async () => {
  const mod = await import("./export-loader");
  loadAccountExport = mod.loadAccountExport;
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

const NOW = new Date("2026-07-05T00:00:00.000Z");

function baseUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "ada@example.com",
    name: "Ada",
    image: null,
    emailVerified: null,
    plan: "free",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** Stubs every parallel lookup `loadAccountExport` fans out to with empty results. */
function stubEmptyParallelLookups(t: TestContext) {
  replacePrismaProperty(t, "document", { findMany: async () => [] });
  replacePrismaProperty(t, "workspace", { findMany: async () => [] });
  replacePrismaProperty(t, "workspaceMember", { findMany: async () => [] });
  replacePrismaProperty(t, "comment", { findMany: async () => [] });
  replacePrismaProperty(t, "commentRead", { findMany: async () => [] });
  replacePrismaProperty(t, "tag", { findMany: async () => [] });
  replacePrismaProperty(t, "brand", { findMany: async () => [] });
  replacePrismaProperty(t, "asset", { findMany: async () => [] });
  replacePrismaProperty(t, "subscription", { findUnique: async () => null });
  replacePrismaProperty(t, "inviteLinkUse", { findMany: async () => [] });
  replacePrismaProperty(t, "usageLedgerEntry", { findMany: async () => [] });
}

describe("loadAccountExport — not-found short circuit", () => {
  it("returns null and never runs any of the parallel per-entity lookups when the user is missing", async (t) => {
    const findUnique = trackedCalls(async () => null);
    replacePrismaProperty(t, "user", { findUnique: findUnique.fn });
    const documentFindMany = trackedCalls(async () => {
      throw new Error(
        "document.findMany should not run when the user lookup misses",
      );
    });
    replacePrismaProperty(t, "document", { findMany: documentFindMany.fn });

    const result = await loadAccountExport("user-missing", NOW);

    assert.equal(result, null);
    assert.equal(findUnique.calls.length, 1);
    assert.equal(documentFindMany.calls.length, 0);
  });
});

describe("loadAccountExport — query scoping", () => {
  it("scopes the user lookup by id and selects every field buildAccountExport reads", async (t) => {
    const findUnique = trackedCalls(async () => baseUserRow());
    replacePrismaProperty(t, "user", { findUnique: findUnique.fn });
    stubEmptyParallelLookups(t);

    await loadAccountExport("user-7", NOW);

    assert.equal(findUnique.calls.length, 1);
    const [args] = findUnique.calls[0] as [
      { where: unknown; select: Record<string, unknown> },
    ];
    assert.deepEqual(args.where, { id: "user-7" });
    for (const key of [
      "id",
      "email",
      "name",
      "image",
      "emailVerified",
      "plan",
      "createdAt",
    ]) {
      assert.equal(
        key in args.select,
        true,
        `expected user select to request "${key}"`,
      );
    }
  });

  it("scopes documents/workspaces/comments/tags/brands/subscription/invites/ledger to the acting user", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => baseUserRow({ id: "user-9" }),
    });
    const documentFindMany = trackedCalls(async () => []);
    replacePrismaProperty(t, "document", { findMany: documentFindMany.fn });
    const workspaceFindMany = trackedCalls(async () => []);
    replacePrismaProperty(t, "workspace", { findMany: workspaceFindMany.fn });
    const memberFindMany = trackedCalls(async () => []);
    replacePrismaProperty(t, "workspaceMember", {
      findMany: memberFindMany.fn,
    });
    const commentFindMany = trackedCalls(async () => []);
    replacePrismaProperty(t, "comment", { findMany: commentFindMany.fn });
    replacePrismaProperty(t, "commentRead", { findMany: async () => [] });
    const tagFindMany = trackedCalls(async () => []);
    replacePrismaProperty(t, "tag", { findMany: tagFindMany.fn });
    const brandFindMany = trackedCalls(async () => []);
    replacePrismaProperty(t, "brand", { findMany: brandFindMany.fn });
    const assetFindMany = trackedCalls(async () => []);
    replacePrismaProperty(t, "asset", { findMany: assetFindMany.fn });
    const subscriptionFindUnique = trackedCalls(async () => null);
    replacePrismaProperty(t, "subscription", {
      findUnique: subscriptionFindUnique.fn,
    });
    replacePrismaProperty(t, "inviteLinkUse", { findMany: async () => [] });
    const usageLedgerFindMany = trackedCalls(async () => []);
    replacePrismaProperty(t, "usageLedgerEntry", {
      findMany: usageLedgerFindMany.fn,
    });

    await loadAccountExport("user-9", NOW);

    const [documentArgs] = documentFindMany.calls[0] as [
      { where: { ownerId: string; deletedAt: null } },
    ];
    assert.deepEqual(documentArgs.where, {
      ownerId: "user-9",
      deletedAt: null,
    });

    const [workspaceArgs] = workspaceFindMany.calls[0] as [
      { where: { ownerId: string } },
    ];
    assert.deepEqual(workspaceArgs.where, { ownerId: "user-9" });

    const [memberArgs] = memberFindMany.calls[0] as [
      { where: { userId: string } },
    ];
    assert.deepEqual(memberArgs.where, { userId: "user-9" });

    const [commentArgs] = commentFindMany.calls[0] as [
      { where: { authorId: string } },
    ];
    assert.deepEqual(commentArgs.where, { authorId: "user-9" });

    const [tagArgs] = tagFindMany.calls[0] as [{ where: { ownerId: string } }];
    assert.deepEqual(tagArgs.where, { ownerId: "user-9" });

    const [brandArgs] = brandFindMany.calls[0] as [
      { where: { ownerId: string } },
    ];
    assert.deepEqual(brandArgs.where, { ownerId: "user-9" });

    const [assetArgs] = assetFindMany.calls[0] as [
      {
        where: {
          OR: Array<Record<string, unknown>>;
          deletedAt: null;
        };
      },
    ];
    assert.deepEqual(assetArgs.where, {
      OR: [
        { document: { ownerId: "user-9" } },
        { workspace: { ownerId: "user-9" } },
        { brand: { ownerId: "user-9" } },
      ],
      deletedAt: null,
    });

    const [subscriptionArgs] = subscriptionFindUnique.calls[0] as [
      { where: { userId: string } },
    ];
    assert.deepEqual(subscriptionArgs.where, { userId: "user-9" });

    const [usageLedgerArgs] = usageLedgerFindMany.calls[0] as [
      {
        where: { userId: string };
        select: Record<string, unknown>;
      },
    ];
    assert.deepEqual(usageLedgerArgs.where, { userId: "user-9" });
    assert.equal(usageLedgerArgs.select.userId, true);
    assert.equal(usageLedgerArgs.select.reservationVersion, true);
    assert.equal("keyHash" in usageLedgerArgs.select, false);
  });
});

describe("loadAccountExport — sharePolicy defaults", () => {
  it("applies embed/present/metadataMode/discoverable/expiresAt defaults when the document fields are nullish", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => baseUserRow(),
    });
    stubEmptyParallelLookups(t);
    replacePrismaProperty(t, "document", {
      findMany: async () => [
        {
          id: "doc-1",
          title: "Untitled",
          contentJson: null,
          deckJson: null,
          workspaceId: null,
          isShared: false,
          shareExpiresAt: null,
          shareEmbedEnabled: null,
          sharePresentEnabled: null,
          shareMetadataMode: null,
          shareDiscoverable: null,
          createdAt: NOW,
          updatedAt: NOW,
          visuals: [],
          versions: [],
        },
      ],
    });

    const result = await loadAccountExport("user-1", NOW);

    assert.ok(result);
    const [doc] = result!.documents;
    assert.deepEqual(doc.sharePolicy, {
      expiresAt: null,
      embedEnabled: true,
      presentEnabled: true,
      metadataMode: "generic",
      discoverable: false,
    });
  });

  it("preserves explicit false/custom sharePolicy values instead of defaulting them", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => baseUserRow(),
    });
    const expiresAt = new Date("2026-08-01T00:00:00.000Z");
    stubEmptyParallelLookups(t);
    replacePrismaProperty(t, "document", {
      findMany: async () => [
        {
          id: "doc-2",
          title: "Locked down",
          contentJson: null,
          deckJson: null,
          workspaceId: null,
          isShared: true,
          shareExpiresAt: expiresAt,
          shareEmbedEnabled: false,
          sharePresentEnabled: false,
          shareMetadataMode: "title-excerpt",
          shareDiscoverable: true,
          createdAt: NOW,
          updatedAt: NOW,
          visuals: [],
          versions: [],
        },
      ],
    });

    const result = await loadAccountExport("user-1", NOW);

    assert.ok(result);
    const [doc] = result!.documents;
    assert.deepEqual(doc.sharePolicy, {
      expiresAt: expiresAt.toISOString(),
      embedEnabled: false,
      presentEnabled: false,
      metadataMode: "title-excerpt",
      discoverable: true,
    });
  });
});

describe("loadAccountExport — invite link use mapping", () => {
  it("derives workspaceId from the related invite link, falling back to null when absent", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => baseUserRow(),
    });
    replacePrismaProperty(t, "document", { findMany: async () => [] });
    replacePrismaProperty(t, "workspace", { findMany: async () => [] });
    replacePrismaProperty(t, "workspaceMember", { findMany: async () => [] });
    replacePrismaProperty(t, "comment", { findMany: async () => [] });
    replacePrismaProperty(t, "commentRead", { findMany: async () => [] });
    replacePrismaProperty(t, "tag", { findMany: async () => [] });
    replacePrismaProperty(t, "brand", { findMany: async () => [] });
    replacePrismaProperty(t, "asset", { findMany: async () => [] });
    replacePrismaProperty(t, "subscription", { findUnique: async () => null });
    replacePrismaProperty(t, "usageLedgerEntry", { findMany: async () => [] });
    const usedAt = new Date("2026-06-01T00:00:00.000Z");
    replacePrismaProperty(t, "inviteLinkUse", {
      findMany: async () => [
        {
          id: "use-1",
          inviteLinkId: "link-1",
          role: "EDITOR",
          usedAt,
          inviteLink: { workspaceId: "ws-1" },
        },
        {
          id: "use-2",
          inviteLinkId: "link-2",
          role: "VIEWER",
          usedAt,
          inviteLink: null,
        },
      ],
    });

    const result = await loadAccountExport("user-1", NOW);

    assert.ok(result);
    assert.deepEqual(result!.inviteLinkUses, [
      {
        id: "use-1",
        inviteLinkId: "link-1",
        workspaceId: "ws-1",
        role: "EDITOR",
        usedAt: usedAt.toISOString(),
      },
      {
        id: "use-2",
        inviteLinkId: "link-2",
        workspaceId: null,
        role: "VIEWER",
        usedAt: usedAt.toISOString(),
      },
    ]);
  });
});

describe("loadAccountExport — assembled export", () => {
  it("falls back subscription to null and hands every fetched section to buildAccountExport", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => baseUserRow({ id: "user-3", plan: "pro" }),
    });
    replacePrismaProperty(t, "document", { findMany: async () => [] });
    replacePrismaProperty(t, "workspace", {
      findMany: async () => [
        {
          id: "ws-1",
          name: "Acme",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    replacePrismaProperty(t, "workspaceMember", { findMany: async () => [] });
    replacePrismaProperty(t, "comment", { findMany: async () => [] });
    replacePrismaProperty(t, "commentRead", { findMany: async () => [] });
    replacePrismaProperty(t, "tag", { findMany: async () => [] });
    replacePrismaProperty(t, "brand", { findMany: async () => [] });
    replacePrismaProperty(t, "asset", { findMany: async () => [] });
    replacePrismaProperty(t, "subscription", { findUnique: async () => null });
    replacePrismaProperty(t, "inviteLinkUse", { findMany: async () => [] });
    replacePrismaProperty(t, "usageLedgerEntry", { findMany: async () => [] });

    const result = await loadAccountExport("user-3", NOW);

    assert.ok(result);
    assert.equal(result!.exportedAt, NOW.toISOString());
    assert.equal(result!.user.id, "user-3");
    assert.equal(result!.user.plan, "pro");
    assert.equal(result!.workspacesOwned.length, 1);
    assert.equal(result!.workspacesOwned[0]?.id, "ws-1");
    assert.equal(result!.subscription, null);
    assert.deepEqual(result!.documents, []);
  });
});
