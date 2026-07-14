import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertCapability,
  capabilitiesForRole,
  deriveDocumentRole,
  documentCapabilityAccessDecision,
  documentCapabilities,
  DocumentPermissionError,
  getDocumentCapabilities,
  requireDocumentCapability,
  type Capability,
  type DocumentRole,
  type DocumentRoleInput,
} from "./document-permissions";
import { prisma } from "@/lib/prisma";
import { RoleResolutionDataIntegrityError } from "./permission-builder";

// ---------------------------------------------------------------------------
// Fixtures: four canonical actors against one workspace document.
// ---------------------------------------------------------------------------

const OWNER = "user-owner";
const WS_OWNER = "user-ws-owner";
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

function firstCallArg<T>(stub: { calls: unknown[][] }): T {
  const arg = stub.calls[0]?.[0];
  assert.ok(arg, "expected stub to record at least one call");
  return arg as T;
}

/** A workspace document owned by OWNER, in a workspace owned by WS_OWNER. */
function workspaceDoc(): DocumentRoleInput {
  return {
    ownerId: OWNER,
    workspaceId: "ws-1",
    workspace: {
      ownerId: WS_OWNER,
      members: [
        { userId: EDITOR, role: "EDITOR" },
        { userId: VIEWER, role: "VIEWER" },
      ],
    },
  };
}

/** A personal document (no workspace) owned by OWNER. */
function personalDoc(): DocumentRoleInput {
  return { ownerId: OWNER, workspaceId: null, workspace: null };
}

// ---------------------------------------------------------------------------
// deriveDocumentRole
// ---------------------------------------------------------------------------

test("deriveDocumentRole: document owner is owner", () => {
  assert.equal(deriveDocumentRole(workspaceDoc(), OWNER), "owner");
  assert.equal(deriveDocumentRole(personalDoc(), OWNER), "owner");
});

test("deriveDocumentRole: workspace owner is owner", () => {
  assert.equal(deriveDocumentRole(workspaceDoc(), WS_OWNER), "owner");
});

test("deriveDocumentRole: EDITOR member is editor", () => {
  assert.equal(deriveDocumentRole(workspaceDoc(), EDITOR), "editor");
});

test("deriveDocumentRole: VIEWER member is viewer", () => {
  assert.equal(deriveDocumentRole(workspaceDoc(), VIEWER), "viewer");
});

test("deriveDocumentRole: unrelated user has no role", () => {
  assert.equal(deriveDocumentRole(workspaceDoc(), STRANGER), "none");
  assert.equal(deriveDocumentRole(personalDoc(), STRANGER), "none");
});

test("deriveDocumentRole: ownerId wins even when an owner membership row exists for that same user", () => {
  const doc: DocumentRoleInput = {
    ownerId: OWNER,
    workspaceId: "ws-1",
    workspace: {
      ownerId: WS_OWNER,
      members: [{ userId: OWNER, role: "OWNER" }],
    },
  };
  assert.equal(deriveDocumentRole(doc, OWNER), "owner");
});

test("deriveDocumentRole: OWNER membership rows are rejected for non-owners", () => {
  const doc: DocumentRoleInput = {
    ownerId: OWNER,
    workspaceId: "ws-1",
    workspace: {
      ownerId: WS_OWNER,
      members: [{ userId: "user-admin", role: "OWNER" }],
    },
  };
  assert.throws(
    () => deriveDocumentRole(doc, "user-admin"),
    RoleResolutionDataIntegrityError,
  );
});

test("deriveDocumentRole: unknown role strings are rejected", () => {
  const doc: DocumentRoleInput = {
    ownerId: OWNER,
    workspaceId: "ws-1",
    workspace: {
      ownerId: WS_OWNER,
      members: [{ userId: "user-x", role: "SUPERUSER" }],
    },
  };
  assert.throws(
    () => deriveDocumentRole(doc, "user-x"),
    RoleResolutionDataIntegrityError,
  );
});

test("deriveDocumentRole: workspaceId set but workspace null yields none for non-owner", () => {
  const doc: DocumentRoleInput = {
    ownerId: OWNER,
    workspaceId: "ws-1",
    workspace: null,
  };
  assert.equal(deriveDocumentRole(doc, STRANGER), "none");
  assert.equal(deriveDocumentRole(doc, OWNER), "owner");
});

// ---------------------------------------------------------------------------
// capabilitiesForRole
// ---------------------------------------------------------------------------

test("capabilitiesForRole: owner can view/edit/manage", () => {
  assert.deepEqual(capabilitiesForRole("owner"), {
    role: "owner",
    canView: true,
    canEdit: true,
    canManage: true,
  });
});

test("capabilitiesForRole: editor can view/edit but not manage", () => {
  assert.deepEqual(capabilitiesForRole("editor"), {
    role: "editor",
    canView: true,
    canEdit: true,
    canManage: false,
  });
});

test("capabilitiesForRole: viewer can only view", () => {
  assert.deepEqual(capabilitiesForRole("viewer"), {
    role: "viewer",
    canView: true,
    canEdit: false,
    canManage: false,
  });
});

