import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  capabilitiesForWorkspaceAccessRole,
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

test("capabilitiesForWorkspaceAccessRole covers every access role without throwing", () => {
  const roles: WorkspaceAccessRole[] = ["owner", "editor", "viewer", "none"];
  for (const role of roles) {
    assert.doesNotThrow(() => capabilitiesForWorkspaceAccessRole(role));
  }
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

test("returned capability flags are runtime-frozen: direct assignment cannot escalate viewer", () => {
  const flags = capabilitiesForWorkspaceAccessRole("viewer");
  // Assignment to a frozen property throws in strict mode; we absorb the error.
  try {
    (flags as { canManage: boolean }).canManage = true;
  } catch {
    // TypeError expected in strict mode — the mutation was rejected.
  }
  assert.equal(
    capabilitiesForWorkspaceAccessRole("viewer").canManage,
    false,
    "viewer canManage must remain false after direct-assignment attempt",
  );
  assert.equal(
    workspaceRoleCan("viewer", "manage"),
    false,
    "workspaceRoleCan must remain false after direct-assignment attempt",
  );
});

test("returned capability flags are runtime-frozen: Reflect.defineProperty cannot escalate viewer", () => {
  const flags = capabilitiesForWorkspaceAccessRole("viewer");
  // Reflect.defineProperty on a frozen object returns false and throws in strict mode.
  try {
    Reflect.defineProperty(flags, "canManage", {
      value: true,
      writable: true,
      configurable: true,
    });
  } catch {
    // TypeError expected — mutation was rejected.
  }
  assert.equal(
    capabilitiesForWorkspaceAccessRole("viewer").canManage,
    false,
    "viewer canManage must remain false after Reflect.defineProperty attempt",
  );
  assert.equal(
    capabilitiesForWorkspaceAccessRole("viewer").canView,
    true,
    "viewer canView must remain true after Reflect.defineProperty attempt",
  );
  assert.equal(
    capabilitiesForWorkspaceAccessRole("viewer").canMutate,
    false,
    "viewer canMutate must remain false after Reflect.defineProperty attempt",
  );
});

test("canonical flags are frozen: owner/editor/none immutability is preserved after viewer mutation attempt", () => {
  // Confirm mutation attempts on one role do not contaminate others.
  try {
    (
      capabilitiesForWorkspaceAccessRole("viewer") as {
        canManage: boolean;
      }
    ).canManage = true;
  } catch {
    // expected
  }
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
  assert.deepEqual(capabilitiesForWorkspaceAccessRole("none"), {
    canView: false,
    canMutate: false,
    canManage: false,
  });
});
