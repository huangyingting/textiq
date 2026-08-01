import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve as resolvePath } from "node:path";
import { before, test } from "node:test";
import { promisify } from "node:util";

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
const serverOnlyStubUrl = "server-only:service-test";

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

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DOCUMENT_LIST_LIMIT } from "@/lib/documents";
import { WORKSPACE_NAME_MAX_LENGTH } from "@/lib/limits";
import { prisma } from "@/lib/prisma";
import { WorkspaceOwnershipTransferConflictError } from "@/lib/workspace/ownership-transfer-types";

type ServiceModule = typeof import("./service");
let createWorkspaceForUser: ServiceModule["createWorkspaceForUser"];
let deleteWorkspaceAndDetachDocuments: ServiceModule["deleteWorkspaceAndDetachDocuments"];
let getWorkspaceMemberRemovalTarget: ServiceModule["getWorkspaceMemberRemovalTarget"];
let leaveWorkspaceForUser: ServiceModule["leaveWorkspaceForUser"];
let listWorkspaceDocumentsForUser: ServiceModule["listWorkspaceDocumentsForUser"];
let normalizeWorkspaceName: ServiceModule["normalizeWorkspaceName"];
let removeWorkspaceMemberAndDetachDocuments: ServiceModule["removeWorkspaceMemberAndDetachDocuments"];
let renameWorkspaceRecord: ServiceModule["renameWorkspaceRecord"];
let transferWorkspaceOwnership: ServiceModule["transferWorkspaceOwnership"];
let createWorkspaceDocumentForUser: ServiceModule["createWorkspaceDocumentForUser"];

before(async () => {
  const mod = await import("./service");
  createWorkspaceForUser = mod.createWorkspaceForUser;
  deleteWorkspaceAndDetachDocuments = mod.deleteWorkspaceAndDetachDocuments;
  getWorkspaceMemberRemovalTarget = mod.getWorkspaceMemberRemovalTarget;
  leaveWorkspaceForUser = mod.leaveWorkspaceForUser;
  listWorkspaceDocumentsForUser = mod.listWorkspaceDocumentsForUser;
  normalizeWorkspaceName = mod.normalizeWorkspaceName;
  removeWorkspaceMemberAndDetachDocuments =
    mod.removeWorkspaceMemberAndDetachDocuments;
  renameWorkspaceRecord = mod.renameWorkspaceRecord;
  transferWorkspaceOwnership = mod.transferWorkspaceOwnership;
  createWorkspaceDocumentForUser = mod.createWorkspaceDocumentForUser;
});

const NOW = new Date("2026-06-25T00:00:00Z");
const REPO_ROOT = process.cwd();
const SQLITE_TEST_DB_DIRECTORY = resolvePath(REPO_ROOT, "prisma", ".test-dbs");
const execFileAsync = promisify(execFile);

function mutablePrisma(): Record<string, unknown> {
  return prisma as unknown as Record<string, unknown>;
}

function replacePrismaProperty(
  t: { after(callback: () => void): void },
  key: string,
  value: unknown,
) {
  const target = mutablePrisma();
  const original = target[key];
  target[key] = value;
  t.after(() => {
    target[key] = original;
  });
}

test("normalizeWorkspaceName trims, caps, and rejects empty names", () => {
  assert.equal(normalizeWorkspaceName("  Team  "), "Team");
  assert.equal(
    normalizeWorkspaceName("x".repeat(WORKSPACE_NAME_MAX_LENGTH + 1)).length,
    WORKSPACE_NAME_MAX_LENGTH,
  );
  assert.throws(() => normalizeWorkspaceName("   "), /Workspace name/);
});

test("workspace record helpers delegate sanitized data to prisma", async (t) => {
  const calls: string[] = [];
  replacePrismaProperty(t, "workspace", {
    async create(args: { data: unknown }) {
      calls.push("workspace.create");
      assert.deepEqual(args.data, { name: "Team", ownerId: "owner-1" });
      return { id: "workspace-1" };
    },
    async update(args: unknown) {
      calls.push("workspace.update");
      assert.deepEqual(args, {
        where: { id: "workspace-1" },
        data: { name: "Renamed" },
      });
      return {};
    },
  });
  replacePrismaProperty(t, "workspaceMember", {
    async findFirst(args: { where: unknown }) {
      calls.push("workspaceMember.findFirst");
      assert.deepEqual(args.where, { id: "member-1" });
      return { workspaceId: "workspace-1", userId: "user-1" };
    },
  });

  assert.deepEqual(await createWorkspaceForUser("owner-1", " Team "), {
    id: "workspace-1",
  });
  assert.deepEqual(await getWorkspaceMemberRemovalTarget("member-1"), {
    workspaceId: "workspace-1",
    userId: "user-1",
  });
  await renameWorkspaceRecord("workspace-1", " Renamed ");

  assert.deepEqual(calls, [
    "workspace.create",
    "workspaceMember.findFirst",
    "workspace.update",
  ]);
});