test("capabilitiesForRole: none can do nothing", () => {
  assert.deepEqual(capabilitiesForRole("none"), {
    role: "none",
    canView: false,
    canEdit: false,
    canManage: false,
  });
});

// ---------------------------------------------------------------------------
// documentCapabilities — end-to-end role → capabilities matrix.
// ---------------------------------------------------------------------------

const EXPECTED: Record<
  string,
  { role: DocumentRole; canView: boolean; canEdit: boolean; canManage: boolean }
> = {
  [OWNER]: { role: "owner", canView: true, canEdit: true, canManage: true },
  [WS_OWNER]: { role: "owner", canView: true, canEdit: true, canManage: true },
  [EDITOR]: { role: "editor", canView: true, canEdit: true, canManage: false },
  [VIEWER]: { role: "viewer", canView: true, canEdit: false, canManage: false },
  [STRANGER]: {
    role: "none",
    canView: false,
    canEdit: false,
    canManage: false,
  },
};

for (const [userId, expected] of Object.entries(EXPECTED)) {
  test(`documentCapabilities: ${userId} → ${expected.role}`, () => {
    assert.deepEqual(documentCapabilities(workspaceDoc(), userId), expected);
  });
}

// ---------------------------------------------------------------------------
// assertCapability — every (role, capability) combination.
// ---------------------------------------------------------------------------

type Allowed = { view: boolean; edit: boolean; manage: boolean };

const ALLOWED: Record<DocumentRole, Allowed> = {
  owner: { view: true, edit: true, manage: true },
  editor: { view: true, edit: true, manage: false },
  viewer: { view: true, edit: false, manage: false },
  none: { view: false, edit: false, manage: false },
};

const CAPABILITIES: Capability[] = ["view", "edit", "manage"];

for (const role of Object.keys(ALLOWED) as DocumentRole[]) {
  for (const capability of CAPABILITIES) {
    const allowed = ALLOWED[role][capability];
    test(`assertCapability: ${role} ${allowed ? "may" : "may not"} ${capability}`, () => {
      const caps = capabilitiesForRole(role);
      if (allowed) {
        assert.doesNotThrow(() => assertCapability(caps, capability));
      } else {
        assert.throws(
          () => assertCapability(caps, capability),
          DocumentPermissionError,
        );
      }
    });
  }
}

test("assertCapability: no-access errors say 'Document not found.' with null capability", () => {
  const caps = capabilitiesForRole("none");
  try {
    assertCapability(caps, "view");
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof DocumentPermissionError);
    assert.equal(error.message, "Document not found.");
    assert.equal(error.capability, null);
    assert.equal(error.accessDecision?.reason, "resource-not-found");
    assert.equal(error.accessDecision?.status, 404);
    assert.equal(error.accessDecision?.concealResource, true);
  }
});

test("assertCapability: viewer edit denial carries a clear permission message", () => {
  const caps = capabilitiesForRole("viewer");
  try {
    assertCapability(caps, "edit");
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof DocumentPermissionError);
    assert.match(error.message, /permission to edit/);
    assert.equal(error.capability, "edit");
    assert.equal(error.accessDecision?.reason, "insufficient-capability");
    assert.equal(error.accessDecision?.status, 403);
  }
});

test("assertCapability: editor manage denial carries a clear permission message", () => {
  const caps = capabilitiesForRole("editor");
  try {
    assertCapability(caps, "manage");
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof DocumentPermissionError);
    assert.match(error.message, /permission to manage/);
    assert.equal(error.capability, "manage");
    assert.equal(error.accessDecision?.reason, "insufficient-capability");
    assert.equal(error.accessDecision?.status, 403);
  }
});

test("documentCapabilityAccessDecision maps document denials to taxonomy", () => {
  assert.deepEqual(
    documentCapabilityAccessDecision(capabilitiesForRole("none"), "view"),
    {
      allow: false,
      resource: { kind: "document" },
      capability: "view",
      reason: "resource-not-found",
      status: 404,
      safeMessage: "Document not found.",
      concealResource: true,
    },
  );
  assert.deepEqual(
    documentCapabilityAccessDecision(capabilitiesForRole("viewer"), "edit"),
    {
      allow: false,
      resource: { kind: "document" },
      capability: "edit",
      reason: "insufficient-capability",
      status: 403,
      safeMessage: "You do not have permission to edit this document.",
      concealResource: false,
    },
  );
  assert.deepEqual(
    documentCapabilityAccessDecision(capabilitiesForRole("owner"), "manage"),
    { allow: true, resource: { kind: "document" }, capability: "manage" },
  );
});

test("getDocumentCapabilities returns none when the document is absent", async (t) => {
  const findUnique = stubPrismaMethod(
    t,
    prisma.document,
    "findUnique",
    async () => null,
  );

  const result = await getDocumentCapabilities("user-1", "missing-doc");

  assert.deepEqual(result, { ...capabilitiesForRole("none"), document: null });
  assert.deepEqual(firstCallArg<{ where: { id: string } }>(findUnique).where, {
    id: "missing-doc",
  });
});

