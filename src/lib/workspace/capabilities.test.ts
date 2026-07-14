import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capabilitiesForEffectiveWorkspaceRole,
  capabilitiesForWorkspaceAccessRole,
  WORKSPACE_CAPABILITIES_BY_EFFECTIVE_ROLE,
  type WorkspaceAccessRole,
} from "./capabilities";

test("capabilitiesForEffectiveWorkspaceRole maps owner/editor/viewer exactly", () => {
  assert.deepEqual(capabilitiesForEffectiveWorkspaceRole("owner"), {
    canView: true,
    canMutate: true,
    canManage: true,
  });
  assert.deepEqual(capabilitiesForEffectiveWorkspaceRole("editor"), {
    canView: true,
    canMutate: true,
    canManage: false,
  });
  assert.deepEqual(capabilitiesForEffectiveWorkspaceRole("viewer"), {
    canView: true,
    canMutate: false,
    canManage: false,
  });
});

test("capabilitiesForWorkspaceAccessRole denies all capabilities for none", () => {
  assert.deepEqual(capabilitiesForWorkspaceAccessRole("none"), {
    canView: false,
    canMutate: false,
    canManage: false,
  });
});

test("WORKSPACE_CAPABILITIES_BY_EFFECTIVE_ROLE stays exhaustive for effective roles", () => {
  const roles: WorkspaceAccessRole[] = ["owner", "editor", "viewer", "none"];
  for (const role of roles) {
    assert.doesNotThrow(() => capabilitiesForWorkspaceAccessRole(role));
  }
  assert.deepEqual(
    Object.keys(WORKSPACE_CAPABILITIES_BY_EFFECTIVE_ROLE).sort(),
    ["editor", "owner", "viewer"],
  );
});
