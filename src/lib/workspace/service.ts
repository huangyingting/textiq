import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { requireWorkspaceCapability } from "@/lib/auth/workspace-capabilities";
import { markdownToLexicalState } from "@/lib/content";
import { templateContentJsonForId } from "@/lib/document/create";
import { buildDocumentListArgs } from "@/lib/document/query";
import { DOCUMENT_LIST_LIMIT, capList } from "@/lib/documents";
import {
  DOCUMENT_CONTENT_MAX_LENGTH,
  DOCUMENT_TITLE_MAX_LENGTH,
} from "@/lib/limits";
import { prisma } from "@/lib/prisma";
import { type WorkspaceDocumentsResult } from "@/lib/workspace/document-types";

export type WorkspaceMemberRemovalTarget = {
  workspaceId: string;
  userId: string;
};

/** Maximum stored workspace name length. */
export const MAX_WORKSPACE_NAME_LENGTH = 100;

export function normalizeWorkspaceName(rawName: string): string {
  const name = rawName.trim().slice(0, MAX_WORKSPACE_NAME_LENGTH);
  if (name === "") {
    throw new Error("Workspace name is required.");
  }
  return name;
}

export async function createWorkspaceForUser(
  ownerId: string,
  rawName: string,
): Promise<{ id: string }> {
  return prisma.workspace.create({
    data: {
      name: normalizeWorkspaceName(rawName),
      ownerId,
    },
    select: { id: true },
  });
}

export async function getWorkspaceMemberRemovalTarget(
  memberId: string,
): Promise<WorkspaceMemberRemovalTarget | null> {
  return prisma.workspaceMember.findFirst({
    where: { id: memberId },
    select: { workspaceId: true, userId: true },
  });
}

export async function removeWorkspaceMemberAndDetachDocuments(
  memberId: string,
  member: WorkspaceMemberRemovalTarget,
): Promise<void> {
  await prisma.$transaction([
    prisma.document.updateMany({
      where: { workspaceId: member.workspaceId, ownerId: member.userId },
      data: { workspaceId: null },
    }),
    prisma.workspaceMember.delete({ where: { id: memberId } }),
  ]);
}

export async function renameWorkspaceRecord(
  workspaceId: string,
  rawName: string,
): Promise<void> {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { name: normalizeWorkspaceName(rawName) },
  });
}

export async function deleteWorkspaceAndDetachDocuments(
  workspaceId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.document.updateMany({
      where: { workspaceId },
      data: { workspaceId: null },
    }),
    prisma.workspace.delete({ where: { id: workspaceId } }),
  ]);
}

export async function leaveWorkspaceForUser(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId },
    select: { ownerId: true },
  });

  if (!workspace) {
    throw new Error("Workspace not found or unauthorized.");
  }

  if (workspace.ownerId === userId) {
    throw new Error(
      "The workspace owner cannot leave. Transfer ownership to another member first.",
    );
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId },
    select: { id: true },
  });

  if (!membership) {
    throw new Error("You are not a member of this workspace.");
  }

  await prisma.workspaceMember.delete({ where: { id: membership.id } });
}

export async function transferWorkspaceOwnership(
  workspaceId: string,
  currentOwnerId: string,
  newOwnerUserId: string,
): Promise<void> {
  if (newOwnerUserId === currentOwnerId) {
    throw new Error("You already own this workspace.");
  }

  const newOwnerMembership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: newOwnerUserId },
    select: { id: true },
  });

  if (!newOwnerMembership) {
    throw new Error("New owner must be an existing member of the workspace.");
  }

  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: workspaceId },
      data: { ownerId: newOwnerUserId },
    }),
    prisma.workspaceMember.delete({ where: { id: newOwnerMembership.id } }),
    prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId: currentOwnerId } },
      create: { workspaceId, userId: currentOwnerId, role: "EDITOR" },
      update: { role: "EDITOR" },
    }),
  ]);
}

export async function listWorkspaceDocumentsForUser(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceDocumentsResult> {
  await requireWorkspaceCapability(userId, workspaceId, "view");

  const rows = await prisma.document.findMany({
    ...buildDocumentListArgs({
      scope: { kind: "workspace", workspaceId },
      limit: DOCUMENT_LIST_LIMIT,
    }),
    select: { id: true, title: true, updatedAt: true },
  });

  const { items, hasMore } = capList(rows, DOCUMENT_LIST_LIMIT);
  return { documents: items, hasMore };
}

export async function createWorkspaceDocumentForUser(
  userId: string,
  workspaceId: string,
  templateId: string,
): Promise<{ id: string }> {
  await requireWorkspaceCapability(userId, workspaceId, "mutate");

  const contentJson = templateContentJsonForId(templateId);

  // Document.content (the plaintext mirror) is deprecated — stop writing it.
  // Physical column drop is a follow-up migration.
  return prisma.document.create({
    data: {
      ownerId: userId,
      workspaceId,
      ...(contentJson ? { contentJson } : {}),
    },
    select: { id: true },
  });
}

export async function importWorkspaceDocumentForUser(
  userId: string,
  workspaceId: string,
  content: string,
  rawTitle: string,
): Promise<{ id: string }> {
  await requireWorkspaceCapability(userId, workspaceId, "mutate");

  const title =
    rawTitle.trim().slice(0, DOCUMENT_TITLE_MAX_LENGTH) || "Imported document";
  const safeContent = content.slice(0, DOCUMENT_CONTENT_MAX_LENGTH);
  const contentJson = JSON.parse(
    markdownToLexicalState(safeContent),
  ) as Prisma.InputJsonValue;

  // Document.content (the plaintext mirror) is deprecated — stop writing it.
  // Physical column drop is a follow-up migration.
  return prisma.document.create({
    data: {
      ownerId: userId,
      workspaceId,
      title,
      contentJson,
    },
    select: { id: true },
  });
}
