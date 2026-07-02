import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboardViewModel } from "@/lib/dashboard/view-model";
import { buildDocumentEditorViewModel } from "@/lib/document-editor/view-model";
import { LEGACY_DECK_SCHEMA_VERSION } from "../document/deck-kernel/deck";
import { buildPublicPresentationModel } from "@/lib/public-render/presentation";
import { assertViewModelSerializable } from "@/lib/view-models/serializable";

import {
  mapCommentRowToDto,
  mapTagRowToDto,
  mapWorkspaceRowToDto,
  type CommentDtoRow,
  type TagDtoRow,
  type WorkspaceDtoRow,
} from "@/lib/data-contracts/prisma-row-mappers";

const now = new Date("2026-06-25T15:15:00.000Z");

const deck = {
  slides: [
    {
      id: "slide-1",
      index: 0,
      title: "Roadmap",
      notes: "",
      elements: [],
    },
  ],
  design: { themeId: "indigo" },
  schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
};

function assertJsonRoundTrip(value: unknown): void {
  assertViewModelSerializable(value);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

test("serialized view-model contract matrix stays JSON-shaped", () => {
  const dashboard = buildDashboardViewModel({
    userEmail: "ada@example.com",
    locale: "en",
    onboardingDismissed: false,
    hasVisuals: false,
    documentList: {
      hasDocuments: true,
      listCapped: false,
      availableTags: [{ slug: "plan", name: "Plan" }],
      documents: [
        {
          id: "doc-1",
          title: "Roadmap",
          favorite: false,
          editedLabel: "Jun 25, 2026",
          workspaceName: "Team",
          thumbnail: null,
          excerpt: "Roadmap",
          readingMinutes: 1,
          createdAtMs: now.getTime(),
          updatedAtMs: now.getTime(),
          canEdit: true,
          canManage: true,
          tags: [{ slug: "plan", name: "Plan" }],
        },
      ],
    },
  });

  const editor = buildDocumentEditorViewModel({
    userId: "user-1",
    userName: "Ada",
    document: {
      id: "doc-1",
      title: "Roadmap",
      contentJson: { root: { children: [] } },
      deckJson: deck,
      deckRevisionToken: "deck-rev-1",
      isShared: true,
      shareId: "share-1",
      slug: "roadmap",
      shareExpiresAt: now,
      shareEmbedEnabled: true,
      sharePresentEnabled: true,
      shareMetadataMode: "generic",
      shareDiscoverable: false,
      ownerId: "user-1",
      workspaceId: null,
      tags: [{ id: "tag-1", name: "Plan", slug: "plan" }],
      workspace: null,
    },
    initialComments: [],
    allTags: [{ id: "tag-1", name: "Plan", slug: "plan" }],
  });

  const comment = mapCommentRowToDto({
    id: "comment-1",
    documentId: "doc-1",
    authorId: "user-1",
    body: "Looks good",
    resolved: false,
    parentId: null,
    anchorType: "text",
    anchorText: "Roadmap",
    anchorNodeId: "block-1",
    slideId: null,
    elementId: null,
    anchorGeometry: null,
    createdAt: now,
    updatedAt: now,
  } as CommentDtoRow);

  const tag = mapTagRowToDto({
    id: "tag-1",
    name: "Plan",
    slug: "plan",
    ownerId: "user-1",
    createdAt: now,
    updatedAt: now,
  } as TagDtoRow);

  const workspace = mapWorkspaceRowToDto({
    id: "workspace-1",
    name: "Team",
    ownerId: "user-1",
    createdAt: now,
    updatedAt: now,
    members: [
      { id: "member-1", userId: "user-2", role: "VIEWER", createdAt: now },
    ],
  } as WorkspaceDtoRow);

  const publicPresentation = buildPublicPresentationModel({
    title: "Roadmap",
    contentJson: { root: { children: [] } },
    deckJson: deck,
    owner: { name: "Ada", plan: "free" },
  });

  for (const viewModel of [
    dashboard,
    editor,
    comment,
    tag,
    workspace,
    publicPresentation,
  ]) {
    assertJsonRoundTrip(viewModel);
  }
});