test("workspace transaction helpers detach documents before destructive changes", async (t) => {
  const operations: unknown[] = [];
  const document = {
    updateMany(args: unknown) {
      operations.push(["document.updateMany", args]);
      return Promise.resolve({ count: 2 });
    },
  };
  const workspaceMember = {
    delete(args: unknown) {
      operations.push(["workspaceMember.delete", args]);
      return Promise.resolve({});
    },
  };
  const workspace = {
    delete(args: unknown) {
      operations.push(["workspace.delete", args]);
      return Promise.resolve({});
    },
  };
  replacePrismaProperty(t, "document", document);
  replacePrismaProperty(t, "workspaceMember", workspaceMember);
  replacePrismaProperty(t, "workspace", workspace);
  replacePrismaProperty(
    t,
    "$transaction",
    async (operation: (tx: unknown) => unknown) =>
      operation({ document, workspaceMember, workspace }),
  );

  await removeWorkspaceMemberAndDetachDocuments("member-1", {
    workspaceId: "workspace-1",
    userId: "user-1",
  });
  await deleteWorkspaceAndDetachDocuments("workspace-1");

  assert.deepEqual(operations, [
    [
      "document.updateMany",
      {
        where: { workspaceId: "workspace-1", ownerId: "user-1" },
        data: { workspaceId: null },
      },
    ],
    ["workspaceMember.delete", { where: { id: "member-1" } }],
    [
      "document.updateMany",
      { where: { workspaceId: "workspace-1" }, data: { workspaceId: null } },
    ],
    ["workspace.delete", { where: { id: "workspace-1" } }],
  ]);
});

test("leaveWorkspaceForUser rejects missing, owned, and non-member workspaces", async (t) => {
  replacePrismaProperty(t, "workspaceMember", {
    async findFirst() {
      return null;
    },
  });

  let workspaceResult: { ownerId: string } | null = null;
  replacePrismaProperty(t, "workspace", {
    async findFirst() {
      return workspaceResult;
    },
  });
  await assert.rejects(
    leaveWorkspaceForUser("workspace-1", "user-1"),
    /Workspace not found/,
  );

  workspaceResult = { ownerId: "user-1" };
  await assert.rejects(
    leaveWorkspaceForUser("workspace-1", "user-1"),
    /owner cannot leave/,
  );

  workspaceResult = { ownerId: "owner-1" };
  await assert.rejects(
    leaveWorkspaceForUser("workspace-1", "user-1"),
    /not a member/,
  );
});

test("leaveWorkspaceForUser deletes a non-owner member row", async (t) => {
  const deleted: unknown[] = [];
  replacePrismaProperty(t, "workspace", {
    async findFirst() {
      return { ownerId: "owner-1" };
    },
  });
  replacePrismaProperty(t, "workspaceMember", {
    async findFirst() {
      return { id: "member-1" };
    },
    async delete(args: unknown) {
      deleted.push(args);
      return {};
    },
  });

  await leaveWorkspaceForUser("workspace-1", "user-1");

  assert.deepEqual(deleted, [{ where: { id: "member-1" } }]);
});

