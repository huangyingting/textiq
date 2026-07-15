import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { WorkspacePermissionError } from "@/lib/auth/workspace-capabilities";
import { importFailure } from "@/lib/import/contract";

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
const { createDocumentFromImportUpload, persistImportedDocument } =
  require("./application-service") as typeof import("./application-service");
/* eslint-enable @typescript-eslint/no-require-imports */

function fakeFile(
  name: string,
  type = "text/markdown",
  content = "# Imported",
): File {
  return new File([Buffer.from(content)], name, { type });
}

test("createDocumentFromImportUpload returns unauthorized for missing user", async () => {
  const result = await createDocumentFromImportUpload(
    {
      file: fakeFile("doc.md"),
      subjectHash: "subject",
      target: { kind: "personal" },
    },
    {
      getCurrentUser: async () => null,
      processImportUpload: async () => {
        throw new Error("should not parse");
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "unauthorized",
      status: 401,
      message: "Sign in to import a document.",
    },
  });
});

test("createDocumentFromImportUpload maps workspace permission errors to forbidden", async () => {
  const result = await createDocumentFromImportUpload(
    {
      file: fakeFile("doc.md"),
      subjectHash: "subject",
      target: { kind: "workspace", workspaceId: "workspace-1" },
    },
    {
      getCurrentUser: async () => ({ id: "user-1" }),
      requireWorkspaceCapability: async () => {
        throw new WorkspacePermissionError("forbidden");
      },
      processImportUpload: async () => {
        throw new Error("should not parse");
      },
      logError: () => {},
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "forbidden",
      status: 403,
      message:
        "You do not have permission to import documents into this workspace.",
    },
  });
});

test("createDocumentFromImportUpload passes through parse failures without persisting", async () => {
  let persisted = false;
  const result = await createDocumentFromImportUpload(
    {
      file: fakeFile("doc.md"),
      subjectHash: "subject",
      target: { kind: "personal" },
    },
    {
      getCurrentUser: async () => ({ id: "user-1" }),
      processImportUpload: async () =>
        importFailure("too_large", "File is too large.", 413),
      persistImportedDocument: async () => {
        persisted = true;
        return { id: "doc-1" };
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "too_large",
      status: 413,
      message: "File is too large.",
    },
  });
  assert.equal(persisted, false);
});

test("createDocumentFromImportUpload threads signal and deadline to processImportUpload", async () => {
  const controller = new AbortController();
  const deadlineAt = Date.now() + 30_000;
  let capturedSignal: AbortSignal | undefined;
  let capturedDeadlineAt: number | undefined;

  const result = await createDocumentFromImportUpload(
    {
      file: fakeFile("doc.md"),
      subjectHash: "subject",
      target: { kind: "personal" },
      signal: controller.signal,
      deadlineAt,
    },
    {
      getCurrentUser: async () => ({ id: "user-1" }),
      processImportUpload: async (_file, options) => {
        capturedSignal = options.signal;
        capturedDeadlineAt = options.deadlineAt;
        return importFailure("too_large", "File is too large.", 413);
      },
      persistImportedDocument: async () => ({ id: "unused" }),
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "too_large",
      status: 413,
      message: "File is too large.",
    },
  });
  assert.equal(capturedSignal, controller.signal);
  assert.equal(capturedDeadlineAt, deadlineAt);
});

test("createDocumentFromImportUpload rechecks abort signal before persistence", async () => {
  let persisted = false;
  const controller = new AbortController();

  const result = await createDocumentFromImportUpload(
    {
      file: fakeFile("doc.md"),
      subjectHash: "subject",
      target: { kind: "personal" },
      signal: controller.signal,
    },
    {
      getCurrentUser: async () => ({ id: "user-1" }),
      processImportUpload: async () => {
        controller.abort();
        return { ok: true, markdown: "# Imported" };
      },
      persistImportedDocument: async () => {
        persisted = true;
        return { id: "doc-1" };
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "aborted",
      status: 408,
      message: "The import was interrupted before parsing finished.",
    },
  });
  assert.equal(persisted, false);
});

test("createDocumentFromImportUpload rechecks deadline before persistence", async () => {
  let persisted = false;
  const result = await createDocumentFromImportUpload(
    {
      file: fakeFile("doc.md"),
      subjectHash: "subject",
      target: { kind: "personal" },
      deadlineAt: Date.now() + 5,
    },
    {
      getCurrentUser: async () => ({ id: "user-1" }),
      processImportUpload: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ok: true, markdown: "# Imported" };
      },
      persistImportedDocument: async () => {
        persisted = true;
        return { id: "doc-1" };
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "timeout",
      status: 408,
      message:
        "The file took too long to parse. Try a smaller or simpler document.",
    },
  });
  assert.equal(persisted, false);
});

test("createDocumentFromImportUpload returns create-mode success after durable persistence", async () => {
  const result = await createDocumentFromImportUpload(
    {
      file: fakeFile("doc.md"),
      subjectHash: "subject",
      target: { kind: "workspace", workspaceId: "workspace-1" },
    },
    {
      getCurrentUser: async () => ({ id: "user-1" }),
      requireWorkspaceCapability: async () => ({
        role: "editor",
        canView: true,
        canMutate: true,
        canManage: false,
        workspace: { id: "workspace-1", ownerId: "owner-1" },
      }),
      processImportUpload: async () => ({ ok: true, markdown: "# Imported" }),
      persistImportedDocument: async (args) => {
        assert.equal(args.userId, "user-1");
        assert.equal(args.target.kind, "workspace");
        assert.equal(args.target.workspaceId, "workspace-1");
        return { id: "doc-123" };
      },
      logError: () => {},
    },
  );

  assert.deepEqual(result, {
    ok: true,
    documentId: "doc-123",
    documentPath: "/app/documents/doc-123",
  });
});

