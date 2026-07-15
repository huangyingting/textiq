import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/generated/prisma/client";
import {
  createDocumentFromTemplateForUser,
  importedMarkdownToContentJson,
} from "@/lib/document/create";
import { duplicateDocumentForUser } from "@/lib/document/duplicate";
import { searchDocumentsForUser } from "@/lib/document/list";
import { atomicSaveDocumentLexical } from "@/lib/document/persistence/visual";
import { restoreVersion } from "@/lib/document/persistence/versioning";
import {
  projectDocumentContent,
  projectDocumentMarkdown,
} from "@/lib/document/content-projection";
import { backfillDocumentContentProjection } from "@/lib/document/content-projection-backfill";
import { seedSampleDocument } from "@/lib/onboarding/seed-sample-document";

const serverOnlyPath = require.resolve("server-only");
(require as NodeJS.Require).cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  isPreloading: false,
  path: serverOnlyPath,
  require: require as NodeJS.Require,
  parent: null,
} as unknown as NodeJS.Module;

/* eslint-disable @typescript-eslint/no-require-imports */
const { persistImportedDocument } =
  require("@/lib/import/application-service") as typeof import("@/lib/import/application-service");
/* eslint-enable @typescript-eslint/no-require-imports */

const REPO_ROOT = process.cwd();
const SQLITE_TEST_DB_DIRECTORY = resolvePath(REPO_ROOT, "prisma", ".test-dbs");
const execFileAsync = promisify(execFile);

type SqliteHarness = {
  databaseFilePath: string;
  databaseUrl: string;
  client: PrismaClient;
};

async function createSqliteHarness(): Promise<SqliteHarness> {
  await mkdir(SQLITE_TEST_DB_DIRECTORY, { recursive: true });
  const databaseFilePath = resolvePath(
    SQLITE_TEST_DB_DIRECTORY,
    `document-search-projection-${randomUUID()}.db`,
  );
  const databaseUrl = `file:${databaseFilePath}`;
  await execFileAsync(
    "npx",
    ["prisma", "db", "push", "--schema", "prisma/schema.sqlite.prisma"],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DB_PROVIDER: "sqlite",
        DATABASE_URL: databaseUrl,
      },
    },
  );
  return {
    databaseFilePath,
    databaseUrl,
    client: new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
    }),
  };
}

async function disposeSqliteHarness(harness: SqliteHarness): Promise<void> {
  await harness.client.$disconnect();
  await rm(harness.databaseFilePath, { force: true });
  await rm(`${harness.databaseFilePath}-journal`, { force: true });
  await rm(`${harness.databaseFilePath}-wal`, { force: true });
  await rm(`${harness.databaseFilePath}-shm`, { force: true });
}

function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function searchIds(
  client: PrismaClient,
  userId: string,
  query: string,
): Promise<string[]> {
  const result = await searchDocumentsForUser(userId, query, client);
  return result.results.map((document) => document.id);
}

