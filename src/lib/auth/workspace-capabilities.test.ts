/**
 * Unit tests for the workspace capability helper.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { prisma } from "@/lib/prisma";
import {
  capabilitiesForWorkspaceAccessRole,
  workspaceRoleCan,
} from "@/lib/workspace/capabilities";

import {
  assertWorkspaceCapability,
  capabilitiesForWorkspaceRole,
  deriveWorkspaceRole,
  requireWorkspaceCapability,
  workspaceCapabilityAccessDecision,
  workspaceCapabilities,
  WorkspacePermissionError,
  type WorkspaceCapability,
  type WorkspaceRole,
  type WorkspaceRoleInput,
} from "./workspace-capabilities";
import { RoleResolutionDataIntegrityError } from "./permission-builder";

const OWNER = "user-owner";
const EDITOR = "user-editor";
const VIEWER = "user-viewer";
const STRANGER = "user-stranger";

function stubPrismaMethod<T extends object, K extends keyof T>(
  t: { after: (fn: () => void) => void },
  object: T,
  methodName: K,
  implementation: (...args: unknown[]) => unknown,
): { calls: unknown[][] } {
  const original = object[methodName];
  const calls: unknown[][] = [];
  const wrapped = (...args: unknown[]) => {
    calls.push(args);
    return (implementation as (...args: unknown[]) => unknown)(...args);
  };
  Object.defineProperty(object, methodName, {
    value: wrapped,
    configurable: true,
  });
  t.after(() => {
    Object.defineProperty(object, methodName, {
      value: original,
      configurable: true,
    });
  });
  return { calls };
}

/** A workspace owned by OWNER with an editor and a viewer member. */
function workspace(): WorkspaceRoleInput {
  return {
    ownerId: OWNER,
    members: [
      { userId: EDITOR, role: "EDITOR" },
      { userId: VIEWER, role: "VIEWER" },
    ],
  };
}

/** A workspace with no members. */
function emptyWorkspace(): WorkspaceRoleInput {
  return { ownerId: OWNER, members: [] };
}

test("deriveWorkspaceRole: workspace owner is owner", () => {
  assert.equal(deriveWorkspaceRole(workspace(), OWNER), "owner");
  assert.equal(deriveWorkspaceRole(emptyWorkspace(), OWNER), "owner");
});

test("deriveWorkspaceRole: EDITOR member is editor", () => {
  assert.equal(deriveWorkspaceRole(workspace(), EDITOR), "editor");
});

test("deriveWorkspaceRole: VIEWER member is viewer", () => {
  assert.equal(deriveWorkspaceRole(workspace(), VIEWER), "viewer");
});

test("deriveWorkspaceRole: unrelated user has no role", () => {
  assert.equal(deriveWorkspaceRole(workspace(), STRANGER), "none");
  assert.equal(deriveWorkspaceRole(emptyWorkspace(), STRANGER), "none");
});

test("deriveWorkspaceRole: ownerId wins even when an owner membership row is malformed", () => {
  const ws: WorkspaceRoleInput = {
    ownerId: OWNER,
    members: [{ userId: OWNER, role: "OWNER" }],
  };
  assert.equal(deriveWorkspaceRole(ws, OWNER), "owner");
});

test("deriveWorkspaceRole: OWNER membership rows are rejected for non-owners", () => {
  const ws: WorkspaceRoleInput = {
    ownerId: OWNER,
    members: [{ userId: "user-admin", role: "OWNER" }],
  };
  assert.throws(
    () => deriveWorkspaceRole(ws, "user-admin"),
    RoleResolutionDataIntegrityError,
  );
});

test("deriveWorkspaceRole: unknown membership role strings are rejected", () => {
  const ws: WorkspaceRoleInput = {
    ownerId: OWNER,
    members: [{ userId: "user-x", role: "SUPERUSER" }],
  };
  assert.throws(
    () => deriveWorkspaceRole(ws, "user-x"),
    RoleResolutionDataIntegrityError,
  );
});

test("capabilitiesForWorkspaceRole: owner can view/mutate/manage", () => {
  assert.deepEqual(capabilitiesForWorkspaceRole("owner"), {
    role: "owner",
    canView: true,
    canMutate: true,
    canManage: true,
  });
});

test("capabilitiesForWorkspaceRole: editor can view/mutate but not manage", () => {
  assert.deepEqual(capabilitiesForWorkspaceRole("editor"), {
    role: "editor",
    canView: true,
    canMutate: true,
    canManage: false,
  });
});

test("capabilitiesForWorkspaceRole: viewer can only view", () => {
  assert.deepEqual(capabilitiesForWorkspaceRole("viewer"), {
    role: "viewer",
    canView: true,
    canMutate: false,
    canManage: false,
  });
});

test("capabilitiesForWorkspaceRole: none can do nothing", () => {
  assert.deepEqual(capabilitiesForWorkspaceRole("none"), {
    role: "none",
    canView: false,
    canMutate: false,
    canManage: false,
  });
});