test("leaveWorkspaceForUser lets malformed or OWNER membership rows exit without role coercion", async (t) => {
  const deleted: unknown[] = [];
  let documentUpdateCalls = 0;
  const membershipRows: Array<{ id: string; role: string }> = [
    { id: "member-owner-role", role: "OWNER" },
    { id: "member-malformed-role", role: "BROKEN_ROLE" },
  ];

  replacePrismaProperty(t, "workspace", {
    async findFirst() {
      return { ownerId: "workspace-owner-1" };
    },
  });
  replacePrismaProperty(t, "workspaceMember", {
    async findFirst() {
      return membershipRows.shift() ?? null;
    },
    async delete(args: unknown) {
      deleted.push(args);
      return {};
    },
  });
  replacePrismaProperty(t, "document", {
    async updateMany() {
      documentUpdateCalls += 1;
      return { count: 0 };
    },
  });

  await leaveWorkspaceForUser("workspace-1", "member-user-1");
  await leaveWorkspaceForUser("workspace-1", "member-user-1");

  assert.deepEqual(deleted, [
    { where: { id: "member-owner-role" } },
    { where: { id: "member-malformed-role" } },
  ]);
  assert.equal(
    documentUpdateCalls,
    0,
    "leave should not rewrite owned document rows when removing membership",
  );
});