test("sqlite search discovers every canonical write path and preserves access scope during backfill races", async (t) => {
  const harness = await createSqliteHarness();
  t.after(async () => {
    await disposeSqliteHarness(harness);
  });
  const { client } = harness;

  const actorId = id("actor");
  const workspaceOwnerId = id("workspace-owner");
  const outsiderId = id("outsider");
  await client.user.createMany({
    data: [
      { id: actorId, email: `${actorId}@example.test` },
      { id: workspaceOwnerId, email: `${workspaceOwnerId}@example.test` },
      { id: outsiderId, email: `${outsiderId}@example.test` },
    ],
  });

  await seedSampleDocument(actorId, client);
  const seededIds = await searchIds(client, actorId, "messy source material");
  assert.equal(seededIds.length, 1);

  const created = await createDocumentFromTemplateForUser(
    actorId,
    "flowchart",
    client,
  );
  assert.deepEqual(await searchIds(client, actorId, "incoming request"), [
    created.id,
  ]);

  const imported = await persistImportedDocument(
    {
      userId: actorId,
      fileName: "constellation.md",
      markdown: "# Import constellation\n\nImported search evidence.",
      target: { kind: "personal" },
    },
    client,
  );
  assert.deepEqual(await searchIds(client, actorId, "Import constellation"), [
    imported.id,
  ]);

  const saveDocumentId = id("save");
  await client.document.create({
    data: {
      id: saveDocumentId,
      ownerId: actorId,
      ...projectDocumentMarkdown("Before save"),
    },
  });
  await atomicSaveDocumentLexical(
    saveDocumentId,
    importedMarkdownToContentJson("# Save quasars\n\nFresh editor save."),
    actorId,
    client,
  );
  assert.deepEqual(await searchIds(client, actorId, "Save quasars"), [
    saveDocumentId,
  ]);

  const restoreDocumentId = id("restore");
  await client.document.create({
    data: {
      id: restoreDocumentId,
      ownerId: actorId,
      ...projectDocumentMarkdown("Current restore state"),
    },
  });
  const restoreSnapshot = importedMarkdownToContentJson(
    "# Restore pulsar\n\nRestored version.",
  );
  const version = await client.documentVersion.create({
    data: {
      documentId: restoreDocumentId,
      contentJson: restoreSnapshot,
      createdById: actorId,
    },
  });
  await restoreVersion(restoreDocumentId, version.id, actorId, {
    db: client,
    snapshot: async () => {},
    reconcile: async () => {},
    revalidate: async () => {},
  });
  assert.deepEqual(await searchIds(client, actorId, "Restore pulsar"), [
    restoreDocumentId,
  ]);

  const duplicateSourceId = id("duplicate-source");
  await client.document.create({
    data: {
      id: duplicateSourceId,
      ownerId: actorId,
      ...projectDocumentMarkdown("# Duplicate comet\n\nCopy this body."),
    },
  });
  const duplicate = await duplicateDocumentForUser(
    actorId,
    duplicateSourceId,
    client,
  );
  assert.ok(duplicate);
  const duplicateIds = await searchIds(client, actorId, "Duplicate comet");
  assert.deepEqual(
    new Set(duplicateIds),
    new Set([duplicateSourceId, duplicate.id]),
  );

  const driftedDocumentId = id("backfill");
  const driftedJson = importedMarkdownToContentJson(
    "# Backfill nebula\n\nRepair this projection.",
  );
  await client.document.create({
    data: {
      id: driftedDocumentId,
      ownerId: actorId,
      content: "stale projection",
      contentJson: driftedJson,
    },
  });
  const backfillResult = await backfillDocumentContentProjection(client, {
    batchSize: 2,
  });
  assert.equal(backfillResult.updated, 1);
  assert.deepEqual(await searchIds(client, actorId, "Backfill nebula"), [
    driftedDocumentId,
  ]);

  const accessibleWorkspaceId = id("workspace");
  const inaccessibleWorkspaceId = id("workspace");
  await client.workspace.create({
    data: {
      id: accessibleWorkspaceId,
      name: "Accessible",
      ownerId: workspaceOwnerId,
      members: { create: { userId: actorId, role: "VIEWER" } },
    },
  });
  await client.workspace.create({
    data: {
      id: inaccessibleWorkspaceId,
      name: "Inaccessible",
      ownerId: outsiderId,
    },
  });
  const accessibleWorkspaceDocumentId = id("accessible-workspace");
  const inaccessiblePersonalDocumentId = id("inaccessible-personal");
  const inaccessibleWorkspaceDocumentId = id("inaccessible-workspace");
  await client.document.createMany({
    data: [
      {
        id: accessibleWorkspaceDocumentId,
        ownerId: workspaceOwnerId,
        workspaceId: accessibleWorkspaceId,
        ...projectDocumentMarkdown("Scope galaxy"),
      },
      {
        id: inaccessiblePersonalDocumentId,
        ownerId: outsiderId,
        ...projectDocumentMarkdown("Scope galaxy"),
      },
      {
        id: inaccessibleWorkspaceDocumentId,
        ownerId: outsiderId,
        workspaceId: inaccessibleWorkspaceId,
        ...projectDocumentMarkdown("Scope galaxy"),
      },
    ],
  });
  assert.deepEqual(await searchIds(client, actorId, "Scope galaxy"), [
    accessibleWorkspaceDocumentId,
  ]);

  const raceDocumentId = id("race");
  await client.document.create({
    data: {
      id: raceDocumentId,
      ownerId: actorId,
      content: "stale race projection",
      contentJson: importedMarkdownToContentJson("Old supernova"),
    },
  });
  let interleaved = false;
  const raceDb = {
    document: {
      findMany: client.document.findMany.bind(client.document),
      findUnique: client.document.findUnique.bind(client.document),
      updateMany: async (
        args: Parameters<typeof client.document.updateMany>[0],
      ) => {
        if (!interleaved && args.where?.id === raceDocumentId) {
          interleaved = true;
          await client.document.update({
            where: { id: raceDocumentId },
            data: projectDocumentContent(
              importedMarkdownToContentJson("New supernova"),
            ),
          });
        }
        return client.document.updateMany(args);
      },
    },
  };
  const raceResult = await backfillDocumentContentProjection(raceDb as never, {
    maxRetries: 2,
  });
  assert.equal(raceResult.updated, 0);
  assert.equal(raceResult.skippedConcurrent, 1);
  assert.equal(raceResult.retries, 1);
  assert.deepEqual(await searchIds(client, actorId, "New supernova"), [
    raceDocumentId,
  ]);
  assert.deepEqual(await searchIds(client, actorId, "Old supernova"), []);
});
