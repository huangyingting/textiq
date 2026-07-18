import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, test } from "node:test";

import { createDefaultBrandKitDraft } from "@/components/presentation/brand-kit-authoring-controller";
import { Prisma } from "@/generated/prisma/client";
import { compileBrandKitDraft } from "./compiler";

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
const serverOnlyStubUrl = "server-only:brand-kit-persistence-test";

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

let persistCompiledBrandKitDraft: (typeof import("./persistence"))["persistCompiledBrandKitDraft"];
let loadCustomThemePackagesForDeck: (typeof import("./persistence"))["loadCustomThemePackagesForDeck"];
let isThemePackageSnapshotVersionUniqueConflict: (typeof import("./persistence"))["isThemePackageSnapshotVersionUniqueConflict"];
let themePackageSnapshotVersionUniqueConstraint: string;

before(async () => {
  const persistence = await import("./persistence");
  ({
    persistCompiledBrandKitDraft,
    loadCustomThemePackagesForDeck,
    isThemePackageSnapshotVersionUniqueConflict,
  } = persistence);
  themePackageSnapshotVersionUniqueConstraint =
    persistence.THEME_PACKAGE_SNAPSHOT_VERSION_UNIQUE_CONSTRAINT;
});

type KnownRequestErrorOptions = ConstructorParameters<
  typeof Prisma.PrismaClientKnownRequestError
>[1];

function knownRequestError(
  options: KnownRequestErrorOptions,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Prisma request failed",
    options,
  );
}

function snapshotVersionCollision(
  meta: KnownRequestErrorOptions["meta"] = {
    target: ["packageId", "packageVersion"],
  },
) {
  return knownRequestError({
    code: "P2002",
    clientVersion: "test",
    meta,
  });
}

function draftAndPackage() {
  const draft = createDefaultBrandKitDraft({
    ownerId: "user-1",
    now: "2026-01-01T00:00:00.000Z",
  });
  const compiled = compileBrandKitDraft(draft);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("fixture failed to compile");
  return { draft, themePackage: compiled.package };
}

function persistenceClient({
  existingPackageJson,
  createError,
  winningPackageJson,
}: {
  existingPackageJson?: unknown;
  createError?: unknown;
  winningPackageJson?: unknown;
} = {}) {
  const calls: string[] = [];
  let transactionCount = 0;
  const createdAt = new Date("2026-02-03T04:05:06.000Z");
  const tx = {
    brandKitDraft: {
      upsert: async () => {
        calls.push("draft.upsert");
        return { id: "draft-row-1" };
      },
    },
    themePackageSnapshot: {
      findUnique: async () => {
        calls.push("tx.snapshot.findUnique");
        return existingPackageJson === undefined
          ? null
          : { packageJson: existingPackageJson, createdAt };
      },
      create: async () => {
        calls.push("snapshot.create");
        if (createError) throw createError;
        return { id: "snapshot-1", createdAt };
      },
      update: async () => {
        calls.push("snapshot.update");
        return { id: "snapshot-1" };
      },
      findMany: async () => [],
    },
  };
  return {
    calls,
    client: {
      ...tx,
      $transaction: async (
        operation: (client: typeof tx) => Promise<unknown>,
      ) => {
        transactionCount += 1;
        calls.push(`transaction.${transactionCount}`);
        return operation(tx);
      },
      themePackageSnapshot: {
        ...tx.themePackageSnapshot,
        findUnique: async () => {
          calls.push("client.snapshot.findUnique");
          return winningPackageJson === undefined
            ? null
            : { packageJson: winningPackageJson, createdAt };
        },
      },
    },
  };
}

test("identical immutable package snapshots are idempotent successes", async () => {
  const { draft, themePackage } = draftAndPackage();
  const fixture = persistenceClient({
    existingPackageJson: JSON.parse(JSON.stringify(themePackage)) as unknown,
  });

  const result = await persistCompiledBrandKitDraft({
    draftInput: draft,
    userId: "user-1",
    client: fixture.client as never,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.catalogEntry.createdAt, "2026-02-03T04:05:06.000Z");
  }
  assert.deepEqual(fixture.calls, [
    "transaction.1",
    "tx.snapshot.findUnique",
    "draft.upsert",
  ]);
});

