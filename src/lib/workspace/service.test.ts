import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_LIST_LIMIT } from "@/lib/documents";
import { prisma } from "@/lib/prisma";
import {
  MAX_INVITE_EXPIRY_DAYS,
  MAX_INVITE_USES_LIMIT,
  MAX_WORKSPACE_NAME_LENGTH,
  assertInvitableWorkspaceRole,
  createWorkspaceDocumentForUser,
  createWorkspaceForUser,
  createWorkspaceInviteLink,
  deleteWorkspaceAndDetachDocuments,
  getInviteLinkTarget,
  getWorkspaceMemberRemovalTarget,
  importWorkspaceDocumentForUser,
  leaveWorkspaceForUser,
  listWorkspaceDocumentsForUser,
  normalizeInviteExpiry,
  normalizeInviteMaxUses,
  normalizeWorkspaceName,
  removeWorkspaceMemberAndDetachDocuments,
  renameWorkspaceRecord,
  revokeWorkspaceInviteLink,
  transferWorkspaceOwnership,
} from "./service";

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

test("normalizeWorkspaceName trims, caps, and rejects empty names", () => {
  assert.equal(normalizeWorkspaceName("  Team  "), "Team");
  assert.equal(
    normalizeWorkspaceName("x".repeat(MAX_WORKSPACE_NAME_LENGTH + 1)).length,
    MAX_WORKSPACE_NAME_LENGTH,
  );
  assert.throws(() => normalizeWorkspaceName("   "), /Workspace name/);
});

test("assertInvitableWorkspaceRole accepts only invite-grantable roles", () => {
  assert.doesNotThrow(() => assertInvitableWorkspaceRole("EDITOR"));
  assert.doesNotThrow(() => assertInvitableWorkspaceRole("VIEWER"));
  assert.throws(() => assertInvitableWorkspaceRole("OWNER"), /Invalid invite/);
});

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
  assert.deepEqual(await getInviteLinkTarget("invite-1"), {
    workspaceId: "workspace-1",
  });
  await revokeWorkspaceInviteLink("invite-1");
  assert.deepEqual(await getWorkspaceMemberRemovalTarget("member-1"), {
    workspaceId: "workspace-1",
    userId: "user-1",
  });
  await renameWorkspaceRecord("workspace-1", " Renamed ");

  assert.deepEqual(calls, [
    "workspace.create",
    "inviteLink.findFirst",
    "inviteLink.update",
    "workspaceMember.findFirst",
    "workspace.update",
  ]);
});

test("workspace transaction helpers detach documents before destructive changes", async (t) => {
  const operations: unknown[] = [];
  replacePrismaProperty(t, "document", {
    updateMany(args: unknown) {
      operations.push(["document.updateMany", args]);
      return Promise.resolve({ count: 2 });
    },
  });
  replacePrismaProperty(t, "workspaceMember", {
    delete(args: unknown) {
      operations.push(["workspaceMember.delete", args]);
      return Promise.resolve({});
    },
  });
  replacePrismaProperty(t, "workspace", {
    delete(args: unknown) {
      operations.push(["workspace.delete", args]);
      return Promise.resolve({});
    },
  });
  replacePrismaProperty(t, "$transaction", async (items: unknown) => items);

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

test("transferWorkspaceOwnership validates target membership before updating roles", async (t) => {
  await assert.rejects(
    transferWorkspaceOwnership("workspace-1", "owner-1", "owner-1"),
    /already own/,
  );

  let membership: { id: string } | null = null;
  replacePrismaProperty(t, "workspaceMember", {
    async findFirst() {
      return membership;
    },
    delete(args: unknown) {
      operations.push(["workspaceMember.delete", args]);
      return Promise.resolve({});
    },
    upsert(args: unknown) {
      operations.push(["workspaceMember.upsert", args]);
      return Promise.resolve({});
    },
  });
  await assert.rejects(
    transferWorkspaceOwnership("workspace-1", "owner-1", "user-2"),
    /existing member/,
  );

  const operations: unknown[] = [];
  membership = { id: "member-2" };
  replacePrismaProperty(t, "workspace", {
    update(args: unknown) {
      operations.push(["workspace.update", args]);
      return Promise.resolve({});
    },
  });
  replacePrismaProperty(t, "$transaction", async (items: unknown) => items);

  await transferWorkspaceOwnership("workspace-1", "owner-1", "user-2");

  assert.equal(operations.length, 3);
  assert.deepEqual(operations[0], [
    "workspace.update",
    { where: { id: "workspace-1" }, data: { ownerId: "user-2" } },
  ]);
  assert.deepEqual(operations[1], [
    "workspaceMember.delete",
    { where: { id: "member-2" } },
  ]);
  assert.deepEqual(operations[2], [
    "workspaceMember.upsert",
    {
      where: {
        workspaceId_userId: { workspaceId: "workspace-1", userId: "owner-1" },
      },
      create: { workspaceId: "workspace-1", userId: "owner-1", role: "EDITOR" },
      update: { role: "EDITOR" },
    },
  ]);
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
  assert.deepEqual(
    await importWorkspaceDocumentForUser(
      "user-1",
      "workspace-1",
      "# Imported",
      "  Imported title  ",
    ),
    { id: "doc-3" },
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
  assert.deepEqual((creates[0] as { select: unknown }).select, { id: true });
  assert.equal(
    (creates[1] as { data: { title: string } }).data.title,
    "Imported title",
  );
  assert.equal(
    typeof (creates[1] as { data: { contentJson: unknown } }).data.contentJson,
    "object",
  );
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

test("importWorkspaceDocumentForUser persists 'Imported document' for whitespace-only title", async (t) => {
  const created: Array<{ data: { title: string } }> = [];

  replacePrismaProperty(t, "workspace", {
    async findUnique() {
      return { id: "workspace-1", ownerId: "user-1", members: [] };
    },
  });
  replacePrismaProperty(t, "document", {
    async create(args: { data: { title: string } }) {
      created.push(args);
      return { id: "doc-1" };
    },
  });

  await importWorkspaceDocumentForUser(
    "user-1",
    "workspace-1",
    "# Content",
    "   ",
  );

  assert.equal(created.length, 1);
  assert.equal(created[0].data.title, "Imported document");
});
