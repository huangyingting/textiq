import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "../../generated/prisma/client";
import { markdownToLexicalStateObject } from "../content/from-markdown";
import {
  createDocumentWithCanonicalContent,
  updateDocumentMetadata,
  updateDocumentWithCanonicalContent,
} from "../document/document-write-port";
import type { PrismaTransactionRunner } from "../prisma-surface";
import { E2E_PROFILE_FIXTURE } from "../../test/builders/e2e-profile";
import {
  buildStaleE2EAssetWhere,
  buildStaleE2EDocumentWhere,
  cleanupStaleE2EPresentationFixtures,
  documentIdFromE2EPresentationAssetStorageKey,
  E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
  E2E_PRESENTATION_DOCUMENT_ID_PREFIX,
  removeE2EPresentationAssetDirectory,
  resolveE2EPresentationAssetDirectory,
  type E2ESeedCleanupInput,
} from "../../../prisma/seed-e2e-cleanup";
import { configuredPresentationTestFixtures } from "../../../e2e/helpers/presentation-fixtures";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const SQLITE_TEST_DB_DIRECTORY = path.join(REPO_ROOT, "prisma", ".test-dbs");

const INPUT: E2ESeedCleanupInput = {
  workspaceId: "e2efixtureworkspace0000001",
  ownerId: "e2e-owner-id",
  activeDocumentIds: [
    "e2eisolatededitorrail00001",
    "e2eisolatededitorrail00001p7765626b6974r2x3",
  ],
};

type MockRows = {
  documents: Array<{ id: string }>;
  assets: Array<{ id: string; storageKey: string }>;
};

function createCleanupMock(rowsByRun: MockRows[]) {
  const calls: Array<{ operation: string; args: unknown }> = [];
  let run = 0;
  const db = {
    async $transaction<T>(
      operation: (tx: {
        document: {
          findMany(args: unknown): Promise<Array<{ id: string }>>;
          deleteMany(args: unknown): Promise<{ count: number }>;
        };
        asset: {
          findMany(
            args: unknown,
          ): Promise<Array<{ id: string; storageKey: string }>>;
          deleteMany(args: unknown): Promise<{ count: number }>;
        };
      }) => Promise<T>,
    ): Promise<T> {
      const rows = rowsByRun[Math.min(run, rowsByRun.length - 1)] ?? {
        documents: [],
        assets: [],
      };
      run += 1;
      return operation({
        document: {
          async findMany(args) {
            calls.push({ operation: "document.findMany", args });
            return rows.documents;
          },
          async deleteMany(args) {
            calls.push({ operation: "document.deleteMany", args });
            return { count: rows.documents.length };
          },
        },
        asset: {
          async findMany(args) {
            calls.push({ operation: "asset.findMany", args });
            return rows.assets;
          },
          async deleteMany(args) {
            calls.push({ operation: "asset.deleteMany", args });
            return { count: rows.assets.length };
          },
        },
      });
    },
  } as unknown as Pick<PrismaTransactionRunner, "$transaction">;

  return { db, calls };
}

test("cleanup deletes exact stale-document assets before their documents", async () => {
  const staleDocumentId = "e2eisolatedremovedfixture001p6368726f6d69756dr1x2";
  const { db, calls } = createCleanupMock([
    {
      documents: [{ id: staleDocumentId }],
      assets: [
        {
          id: "stale-attached-asset",
          storageKey: `${staleDocumentId}/attached.png`,
        },
        {
          id: "legacy-orphan-asset",
          storageKey: "e2eisolatedoldfixture00001/legacy.png",
        },
      ],
    },
  ]);

  const result = await cleanupStaleE2EPresentationFixtures(db, INPUT);

  assert.deepEqual(
    calls.map((call) => call.operation),
    [
      "document.findMany",
      "asset.findMany",
      "asset.deleteMany",
      "document.deleteMany",
    ],
  );
  assert.deepEqual(result.staleDocumentIds, [staleDocumentId]);
  assert.deepEqual(result.deletedAssetIds, [
    "stale-attached-asset",
    "legacy-orphan-asset",
  ]);
  assert.deepEqual(calls[2]?.args, {
    where: {
      id: { in: ["stale-attached-asset", "legacy-orphan-asset"] },
    },
  });
  assert.deepEqual(calls[3]?.args, {
    where: { id: { in: [staleDocumentId] } },
  });
});

