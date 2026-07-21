import assert from "node:assert/strict";
import test from "node:test";

import { buildMinimalDeck } from "@/test/builders/presentation-deck";
import { WorkspaceRoleDataIntegrityError } from "@/lib/workspace/roles";

import {
  mapCommentRowToDto,
  mapDocumentRowToDto,
  mapSubscriptionLiterals,
  mapTagRowToDto,
  mapUsageLedgerLiterals,
  mapVisualRowToDto,
  mapWorkspaceRowToDto,
  type CommentDtoRow,
  type DocumentDtoRow,
  type TagDtoRow,
  type VisualDtoRow,
  type WorkspaceDtoRow,
} from "./prisma-row-mappers";

const now = new Date("2026-06-25T15:15:00.000Z");

function deck(): unknown {
  return buildMinimalDeck();
}

function visual(): unknown {
  return {
    version: 1,
    type: "flowchart",
    width: 760,
    height: 480,
    nodes: [{ id: "n1", label: "Start" }],
    edges: [],
  };
}

test("maps document rows to serial DTOs and validates current JSON contracts", () => {
  const dto = mapDocumentRowToDto({
    id: "doc-1",
    title: "Doc",
    content: "Body",
    contentJson: { root: { children: [] } },
    deckJson: deck(),
    deckRevisionToken: "rev",
    ownerId: "user-1",
    workspaceId: null,
    shareId: null,
    slug: null,
    isShared: false,
    favorite: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  } as DocumentDtoRow);

  assert.equal(dto.createdAt, "2026-06-25T15:15:00.000Z");
  assert.equal(dto.favorite, true);
  assert.throws(
    () =>
      mapDocumentRowToDto({
        ...dto,
        createdAt: now,
        updatedAt: now,
        deckJson: JSON.stringify(deck()),
      } as DocumentDtoRow),
    /Deck must be an object/,
  );
  const deleted = mapDocumentRowToDto({
    id: "doc-2",
    title: "Deleted",
    content: "",
    contentJson: null,
    deckJson: null,
    deckRevisionToken: null,
    ownerId: "user-1",
    workspaceId: "workspace-1",
    shareId: "share-1",
    slug: "deleted",
    isShared: true,
    favorite: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: now,
  } as DocumentDtoRow);
  assert.equal(deleted.deletedAt, "2026-06-25T15:15:00.000Z");
  assert.equal(deleted.deckJson, null);
});

test("maps visual rows with matching literal type and data type", () => {
  const row = {
    id: "visual-1",
    documentId: "doc-1",
    anchorBlockId: "block-1",
    orderIndex: 0,
    type: "flowchart",
    title: null,
    data: visual(),
    createdAt: now,
    updatedAt: now,
  } as VisualDtoRow;
  const dto = mapVisualRowToDto(row);
  assert.equal(dto.type, "flowchart");
  assert.equal(dto.data.type, "flowchart");
  assert.equal(dto.updatedAt, "2026-06-25T15:15:00.000Z");
  assert.throws(
    () =>
      mapVisualRowToDto({
        ...row,
        type: "bogus",
      } as VisualDtoRow),
    /Visual type/,
  );
  assert.throws(
    () =>
      mapVisualRowToDto({
        ...row,
        data: { ...(visual() as Record<string, unknown>), type: "mindmap" },
      } as VisualDtoRow),
    /Visual row type must match/,
  );
  assert.throws(
    () =>
      mapVisualRowToDto({
        ...row,
        data: { bogus: true },
      } as VisualDtoRow),
    /\[Visual.data\]/,
  );
});

test("maps comment, tag, workspace, and literal rows", () => {
  const comment = mapCommentRowToDto({
    id: "comment-1",
    documentId: "doc-1",
    authorId: "user-1",
    body: "Looks good",
    resolved: false,
    parentId: null,
    anchorType: "text",
    anchorText: "Looks",
    anchorNodeId: "block-1",
    slideId: null,
    elementId: null,
    anchorGeometry: null,
    createdAt: now,
    updatedAt: now,
  } as CommentDtoRow);
  assert.equal(comment.anchor.kind, "text");
  assert.equal(comment.updatedAt, "2026-06-25T15:15:00.000Z");

  const tableRow: CommentDtoRow = {
    id: "comment-table",
    documentId: "doc-1",
    authorId: "user-1",
    body: "Table note",
    resolved: false,
    parentId: null,
    anchorType: "table",
    anchorText: "Quarterly metrics",
    anchorNodeId: "table-1",
    slideId: null,
    elementId: null,
    anchorGeometry: null,
    createdAt: now,
    updatedAt: now,
  } as CommentDtoRow;
  const tableComment = mapCommentRowToDto(tableRow);
  assert.deepEqual(tableComment.anchor, {
    kind: "document-block",
    blockKind: "table",
    text: "Quarterly metrics",
    nodeId: "table-1",
  });
  const tableCommentWithoutNodeId = mapCommentRowToDto({
    ...tableRow,
    id: "comment-table-floating",
    anchorText: null,
    anchorNodeId: null,
  });
  assert.deepEqual(tableCommentWithoutNodeId.anchor, {
    kind: "document-block",
    blockKind: "table",
    text: null,
    nodeId: null,
  });
  assert.throws(
    () =>
      mapCommentRowToDto({
        ...tableRow,
        id: "comment-table-slide-conflict",
        slideId: "slide-1",
      }),
    /Slide comment anchors must not also carry anchorType/,
  );

  const tag = mapTagRowToDto({
    id: "tag-1",
    name: "Product Plan",
    slug: "product-plan",
    ownerId: "user-1",
    createdAt: now,
    updatedAt: now,
  } as TagDtoRow);
  assert.equal(tag.slug, "product-plan");

  const workspace = mapWorkspaceRowToDto({
    id: "workspace-1",
    name: "Team",
    ownerId: "owner-1",
    createdAt: now,
    updatedAt: now,
    members: [
      { id: "member-1", userId: "user-1", role: "EDITOR", createdAt: now },
    ],
  } as WorkspaceDtoRow);
  assert.equal(workspace.members[0]?.role, "EDITOR");

  assert.deepEqual(
    mapSubscriptionLiterals({ plan: "plus", status: "active" }),
    {
      plan: "plus",
      status: "active",
    },
  );
  assert.deepEqual(mapUsageLedgerLiterals({ status: "captured" }), {
    status: "captured",
  });
  assert.throws(
    () =>
      mapTagRowToDto({
        id: "tag-2",
        name: "Product Plan",
        slug: "legacy-slug",
        ownerId: "user-1",
        createdAt: now,
        updatedAt: now,
      } as TagDtoRow),
    /Tag slug/,
  );
  assert.throws(
    () =>
      mapWorkspaceRowToDto({
        id: "workspace-1",
        name: "Team",
        ownerId: "owner-1",
        createdAt: now,
        updatedAt: now,
        members: [
          { id: "member-1", userId: "user-1", role: "ADMIN", createdAt: now },
        ],
      } as WorkspaceDtoRow),
    (error: unknown) =>
      error instanceof WorkspaceRoleDataIntegrityError &&
      error.code === "invalid-workspace-member-role",
  );
  assert.throws(
    () => mapSubscriptionLiterals({ plan: "enterprise", status: "active" }),
    /Plan must be one of/,
  );
  assert.throws(
    () => mapSubscriptionLiterals({ plan: "plus", status: "paused" }),
    /Subscription status/,
  );
  assert.throws(
    () => mapUsageLedgerLiterals({ status: "voided" }),
    /Usage ledger status/,
  );
});
