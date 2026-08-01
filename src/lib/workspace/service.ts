import "server-only";

import { requireWorkspaceCapability } from "@/lib/auth/workspace-capabilities";
import { templateContentJsonForId } from "@/lib/document/create";
import {
  createDocumentWithCanonicalContent,
  updateDocumentsMetadata,
} from "@/lib/document/document-write-port";
import { buildDocumentListArgs } from "@/lib/document/query";
import { DOCUMENT_LIST_LIMIT, capList } from "@/lib/documents";
import { WORKSPACE_NAME_MAX_LENGTH } from "@/lib/limits";
import { prisma } from "@/lib/prisma";
import { type WorkspaceDocumentsResult } from "@/lib/workspace/document-types";
import {
  type TransferWorkspaceOwnershipInput,
  WorkspaceOwnershipTransferConflictError,
} from "@/lib/workspace/ownership-transfer-types";

export type WorkspaceMemberRemovalTarget = {
  workspaceId: string;
  userId: string;
};

export function normalizeWorkspaceName(rawName: string): string {
  const name = rawName.trim().slice(0, WORKSPACE_NAME_MAX_LENGTH);
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
  await prisma.$transaction(async (tx) => {
    await updateDocumentsMetadata(tx, {
      where: { workspaceId: member.workspaceId, ownerId: member.userId },
      data: { workspaceId: null },
    });
    await tx.workspaceMember.delete({ where: { id: memberId } });
  });
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
  await prisma.$transaction(async (tx) => {
    await updateDocumentsMetadata(tx, {
      where: { workspaceId },
      data: { workspaceId: null },
    });
    await tx.workspace.delete({ where: { id: workspaceId } });
  });
}

/**
 * Removes the caller's membership row when they are not the workspace owner.
 *
 * Role values are intentionally ignored for this cleanup path so malformed or
 * persisted OWNER membership rows can be removed safely by the affected user.
 * Authored documents remain owned by the same user; only membership is deleted.
 */
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
  input: TransferWorkspaceOwnershipInput,
): Promise<void> {
  if (input.targetUserId === input.actorUserId) {
    throw new Error("You already own this workspace.");
  }

  await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { ownerId: true },
    });

    if (!workspace || workspace.ownerId !== input.actorUserId) {
      throw new WorkspaceOwnershipTransferConflictError({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
      });
    }

    const newOwnerMembership = await tx.workspaceMember.findFirst({
      where: { workspaceId: input.workspaceId, userId: input.targetUserId },
      select: { id: true },
    });

    if (!newOwnerMembership) {
      throw new Error("New owner must be an existing member of the workspace.");
    }

    const casOwnerUpdate = await tx.workspace.updateMany({
      where: { id: input.workspaceId, ownerId: input.actorUserId },
      data: { ownerId: input.targetUserId },
    });

    if (casOwnerUpdate.count !== 1) {
      throw new WorkspaceOwnershipTransferConflictError({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
      });
    }

    const removedTargetMembership = await tx.workspaceMember.deleteMany({
      where: {
        id: newOwnerMembership.id,
        workspaceId: input.workspaceId,
        userId: input.targetUserId,
      },
    });

    if (removedTargetMembership.count !== 1) {
      throw new Error("New owner must be an existing member of the workspace.");
    }

    await tx.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        userId: input.actorUserId,
        role: "EDITOR",
      },
      update: { role: "EDITOR" },
    });
  });
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

  return createDocumentWithCanonicalContent<{ id: string }>(prisma, {
    data: {
      ownerId: userId,
      workspaceId,
    },
    ...(contentJson ? { contentSnapshot: contentJson } : {}),
    select: { id: true },
  });
}