test("transferWorkspaceOwnership validates target membership and applies owner CAS with demotion", async (t) => {
  await assert.rejects(
    transferWorkspaceOwnership({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      targetUserId: "owner-1",
    }),
    /already own/,
  );

  const operations: unknown[] = [];
  let membership: { id: string } | null = null;
  const tx = {
    workspace: {
      async findUnique(args: unknown) {
        operations.push(["workspace.findUnique", args]);
        return { ownerId: "owner-1" };
      },
      async updateMany(args: unknown) {
        operations.push(["workspace.updateMany", args]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst(args: unknown) {
        operations.push(["workspaceMember.findFirst", args]);
        return membership;
      },
      async deleteMany(args: unknown) {
        operations.push(["workspaceMember.deleteMany", args]);
        return { count: 1 };
      },
      async upsert(args: unknown) {
        operations.push(["workspaceMember.upsert", args]);
        return {};
      },
    },
  };
  replacePrismaProperty(
    t,
    "$transaction",
    async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  );

  await assert.rejects(
    transferWorkspaceOwnership({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      targetUserId: "user-2",
    }),
    /existing member/,
  );

  membership = { id: "member-2" };
  operations.length = 0;
  await transferWorkspaceOwnership({
    workspaceId: "workspace-1",
    actorUserId: "owner-1",
    targetUserId: "user-2",
  });

  assert.deepEqual(operations, [
    [
      "workspace.findUnique",
      { where: { id: "workspace-1" }, select: { ownerId: true } },
    ],
    [
      "workspaceMember.findFirst",
      {
        where: { workspaceId: "workspace-1", userId: "user-2" },
        select: { id: true },
      },
    ],
    [
      "workspace.updateMany",
      {
        where: { id: "workspace-1", ownerId: "owner-1" },
        data: { ownerId: "user-2" },
      },
    ],
    [
      "workspaceMember.deleteMany",
      {
        where: { id: "member-2", workspaceId: "workspace-1", userId: "user-2" },
      },
    ],
    [
      "workspaceMember.upsert",
      {
        where: {
          workspaceId_userId: { workspaceId: "workspace-1", userId: "owner-1" },
        },
        create: {
          workspaceId: "workspace-1",
          userId: "owner-1",
          role: "EDITOR",
        },
        update: { role: "EDITOR" },
      },
    ],
  ]);
});

test("transferWorkspaceOwnership throws a typed stale-owner conflict before any writes when actor is stale", async (t) => {
  const operations: unknown[] = [];
  const tx = {
    workspace: {
      async findUnique(args: unknown) {
        operations.push(["workspace.findUnique", args]);
        return { ownerId: "other-owner" };
      },
    },
    workspaceMember: {
      async findFirst() {
        operations.push(["workspaceMember.findFirst"]);
        return { id: "member-2" };
      },
      async deleteMany() {
        operations.push(["workspaceMember.deleteMany"]);
        return { count: 1 };
      },
      async upsert() {
        operations.push(["workspaceMember.upsert"]);
        return {};
      },
    },
  };
  replacePrismaProperty(
    t,
    "$transaction",
    async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  );

  await assert.rejects(
    transferWorkspaceOwnership({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      targetUserId: "user-2",
    }),
    (error: unknown) => {
      assert.ok(error instanceof WorkspaceOwnershipTransferConflictError);
      assert.equal(error.reason, "stale-owner");
      assert.equal(error.workspaceId, "workspace-1");
      return true;
    },
  );

  assert.deepEqual(operations, [
    [
      "workspace.findUnique",
      { where: { id: "workspace-1" }, select: { ownerId: true } },
    ],
  ]);
});

test("transferWorkspaceOwnership throws stale-owner conflict when CAS update loses", async (t) => {
  const operations: unknown[] = [];
  const tx = {
    workspace: {
      async findUnique(args: unknown) {
        operations.push(["workspace.findUnique", args]);
        return { ownerId: "owner-1" };
      },
      async updateMany(args: unknown) {
        operations.push(["workspace.updateMany", args]);
        return { count: 0 };
      },
    },
    workspaceMember: {
      async findFirst(args: unknown) {
        operations.push(["workspaceMember.findFirst", args]);
        return { id: "member-2" };
      },
      async deleteMany() {
        operations.push(["workspaceMember.deleteMany"]);
        return { count: 1 };
      },
      async upsert() {
        operations.push(["workspaceMember.upsert"]);
        return {};
      },
    },
  };
  replacePrismaProperty(
    t,
    "$transaction",
    async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  );

  await assert.rejects(
    transferWorkspaceOwnership({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      targetUserId: "user-2",
    }),
    (error: unknown) => {
      assert.ok(error instanceof WorkspaceOwnershipTransferConflictError);
      assert.equal(error.reason, "stale-owner");
      return true;
    },
  );

  assert.deepEqual(operations, [
    [
      "workspace.findUnique",
      { where: { id: "workspace-1" }, select: { ownerId: true } },
    ],
    [
      "workspaceMember.findFirst",
      {
        where: { workspaceId: "workspace-1", userId: "user-2" },
        select: { id: true },
      },
    ],
    [
      "workspace.updateMany",
      {
        where: { id: "workspace-1", ownerId: "owner-1" },
        data: { ownerId: "user-2" },
      },
    ],
  ]);
});

test("transferWorkspaceOwnership rejects when target membership disappears after CAS owner claim", async (t) => {
  const operations: unknown[] = [];
  const tx = {
    workspace: {
      async findUnique(args: unknown) {
        operations.push(["workspace.findUnique", args]);
        return { ownerId: "owner-1" };
      },
      async updateMany(args: unknown) {
        operations.push(["workspace.updateMany", args]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst(args: unknown) {
        operations.push(["workspaceMember.findFirst", args]);
        return { id: "member-2" };
      },
      async deleteMany(args: unknown) {
        operations.push(["workspaceMember.deleteMany", args]);
        return { count: 0 };
      },
      async upsert() {
        operations.push(["workspaceMember.upsert"]);
        return {};
      },
    },
  };
  replacePrismaProperty(
    t,
    "$transaction",
    async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  );

  await assert.rejects(
    transferWorkspaceOwnership({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      targetUserId: "user-2",
    }),
    /existing member/,
  );

  assert.deepEqual(operations, [
    [
      "workspace.findUnique",
      { where: { id: "workspace-1" }, select: { ownerId: true } },
    ],
    [
      "workspaceMember.findFirst",
      {
        where: { workspaceId: "workspace-1", userId: "user-2" },
        select: { id: true },
      },
    ],
    [
      "workspace.updateMany",
      {
        where: { id: "workspace-1", ownerId: "owner-1" },
        data: { ownerId: "user-2" },
      },
    ],
    [
      "workspaceMember.deleteMany",
      {
        where: { id: "member-2", workspaceId: "workspace-1", userId: "user-2" },
      },
    ],
  ]);
});

test("transferWorkspaceOwnership propagates transaction failures without retrying", async (t) => {
  const operations: unknown[] = [];
  const expected = new Error("owner demotion failed");
  const tx = {
    workspace: {
      async findUnique(args: unknown) {
        operations.push(["workspace.findUnique", args]);
        return { ownerId: "owner-1" };
      },
      async updateMany(args: unknown) {
        operations.push(["workspace.updateMany", args]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst(args: unknown) {
        operations.push(["workspaceMember.findFirst", args]);
        return { id: "member-2" };
      },
      async deleteMany(args: unknown) {
        operations.push(["workspaceMember.deleteMany", args]);
        return { count: 1 };
      },
      async upsert(args: unknown) {
        operations.push(["workspaceMember.upsert", args]);
        throw expected;
      },
    },
  };
  replacePrismaProperty(
    t,
    "$transaction",
    async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  );

  await assert.rejects(
    transferWorkspaceOwnership({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      targetUserId: "user-2",
    }),
    (error: unknown) => error === expected,
  );

  assert.equal(
    operations.filter(
      (entry) => (entry as unknown[])[0] === "workspaceMember.upsert",
    ).length,
    1,
  );
});

test("workspace document helpers require capabilities and map document rows", async (t) => {
  const creates: unknown[] = [];
  replacePrismaProperty(t, "workspace", {
    async findUnique() {
      return {
        id: "workspace-1",
        ownerId: "user-1",
        members: [],
      };
    },
  });
  replacePrismaProperty(t, "document", {
    async findMany() {
      return [
        {
          id: "doc-1",
          title: "First",
          updatedAt: new Date("2026-06-25T01:00:00Z"),
        },
      ];
    },
    async create(args: unknown) {
      creates.push(args);
      return { id: `doc-${creates.length + 1}` };
    },
  });

  assert.deepEqual(
    await listWorkspaceDocumentsForUser("user-1", "workspace-1"),
    {
      documents: [
        {
          id: "doc-1",
          title: "First",
          updatedAt: new Date("2026-06-25T01:00:00Z"),
        },
      ],
      hasMore: false,
    },
  );
  assert.deepEqual(
    await createWorkspaceDocumentForUser("user-1", "workspace-1", "flowchart"),
    { id: "doc-2" },
  );

  assert.equal(
    (creates[0] as { data: { ownerId: string } }).data.ownerId,
    "user-1",
  );
  assert.equal(
    (creates[0] as { data: { workspaceId: string } }).data.workspaceId,
    "workspace-1",
  );
  assert.equal(
    typeof (creates[0] as { data: { contentJson: unknown } }).data.contentJson,
    "object",
  );
  assert.match(
    JSON.stringify(
      (creates[0] as { data: { contentJson: unknown } }).data.contentJson,
    ),
    /Process overview/,
  );
  assert.match(
    (creates[0] as { data: { content: string } }).data.content,
    /Process overview/,
  );
  assert.deepEqual((creates[0] as { select: unknown }).select, { id: true });
});

test("listWorkspaceDocumentsForUser returns 200 items and hasMore:true when 201 rows exist", async (t) => {
  const rows = Array.from({ length: DOCUMENT_LIST_LIMIT + 1 }, (_, i) => ({
    id: `doc-${i}`,
    title: `Document ${i}`,
    updatedAt: NOW,
  }));

  replacePrismaProperty(t, "workspace", {
    async findUnique() {
      return { id: "workspace-1", ownerId: "user-1", members: [] };
    },
  });
  replacePrismaProperty(t, "document", {
    async findMany() {
      return rows;
    },
  });

  const result = await listWorkspaceDocumentsForUser("user-1", "workspace-1");

  assert.equal(result.documents.length, DOCUMENT_LIST_LIMIT);
  assert.equal(result.hasMore, true);
  assert.equal(result.documents[0].id, "doc-0");
  assert.equal(
    result.documents[DOCUMENT_LIST_LIMIT - 1].id,
    `doc-${DOCUMENT_LIST_LIMIT - 1}`,
  );
});

type WorkspaceTransferIntegrationHarness = {
  databaseFilePath: string;
  databaseUrl: string;
  client: PrismaClient;
};

type WorkspaceTransferFixture = {
  actorUserId: string;
  workspaceId: string;
  targetBUserId: string;
  targetCUserId: string;
};

function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function email(idValue: string): string {
  return `${idValue}@example.com`;
}

async function createWorkspaceTransferIntegrationHarness(): Promise<WorkspaceTransferIntegrationHarness> {
  await mkdir(SQLITE_TEST_DB_DIRECTORY, { recursive: true });

  const databaseFilePath = resolvePath(
    SQLITE_TEST_DB_DIRECTORY,
    `workspace-transfer-${randomUUID()}.db`,
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

async function disposeWorkspaceTransferIntegrationHarness(
  harness: WorkspaceTransferIntegrationHarness,
): Promise<void> {
  await harness.client.$disconnect();
  await rm(harness.databaseFilePath, { force: true });
  await rm(`${harness.databaseFilePath}-journal`, { force: true });
  await rm(`${harness.databaseFilePath}-wal`, { force: true });
  await rm(`${harness.databaseFilePath}-shm`, { force: true });
}

function bindWorkspaceTransferPrismaToIntegrationClient(
  t: { after(callback: () => void): void },
  client: PrismaClient,
) {
  replacePrismaProperty(t, "$transaction", client.$transaction.bind(client));
}

async function seedWorkspaceTransferFixture(
  client: PrismaClient,
): Promise<WorkspaceTransferFixture> {
  const actorUserId = id("owner");
  const targetBUserId = id("target");
  const targetCUserId = id("target");
  const workspaceId = id("workspace");

  await client.user.createMany({
    data: [
      { id: actorUserId, email: email(actorUserId) },
      { id: targetBUserId, email: email(targetBUserId) },
      { id: targetCUserId, email: email(targetCUserId) },
    ],
  });

  await client.workspace.create({
    data: { id: workspaceId, name: "Workspace", ownerId: actorUserId },
  });

  await client.workspaceMember.createMany({
    data: [
      { workspaceId, userId: targetBUserId, role: "EDITOR" },
      { workspaceId, userId: targetCUserId, role: "VIEWER" },
    ],
  });

  return { actorUserId, workspaceId, targetBUserId, targetCUserId };
}

async function readWorkspaceTransferState(
  client: PrismaClient,
  fixture: WorkspaceTransferFixture,
) {
  const workspace = await client.workspace.findUnique({
    where: { id: fixture.workspaceId },
    select: { ownerId: true },
  });

  const members = await client.workspaceMember.findMany({
    where: { workspaceId: fixture.workspaceId },
    select: { userId: true, role: true },
    orderBy: { userId: "asc" },
  });

  return {
    ownerId: workspace?.ownerId ?? null,
    members,
  };
}

test("transferWorkspaceOwnership integration: concurrent A→B/A→C yields exactly one winner", async (t) => {
  const harness = await createWorkspaceTransferIntegrationHarness();
  t.after(async () => {
    await disposeWorkspaceTransferIntegrationHarness(harness);
  });
  bindWorkspaceTransferPrismaToIntegrationClient(t, harness.client);

  const fixture = await seedWorkspaceTransferFixture(harness.client);

  const [aToB, aToC] = await Promise.allSettled([
    transferWorkspaceOwnership({
      workspaceId: fixture.workspaceId,
      actorUserId: fixture.actorUserId,
      targetUserId: fixture.targetBUserId,
    }),
    transferWorkspaceOwnership({
      workspaceId: fixture.workspaceId,
      actorUserId: fixture.actorUserId,
      targetUserId: fixture.targetCUserId,
    }),
  ]);

  const outcomes = [aToB, aToC];
  const successIndexes = outcomes
    .map((entry, index) => (entry.status === "fulfilled" ? index : -1))
    .filter((index) => index !== -1);
  assert.equal(successIndexes.length, 1);

  const failureIndexes = outcomes
    .map((entry, index) => (entry.status === "rejected" ? index : -1))
    .filter((index) => index !== -1);
  assert.equal(failureIndexes.length, 1);

  const failed = outcomes[failureIndexes[0]];
  assert.equal(failed.status, "rejected");
  assert.ok(failed.reason instanceof WorkspaceOwnershipTransferConflictError);
  assert.equal(failed.reason.reason, "stale-owner");

  const winnerTargetUserId =
    successIndexes[0] === 0 ? fixture.targetBUserId : fixture.targetCUserId;
  const loserTargetUserId =
    winnerTargetUserId === fixture.targetBUserId
      ? fixture.targetCUserId
      : fixture.targetBUserId;
  const state = await readWorkspaceTransferState(harness.client, fixture);
  assert.equal(state.ownerId, winnerTargetUserId);
  assert.equal(
    state.members.filter((member) => member.userId === winnerTargetUserId)
      .length,
    0,
  );
  assert.equal(
    state.members.filter((member) => member.userId === loserTargetUserId)
      .length,
    1,
  );
  const priorOwnerMemberships = state.members.filter(
    (member) => member.userId === fixture.actorUserId,
  );
  assert.equal(priorOwnerMemberships.length, 1);
  assert.equal(priorOwnerMemberships[0].role, "EDITOR");
});

test("transferWorkspaceOwnership integration: stale-owner replay fails and keeps loser membership", async (t) => {
  const harness = await createWorkspaceTransferIntegrationHarness();
  t.after(async () => {
    await disposeWorkspaceTransferIntegrationHarness(harness);
  });
  bindWorkspaceTransferPrismaToIntegrationClient(t, harness.client);

  const fixture = await seedWorkspaceTransferFixture(harness.client);

  await transferWorkspaceOwnership({
    workspaceId: fixture.workspaceId,
    actorUserId: fixture.actorUserId,
    targetUserId: fixture.targetBUserId,
  });

  await assert.rejects(
    transferWorkspaceOwnership({
      workspaceId: fixture.workspaceId,
      actorUserId: fixture.actorUserId,
      targetUserId: fixture.targetCUserId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof WorkspaceOwnershipTransferConflictError);
      assert.equal(error.reason, "stale-owner");
      return true;
    },
  );

  const state = await readWorkspaceTransferState(harness.client, fixture);
  assert.equal(state.ownerId, fixture.targetBUserId);
  assert.equal(
    state.members.filter((member) => member.userId === fixture.targetBUserId)
      .length,
    0,
  );
  assert.equal(
    state.members.filter((member) => member.userId === fixture.targetCUserId)
      .length,
    1,
  );
  const priorOwnerMemberships = state.members.filter(
    (member) => member.userId === fixture.actorUserId,
  );
  assert.equal(priorOwnerMemberships.length, 1);
  assert.equal(priorOwnerMemberships[0].role, "EDITOR");
});

test("transferWorkspaceOwnership integration rolls back when target disappears after owner CAS", async (t) => {
  const harness = await createWorkspaceTransferIntegrationHarness();
  t.after(async () => {
    await disposeWorkspaceTransferIntegrationHarness(harness);
  });
  bindWorkspaceTransferPrismaToIntegrationClient(t, harness.client);

  const fixture = await seedWorkspaceTransferFixture(harness.client);
  const triggerName = `WorkspaceTransferTargetGone_${randomUUID().replace(/-/g, "_")}`;

  await harness.client.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    AFTER UPDATE OF "ownerId" ON "Workspace"
    WHEN NEW."id" = '${fixture.workspaceId}'
    BEGIN
      DELETE FROM "WorkspaceMember"
      WHERE "workspaceId" = '${fixture.workspaceId}'
        AND "userId" = '${fixture.targetBUserId}';
    END;
  `);

  await assert.rejects(
    transferWorkspaceOwnership({
      workspaceId: fixture.workspaceId,
      actorUserId: fixture.actorUserId,
      targetUserId: fixture.targetBUserId,
    }),
    /existing member/,
  );

  const state = await readWorkspaceTransferState(harness.client, fixture);
  assert.equal(state.ownerId, fixture.actorUserId);
  assert.equal(
    state.members.filter((member) => member.userId === fixture.targetBUserId)
      .length,
    1,
  );
  assert.equal(
    state.members.filter((member) => member.userId === fixture.actorUserId)
      .length,
    0,
  );
});

test("transferWorkspaceOwnership integration rolls back owner/membership changes on transaction failure", async (t) => {
  const harness = await createWorkspaceTransferIntegrationHarness();
  t.after(async () => {
    await disposeWorkspaceTransferIntegrationHarness(harness);
  });
  bindWorkspaceTransferPrismaToIntegrationClient(t, harness.client);

  const fixture = await seedWorkspaceTransferFixture(harness.client);
  const triggerName = `WorkspaceTransferOwnerDemoteFail_${randomUUID().replace(/-/g, "_")}`;

  await harness.client.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON "WorkspaceMember"
    WHEN NEW."workspaceId" = '${fixture.workspaceId}'
      AND NEW."userId" = '${fixture.actorUserId}'
    BEGIN
      SELECT RAISE(ABORT, 'forced owner-demotion failure');
    END;
  `);

  await assert.rejects(
    transferWorkspaceOwnership({
      workspaceId: fixture.workspaceId,
      actorUserId: fixture.actorUserId,
      targetUserId: fixture.targetBUserId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
      return true;
    },
  );

  const state = await readWorkspaceTransferState(harness.client, fixture);
  assert.equal(state.ownerId, fixture.actorUserId);
  assert.equal(
    state.members.filter((member) => member.userId === fixture.targetBUserId)
      .length,
    1,
  );
  assert.equal(
    state.members.filter((member) => member.userId === fixture.actorUserId)
      .length,
    0,
  );
});
