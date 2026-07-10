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

test("acceptWorkspaceInvite capped: exact predicate, increment, member, audit, and joined outcome", async (t) => {
  const ops: Array<[string, unknown]> = [];

  stubTransaction(t, {
    inviteLink: {
      async updateMany(args: unknown) {
        ops.push(["inviteLink.updateMany", args]);
        return { count: 1 };
      },
    },
    workspaceMember: {
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
    inviteLinkId: "link-1",
    maxUses: 5,
    workspaceId: "ws-1",
    userId: "user-1",
    role: "EDITOR",
  });

  assert.deepEqual(result, { outcome: "joined" });
  assert.equal(ops.length, 3);

  // Capped predicate includes useCount condition
  assert.deepEqual(ops[0], [
    "inviteLink.updateMany",
    {
      where: { id: "link-1", useCount: { lt: 5 } },
      data: { useCount: { increment: 1 } },
    },
  ]);

  // Member creation payload
  assert.deepEqual(ops[1], [
    "workspaceMember.create",
    { data: { workspaceId: "ws-1", userId: "user-1", role: "EDITOR" } },
  ]);

  // Audit row payload
  assert.deepEqual(ops[2], [
    "inviteLinkUse.create",
    { data: { inviteLinkId: "link-1", userId: "user-1", role: "EDITOR" } },
  ]);
});

test("acceptWorkspaceInvite unlimited: predicate excludes useCount condition", async (t) => {
  const ops: Array<[string, unknown]> = [];

  stubTransaction(t, {
    inviteLink: {
      async updateMany(args: unknown) {
        ops.push(["inviteLink.updateMany", args]);
        return { count: 1 };
      },
    },
    workspaceMember: {
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
    inviteLinkId: "link-1",
    maxUses: null,
    workspaceId: "ws-1",
    userId: "user-1",
    role: "VIEWER",
  });

  assert.deepEqual(result, { outcome: "joined" });

  // Unlimited predicate: id only, no useCount
  assert.deepEqual(ops[0], [
    "inviteLink.updateMany",
    {
      where: { id: "link-1" },
      data: { useCount: { increment: 1 } },
    },
  ]);
});

test("acceptWorkspaceInvite returns cap-exhausted with no member/audit calls when count is 0", async (t) => {
  const ops: Array<[string, unknown]> = [];

  stubTransaction(t, {
    inviteLink: {
      async updateMany(args: unknown) {
        ops.push(["inviteLink.updateMany", args]);
        return { count: 0 };
      },
    },
    workspaceMember: {
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
    maxUses: 5,
    workspaceId: "ws-1",
    userId: "user-1",
    role: "EDITOR",
  });

  assert.deepEqual(result, { outcome: "cap-exhausted" });

  // Only the updateMany was called; member and audit were never reached.
  assert.equal(ops.length, 1);
  assert.equal(ops[0][0], "inviteLink.updateMany");
});

test("acceptWorkspaceInvite maps P2002 to already-member after transaction rejection", async (t) => {
  const ops: Array<[string, unknown]> = [];

  // The transaction stub invokes the callback, which throws P2002 from
  // workspaceMember.create. Since we let the error propagate, the transaction
  // rejects (simulating rollback). The service maps it to `already-member`.
  stubTransaction(t, {
    inviteLink: {
      async updateMany(args: unknown) {
        ops.push(["inviteLink.updateMany", args]);
        return { count: 1 };
      },
    },
    workspaceMember: {
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
    maxUses: 5,
    workspaceId: "ws-1",
    userId: "user-1",
    role: "EDITOR",
  });

  assert.deepEqual(result, { outcome: "already-member" });

  // The increment happened inside the callback, but since the transaction
  // rejected the P2002 should roll it back in a real database. The audit
  // row was never created because the error escaped before reaching it.
  assert.equal(ops.length, 1);
  assert.equal(ops[0][0], "inviteLink.updateMany");
});

test("acceptWorkspaceInvite rethrows non-P2002 errors unchanged", async (t) => {
  const dbError = new Error("Connection lost");

  stubTransaction(t, {
    inviteLink: {
      async updateMany() {
        return { count: 1 };
      },
    },
    workspaceMember: {
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
        maxUses: null,
        workspaceId: "ws-1",
        userId: "user-1",
        role: "EDITOR",
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
      async updateMany() {
        return { count: 1 };
      },
    },
    workspaceMember: {
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
        maxUses: 5,
        workspaceId: "ws-1",
        userId: "user-1",
        role: "EDITOR",
      }),
    p2002,
  );
});

test("acceptWorkspaceInvite does not swallow P2002 from inviteLink.updateMany", async (t) => {
  const p2002 = new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on inviteLink",
    { code: "P2002", clientVersion: "test" },
  );

  stubTransaction(t, {
    inviteLink: {
      async updateMany() {
        throw p2002;
      },
    },
    workspaceMember: {
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
        maxUses: null,
        workspaceId: "ws-1",
        userId: "user-1",
        role: "EDITOR",
      }),
    p2002,
  );
});