test("different content at an existing package id and version is rejected", async () => {
  const { draft, themePackage } = draftAndPackage();
  const fixture = persistenceClient({
    existingPackageJson: { ...themePackage, name: "Old content" },
  });

  const result = await persistCompiledBrandKitDraft({
    draftInput: draft,
    userId: "user-1",
    client: fixture.client as never,
  });

  assert.deepEqual(result, {
    ok: false,
    diagnostics: [
      {
        severity: "error",
        code: "package-version-exists",
        message:
          "This theme package version already exists with different content. Increment Version before saving.",
        path: "version",
      },
    ],
  });
  assert.deepEqual(fixture.calls, ["transaction.1", "tx.snapshot.findUnique"]);
});

test("a P2002 winner with different content returns version conflict without mutating the draft", async () => {
  const { draft, themePackage } = draftAndPackage();
  const fixture = persistenceClient({
    createError: snapshotVersionCollision(),
    winningPackageJson: { ...themePackage, name: "Concurrent winner" },
  });

  const result = await persistCompiledBrandKitDraft({
    draftInput: draft,
    userId: "user-1",
    client: fixture.client as never,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.ok ? undefined : result.diagnostics[0]?.code,
    "package-version-exists",
  );
  assert.deepEqual(fixture.calls, [
    "transaction.1",
    "tx.snapshot.findUnique",
    "snapshot.create",
    "client.snapshot.findUnique",
  ]);
  assert.equal(fixture.calls.includes("draft.upsert"), false);
});

test("a P2002 winner with identical canonical content is idempotent and synchronizes the draft", async () => {
  const { draft, themePackage } = draftAndPackage();
  const reorderedPackage = Object.fromEntries(
    Object.entries(themePackage).reverse(),
  );
  const fixture = persistenceClient({
    createError: snapshotVersionCollision({
      target: ["packageVersion", "packageId"],
    }),
    winningPackageJson: reorderedPackage,
  });

  const result = await persistCompiledBrandKitDraft({
    draftInput: draft,
    userId: "user-1",
    client: fixture.client as never,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(fixture.calls, [
    "transaction.1",
    "tx.snapshot.findUnique",
    "snapshot.create",
    "client.snapshot.findUnique",
    "transaction.2",
    "draft.upsert",
  ]);
});

test("non-P2002 persistence failures are not swallowed", async () => {
  const { draft } = draftAndPackage();
  const failure = new Error("database unavailable");
  const fixture = persistenceClient({ createError: failure });

  await assert.rejects(
    () =>
      persistCompiledBrandKitDraft({
        draftInput: draft,
        userId: "user-1",
        client: fixture.client as never,
      }),
    (error) => error === failure,
  );
});

test("snapshot collision classifier matches SQLite adapter field targets", () => {
  const error = snapshotVersionCollision({
    driverAdapterError: {
      cause: {
        constraint: {
          fields: ["packageId", "packageVersion"],
        },
      },
    },
  });

  assert.equal(isThemePackageSnapshotVersionUniqueConflict(error), true);
});

test("snapshot collision classifier matches PostgreSQL constraint targets", () => {
  const error = snapshotVersionCollision({
    driverAdapterError: {
      cause: {
        constraint: {
          name: themePackageSnapshotVersionUniqueConstraint,
        },
      },
    },
  });

  assert.equal(isThemePackageSnapshotVersionUniqueConflict(error), true);
});

test("snapshot collision classifier accepts provider field order variance", () => {
  const error = snapshotVersionCollision({
    target: ["packageVersion", "packageId"],
  });

  assert.equal(isThemePackageSnapshotVersionUniqueConflict(error), true);
});

test("snapshot collision classifier rejects unrelated P2002 targets", () => {
  const error = snapshotVersionCollision({
    target: ["scopeKey", "slug"],
  });

  assert.equal(isThemePackageSnapshotVersionUniqueConflict(error), false);
});

test("unrelated P2002 persistence failures propagate without winner recovery", async () => {
  const { draft } = draftAndPackage();
  const failure = snapshotVersionCollision({
    target: ["scopeKey", "slug"],
  });
  const fixture = persistenceClient({ createError: failure });

  await assert.rejects(
    () =>
      persistCompiledBrandKitDraft({
        draftInput: draft,
        userId: "user-1",
        client: fixture.client as never,
      }),
    (error) => error === failure,
  );
  assert.deepEqual(fixture.calls, [
    "transaction.1",
    "tx.snapshot.findUnique",
    "snapshot.create",
  ]);
});

test("owner loading separates the active exact snapshot from authorized catalog entries", async () => {
  const { themePackage } = draftAndPackage();
  const active = { ...themePackage, version: "1.0.0+r1", name: "Active" };
  const latest = { ...themePackage, version: "2.0.0+r1", name: "Latest" };
  const other = {
    ...themePackage,
    id: "brand-kit:workspace-workspace-1:other",
    version: "3.0.0+r1",
    name: "Other",
  };
  const exactQueries: unknown[] = [];
  const catalogQueries: unknown[] = [];
  const client = {
    themePackageSnapshot: {
      findUnique: async (query: unknown) => {
        exactQueries.push(query);
        return { packageJson: active };
      },
      findMany: async (query: unknown) => {
        catalogQueries.push(query);
        return [
          {
            packageId: latest.id,
            packageVersion: latest.version,
            packageJson: latest,
            createdAt: new Date("2026-03-01T00:00:00.000Z"),
          },
          {
            packageId: other.id,
            packageVersion: other.version,
            packageJson: other,
            createdAt: new Date("2026-02-01T00:00:00.000Z"),
          },
        ];
      },
    },
  };

  const result = await loadCustomThemePackagesForDeck(
    {
      theme: {
        packageId: active.id,
        packageVersion: active.version,
      },
    },
    {
      userId: "user-1",
      workspaceId: "workspace-1",
      client: client as never,
    },
  );

  assert.deepEqual(
    [
      result.activePackage?.id,
      result.activePackage?.version,
      result.catalogEntries.map((entry) => [
        entry.package.id,
        entry.package.version,
        entry.createdAt,
      ]),
    ],
    [
      active.id,
      active.version,
      [
        [latest.id, latest.version, "2026-03-01T00:00:00.000Z"],
        [other.id, other.version, "2026-02-01T00:00:00.000Z"],
      ],
    ],
  );
  assert.deepEqual(
    (
      exactQueries[0] as {
        where: { packageId_packageVersion: unknown };
      }
    ).where.packageId_packageVersion,
    {
      packageId: active.id,
      packageVersion: active.version,
    },
  );
  assert.deepEqual(
    (catalogQueries[0] as { where: { OR: unknown[] } }).where.OR,
    [{ ownerId: "user-1" }, { workspaceId: "workspace-1" }],
  );
  assert.deepEqual((catalogQueries[0] as { orderBy: unknown }).orderBy, [
    { createdAt: "desc" },
    { packageId: "asc" },
    { packageVersion: "desc" },
  ]);
});

test("workspace collaborator renders an owner's user-scoped active snapshot without browsing owner-only packages", async () => {
  const { themePackage } = draftAndPackage();
  const activeOwnerPackage = {
    ...themePackage,
    version: "1.0.0+r1",
    name: "Owner active",
  };
  const collaboratorPackage = {
    ...themePackage,
    id: "brand-kit:user-collaborator:mine",
    version: "2.0.0+r1",
    name: "Collaborator package",
  };
  const exactQueries: unknown[] = [];
  const catalogQueries: unknown[] = [];
  const client = {
    themePackageSnapshot: {
      findUnique: async (query: unknown) => {
        exactQueries.push(query);
        return { packageJson: activeOwnerPackage };
      },
      findMany: async (query: unknown) => {
        catalogQueries.push(query);
        return [
          {
            packageId: collaboratorPackage.id,
            packageVersion: collaboratorPackage.version,
            packageJson: collaboratorPackage,
            createdAt: new Date("2026-03-01T00:00:00.000Z"),
          },
        ];
      },
    },
  };

  const result = await loadCustomThemePackagesForDeck(
    {
      theme: {
        packageId: activeOwnerPackage.id,
        packageVersion: activeOwnerPackage.version,
      },
    },
    {
      userId: "user-collaborator",
      workspaceId: "workspace-1",
      client: client as never,
    },
  );

  assert.equal(result.activePackage?.name, "Owner active");
  assert.deepEqual(
    result.catalogEntries.map((entry) => entry.package.name),
    ["Collaborator package"],
  );
  assert.deepEqual(
    (
      exactQueries[0] as {
        where: { packageId_packageVersion: unknown };
      }
    ).where.packageId_packageVersion,
    {
      packageId: activeOwnerPackage.id,
      packageVersion: activeOwnerPackage.version,
    },
  );
  assert.deepEqual(
    (catalogQueries[0] as { where: { OR: unknown[] } }).where.OR,
    [{ ownerId: "user-collaborator" }, { workspaceId: "workspace-1" }],
  );
});

test("missing exact active snapshots retain the explicit fallback diagnostic", async () => {
  const { themePackage } = draftAndPackage();
  const client = {
    themePackageSnapshot: {
      findUnique: async () => null,
      findMany: async () => [],
    },
  };

  const result = await loadCustomThemePackagesForDeck(
    {
      theme: {
        packageId: themePackage.id,
        packageVersion: themePackage.version,
      },
    },
    { userId: "user-1", client: client as never },
  );

  assert.equal(result.activePackage, undefined);
  assert.equal(result.diagnostics[0]?.code, "unknown-theme-package");
  assert.equal(result.diagnostics[0]?.path, "theme.packageId");
});

test("invalid exact active snapshots retain validation diagnostics", async () => {
  const { themePackage } = draftAndPackage();
  const client = {
    themePackageSnapshot: {
      findUnique: async () => ({ packageJson: { id: themePackage.id } }),
      findMany: async () => [],
    },
  };

  const result = await loadCustomThemePackagesForDeck(
    {
      theme: {
        packageId: themePackage.id,
        packageVersion: themePackage.version,
      },
    },
    { userId: "user-1", client: client as never },
  );

  assert.equal(result.activePackage, undefined);
  assert.equal(result.diagnostics[0]?.code, "unknown-theme-package");
  assert.match(
    result.diagnostics[0]?.path ?? "",
    /^activeThemePackageSnapshot\.packageJson/,
  );
});

test("custom active references without a version do not perform a broad package lookup", async () => {
  const { themePackage } = draftAndPackage();
  let exactLookupCount = 0;
  const client = {
    themePackageSnapshot: {
      findUnique: async () => {
        exactLookupCount += 1;
        return { packageJson: themePackage };
      },
      findMany: async () => [],
    },
  };

  const result = await loadCustomThemePackagesForDeck(
    { theme: { packageId: themePackage.id } },
    { userId: "user-1", client: client as never },
  );

  assert.equal(exactLookupCount, 0);
  assert.equal(result.activePackage, undefined);
  assert.equal(result.diagnostics[0]?.code, "unknown-theme-package");
});

test("active-only render snapshots do not appear in Recent/catalog state", async () => {
  const { themePackage } = draftAndPackage();
  const active = { ...themePackage, version: "1.0.0+r1" };
  const client = {
    themePackageSnapshot: {
      findUnique: async () => ({ packageJson: active }),
      findMany: async () => [],
    },
  };

  const result = await loadCustomThemePackagesForDeck(
    {
      theme: {
        packageId: active.id,
        packageVersion: active.version,
      },
    },
    { userId: "user-1", client: client as never },
  );

  assert.equal(result.activePackage?.version, active.version);
  assert.deepEqual(result.catalogEntries, []);
});