test("workspace capability map stays in parity with UI capability helpers", () => {
  const roles: WorkspaceRole[] = ["owner", "editor", "viewer", "none"];
  for (const role of roles) {
    assert.deepEqual(capabilitiesForWorkspaceRole(role), {
      role,
      ...capabilitiesForWorkspaceAccessRole(role),
    });
  }
});

test("workspace capability decisions stay in parity with canonical role decision helper", () => {
  const roles: WorkspaceRole[] = ["owner", "editor", "viewer", "none"];
  const capabilities: WorkspaceCapability[] = ["view", "mutate", "manage"];
  for (const role of roles) {
    for (const capability of capabilities) {
      const decision = workspaceCapabilityAccessDecision(
        capabilitiesForWorkspaceRole(role),
        capability,
      );
      assert.equal(
        decision.allow,
        workspaceRoleCan(role, capability),
        `${role}:${capability}`,
      );
    }
  }
});

test("permission-builder output matches canonical capability matrix for every role and capability", () => {
  // Verifies that permission-builder delegates to the canonical policy and
  // does not maintain an independent role→capability algorithm.
  const roles: WorkspaceRole[] = ["owner", "editor", "viewer", "none"];
  const capabilityKeys: WorkspaceCapability[] = ["view", "mutate", "manage"];
  for (const role of roles) {
    const caps = capabilitiesForWorkspaceRole(role);
    const canonical = capabilitiesForWorkspaceAccessRole(role);
    assert.equal(caps.canView, canonical.canView, `${role}: canView`);
    assert.equal(caps.canMutate, canonical.canMutate, `${role}: canMutate`);
    assert.equal(caps.canManage, canonical.canManage, `${role}: canManage`);
    for (const capability of capabilityKeys) {
      const decision = workspaceCapabilityAccessDecision(caps, capability);
      assert.equal(
        decision.allow,
        workspaceRoleCan(role, capability),
        `permission-builder decision ${role}:${capability} must match canonical workspaceRoleCan`,
      );
    }
  }
});

const EXPECTED: Record<
  string,
  {
    role: WorkspaceRole;
    canView: boolean;
    canMutate: boolean;
    canManage: boolean;
  }
> = {
  [OWNER]: { role: "owner", canView: true, canMutate: true, canManage: true },
  [EDITOR]: {
    role: "editor",
    canView: true,
    canMutate: true,
    canManage: false,
  },
  [VIEWER]: {
    role: "viewer",
    canView: true,
    canMutate: false,
    canManage: false,
  },
  [STRANGER]: {
    role: "none",
    canView: false,
    canMutate: false,
    canManage: false,
  },
};

for (const [userId, expected] of Object.entries(EXPECTED)) {
  test(`workspaceCapabilities: ${userId} → ${expected.role}`, () => {
    assert.deepEqual(workspaceCapabilities(workspace(), userId), expected);
  });
}

type Allowed = { view: boolean; mutate: boolean; manage: boolean };

const ALLOWED: Record<WorkspaceRole, Allowed> = {
  owner: { view: true, mutate: true, manage: true },
  editor: { view: true, mutate: true, manage: false },
  viewer: { view: true, mutate: false, manage: false },
  none: { view: false, mutate: false, manage: false },
};

const CAPABILITIES: WorkspaceCapability[] = ["view", "mutate", "manage"];

for (const role of Object.keys(ALLOWED) as WorkspaceRole[]) {
  for (const capability of CAPABILITIES) {
    const allowed = ALLOWED[role][capability];
    test(`assertWorkspaceCapability: ${role} ${allowed ? "may" : "may not"} ${capability}`, () => {
      const caps = capabilitiesForWorkspaceRole(role);
      if (allowed) {
        assert.doesNotThrow(() => assertWorkspaceCapability(caps, capability));
      } else {
        assert.throws(
          () => assertWorkspaceCapability(caps, capability),
          WorkspacePermissionError,
        );
      }
    });
  }
}

test("assertWorkspaceCapability: no-access error says 'Workspace not found.' with null capability", () => {
  const caps = capabilitiesForWorkspaceRole("none");
  try {
    assertWorkspaceCapability(caps, "view");
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof WorkspacePermissionError);
    assert.equal(error.message, "Workspace not found.");
    assert.equal(error.capability, null);
    assert.equal(error.accessDecision?.reason, "resource-not-found");
    assert.equal(error.accessDecision?.status, 404);
    assert.equal(error.accessDecision?.concealResource, true);
  }
});

test("WorkspacePermissionError preserves capability and access decision fields", () => {
  const accessDecision = workspaceCapabilityAccessDecision(
    capabilitiesForWorkspaceRole("editor"),
    "manage",
  );
  if (accessDecision.allow) {
    throw new Error("Expected manage decision to be denied for editor.");
  }
  const error = new WorkspacePermissionError(
    "Only the workspace owner may perform this action.",
    "manage",
    accessDecision,
  );

  assert.equal(error.name, "WorkspacePermissionError");
  assert.equal(error.capability, "manage");
  assert.equal(error.accessDecision, accessDecision);
});