test("createDocumentFromImportUpload maps Prisma conflict to conflict error", async () => {
  const result = await createDocumentFromImportUpload(
    {
      file: fakeFile("doc.md"),
      subjectHash: "subject",
      target: { kind: "personal" },
    },
    {
      getCurrentUser: async () => ({ id: "user-1" }),
      processImportUpload: async () => ({ ok: true, markdown: "# Imported" }),
      persistImportedDocument: async () => {
        throw new Prisma.PrismaClientKnownRequestError("conflict", {
          code: "P2002",
          clientVersion: "test",
        });
      },
      logError: () => {},
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "conflict",
      status: 409,
      message: "A conflicting update prevented the import. Please try again.",
    },
  });
});

test("createDocumentFromImportUpload maps Prisma persistence failures to persistence error", async () => {
  const result = await createDocumentFromImportUpload(
    {
      file: fakeFile("doc.md"),
      subjectHash: "subject",
      target: { kind: "personal" },
    },
    {
      getCurrentUser: async () => ({ id: "user-1" }),
      processImportUpload: async () => ({ ok: true, markdown: "# Imported" }),
      persistImportedDocument: async () => {
        throw new Prisma.PrismaClientValidationError("invalid", {
          clientVersion: "test",
        });
      },
      logError: () => {},
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "persistence",
      status: 500,
      message: "The document could not be saved. Please try again.",
    },
  });
});

test("createDocumentFromImportUpload maps non-Prisma persistence failures to internal error", async () => {
  const result = await createDocumentFromImportUpload(
    {
      file: fakeFile("doc.md"),
      subjectHash: "subject",
      target: { kind: "personal" },
    },
    {
      getCurrentUser: async () => ({ id: "user-1" }),
      processImportUpload: async () => ({ ok: true, markdown: "# Imported" }),
      persistImportedDocument: async () => {
        throw new Error("boom");
      },
      logError: () => {},
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "internal",
      status: 500,
      message: "Import failed unexpectedly. Please try again.",
    },
  });
});

type SqliteHarness = {
  databaseFilePath: string;
  databaseUrl: string;
  client: PrismaClient;
};

const REPO_ROOT = process.cwd();
const SQLITE_TEST_DB_DIRECTORY = resolvePath(REPO_ROOT, "prisma", ".test-dbs");
const execFileAsync = promisify(execFile);

async function createSqliteHarness(prefix: string): Promise<SqliteHarness> {
  await mkdir(SQLITE_TEST_DB_DIRECTORY, { recursive: true });

  const databaseFilePath = resolvePath(
    SQLITE_TEST_DB_DIRECTORY,
    `${prefix}-${randomUUID()}.db`,
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

  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  const client = new PrismaClient({ adapter });
  return { databaseFilePath, databaseUrl, client };
}

async function disposeSqliteHarness(harness: SqliteHarness): Promise<void> {
  await harness.client.$disconnect();
  await rm(harness.databaseFilePath, { force: true });
  await rm(`${harness.databaseFilePath}-journal`, { force: true });
  await rm(`${harness.databaseFilePath}-wal`, { force: true });
  await rm(`${harness.databaseFilePath}-shm`, { force: true });
}

function seededUserId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

test("persistImportedDocument (sqlite): creates document and initial version in one transaction", async (t) => {
  const harness = await createSqliteHarness("import-application");
  t.after(async () => {
    await disposeSqliteHarness(harness);
  });

  const userId = seededUserId("user");
  await harness.client.user.create({
    data: { id: userId, email: `${userId}@example.com` },
  });

  const persisted = await persistImportedDocument(
    {
      userId,
      fileName: "roadmap.md",
      markdown: "# Roadmap",
      target: { kind: "personal" },
    },
    harness.client,
  );

  const document = await harness.client.document.findUnique({
    where: { id: persisted.id },
    select: {
      ownerId: true,
      title: true,
      workspaceId: true,
    },
  });
  const versions = await harness.client.documentVersion.findMany({
    where: { documentId: persisted.id },
    select: { createdById: true },
  });

  assert.ok(document);
  assert.equal(document?.ownerId, userId);
  assert.equal(document?.title, "roadmap");
  assert.equal(document?.workspaceId, null);
  assert.equal(versions.length, 1);
  assert.equal(versions[0]?.createdById, userId);
});

test("persistImportedDocument (sqlite): rolls back document when version insert fails", async (t) => {
  const harness = await createSqliteHarness("import-application-rollback");
  t.after(async () => {
    await disposeSqliteHarness(harness);
  });

  const userId = seededUserId("user");
  await harness.client.user.create({
    data: { id: userId, email: `${userId}@example.com` },
  });

  const triggerName = `DocumentVersionFail_${randomUUID().replace(/-/g, "_")}`;
  await harness.client.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON "DocumentVersion"
    BEGIN
      SELECT RAISE(FAIL, 'document-version-fail');
    END;
  `);
  t.after(async () => {
    await harness.client.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}"`,
    );
  });

  await assert.rejects(
    persistImportedDocument(
      {
        userId,
        fileName: "rollback.md",
        markdown: "# Rollback",
        target: { kind: "personal" },
      },
      harness.client,
    ),
  );

  const documentCount = await harness.client.document.count({
    where: { ownerId: userId },
  });
  const versionCount = await harness.client.documentVersion.count();
  assert.equal(documentCount, 0);
  assert.equal(versionCount, 0);
});
