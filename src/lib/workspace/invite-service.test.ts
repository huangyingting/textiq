import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, test } from "node:test";

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
const serverOnlyStubUrl = "server-only:invite-service-test";

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

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type InviteServiceModule = typeof import("./invite-service");
let MAX_INVITE_EXPIRY_DAYS: InviteServiceModule["MAX_INVITE_EXPIRY_DAYS"];
let MAX_INVITE_USES_LIMIT: InviteServiceModule["MAX_INVITE_USES_LIMIT"];
let acceptWorkspaceInvite: InviteServiceModule["acceptWorkspaceInvite"];
let assertInvitableWorkspaceRole: InviteServiceModule["assertInvitableWorkspaceRole"];
let createWorkspaceInviteLink: InviteServiceModule["createWorkspaceInviteLink"];
let getInviteLinkTarget: InviteServiceModule["getInviteLinkTarget"];
let normalizeInviteExpiry: InviteServiceModule["normalizeInviteExpiry"];
let normalizeInviteMaxUses: InviteServiceModule["normalizeInviteMaxUses"];
let revokeWorkspaceInviteLink: InviteServiceModule["revokeWorkspaceInviteLink"];

before(async () => {
  const mod = await import("./invite-service");
  MAX_INVITE_EXPIRY_DAYS = mod.MAX_INVITE_EXPIRY_DAYS;
  MAX_INVITE_USES_LIMIT = mod.MAX_INVITE_USES_LIMIT;
  acceptWorkspaceInvite = mod.acceptWorkspaceInvite;
  assertInvitableWorkspaceRole = mod.assertInvitableWorkspaceRole;
  createWorkspaceInviteLink = mod.createWorkspaceInviteLink;
  getInviteLinkTarget = mod.getInviteLinkTarget;
  normalizeInviteExpiry = mod.normalizeInviteExpiry;
  normalizeInviteMaxUses = mod.normalizeInviteMaxUses;
  revokeWorkspaceInviteLink = mod.revokeWorkspaceInviteLink;
});

const NOW = new Date("2026-06-25T00:00:00Z");

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

// ---------------------------------------------------------------------------
// Normalization / validation (moved from service.test.ts)
// ---------------------------------------------------------------------------

test("normalizeInviteExpiry returns null for omitted/null expiry", () => {
  assert.equal(normalizeInviteExpiry(undefined, NOW), null);
  assert.equal(normalizeInviteExpiry(null, NOW), null);
});

test("normalizeInviteExpiry computes expiry from the server clock", () => {
  assert.equal(
    normalizeInviteExpiry(2, NOW)?.toISOString(),
    "2026-06-27T00:00:00.000Z",
  );
});

test("normalizeInviteExpiry rejects invalid windows", () => {
  for (const value of [0, -1, Number.NaN, MAX_INVITE_EXPIRY_DAYS + 1]) {
    assert.throws(() => normalizeInviteExpiry(value, NOW), /Invalid invite/);
  }
});

test("normalizeInviteMaxUses returns null for omitted/null caps", () => {
  assert.equal(normalizeInviteMaxUses(undefined), null);
  assert.equal(normalizeInviteMaxUses(null), null);
});

test("normalizeInviteMaxUses validates integer usage caps", () => {
  assert.equal(normalizeInviteMaxUses(1), 1);
  assert.equal(normalizeInviteMaxUses(MAX_INVITE_USES_LIMIT), 10_000);

  for (const value of [0, -1, 1.5, MAX_INVITE_USES_LIMIT + 1]) {
    assert.throws(() => normalizeInviteMaxUses(value), /Invalid invite/);
  }
});

test("assertInvitableWorkspaceRole accepts only invite-grantable roles", () => {
  assert.doesNotThrow(() => assertInvitableWorkspaceRole("EDITOR"));
  assert.doesNotThrow(() => assertInvitableWorkspaceRole("VIEWER"));
  assert.throws(() => assertInvitableWorkspaceRole("OWNER"), /Invalid invite/);
});

// ---------------------------------------------------------------------------
// Link CRUD (moved from service.test.ts)
// ---------------------------------------------------------------------------