test("ownership predicates retain current assets and unrelated null-document assets", () => {
  const staleDocumentId = "e2eisolatedremovedfixture001";
  assert.deepEqual(buildStaleE2EDocumentWhere(INPUT), {
    workspaceId: INPUT.workspaceId,
    ownerId: INPUT.ownerId,
    id: {
      startsWith: E2E_PRESENTATION_DOCUMENT_ID_PREFIX,
      notIn: [...INPUT.activeDocumentIds],
    },
  });
  assert.deepEqual(buildStaleE2EAssetWhere(INPUT, [staleDocumentId]), {
    OR: [
      { documentId: { in: [staleDocumentId] } },
      {
        documentId: null,
        workspaceId: INPUT.workspaceId,
        storageKey: {
          startsWith: E2E_PRESENTATION_DOCUMENT_ID_PREFIX,
        },
        originalName: {
          in: [E2E_PRESENTATION_ASSET_ORIGINAL_NAME, "fixture.png"],
        },
        NOT: INPUT.activeDocumentIds.map((documentId) => ({
          storageKey: { startsWith: `${documentId}/` },
        })),
      },
    ],
  });
});

test("cleanup is idempotent across repeated seed runs", async () => {
  const staleDocumentId = "e2eisolatedremovedfixture001";
  const { db, calls } = createCleanupMock([
    {
      documents: [{ id: staleDocumentId }],
      assets: [
        {
          id: "stale-asset",
          storageKey: `${staleDocumentId}/fixture.png`,
        },
      ],
    },
    { documents: [], assets: [] },
  ]);

  const first = await cleanupStaleE2EPresentationFixtures(db, INPUT);
  const second = await cleanupStaleE2EPresentationFixtures(db, INPUT);

  assert.equal(first.staleDocumentIds.length, 1);
  assert.equal(first.deletedAssetIds.length, 1);
  assert.deepEqual(second, {
    staleDocumentIds: [],
    deletedAssetIds: [],
    deletedAssetStorageKeys: [],
  });
  assert.equal(
    calls.filter((call) => call.operation === "asset.deleteMany").length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.operation === "document.deleteMany").length,
    1,
  );
});

test("provider-neutral query shape supports project, repeat, and worker slots", async () => {
  for (const provider of ["sqlite", "postgresql"]) {
    const { db, calls } = createCleanupMock([{ documents: [], assets: [] }]);
    await cleanupStaleE2EPresentationFixtures(db, INPUT);

    assert.deepEqual(
      calls.map((call) => call.operation),
      ["document.findMany", "asset.findMany"],
      provider,
    );
    assert.deepEqual(
      (calls[1]?.args as { where: unknown }).where,
      buildStaleE2EAssetWhere(INPUT, []),
      provider,
    );
    assert.match(JSON.stringify(calls), /p7765626b6974r2x3/);
    assert.doesNotMatch(JSON.stringify(calls), /\$queryRaw|\$executeRaw/i);
  }
});

