/**
 * Unit tests for the workspace capability helper.
 *
 * Mirrors the document-permissions.test.ts pattern: DB-free, pure-function
 * tests covering every (role, capability) combination and all canonical actors.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertWorkspaceCapability,
  capabilitiesForWorkspaceRole,
  deriveWorkspaceRole,
  workspaceCapabilityAccessDecision,
  workspaceCapabilities,
  WorkspacePermissionError,
  type WorkspaceCapability,
  type WorkspaceRole,
  type WorkspaceRoleInput,
} from "./workspace-capabilities";

// ---------------------------------------------------------------------------
// Fixtures: four canonical actors.
// ---------------------------------------------------------------------------

const OWNER = "user-owner";
const EDITOR = "user-editor";
const VIEWER = "user-viewer";
const STRANGER = "user-stranger";

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

// ---------------------------------------------------------------------------
// deriveWorkspaceRole
// ---------------------------------------------------------------------------

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

test("deriveWorkspaceRole: OWNER-role member is treated as owner", () => {
  const ws: WorkspaceRoleInput = {
    ownerId: OWNER,
    members: [{ userId: "user-admin", role: "OWNER" }],
  };
  assert.equal(deriveWorkspaceRole(ws, "user-admin"), "owner");
});

test("deriveWorkspaceRole: unknown role string falls back to viewer", () => {
  const ws: WorkspaceRoleInput = {
    ownerId: OWNER,
    members: [{ userId: "user-x", role: "SUPERUSER" }],
  };
  assert.equal(deriveWorkspaceRole(ws, "user-x"), "viewer");
});

// ---------------------------------------------------------------------------
// capabilitiesForWorkspaceRole
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// workspaceCapabilities — end-to-end matrix
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// assertWorkspaceCapability — every (role, capability) combination
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

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
      members: [{ userId: "user-admin", role: "OWNER" as never }],
    },
    "user-admin",
  );

  assert.deepEqual(caps, {
    role: "owner",
    canView: true,
    canMutate: true,
    canManage: true,
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

// ---------------------------------------------------------------------------
// Action → capability contract (mirrors document-permissions.test.ts style)
// ---------------------------------------------------------------------------

const ACTION_CAPABILITY: Record<string, WorkspaceCapability> = {
  // Owner-only lifecycle mutations
  renameWorkspace: "manage",
  deleteWorkspace: "manage",
  transferOwnership: "manage",
  createInviteLink: "manage",
  revokeInviteLink: "manage",
  removeMember: "manage",
  // Document mutations (owner + editor)
  createWorkspaceDocument: "mutate",
  importWorkspaceDocument: "mutate",
  // Read-only
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