test("createWorkspaceInviteLink normalizes role, expiry, and usage limits before persisting", async (t) => {
  replacePrismaProperty(t, "inviteLink", {
    async create(args: { data: Record<string, unknown> }) {
      assert.equal(args.data.workspaceId, "workspace-1");
      assert.equal(args.data.role, "EDITOR");
      assert.equal(args.data.createdById, "user-1");
      assert.equal(args.data.maxUses, 5);
      assert.ok(args.data.expiresAt instanceof Date);
      return {
        id: "invite-1",
        token: args.data.token,
        role: "EDITOR",
        createdAt: NOW,
        expiresAt: args.data.expiresAt,
        maxUses: args.data.maxUses,
        useCount: 0,
      };
    },
  });

  const invite = await createWorkspaceInviteLink({
    workspaceId: "workspace-1",
    role: "EDITOR",
    createdById: "user-1",
    options: { expiresInDays: 1, maxUses: 5 },
  });

  assert.equal(invite.id, "invite-1");
  assert.equal(invite.role, "EDITOR");
  assert.equal(invite.maxUses, 5);
});

test("getInviteLinkTarget and revokeWorkspaceInviteLink delegate to prisma", async (t) => {
  const calls: string[] = [];
  replacePrismaProperty(t, "inviteLink", {
    async findFirst(args: { where: unknown }) {
      calls.push("inviteLink.findFirst");
      assert.deepEqual(args.where, { id: "invite-1" });
      return { workspaceId: "workspace-1" };
    },
    async update(args: unknown) {
      calls.push("inviteLink.update");
      assert.deepEqual(args, {
        where: { id: "invite-1" },
        data: { isRevoked: true },
      });
      return {};
    },
  });

  assert.deepEqual(await getInviteLinkTarget("invite-1"), {
    workspaceId: "workspace-1",
  });
  await revokeWorkspaceInviteLink("invite-1");

  assert.deepEqual(calls, ["inviteLink.findFirst", "inviteLink.update"]);
});

// ---------------------------------------------------------------------------
// acceptWorkspaceInvite — transaction tests
// ---------------------------------------------------------------------------

const ACCEPT_INVITE_SELECT = {
  id: true,
  workspaceId: true,
  role: true,
  isRevoked: true,
  expiresAt: true,
  maxUses: true,
  useCount: true,
  workspace: { select: { ownerId: true } },
} as const;

type InviteAcceptanceRow = {
  id: string;
  workspaceId: string;
  role: string;
  isRevoked: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  workspace: { ownerId: string };
};

function inviteRow(
  overrides: Partial<InviteAcceptanceRow> = {},
): InviteAcceptanceRow {
  const defaults: InviteAcceptanceRow = {
    id: "link-1",
    workspaceId: "ws-1",
    role: "EDITOR",
    isRevoked: false,
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    workspace: { ownerId: "owner-1" },
  };
  return {
    ...defaults,
    ...overrides,
    workspace: overrides.workspace ?? defaults.workspace,
  };
}

/**
 * Builds a stub that mimics Prisma's interactive `$transaction(callback)`.
 * The callback receives a fake transaction client whose model stubs are
 * controlled by the caller.
 */
function stubTransaction(
  t: { after(callback: () => void): void },
  txModels: Record<string, unknown>,
) {
  replacePrismaProperty(
    t,
    "$transaction",
    async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
      return cb(txModels);
    },
  );
}