test("getDocumentCapabilities hides soft-deleted rows unless requested", async (t) => {
  stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
    id: "doc-1",
    ownerId: "user-1",
    workspaceId: null,
    deletedAt: new Date("2026-01-01T00:00:00Z"),
    workspace: null,
  }));

  assert.deepEqual(await getDocumentCapabilities("user-1", "doc-1"), {
    ...capabilitiesForRole("none"),
    document: null,
  });
  assert.deepEqual(
    await getDocumentCapabilities("user-1", "doc-1", { includeDeleted: true }),
    {
      ...capabilitiesForRole("owner"),
      document: { id: "doc-1", ownerId: "user-1", workspaceId: null },
    },
  );
});

test("requireDocumentCapability returns identity on success and typed denial on missing document", async (t) => {
  stubPrismaMethod(t, prisma.document, "findUnique", async (args) => {
    const { where } = args as { where: { id: string } };
    return where.id === "doc-1"
      ? {
          id: "doc-1",
          ownerId: "user-1",
          workspaceId: null,
          deletedAt: null,
          workspace: null,
        }
      : null;
  });

  const allowed = await requireDocumentCapability("user-1", "doc-1", "manage");
  assert.deepEqual(allowed.document, {
    id: "doc-1",
    ownerId: "user-1",
    workspaceId: null,
  });
  assert.equal(allowed.canManage, true);

  await assert.rejects(
    () => requireDocumentCapability("user-1", "missing", "view"),
    (error) =>
      error instanceof DocumentPermissionError &&
      error.capability === null &&
      error.accessDecision?.reason === "resource-not-found",
  );
});

test("requireDocumentCapability surfaces invalid persisted workspace membership roles as invalid-role denials", async (t) => {
  stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
    id: "doc-1",
    ownerId: "owner-1",
    workspaceId: "ws-1",
    deletedAt: null,
    workspace: {
      ownerId: "owner-1",
      members: [{ userId: "user-2", role: "OWNER" }],
    },
  }));

  await assert.rejects(
    () => requireDocumentCapability("user-2", "doc-1", "view"),
    (error: unknown) =>
      error instanceof DocumentPermissionError &&
      error.capability === "view" &&
      error.accessDecision?.reason === "invalid-role",
  );
});

// ---------------------------------------------------------------------------
// Action → capability contract: encode each mutating document action's required
// capability and assert that the four canonical actors are gated correctly.
// This is the regression guard for issue #89 AC #2/#3/#4.
// ---------------------------------------------------------------------------

const ACTION_CAPABILITY: Record<string, Capability> = {
  // Dashboard (src/app/app/actions.ts)
  renameDocument: "edit",
  toggleFavorite: "edit",
  duplicateDocument: "view",
  deleteDocument: "manage",
  restoreDocument: "manage",
  // Editor (lexical-actions.ts / sharing-actions.ts / deck-actions.ts / versioning-actions.ts)
  rebuildVisualMirror: "edit",
  fetchDeckJson: "view",
  saveDocumentLexical: "edit",
  saveDeckJson: "edit",
  toggleDocumentSharing: "manage",
  regenerateShareLink: "manage",
  updateSharePolicy: "manage",
  listDocumentVersions: "view",
  restoreDocumentVersion: "edit",
  // Tags (src/app/app/documents/[id]/tags-actions.ts)
  addTag: "edit",
  removeTag: "edit",
  // Comments (src/app/app/documents/[id]/comments-actions.ts)
  listComments: "view",
  createComment: "view",
  setCommentResolved: "view",
  // Slide assets
  uploadSlideAsset: "edit",
};

test("deck action capability map exposes only the full-deck save entry point", () => {
  assert.equal(ACTION_CAPABILITY.saveDeckJson, "edit");
  assert.equal("saveDeckPatch" in ACTION_CAPABILITY, false);
  assert.equal("saveDeckCommand" in ACTION_CAPABILITY, false);
});

for (const [action, capability] of Object.entries(ACTION_CAPABILITY)) {
  test(`${action} (requires ${capability}): owner & editor/viewer gating`, () => {
    const caps = documentCapabilities(workspaceDoc(), OWNER);
    // Owner is allowed every action.
    assert.doesNotThrow(() => assertCapability(caps, capability));

    // Editor is allowed everything except manage actions.
    const editorCaps = documentCapabilities(workspaceDoc(), EDITOR);
    if (capability === "manage") {
      assert.throws(
        () => assertCapability(editorCaps, capability),
        DocumentPermissionError,
      );
    } else {
      assert.doesNotThrow(() => assertCapability(editorCaps, capability));
    }

    // Viewer is allowed only view actions.
    const viewerCaps = documentCapabilities(workspaceDoc(), VIEWER);
    if (capability === "view") {
      assert.doesNotThrow(() => assertCapability(viewerCaps, capability));
    } else {
      assert.throws(
        () => assertCapability(viewerCaps, capability),
        DocumentPermissionError,
      );
    }

    // Unrelated user is denied every action with "Document not found."
    const strangerCaps = documentCapabilities(workspaceDoc(), STRANGER);
    assert.throws(
      () => assertCapability(strangerCaps, capability),
      (error: unknown) =>
        error instanceof DocumentPermissionError &&
        error.message === "Document not found.",
    );
  });
}
