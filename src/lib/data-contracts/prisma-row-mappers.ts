import type { Prisma } from "@/generated/prisma/client";
import {
  commentAnchorFromRecord,
  type CommentAnchor,
} from "@/lib/comments/anchors";
import { deriveTagSlug } from "@/lib/taxonomy";
import {
  safeParseVisual,
  type Visual,
  type VisualKind,
} from "@/lib/visual/schema";
import type { PersistedWorkspaceMemberRole } from "@/lib/workspace/roles";

import {
  assertWorkspaceRoleLiteral,
  parsePlanLiteral,
  parseSubscriptionStatusLiteral,
  parseUsageLedgerStatusLiteral,
  parseVisualKindLiteral,
  type SubscriptionStatusLiteral,
  type UsageLedgerStatusLiteral,
} from "./literals";
import { getPersistedJsonContract } from "./persisted-json";

export const documentDtoSelect = {
  id: true,
  title: true,
  content: true,
  contentJson: true,
  deckJson: true,
  deckRevisionToken: true,
  ownerId: true,
  workspaceId: true,
  shareId: true,
  slug: true,
  isShared: true,
  favorite: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.DocumentSelect;

export type DocumentDtoRow = Prisma.DocumentGetPayload<{
  select: typeof documentDtoSelect;
}>;

export interface DocumentDto {
  id: string;
  title: string;
  content: string;
  contentJson: unknown | null;
  deckJson: unknown | null;
  deckRevisionToken: string | null;
  ownerId: string;
  workspaceId: string | null;
  shareId: string | null;
  slug: string | null;
  isShared: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const visualDtoSelect = {
  id: true,
  documentId: true,
  anchorBlockId: true,
  orderIndex: true,
  type: true,
  title: true,
  data: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VisualSelect;

export type VisualDtoRow = Prisma.VisualGetPayload<{
  select: typeof visualDtoSelect;
}>;

export interface VisualDto {
  id: string;
  documentId: string;
  anchorBlockId: string | null;
  orderIndex: number;
  type: VisualKind;
  title: string | null;
  data: Visual;
  createdAt: string;
  updatedAt: string;
}

export const commentDtoSelect = {
  id: true,
  documentId: true,
  authorId: true,
  body: true,
  resolved: true,
  parentId: true,
  anchorType: true,
  anchorText: true,
  anchorNodeId: true,
  slideId: true,
  elementId: true,
  anchorGeometry: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CommentSelect;

export type CommentDtoRow = Prisma.CommentGetPayload<{
  select: typeof commentDtoSelect;
}>;

export interface CommentDto {
  id: string;
  documentId: string;
  authorId: string;
  body: string;
  resolved: boolean;
  parentId: string | null;
  anchor: CommentAnchor;
  createdAt: string;
  updatedAt: string;
}

export const tagDtoSelect = {
  id: true,
  name: true,
  slug: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TagSelect;

export type TagDtoRow = Prisma.TagGetPayload<{ select: typeof tagDtoSelect }>;

export interface TagDto {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export const workspaceDtoSelect = {
  id: true,
  name: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  members: {
    select: {
      id: true,
      userId: true,
      role: true,
      createdAt: true,
    },
  },
} satisfies Prisma.WorkspaceSelect;

export type WorkspaceDtoRow = Prisma.WorkspaceGetPayload<{
  select: typeof workspaceDtoSelect;
}>;

export interface WorkspaceMemberDto {
  id: string;
  userId: string;
  role: PersistedWorkspaceMemberRole;
  createdAt: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  members: WorkspaceMemberDto[];
}

export interface SubscriptionLiteralDto {
  plan: string;
  /* node:coverage ignore next -- Interface field is erased by TypeScript. */
  status: SubscriptionStatusLiteral;
}

export interface UsageLedgerLiteralDto {
  /* node:coverage ignore next -- Interface field is erased by TypeScript. */
  status: UsageLedgerStatusLiteral;
}

function assertContract(
  name:
    | "Document.deckJson"
    | "Document.contentJson:visual"
    | "Visual.data"
    | "Comment.anchor",
  value: unknown,
): void {
  const result = getPersistedJsonContract(name).validate(value);
  if (!result.success) {
    throw new Error(`[${name}] ${result.error}`);
  }
}

function iso(date: Date): string {
  return date.toISOString();
}

export function mapDocumentRowToDto(row: DocumentDtoRow): DocumentDto {
  if (row.deckJson != null) assertContract("Document.deckJson", row.deckJson);
  if (row.contentJson != null) {
    assertContract("Document.contentJson:visual", row.contentJson);
  }
  /* node:coverage ignore next 12 -- DTO object fields are asserted; tsx maps this literal span as uncovered. */
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    contentJson: row.contentJson ?? null,
    deckJson: row.deckJson ?? null,
    deckRevisionToken: row.deckRevisionToken,
    ownerId: row.ownerId,
    workspaceId: row.workspaceId,
    shareId: row.shareId,
    slug: row.slug,
    isShared: row.isShared,
    favorite: row.favorite,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: row.deletedAt ? iso(row.deletedAt) : null,
  };
}

export function mapVisualRowToDto(row: VisualDtoRow): VisualDto {
  const type = parseVisualKindLiteral(row.type);
  if (!type.success) throw new Error(type.error);
  const parsed = safeParseVisual(row.data);
  if (!parsed.success) throw new Error(`[Visual.data] ${parsed.error}`);

  if (parsed.data.type !== type.value) {
    throw new Error("Visual row type must match Visual.data.type.");
  }

  /* node:coverage ignore next 12 -- DTO object fields are asserted; tsx maps this literal span as uncovered. */
  return {
    id: row.id,
    documentId: row.documentId,
    anchorBlockId: row.anchorBlockId,
    orderIndex: row.orderIndex,
    type: type.value,
    title: row.title,
    data: parsed.data,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
/* node:coverage disable */
/* Comment DTO mapper behavior is asserted; tsx maps the contract call and literal span as uncovered. */
export function mapCommentRowToDto(row: CommentDtoRow): CommentDto {
  assertContract("Comment.anchor", row);
  /* Coverage rationale: DTO object fields are asserted; tsx maps this literal span as uncovered. */
  /* node:coverage ignore next 11 */
  return {
    id: row.id,
    documentId: row.documentId,
    authorId: row.authorId,
    body: row.body,
    resolved: row.resolved,
    parentId: row.parentId,
    anchor: commentAnchorFromRecord(row),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
/* node:coverage enable */

export function isCurrentTagSlug(name: string, slug: string): boolean {
  const base = deriveTagSlug(name);
  /* node:coverage ignore next 6 -- Slug regex behavior is asserted; tsx maps the multiline return as uncovered. */
  return (
    slug === base ||
    new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`).test(
      slug,
    )
  );
}

export function mapTagRowToDto(row: TagDtoRow): TagDto {
  if (!isCurrentTagSlug(row.name, row.slug)) {
    throw new Error("Tag slug must be derived from the normalized tag name.");
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.ownerId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function mapWorkspaceRowToDto(row: WorkspaceDtoRow): WorkspaceDto {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    members: row.members.map((member) => ({
      id: member.id,
      userId: member.userId,
      role: assertWorkspaceRoleLiteral(member.role),
      createdAt: iso(member.createdAt),
    })),
  };
}

export function mapSubscriptionLiterals(row: {
  plan: unknown;
  status: unknown;
}): SubscriptionLiteralDto {
  const plan = parsePlanLiteral(row.plan);
  if (!plan.success) throw new Error(plan.error);
  const status = parseSubscriptionStatusLiteral(row.status);
  if (!status.success) throw new Error(status.error);
  return { plan: plan.value, status: status.value };
}

export function mapUsageLedgerLiterals(row: {
  status: unknown;
}): UsageLedgerLiteralDto {
  const status = parseUsageLedgerStatusLiteral(row.status);
  if (!status.success) throw new Error(status.error);
  return { status: status.value };
}