test("acceptWorkspaceInvite joins using persisted invite facts and CAS consumption", async (t) => {
  const ops: Array<[string, unknown]> = [];
  const expiresAt = new Date("2026-06-26T00:00:00Z");

  stubTransaction(t, {
    inviteLink: {
      async findUnique(args: unknown) {
        ops.push(["inviteLink.findUnique", args]);
        return inviteRow({
          id: "link-9",
          workspaceId: "ws-db",
          role: "EDITOR",
          maxUses: 5,
          useCount: 1,
          expiresAt,
          workspace: { ownerId: "owner-9" },
        });
      },
      async updateMany(args: unknown) {
        ops.push(["inviteLink.updateMany", args]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst(args: unknown) {
        ops.push(["workspaceMember.findFirst", args]);
        return null;
      },
      async create(args: unknown) {
        ops.push(["workspaceMember.create", args]);
        return {};
      },
    },
    inviteLinkUse: {
      async create(args: unknown) {
        ops.push(["inviteLinkUse.create", args]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-9",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, { outcome: "joined", workspaceId: "ws-db" });
  assert.deepEqual(ops[0], [
    "inviteLink.findUnique",
    {
      where: { id: "link-9" },
      select: ACCEPT_INVITE_SELECT,
    },
  ]);
  assert.deepEqual(ops[1], [
    "workspaceMember.findFirst",
    { where: { workspaceId: "ws-db", userId: "user-1" }, select: { id: true } },
  ]);
  assert.deepEqual(ops[2], [
    "inviteLink.updateMany",
    {
      where: {
        id: "link-9",
        workspaceId: "ws-db",
        role: "EDITOR",
        isRevoked: false,
        expiresAt,
        maxUses: 5,
        useCount: { equals: 1, lt: 5 },
      },
      data: { useCount: { increment: 1 } },
    },
  ]);
  assert.deepEqual(ops[3], [
    "workspaceMember.create",
    { data: { workspaceId: "ws-db", userId: "user-1", role: "EDITOR" } },
  ]);
  assert.deepEqual(ops[4], [
    "inviteLinkUse.create",
    { data: { inviteLinkId: "link-9", userId: "user-1", role: "EDITOR" } },
  ]);
});

test("acceptWorkspaceInvite uses scalar useCount CAS predicate for unlimited invites", async (t) => {
  const ops: Array<[string, unknown]> = [];

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        return inviteRow({ id: "link-unlimited", maxUses: null, useCount: 2 });
      },
      async updateMany(args: unknown) {
        ops.push(["inviteLink.updateMany", args]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst() {
        return null;
      },
      async create(args: unknown) {
        ops.push(["workspaceMember.create", args]);
        return {};
      },
    },
    inviteLinkUse: {
      async create(args: unknown) {
        ops.push(["inviteLinkUse.create", args]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-unlimited",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, { outcome: "joined", workspaceId: "ws-1" });
  assert.deepEqual(ops[0], [
    "inviteLink.updateMany",
    {
      where: {
        id: "link-unlimited",
        workspaceId: "ws-1",
        role: "EDITOR",
        isRevoked: false,
        expiresAt: null,
        maxUses: null,
        useCount: 2,
      },
      data: { useCount: { increment: 1 } },
    },
  ]);
});

test("acceptWorkspaceInvite denies a revoked invite without count/member/audit writes", async (t) => {
  const ops: Array<[string, unknown]> = [];

  stubTransaction(t, {
    inviteLink: {
      async findUnique(args: unknown) {
        ops.push(["inviteLink.findUnique", args]);
        return inviteRow({ isRevoked: true });
      },
      async updateMany() {
        ops.push(["inviteLink.updateMany", null]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst() {
        ops.push(["workspaceMember.findFirst", null]);
        return null;
      },
      async create() {
        ops.push(["workspaceMember.create", null]);
        return {};
      },
    },
    inviteLinkUse: {
      async create() {
        ops.push(["inviteLinkUse.create", null]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-1",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, { outcome: "denied", reason: "revoked" });
  assert.equal(ops.length, 1);
  assert.equal(ops[0][0], "inviteLink.findUnique");
});

test("acceptWorkspaceInvite denies at the expiry boundary without writes", async (t) => {
  const ops: Array<[string, unknown]> = [];

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        ops.push(["inviteLink.findUnique", null]);
        return inviteRow({ expiresAt: NOW });
      },
      async updateMany() {
        ops.push(["inviteLink.updateMany", null]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst() {
        ops.push(["workspaceMember.findFirst", null]);
        return null;
      },
      async create() {
        ops.push(["workspaceMember.create", null]);
        return {};
      },
    },
    inviteLinkUse: {
      async create() {
        ops.push(["inviteLinkUse.create", null]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-1",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, { outcome: "denied", reason: "expired" });
  assert.deepEqual(ops, [["inviteLink.findUnique", null]]);
});

test("acceptWorkspaceInvite re-checks revocation races between read and consume", async (t) => {
  const ops: Array<[string, unknown]> = [];
  const snapshots = [
    inviteRow({ isRevoked: false, maxUses: 5, useCount: 0 }),
    inviteRow({ isRevoked: true, maxUses: 5, useCount: 0 }),
  ];
  let findCount = 0;

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        ops.push(["inviteLink.findUnique", null]);
        const snapshot = snapshots[Math.min(findCount, snapshots.length - 1)];
        findCount += 1;
        return snapshot;
      },
      async updateMany() {
        ops.push(["inviteLink.updateMany", null]);
        return { count: 0 };
      },
    },
    workspaceMember: {
      async findFirst() {
        ops.push(["workspaceMember.findFirst", null]);
        return null;
      },
      async create() {
        ops.push(["workspaceMember.create", null]);
        return {};
      },
    },
    inviteLinkUse: {
      async create() {
        ops.push(["inviteLinkUse.create", null]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-1",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, { outcome: "denied", reason: "revoked" });
  assert.deepEqual(
    ops.map(([name]) => name),
    [
      "inviteLink.findUnique",
      "workspaceMember.findFirst",
      "inviteLink.updateMany",
      "inviteLink.findUnique",
    ],
  );
});

test("acceptWorkspaceInvite re-checks expiry races between read and consume", async (t) => {
  const future = new Date("2026-06-25T01:00:00Z");
  const ops: Array<[string, unknown]> = [];
  const snapshots = [
    inviteRow({ expiresAt: future }),
    inviteRow({ expiresAt: NOW }),
  ];
  let findCount = 0;

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        ops.push(["inviteLink.findUnique", null]);
        const snapshot = snapshots[Math.min(findCount, snapshots.length - 1)];
        findCount += 1;
        return snapshot;
      },
      async updateMany() {
        ops.push(["inviteLink.updateMany", null]);
        return { count: 0 };
      },
    },
    workspaceMember: {
      async findFirst() {
        ops.push(["workspaceMember.findFirst", null]);
        return null;
      },
      async create() {
        ops.push(["workspaceMember.create", null]);
        return {};
      },
    },
    inviteLinkUse: {
      async create() {
        ops.push(["inviteLinkUse.create", null]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-1",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, { outcome: "denied", reason: "expired" });
  assert.equal(callsByName(ops, "workspaceMember.create"), 0);
  assert.equal(callsByName(ops, "inviteLinkUse.create"), 0);
});

test("acceptWorkspaceInvite re-checks cap races and denies exhausted without writes", async (t) => {
  const ops: Array<[string, unknown]> = [];
  const snapshots = [
    inviteRow({ maxUses: 2, useCount: 1 }),
    inviteRow({ maxUses: 2, useCount: 2 }),
  ];
  let findCount = 0;

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        ops.push(["inviteLink.findUnique", null]);
        const snapshot = snapshots[Math.min(findCount, snapshots.length - 1)];
        findCount += 1;
        return snapshot;
      },
      async updateMany() {
        ops.push(["inviteLink.updateMany", null]);
        return { count: 0 };
      },
    },
    workspaceMember: {
      async findFirst() {
        ops.push(["workspaceMember.findFirst", null]);
        return null;
      },
      async create() {
        ops.push(["workspaceMember.create", null]);
        return {};
      },
    },
    inviteLinkUse: {
      async create() {
        ops.push(["inviteLinkUse.create", null]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-1",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, { outcome: "denied", reason: "exhausted" });
  assert.equal(callsByName(ops, "workspaceMember.create"), 0);
  assert.equal(callsByName(ops, "inviteLinkUse.create"), 0);
});

test("acceptWorkspaceInvite returns already-owner without consuming invite capacity", async (t) => {
  const ops: Array<[string, unknown]> = [];

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        ops.push(["inviteLink.findUnique", null]);
        return inviteRow({
          workspaceId: "ws-9",
          workspace: { ownerId: "user-1" },
        });
      },
      async updateMany() {
        ops.push(["inviteLink.updateMany", null]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst() {
        ops.push(["workspaceMember.findFirst", null]);
        return null;
      },
      async create() {
        ops.push(["workspaceMember.create", null]);
        return {};
      },
    },
    inviteLinkUse: {
      async create() {
        ops.push(["inviteLinkUse.create", null]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-1",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, { outcome: "already-owner", workspaceId: "ws-9" });
  assert.equal(callsByName(ops, "workspaceMember.findFirst"), 0);
  assert.equal(callsByName(ops, "inviteLink.updateMany"), 0);
  assert.equal(callsByName(ops, "workspaceMember.create"), 0);
  assert.equal(callsByName(ops, "inviteLinkUse.create"), 0);
});

test("acceptWorkspaceInvite returns already-member without consuming invite capacity", async (t) => {
  const ops: Array<[string, unknown]> = [];

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        ops.push(["inviteLink.findUnique", null]);
        return inviteRow({ workspaceId: "ws-7" });
      },
      async updateMany() {
        ops.push(["inviteLink.updateMany", null]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst() {
        ops.push(["workspaceMember.findFirst", null]);
        return { id: "member-1" };
      },
      async create() {
        ops.push(["workspaceMember.create", null]);
        return {};
      },
    },
    inviteLinkUse: {
      async create() {
        ops.push(["inviteLinkUse.create", null]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-1",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, { outcome: "already-member", workspaceId: "ws-7" });
  assert.equal(callsByName(ops, "inviteLink.updateMany"), 0);
  assert.equal(callsByName(ops, "workspaceMember.create"), 0);
  assert.equal(callsByName(ops, "inviteLinkUse.create"), 0);
});

test("acceptWorkspaceInvite maps workspaceMember P2002 replay to already-member", async (t) => {
  const ops: Array<[string, unknown]> = [];

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        ops.push(["inviteLink.findUnique", null]);
        return inviteRow({ workspaceId: "ws-race", maxUses: 5, useCount: 0 });
      },
      async updateMany(args: unknown) {
        ops.push(["inviteLink.updateMany", args]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst(args: unknown) {
        ops.push(["workspaceMember.findFirst", args]);
        return null;
      },
      async create() {
        throw new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed",
          { code: "P2002", clientVersion: "test" },
        );
      },
    },
    inviteLinkUse: {
      async create() {
        ops.push(["inviteLinkUse.create", null]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-1",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, {
    outcome: "already-member",
    workspaceId: "ws-race",
  });
  assert.equal(callsByName(ops, "inviteLinkUse.create"), 0);
});

test("acceptWorkspaceInvite denies invalid persisted invite roles explicitly", async (t) => {
  const ops: Array<[string, unknown]> = [];

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        ops.push(["inviteLink.findUnique", null]);
        return inviteRow({ role: "OWNER" });
      },
      async updateMany() {
        ops.push(["inviteLink.updateMany", null]);
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst() {
        ops.push(["workspaceMember.findFirst", null]);
        return null;
      },
      async create() {
        ops.push(["workspaceMember.create", null]);
        return {};
      },
    },
    inviteLinkUse: {
      async create() {
        ops.push(["inviteLinkUse.create", null]);
        return {};
      },
    },
  });

  const result = await acceptWorkspaceInvite({
    inviteLinkId: "link-1",
    userId: "user-1",
    now: NOW,
  });

  assert.deepEqual(result, { outcome: "denied", reason: "invalid-role" });
  assert.equal(callsByName(ops, "inviteLink.updateMany"), 0);
  assert.equal(callsByName(ops, "workspaceMember.create"), 0);
  assert.equal(callsByName(ops, "inviteLinkUse.create"), 0);
});

test("acceptWorkspaceInvite throws explicit error when bounded CAS retries exhaust", async (t) => {
  const active = inviteRow({ maxUses: null, useCount: 0 });

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        return active;
      },
      async updateMany() {
        return { count: 0 };
      },
    },
    workspaceMember: {
      async findFirst() {
        return null;
      },
      async create() {
        return { count: 1 };
      },
    },
    inviteLinkUse: {
      async create() {
        return {};
      },
    },
  });

  await assert.rejects(
    () =>
      acceptWorkspaceInvite({
        inviteLinkId: "link-1",
        userId: "user-1",
        now: NOW,
      }),
    /Invite acceptance conflicted/,
  );
});

test("acceptWorkspaceInvite rethrows non-P2002 errors unchanged", async (t) => {
  const dbError = new Error("Connection lost");

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        return inviteRow();
      },
      async updateMany() {
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst() {
        return null;
      },
      async create() {
        throw dbError;
      },
    },
    inviteLinkUse: {
      async create() {
        return {};
      },
    },
  });

  await assert.rejects(
    () =>
      acceptWorkspaceInvite({
        inviteLinkId: "link-1",
        userId: "user-1",
        now: NOW,
      }),
    dbError,
  );
});

test("acceptWorkspaceInvite does not swallow P2002 from inviteLinkUse.create", async (t) => {
  const p2002 = new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on inviteLinkUse",
    { code: "P2002", clientVersion: "test" },
  );

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        return inviteRow();
      },
      async updateMany() {
        return { count: 1 };
      },
    },
    workspaceMember: {
      async findFirst() {
        return null;
      },
      async create() {
        return {};
      },
    },
    inviteLinkUse: {
      async create() {
        throw p2002;
      },
    },
  });

  await assert.rejects(
    () =>
      acceptWorkspaceInvite({
        inviteLinkId: "link-1",
        userId: "user-1",
        now: NOW,
      }),
    p2002,
  );
});

test("acceptWorkspaceInvite surfaces transaction errors from inviteLink.updateMany", async (t) => {
  const p2002 = new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on inviteLink",
    { code: "P2002", clientVersion: "test" },
  );

  stubTransaction(t, {
    inviteLink: {
      async findUnique() {
        return inviteRow();
      },
      async updateMany() {
        throw p2002;
      },
    },
    workspaceMember: {
      async findFirst() {
        return null;
      },
      async create() {
        return {};
      },
    },
    inviteLinkUse: {
      async create() {
        return {};
      },
    },
  });

  await assert.rejects(
    () =>
      acceptWorkspaceInvite({
        inviteLinkId: "link-1",
        userId: "user-1",
        now: NOW,
      }),
    p2002,
  );
});

function callsByName(ops: Array<[string, unknown]>, name: string): number {
  return ops.filter(([op]) => op === name).length;
}