test("workspaceCapabilities combines role derivation with capability flags", () => {
  const caps = workspaceCapabilities(
    {
      ownerId: OWNER,
      members: [{ userId: "user-member", role: "EDITOR" }],
    },
    "user-member",
  );

  assert.deepEqual(caps, {
    role: "editor",
    canView: true,
    canMutate: true,
    canManage: false,
  });
});

test("assertWorkspaceCapability: viewer mutate denial carries a clear message", () => {
  const caps = capabilitiesForWorkspaceRole("viewer");
  try {
    assertWorkspaceCapability(caps, "mutate");
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof WorkspacePermissionError);
    assert.match(error.message, /owners and editors/);
    assert.equal(error.capability, "mutate");
    assert.equal(error.accessDecision?.reason, "insufficient-capability");
    assert.equal(error.accessDecision?.status, 403);
  }
});

test("assertWorkspaceCapability: editor manage denial carries a clear message", () => {
  const caps = capabilitiesForWorkspaceRole("editor");
  try {
    assertWorkspaceCapability(caps, "manage");
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof WorkspacePermissionError);
    assert.match(error.message, /only the workspace owner/i);
    assert.equal(error.capability, "manage");
    assert.equal(error.accessDecision?.reason, "insufficient-capability");
    assert.equal(error.accessDecision?.status, 403);
  }
});

test("workspaceCapabilityAccessDecision maps workspace denials to taxonomy", () => {
  assert.deepEqual(
    workspaceCapabilityAccessDecision(
      capabilitiesForWorkspaceRole("none"),
      "view",
    ),
    {
      allow: false,
      resource: { kind: "workspace" },
      capability: "view",
      reason: "resource-not-found",
      status: 404,
      safeMessage: "Workspace not found.",
      concealResource: true,
    },
  );
  assert.deepEqual(
    workspaceCapabilityAccessDecision(
      capabilitiesForWorkspaceRole("viewer"),
      "mutate",
    ),
    {
      allow: false,
      resource: { kind: "workspace" },
      capability: "mutate",
      reason: "insufficient-capability",
      status: 403,
      safeMessage:
        "Only workspace owners and editors may create or import documents.",
      concealResource: false,
    },
  );
  assert.deepEqual(
    workspaceCapabilityAccessDecision(
      capabilitiesForWorkspaceRole("owner"),
      "manage",
    ),
    { allow: true, resource: { kind: "workspace" }, capability: "manage" },
  );
});

const ACTION_CAPABILITY: Record<string, WorkspaceCapability> = {
  renameWorkspace: "manage",
  deleteWorkspace: "manage",
  transferOwnership: "manage",
  createInviteLink: "manage",
  revokeInviteLink: "manage",
  removeMember: "manage",
  createWorkspaceDocument: "mutate",
  importWorkspaceDocument: "mutate",
  getWorkspaceDocuments: "view",
};

for (const [action, capability] of Object.entries(ACTION_CAPABILITY)) {
  test(`${action} (requires ${capability}): gating for owner/editor/viewer/stranger`, () => {
    const ownerCaps = workspaceCapabilities(workspace(), OWNER);
    assert.doesNotThrow(() => assertWorkspaceCapability(ownerCaps, capability));

    const editorCaps = workspaceCapabilities(workspace(), EDITOR);
    if (capability === "manage") {
      assert.throws(
        () => assertWorkspaceCapability(editorCaps, capability),
        WorkspacePermissionError,
      );
    } else {
      assert.doesNotThrow(() =>
        assertWorkspaceCapability(editorCaps, capability),
      );
    }

    const viewerCaps = workspaceCapabilities(workspace(), VIEWER);
    if (capability === "view") {
      assert.doesNotThrow(() =>
        assertWorkspaceCapability(viewerCaps, capability),
      );
    } else {
      assert.throws(
        () => assertWorkspaceCapability(viewerCaps, capability),
        WorkspacePermissionError,
      );
    }

    const strangerCaps = workspaceCapabilities(workspace(), STRANGER);
    assert.throws(
      () => assertWorkspaceCapability(strangerCaps, capability),
      (error: unknown) =>
        error instanceof WorkspacePermissionError &&
        error.message === "Workspace not found.",
    );
  });
}

test("requireWorkspaceCapability surfaces invalid persisted membership rows as invalid-role denials", async (t) => {
  stubPrismaMethod(t, prisma.workspace, "findUnique", async () => ({
    id: "ws-1",
    ownerId: OWNER,
    members: [{ userId: "user-bad", role: "OWNER" }],
  }));

  await assert.rejects(
    () => requireWorkspaceCapability("user-bad", "ws-1", "view"),
    (error: unknown) =>
      error instanceof WorkspacePermissionError &&
      error.capability === "view" &&
      error.accessDecision?.reason === "invalid-role",
  );
});

test("requireWorkspaceCapability keeps owner access when ownerId matches, even if a malformed owner membership row exists", async (t) => {
  stubPrismaMethod(t, prisma.workspace, "findUnique", async () => ({
    id: "ws-1",
    ownerId: OWNER,
    members: [{ userId: OWNER, role: "OWNER" }],
  }));

  const result = await requireWorkspaceCapability(OWNER, "ws-1", "manage");
  assert.equal(result.role, "owner");
  assert.equal(result.canManage, true);
});
