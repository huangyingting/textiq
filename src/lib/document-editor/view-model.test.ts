import assert from "node:assert/strict";
import test from "node:test";

import { assertViewModelSerializable } from "@/lib/view-models/serializable";
import { LEGACY_DECK_SCHEMA_VERSION } from "../document/deck-kernel/deck";

import { buildDocumentEditorViewModel } from "./view-model";

test("document editor view model serializes document state and share settings", () => {
  const viewModel = buildDocumentEditorViewModel({
    userId: "user-1",
    userName: "Ada",
    document: {
      id: "doc-1",
      title: "Roadmap",
      contentJson: { root: { children: [] } },
      deckRevisionToken: "deck-rev-1",
      deckJson: {
        design: { themeId: "default" },
        schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
        slides: [],
      },
      isShared: true,
      shareId: "share-1",
      slug: "roadmap",
      shareExpiresAt: new Date("2026-02-03T04:05:06.000Z"),
      shareEmbedEnabled: false,
      sharePresentEnabled: true,
      shareMetadataMode: "title-excerpt",
      shareDiscoverable: true,
      ownerId: "user-1",
      workspaceId: null,
      tags: [{ id: "tag-1", name: "Plan", slug: "plan" }],
      workspace: null,
    },
    initialComments: [
      {
        id: "comment-1",
        body: "Looks good",
        author: { id: "user-1", name: "Ada" },
        createdAt: "2026-02-03T04:05:06.000Z",
        resolved: false,
        anchor: { kind: "text", text: "Roadmap", nodeId: "node-1" },
        anchorType: "text",
        anchorText: "Roadmap",
        anchorNodeId: "node-1",
        replies: [],
      },
    ],
    allTags: [{ id: "tag-2", name: "Draft", slug: "draft" }],
  });

  assert.equal(viewModel.initialStateJson, '{"root":{"children":[]}}');
  assert.equal(viewModel.initialDeckRevisionToken, "deck-rev-1");
  assert.equal(viewModel.initialShareExpiresAt, "2026-02-03T04:05:06.000Z");
  assert.equal(viewModel.initialShareMetadataMode, "title-excerpt");
  assert.equal(viewModel.initialShareDiscoverable, true);
  assert.equal(viewModel.canEdit, true);
  assert.equal(viewModel.canManage, true);
  assert.equal(viewModel.workspaceName, null);
  assert.equal(viewModel.userId, "user-1");
  assertViewModelSerializable(viewModel);
});

test("document editor view model derives workspace viewer capabilities", () => {
  const viewModel = buildDocumentEditorViewModel({
    userId: "member-1",
    userName: "Viewer",
    document: {
      id: "doc-1",
      title: "Shared",
      contentJson: null,
      deckJson: null,
      deckRevisionToken: null,
      isShared: false,
      shareId: null,
      slug: null,
      shareExpiresAt: null,
      shareEmbedEnabled: true,
      sharePresentEnabled: true,
      shareMetadataMode: "generic",
      shareDiscoverable: false,
      ownerId: "owner-1",
      workspaceId: "workspace-1",
      tags: [],
      workspace: {
        name: "Team",
        ownerId: "owner-1",
        members: [{ userId: "member-1", role: "VIEWER" }],
      },
    },
    initialComments: [],
    allTags: [],
  });

  assert.equal(viewModel.initialStateJson, null);
  assert.equal(viewModel.initialDeckJson, null);
  assert.equal(viewModel.canEdit, false);
  assert.equal(viewModel.canManage, false);
  assert.equal(viewModel.workspaceName, "Team");
  assertViewModelSerializable(viewModel);
});