test("asset directory cleanup rejects traversal and removes only canonical fixture directories", async (t) => {
  const harnessRoot = path.join(
    SQLITE_TEST_DB_DIRECTORY,
    `e2e-seed-paths-${randomUUID()}`,
  );
  const assetRoot = path.join(harnessRoot, "slide-assets");
  const outsideRoot = path.join(harnessRoot, "slide-assets-prefix-collision");
  const sentinelPath = path.join(outsideRoot, "sentinel.txt");
  await fs.mkdir(assetRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(sentinelPath, "retain");
  t.after(() => fs.rm(harnessRoot, { force: true, recursive: true }));

  const invalidDocumentIds = [
    "../slide-assets-prefix-collision",
    "e2eisolated/nested",
    String.raw`e2eisolated\backslash`,
    "e2eisolated%2f..%2fsentinel",
    "e2eisolated／fullwidth",
    "e2eisolated⁄fraction",
    "e2eisolated\u0000nul",
    "e2eisolated\u001fcontrol",
    "/e2eisolatedabsolute",
    ".",
    "..",
  ];
  const diagnostics: string[] = [];
  for (const documentId of invalidDocumentIds) {
    assert.throws(() =>
      resolveE2EPresentationAssetDirectory(assetRoot, documentId),
    );
    assert.equal(
      await removeE2EPresentationAssetDirectory(
        assetRoot,
        documentId,
        (message) => diagnostics.push(message),
      ),
      false,
    );
  }

  const validDocumentId = "e2eisolatededitorrail00001p7765626b6974r2x3";
  const validDirectory = resolveE2EPresentationAssetDirectory(
    assetRoot,
    validDocumentId,
  );
  await fs.mkdir(validDirectory, { recursive: true });
  await fs.writeFile(path.join(validDirectory, "fixture.png"), "fixture");
  assert.equal(
    await removeE2EPresentationAssetDirectory(assetRoot, validDocumentId),
    true,
  );
  await assert.rejects(fs.lstat(validDirectory), { code: "ENOENT" });
  assert.equal(await fs.readFile(sentinelPath, "utf8"), "retain");
  assert.equal(diagnostics.length, invalidDocumentIds.length);
});

test("asset directory cleanup unlinks an escaping symlink without following it", async (t) => {
  const harnessRoot = path.join(
    SQLITE_TEST_DB_DIRECTORY,
    `e2e-seed-symlink-${randomUUID()}`,
  );
  const assetRoot = path.join(harnessRoot, "slide-assets");
  const outsideRoot = path.join(harnessRoot, "outside");
  const sentinelPath = path.join(outsideRoot, "sentinel.txt");
  const documentId = "e2eisolatedsymlinkescape001";
  const assetDirectory = path.join(assetRoot, documentId);
  await fs.mkdir(assetRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(sentinelPath, "retain");
  await fs.symlink(outsideRoot, assetDirectory, "dir");
  t.after(() => fs.rm(harnessRoot, { force: true, recursive: true }));

  assert.equal(
    await removeE2EPresentationAssetDirectory(assetRoot, documentId),
    true,
  );
  await assert.rejects(fs.lstat(assetDirectory), { code: "ENOENT" });
  assert.equal(await fs.readFile(sentinelPath, "utf8"), "retain");
});

test("storage key parsing accepts only canonical fixture asset keys", () => {
  const checksum = "a".repeat(64);
  assert.equal(
    documentIdFromE2EPresentationAssetStorageKey(
      `e2eisolatedvalidfixture001/${checksum}.png`,
    ),
    "e2eisolatedvalidfixture001",
  );
  for (const storageKey of [
    `../escape/${checksum}.png`,
    `e2eisolatedvalidfixture001/../${checksum}.png`,
    String.raw`e2eisolatedvalidfixture001\${checksum}.png`,
    `e2eisolatedvalidfixture001/%2e%2e%2fsentinel`,
    `e2eisolatedvalidfixture001／${checksum}.png`,
  ]) {
    assert.equal(
      documentIdFromE2EPresentationAssetStorageKey(storageKey),
      null,
    );
  }
});

test(
  "the full E2E seed twice removes stale owned fixtures in a disposable SQLite database",
  { timeout: 120_000 },
  async (t) => {
    await fs.mkdir(SQLITE_TEST_DB_DIRECTORY, { recursive: true });
    const harnessRoot = path.join(
      SQLITE_TEST_DB_DIRECTORY,
      `e2e-seed-integration-${randomUUID()}`,
    );
    const databaseFilePath = path.join(harnessRoot, "seed.db");
    const databaseUrl = `file:${databaseFilePath}`;
    const assetRoot = path.join(harnessRoot, "storage", "slide-assets");
    await fs.mkdir(path.join(harnessRoot, "e2e"), { recursive: true });
    t.after(() => fs.rm(harnessRoot, { force: true, recursive: true }));

    const fixtureSlots = JSON.stringify([
      {
        projectName: "chromium",
        repeatEachIndex: 0,
        parallelIndex: 0,
      },
      {
        projectName: "webkit",
        repeatEachIndex: 2,
        parallelIndex: 3,
      },
    ]);
    const seedEnvironment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DB_PROVIDER: "sqlite",
      E2E_PROFILE_FIXTURE_SLOTS: fixtureSlots,
      TSX_TSCONFIG_PATH: path.join(REPO_ROOT, "tsconfig.json"),
    };
    const expectedPresentationFixtures =
      configuredPresentationTestFixtures(seedEnvironment);

    await execFileAsync(
      "npx",
      ["prisma", "db", "push", "--schema", "prisma/schema.sqlite.prisma"],
      {
        cwd: REPO_ROOT,
        env: seedEnvironment,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const runFullSeed = () =>
      execFileAsync(
        process.execPath,
        ["--import", "tsx", path.join(REPO_ROOT, "prisma", "seed-e2e.ts")],
        {
          cwd: harnessRoot,
          env: seedEnvironment,
          maxBuffer: 10 * 1024 * 1024,
        },
      );

    await runFullSeed();

    const client = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
    });
    t.after(() => client.$disconnect());
    const owner = await client.user.findUniqueOrThrow({
      where: { email: E2E_PROFILE_FIXTURE.owner.email },
      select: { id: true },
    });
    const editor = await client.user.findUniqueOrThrow({
      where: { email: E2E_PROFILE_FIXTURE.editor.email },
      select: { id: true },
    });
    const viewer = await client.user.findUniqueOrThrow({
      where: { email: E2E_PROFILE_FIXTURE.viewer.email },
      select: { id: true },
    });
    const accountLifecycle = await client.user.findUniqueOrThrow({
      where: { id: E2E_PROFILE_FIXTURE.accountLifecycle.id },
      select: { id: true },
    });
    const signupLifecycle = E2E_PROFILE_FIXTURE.signupLifecycle;
    await client.user.create({
      data: {
        id: signupLifecycle.id,
        email: signupLifecycle.email,
        name: signupLifecycle.name,
        passwordHash: await bcrypt.hash(signupLifecycle.password, 4),
      },
    });
    await createDocumentWithCanonicalContent(client, {
      contentSnapshot: markdownToLexicalStateObject(
        "Interrupted signup lifecycle content.",
      ),
      data: {
        id: signupLifecycle.cleanupDocumentId,
        title: "Interrupted signup lifecycle document",
        ownerId: signupLifecycle.id,
      },
    });
    const staleDocumentId = "e2eisolatedstalefixture0001";
    const staleOrphanDocumentId = "e2eisolatedstaleorphan0001";
    const hostileDocumentId = "e2eisolated/../../slide-assets-prefix-collision";
    const staleAssetId = "e2e-stale-attached-asset";
    const staleOrphanAssetId = "e2e-stale-orphan-asset";
    const hostileAssetId = "e2e-hostile-attached-asset";
    const unrelatedAssetId = "unrelated-null-document-asset";
    const staleStorageKey = `${staleDocumentId}/${"b".repeat(64)}.png`;
    const staleOrphanStorageKey = `${staleOrphanDocumentId}/${"c".repeat(64)}.png`;
    const hostileStorageKey = `${hostileDocumentId}/${"e".repeat(64)}.png`;
    const unrelatedStorageKey = `unrelated/${"d".repeat(64)}.png`;
    const staleDashboardLifecycleCopyId = "e2edashboardlifecyclestalecopy01";
    const staleWorkspaceLifecycleId = "e2eworkspacelifecyclestale01";
    const staleMetadataVersionId = "e2edocmetahistorystaleversion1";
    const staleMetadataTagId = "e2edocmetahistorystaletag0001";
    const staleCommentRootId = "e2edoccommentlifestaleroot01";
    const staleCommentReplyId = "e2edoccommentlifestalereply1";
    const staleCommentReadId = "e2edoccommentlifestaleread01";
    const outsideSentinelPath = path.join(
      harnessRoot,
      "storage",
      "slide-assets-prefix-collision",
      "sentinel.txt",
    );

    await client.document.createMany({
      data: [
        {
          id: staleDocumentId,
          title: "Stale E2E fixture",
          ownerId: owner.id,
          workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
        },
        {
          id: hostileDocumentId,
          title: "Hostile E2E fixture id",
          ownerId: owner.id,
          workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
        },
      ],
    });
    await client.asset.createMany({
      data: [
        {
          id: staleAssetId,
          documentId: staleDocumentId,
          workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
          mimeType: "image/png",
          byteSize: 5,
          checksum: "b".repeat(64),
          storageKey: staleStorageKey,
          originalName: E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
        },
        {
          id: staleOrphanAssetId,
          documentId: null,
          workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
          mimeType: "image/png",
          byteSize: 5,
          checksum: "c".repeat(64),
          storageKey: staleOrphanStorageKey,
          originalName: E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
        },
        {
          id: hostileAssetId,
          documentId: hostileDocumentId,
          workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
          mimeType: "image/png",
          byteSize: 7,
          checksum: "e".repeat(64),
          storageKey: hostileStorageKey,
          originalName: E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
        },
        {
          id: unrelatedAssetId,
          documentId: null,
          workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
          mimeType: "image/png",
          byteSize: 6,
          checksum: "d".repeat(64),
          storageKey: unrelatedStorageKey,
          originalName: E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
        },
      ],
    });
    await fs.mkdir(path.dirname(outsideSentinelPath), { recursive: true });
    await fs.writeFile(outsideSentinelPath, "retain");
    for (const storageKey of [
      staleStorageKey,
      staleOrphanStorageKey,
      unrelatedStorageKey,
    ]) {
      const filePath = path.join(assetRoot, storageKey);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "retain");
    }

    await client.document.create({
      data: {
        id: staleDashboardLifecycleCopyId,
        title: E2E_PROFILE_FIXTURE.dashboardDocuments.lifecycle.renamedTitle,
        ownerId: owner.id,
      },
    });
    await client.document.update({
      where: {
        id: E2E_PROFILE_FIXTURE.dashboardDocuments.lifecycle.id,
      },
      data: {
        title: E2E_PROFILE_FIXTURE.dashboardDocuments.lifecycle.renamedTitle,
        favorite: true,
        deletedAt: new Date(),
      },
    });
    await client.workspace.create({
      data: {
        id: staleWorkspaceLifecycleId,
        name: E2E_PROFILE_FIXTURE.workspaceLifecycle.renamedName,
        ownerId: editor.id,
      },
    });
    const metadataLifecycle = E2E_PROFILE_FIXTURE.documentMetadataLifecycle;
    const staleMetadataContent = markdownToLexicalStateObject(
      metadataLifecycle.restoredContent,
    );
    await updateDocumentWithCanonicalContent(client, {
      where: { id: metadataLifecycle.id },
      contentSnapshot: staleMetadataContent,
    });
    await client.tag.create({
      data: {
        id: staleMetadataTagId,
        ownerId: owner.id,
        name: metadataLifecycle.tagName,
        slug: "e2e-metadata-lifecycle",
      },
    });
    await updateDocumentMetadata(client, {
      where: { id: metadataLifecycle.id },
      data: { tags: { connect: { id: staleMetadataTagId } } },
    });
    await client.documentVersion.create({
      data: {
        id: staleMetadataVersionId,
        documentId: metadataLifecycle.id,
        contentJson: staleMetadataContent as unknown as Prisma.InputJsonValue,
        label: "Stale browser checkpoint",
        createdById: owner.id,
      },
    });
    const commentLifecycle = E2E_PROFILE_FIXTURE.documentCommentLifecycle;
    await updateDocumentWithCanonicalContent(client, {
      where: { id: commentLifecycle.id },
      contentSnapshot: markdownToLexicalStateObject("Stale comment content."),
      data: {
        title: "Stale comment lifecycle title",
        workspaceId: null,
      },
    });
    await client.comment.create({
      data: {
        id: staleCommentRootId,
        documentId: commentLifecycle.id,
        authorId: owner.id,
        body: "Stale root comment",
        anchorType: "text",
        anchorText: "Stale comment content.",
        resolved: true,
      },
    });
    await client.comment.create({
      data: {
        id: staleCommentReplyId,
        documentId: commentLifecycle.id,
        authorId: viewer.id,
        body: "Stale reply",
        parentId: staleCommentRootId,
      },
    });
    await client.commentRead.create({
      data: {
        id: staleCommentReadId,
        documentId: commentLifecycle.id,
        userId: viewer.id,
      },
    });
    const shareLifecycle = E2E_PROFILE_FIXTURE.documentShareLifecycle;
    await updateDocumentWithCanonicalContent(client, {
      where: { id: shareLifecycle.id },
      contentSnapshot: markdownToLexicalStateObject("Stale shared content."),
      data: {
        title: "Stale shared lifecycle title",
        isShared: true,
        shareId: "stale-share-lifecycle-id",
        slug: "stale-share-lifecycle",
        shareExpiresAt: new Date("2027-12-31T23:59:00.000Z"),
        shareEmbedEnabled: false,
        sharePresentEnabled: false,
        sharePasscodeHash: "stale-passcode-hash",
        shareMetadataMode: "title-excerpt",
        shareDiscoverable: true,
      },
    });
    await client.user.update({
      where: { id: accountLifecycle.id },
      data: {
        name: E2E_PROFILE_FIXTURE.accountLifecycle.updatedName,
        passwordHash: await bcrypt.hash(
          E2E_PROFILE_FIXTURE.accountLifecycle.replacementPassword,
          4,
        ),
        sessionInvalidatedAt: new Date("2027-01-01T00:00:00.000Z"),
      },
    });

    await runFullSeed();

    const currentDocuments = await client.document.findMany({
      where: {
        ownerId: owner.id,
        workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
        id: { startsWith: E2E_PRESENTATION_DOCUMENT_ID_PREFIX },
      },
      select: { id: true },
    });
    assert.deepEqual(
      currentDocuments.map(({ id }) => id).sort(),
      expectedPresentationFixtures.map(({ documentId }) => documentId).sort(),
    );
    assert.equal(
      await client.asset.count({
        where: {
          documentId: { in: currentDocuments.map(({ id }) => id) },
          originalName: E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
        },
      }),
      expectedPresentationFixtures.length,
    );
    assert.equal(
      await client.document.count({
        where: { id: { in: [staleDocumentId, hostileDocumentId] } },
      }),
      0,
    );
    assert.equal(
      await client.document.count({
        where: { id: staleDashboardLifecycleCopyId },
      }),
      0,
    );
    assert.equal(
      await client.workspace.count({
        where: { id: staleWorkspaceLifecycleId },
      }),
      0,
    );
    assert.deepEqual(
      await client.document.findUniqueOrThrow({
        where: { id: metadataLifecycle.id },
        select: {
          content: true,
          tags: { select: { id: true } },
        },
      }),
      {
        content: metadataLifecycle.currentContent,
        tags: [],
      },
    );
    const resetAccountLifecycle = await client.user.findUniqueOrThrow({
      where: { id: accountLifecycle.id },
      select: {
        email: true,
        name: true,
        passwordHash: true,
        sessionInvalidatedAt: true,
        emailVerified: true,
        plan: true,
      },
    });
    assert.deepEqual(
      {
        email: resetAccountLifecycle.email,
        name: resetAccountLifecycle.name,
        sessionInvalidatedAt: resetAccountLifecycle.sessionInvalidatedAt,
        emailVerified: resetAccountLifecycle.emailVerified instanceof Date,
        plan: resetAccountLifecycle.plan,
      },
      {
        email: E2E_PROFILE_FIXTURE.accountLifecycle.email,
        name: E2E_PROFILE_FIXTURE.accountLifecycle.name,
        sessionInvalidatedAt: null,
        emailVerified: true,
        plan: E2E_PROFILE_FIXTURE.accountLifecycle.plan,
      },
    );
    assert.equal(
      await bcrypt.compare(
        E2E_PROFILE_FIXTURE.accountLifecycle.password,
        resetAccountLifecycle.passwordHash ?? "",
      ),
      true,
    );
    assert.equal(
      await client.user.count({ where: { email: signupLifecycle.email } }),
      0,
    );
    assert.equal(
      await client.document.count({
        where: { id: signupLifecycle.cleanupDocumentId },
      }),
      0,
    );
    assert.deepEqual(
      await client.documentVersion.findMany({
        where: { documentId: metadataLifecycle.id },
        orderBy: { id: "asc" },
        select: { id: true, label: true },
      }),
      [
        {
          id: metadataLifecycle.versionId,
          label: metadataLifecycle.versionLabel,
        },
      ],
    );
    assert.equal(
      await client.tag.count({ where: { id: staleMetadataTagId } }),
      0,
    );
    assert.deepEqual(
      await client.document.findUniqueOrThrow({
        where: { id: commentLifecycle.id },
        select: {
          title: true,
          content: true,
          ownerId: true,
          workspaceId: true,
        },
      }),
      {
        title: commentLifecycle.title,
        content: commentLifecycle.content,
        ownerId: owner.id,
        workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
      },
    );
    assert.equal(
      await client.comment.count({
        where: { documentId: commentLifecycle.id },
      }),
      0,
    );
    assert.equal(
      await client.commentRead.count({
        where: { documentId: commentLifecycle.id },
      }),
      0,
    );
    assert.deepEqual(
      await client.document.findUniqueOrThrow({
        where: { id: shareLifecycle.id },
        select: {
          title: true,
          content: true,
          ownerId: true,
          workspaceId: true,
          isShared: true,
          shareId: true,
          slug: true,
          shareExpiresAt: true,
          shareEmbedEnabled: true,
          sharePresentEnabled: true,
          sharePasscodeHash: true,
          shareMetadataMode: true,
          shareDiscoverable: true,
        },
      }),
      {
        title: shareLifecycle.title,
        content: shareLifecycle.content,
        ownerId: owner.id,
        workspaceId: null,
        isShared: false,
        shareId: null,
        slug: null,
        shareExpiresAt: null,
        shareEmbedEnabled: true,
        sharePresentEnabled: true,
        sharePasscodeHash: null,
        shareMetadataMode: "generic",
        shareDiscoverable: false,
      },
    );
    assert.deepEqual(
      await client.document.findUniqueOrThrow({
        where: {
          id: E2E_PROFILE_FIXTURE.dashboardDocuments.lifecycle.id,
        },
        select: {
          title: true,
          content: true,
          favorite: true,
          deletedAt: true,
          workspaceId: true,
        },
      }),
      {
        title: E2E_PROFILE_FIXTURE.dashboardDocuments.lifecycle.title,
        content: E2E_PROFILE_FIXTURE.dashboardDocuments.lifecycle.content,
        favorite: false,
        deletedAt: null,
        workspaceId: null,
      },
    );
    assert.equal(
      await client.asset.count({
        where: {
          id: { in: [staleAssetId, staleOrphanAssetId, hostileAssetId] },
        },
      }),
      0,
    );
    assert.equal(
      await client.asset.count({ where: { id: unrelatedAssetId } }),
      1,
    );
    await assert.rejects(fs.lstat(path.join(assetRoot, staleDocumentId)), {
      code: "ENOENT",
    });
    await assert.rejects(
      fs.lstat(path.join(assetRoot, staleOrphanDocumentId)),
      { code: "ENOENT" },
    );
    assert.equal(
      await fs.readFile(path.join(assetRoot, unrelatedStorageKey), "utf8"),
      "retain",
    );
    assert.equal(await fs.readFile(outsideSentinelPath, "utf8"), "retain");
  },
);
