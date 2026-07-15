import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  capabilitiesForWorkspaceAccessRole,
  WORKSPACE_CAPABILITIES_BY_ROLE,
  type WorkspaceAccessRole,
  type WorkspaceCapabilityMode,
  workspaceRoleCan,
} from "./capabilities";

test("capabilitiesForWorkspaceAccessRole maps every role to canonical flags", () => {
  assert.deepEqual(capabilitiesForWorkspaceAccessRole("owner"), {
    canView: true,
    canMutate: true,
    canManage: true,
  });
  assert.deepEqual(capabilitiesForWorkspaceAccessRole("editor"), {
    canView: true,
    canMutate: true,
    canManage: false,
  });
  assert.deepEqual(capabilitiesForWorkspaceAccessRole("viewer"), {
    canView: true,
    canMutate: false,
    canManage: false,
  });
  assert.deepEqual(capabilitiesForWorkspaceAccessRole("none"), {
    canView: false,
    canMutate: false,
    canManage: false,
  });
});

test("WORKSPACE_CAPABILITIES_BY_ROLE stays exhaustive for all access roles", () => {
  const roles: WorkspaceAccessRole[] = ["owner", "editor", "viewer", "none"];
  for (const role of roles) {
    assert.doesNotThrow(() => capabilitiesForWorkspaceAccessRole(role));
  }
  assert.deepEqual(Object.keys(WORKSPACE_CAPABILITIES_BY_ROLE).sort(), [
    "editor",
    "none",
    "owner",
    "viewer",
  ]);
});

test("workspaceRoleCan stays consistent with capability flags", () => {
  const roles: WorkspaceAccessRole[] = ["owner", "editor", "viewer", "none"];
  const capabilities: WorkspaceCapabilityMode[] = ["view", "mutate", "manage"];

  for (const role of roles) {
    const flags = capabilitiesForWorkspaceAccessRole(role);
    for (const capability of capabilities) {
      const expected =
        capability === "view"
          ? flags.canView
          : capability === "mutate"
            ? flags.canMutate
            : flags.canManage;
      assert.equal(workspaceRoleCan(role, capability), expected);
    }
  }
});

test("auth and UI callers consume canonical workspace capability helpers", () => {
  const authSource = readFileSync(
    resolve(process.cwd(), "src/lib/auth/workspace-capabilities.ts"),
    "utf8",
  );
  const uiSource = readFileSync(
    resolve(
      process.cwd(),
      "src/app/app/workspaces/[id]/workspace-documents.tsx",
    ),
    "utf8",
  );

  assert.match(authSource, /capabilitiesForWorkspaceAccessRole/);
  assert.match(authSource, /workspaceRoleCan/);
  assert.match(uiSource, /capabilitiesForWorkspaceAccessRole/);

  const inlineCapabilityMapPattern =
    /owner:\s*\{\s*canView:\s*true,\s*canMutate:\s*true,\s*canManage:\s*true/;
  assert.equal(
    inlineCapabilityMapPattern.test(authSource),
    false,
    "auth workspace capabilities should not redefine the role capability map",
  );
  assert.equal(
    inlineCapabilityMapPattern.test(uiSource),
    false,
    "workspace UI should not redefine the role capability map",
  );
});
