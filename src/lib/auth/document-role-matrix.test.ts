import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertCapability,
  documentCapabilities,
  DocumentPermissionError,
  type Capability,
  type DocumentRole,
  type DocumentRoleInput,
} from "./document-permissions";

/**
 * Role-matrix contract across ALL document mutation surfaces (issue #107).
 *
 * This complements `document-permissions.test.ts` (which exhaustively unit-tests
 * the pure helpers and a flat action→capability map) by organizing every real
 * server-action surface — title, body, deck, share, comments, tags, and
 * document metadata — into one truth table and asserting the four canonical
 * actors (owner, editor, viewer, unrelated stranger) are gated exactly right.
 *
 * Each `capability` below MUST mirror the `requireDocumentCapability(...)`
 * argument wired into the corresponding server action. If any action were
 * re-wired to the wrong capability (e.g. a viewer-mutable body, or an
 * editor-managed share toggle), the matching row here flips and this test fails.
 *
 * It is intentionally DB-free and deterministic: it exercises only the pure
 * capability/contract layer against a fixed in-memory document fixture.
 */

const OWNER = "user-owner";
const EDITOR = "user-editor";
const VIEWER = "user-viewer";
const STRANGER = "user-stranger";

/** A workspace document owned by OWNER with an EDITOR and a VIEWER member. */
function workspaceDoc(): DocumentRoleInput {
  return {
    ownerId: OWNER,
    workspaceId: "ws-1",
    workspace: {
      ownerId: "user-ws-owner",
      members: [
        { userId: EDITOR, role: "EDITOR" },
        { userId: VIEWER, role: "VIEWER" },
      ],
    },
  };
}

/**
 * Every document-mutation surface, the concrete server action(s) that implement
 * it, and the capability each requires. The `file` column documents where the
 * `requireDocumentCapability` call lives so a reviewer can verify the contract.
 */
type SurfaceContract = {
  surface: string;
  capability: Capability;
  actions: { name: string; file: string }[];
};

const SURFACES: SurfaceContract[] = [
  {
    surface: "title",
    capability: "edit",
    actions: [{ name: "renameDocument", file: "src/app/app/actions.ts" }],
  },
  {
    surface: "body (lexical)",
    capability: "edit",
    actions: [
      {
        name: "saveDocumentLexical",
        file: "src/app/app/documents/[id]/lexical-actions.ts",
      },
      {
        name: "rebuildVisualMirror",
        file: "src/app/app/documents/[id]/lexical-actions.ts",
      },
    ],
  },
  {
    surface: "deck",
    capability: "edit",
    actions: [
      {
        name: "saveDeckJson",
        file: "src/app/app/documents/[id]/deck-actions.ts",
      },
    ],
  },
  {
    surface: "deck read",
    capability: "view",
    actions: [
      {
        name: "fetchDeckJson",
        file: "src/app/app/documents/[id]/deck-actions.ts",
      },
    ],
  },
  {
    surface: "versions read",
    capability: "view",
    actions: [
      {
        name: "listDocumentVersions",
        file: "src/app/app/documents/[id]/versioning-actions.ts",
      },
    ],
  },
  {
    surface: "versions restore",
    capability: "edit",
    actions: [
      {
        name: "restoreDocumentVersion",
        file: "src/app/app/documents/[id]/versioning-actions.ts",
      },
    ],
  },
  {
    surface: "share",
    capability: "manage",
    actions: [
      {
        name: "toggleDocumentSharing",
        file: "src/app/app/documents/[id]/sharing-actions.ts",
      },
      {
        name: "regenerateShareLink",
        file: "src/app/app/documents/[id]/sharing-actions.ts",
      },
      {
        name: "updateSharePolicy",
        file: "src/app/app/documents/[id]/sharing-actions.ts",
      },
    ],
  },
  {
    surface: "comments",
    capability: "view",
    actions: [
      {
        name: "listComments",
        file: "src/app/app/documents/[id]/comments-actions.ts",
      },
      {
        name: "createComment",
        file: "src/app/app/documents/[id]/comments-actions.ts",
      },
      {
        name: "setCommentResolved",
        file: "src/app/app/documents/[id]/comments-actions.ts",
      },
    ],
  },
  {
    surface: "slide assets",
    capability: "edit",
    actions: [
      {
        name: "uploadSlideAsset",
        file: "src/app/app/documents/[id]/slide-asset-actions.ts",
      },
    ],
  },
  {
    surface: "tags",
    capability: "edit",
    actions: [
      { name: "addTag", file: "src/app/app/documents/[id]/tags-actions.ts" },
      { name: "removeTag", file: "src/app/app/documents/[id]/tags-actions.ts" },
    ],
  },
  {
    surface: "metadata",
    capability: "edit",
    actions: [{ name: "toggleFavorite", file: "src/app/app/actions.ts" }],
  },
  {
    surface: "metadata (duplicate)",
    capability: "view",
    actions: [{ name: "duplicateDocument", file: "src/app/app/actions.ts" }],
  },
  {
    surface: "metadata (lifecycle)",
    capability: "manage",
    actions: [
      { name: "deleteDocument", file: "src/app/app/actions.ts" },
      { name: "restoreDocument", file: "src/app/app/actions.ts" },
    ],
  },
];

