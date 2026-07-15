import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceRoleDataIntegrityError } from "@/lib/workspace/roles";

import {
  assertPlanLiteral,
  assertWorkspaceRoleLiteral,
  parseInvitableWorkspaceRoleLiteral,
  parsePlanLiteral,
  parseSubscriptionStatusLiteral,
  parseUsageLedgerStatusLiteral,
  parseVisualKindLiteral,
  parseWorkspaceRoleLiteral,
} from "./literals";

test("literal parsers accept current persisted enum values", () => {
  assert.deepEqual(parseWorkspaceRoleLiteral("EDITOR"), {
    success: true,
    value: "EDITOR",
  });
  assert.deepEqual(parseInvitableWorkspaceRoleLiteral("EDITOR"), {
    success: true,
    value: "EDITOR",
  });
  assert.deepEqual(parsePlanLiteral("plus"), { success: true, value: "plus" });
  assert.deepEqual(parseUsageLedgerStatusLiteral("refunded"), {
    success: true,
    value: "refunded",
  });
  assert.deepEqual(parseSubscriptionStatusLiteral("trialing"), {
    success: true,
    value: "trialing",
  });
  assert.deepEqual(parseVisualKindLiteral("flowchart"), {
    success: true,
    value: "flowchart",
  });
});

test("literal parsers reject superseded or malformed persisted values", () => {
  const ownerMembership = parseWorkspaceRoleLiteral("OWNER");
  assert.equal(ownerMembership.success, false);
  if (!ownerMembership.success) {
    assert.match(ownerMembership.error, /must not be OWNER/i);
  }
  assert.equal(parseWorkspaceRoleLiteral("ADMIN").success, false);
  assert.equal(parseWorkspaceRoleLiteral(null).success, false);
  assert.equal(parseInvitableWorkspaceRoleLiteral("OWNER").success, false);
  assert.equal(parsePlanLiteral("enterprise").success, false);
  assert.equal(parseUsageLedgerStatusLiteral("voided").success, false);
  assert.equal(parseSubscriptionStatusLiteral("paused").success, false);
  assert.equal(parseVisualKindLiteral("legacy").success, false);
});

test("literal assertions return valid values and throw parser errors", () => {
  assert.equal(assertWorkspaceRoleLiteral("VIEWER"), "VIEWER");
  assert.equal(assertPlanLiteral("free"), "free");
  assert.throws(
    () => assertWorkspaceRoleLiteral("ADMIN"),
    (error: unknown) =>
      error instanceof WorkspaceRoleDataIntegrityError &&
      error.code === "invalid-workspace-member-role",
  );
  assert.throws(
    () => assertWorkspaceRoleLiteral("OWNER"),
    (error: unknown) =>
      error instanceof WorkspaceRoleDataIntegrityError &&
      error.code === "owner-membership-row",
  );
  assert.throws(() => assertPlanLiteral("enterprise"), /Plan must be one of/);
});
