import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertPersistedWorkspaceMemberRole,
  isInvitableWorkspaceRole,
  parsePersistedWorkspaceMemberRole,
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

test("isInvitableWorkspaceRole matches the persisted member-role policy", () => {
  assert.equal(isInvitableWorkspaceRole("EDITOR"), true);
  assert.equal(isInvitableWorkspaceRole("VIEWER"), true);
  assert.equal(isInvitableWorkspaceRole("OWNER"), false);
  assert.equal(isInvitableWorkspaceRole("ADMIN"), false);
});
