import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertPersistedWorkspaceMemberRole,
  isInvitableWorkspaceRole,
  parsePersistedWorkspaceMemberRole,
  persistedMemberRoleToEffectiveRole,
  WorkspaceRoleDataIntegrityError,
} from "./roles";

test("parsePersistedWorkspaceMemberRole accepts canonical persisted roles", () => {
  assert.deepEqual(parsePersistedWorkspaceMemberRole("EDITOR"), {
    success: true,
    value: "EDITOR",
  });
  assert.deepEqual(parsePersistedWorkspaceMemberRole("VIEWER"), {
    success: true,
    value: "VIEWER",
  });
});

test("parsePersistedWorkspaceMemberRole rejects OWNER membership rows explicitly", () => {
  const parsed = parsePersistedWorkspaceMemberRole("OWNER");
  assert.equal(parsed.success, false);
  if (parsed.success) {
    assert.fail("expected OWNER to be rejected");
  }
  assert.equal(parsed.error.code, "owner-membership-row");
  assert.match(parsed.error.message, /must not be OWNER/i);
});

test("parsePersistedWorkspaceMemberRole rejects malformed persisted values", () => {
  for (const value of ["ADMIN", "", null, 123, { role: "EDITOR" }]) {
    const parsed = parsePersistedWorkspaceMemberRole(value);
    assert.equal(parsed.success, false);
    if (parsed.success) {
      assert.fail("expected malformed role to be rejected");
    }
    assert.equal(parsed.error.code, "invalid-workspace-member-role");
  }
});

test("assertPersistedWorkspaceMemberRole returns valid roles and throws typed integrity errors", () => {
  assert.equal(assertPersistedWorkspaceMemberRole("EDITOR"), "EDITOR");

  assert.throws(
    () => assertPersistedWorkspaceMemberRole("OWNER"),
    (error: unknown) =>
      error instanceof WorkspaceRoleDataIntegrityError &&
      error.code === "owner-membership-row" &&
      error.value === "OWNER",
  );
});

test("persistedMemberRoleToEffectiveRole maps persisted roles exhaustively", () => {
  assert.equal(persistedMemberRoleToEffectiveRole("EDITOR"), "editor");
  assert.equal(persistedMemberRoleToEffectiveRole("VIEWER"), "viewer");
});

test("workspace callers use the canonical persisted-to-effective converter", () => {
  const files = [
    "src/app/app/workspaces/page.tsx",
    "src/app/app/workspaces/[id]/page.tsx",
    "src/app/app/workspaces/[id]/members-list.tsx",
    "src/lib/auth/permission-builder.ts",
  ];
  const localConverterPattern =
    /role\s*===\s*"EDITOR"\s*\?\s*"editor"\s*:\s*"viewer"/;

  for (const relativePath of files) {
    const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
    assert.match(source, /persistedMemberRoleToEffectiveRole/);
    assert.equal(
      localConverterPattern.test(source),
      false,
      `local persisted-to-effective converter found in ${relativePath}`,
    );
  }
});

test("isInvitableWorkspaceRole matches the persisted member-role policy", () => {
  assert.equal(isInvitableWorkspaceRole("EDITOR"), true);
  assert.equal(isInvitableWorkspaceRole("VIEWER"), true);
  assert.equal(isInvitableWorkspaceRole("OWNER"), false);
  assert.equal(isInvitableWorkspaceRole("ADMIN"), false);
});