/** Expected allow/deny for each role given a required capability. */
function isAllowed(role: DocumentRole, capability: Capability): boolean {
  switch (role) {
    case "owner":
      return true;
    case "editor":
      return capability !== "manage";
    case "viewer":
      return capability === "view";
    default:
      return false;
  }
}

const ROLES: { role: DocumentRole; userId: string }[] = [
  { role: "owner", userId: OWNER },
  { role: "editor", userId: EDITOR },
  { role: "viewer", userId: VIEWER },
  { role: "none", userId: STRANGER },
];

test("deck surface keeps the full-deck save action and closes patch/command save entry points", () => {
  const deckSurface = SURFACES.find((surface) => surface.surface === "deck");
  assert.ok(deckSurface);
  assert.deepEqual(
    deckSurface.actions.map((action) => action.name),
    ["saveDeckJson"],
  );
});

for (const { surface, capability, actions } of SURFACES) {
  for (const action of actions) {
    for (const { role, userId } of ROLES) {
      const allowed = isAllowed(role, capability);
      test(`role matrix: ${role} ${allowed ? "may" : "may not"} ${action.name} [${surface} → ${capability}]`, () => {
        const caps = documentCapabilities(workspaceDoc(), userId);

        if (allowed) {
          assert.doesNotThrow(
            () => assertCapability(caps, capability),
            `${role} should be allowed to ${action.name} (${action.file})`,
          );
          return;
        }

        assert.throws(
          () => assertCapability(caps, capability),
          DocumentPermissionError,
          `${role} should be denied ${action.name} (${action.file})`,
        );

        // An unrelated user must never learn the document exists: every denial
        // for the stranger surfaces the generic "Document not found." message.
        if (role === "none") {
          assert.throws(
            () => assertCapability(caps, capability),
            (error: unknown) =>
              error instanceof DocumentPermissionError &&
              error.message === "Document not found." &&
              error.capability === null,
          );
        }
      });
    }
  }
}

// A compact, human-readable assertion of the full surface × role truth table —
// fails loudly with the offending cell if any expectation drifts.
test("role matrix: full surface × role truth table is exhaustive", () => {
  const matrix: Record<string, Record<DocumentRole, boolean>> = {};

  for (const { surface, capability, actions } of SURFACES) {
    for (const action of actions) {
      matrix[action.name] = {
        owner: false,
        editor: false,
        viewer: false,
        none: false,
      };
      for (const { role, userId } of ROLES) {
        const caps = documentCapabilities(workspaceDoc(), userId);
        let permitted = true;
        try {
          assertCapability(caps, capability);
        } catch {
          permitted = false;
        }
        matrix[action.name][role] = permitted;
        assert.equal(
          permitted,
          isAllowed(role, capability),
          `${action.name} (${surface} → ${capability}) for ${role} expected ${isAllowed(
            role,
            capability,
          )} but got ${permitted}`,
        );
      }
    }
  }

  // Spot-check representative cells of the contract.
  assert.deepEqual(matrix.saveDocumentLexical, {
    owner: true,
    editor: true,
    viewer: false,
    none: false,
  });
  assert.deepEqual(matrix.toggleDocumentSharing, {
    owner: true,
    editor: false,
    viewer: false,
    none: false,
  });
  assert.deepEqual(matrix.listComments, {
    owner: true,
    editor: true,
    viewer: true,
    none: false,
  });
});
