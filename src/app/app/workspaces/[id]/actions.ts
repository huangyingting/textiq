"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/session";
import { requireWorkspaceCapability } from "@/lib/auth/workspace-capabilities";
import {
  assertInvitableWorkspaceRole,
  createWorkspaceDocumentForUser,
  createWorkspaceInviteLink,
  deleteWorkspaceAndDetachDocuments,
  getInviteLinkTarget,
  getWorkspaceMemberRemovalTarget,
  importWorkspaceDocumentForUser,
  leaveWorkspaceForUser,
  listWorkspaceDocumentsForUser,
  removeWorkspaceMemberAndDetachDocuments,
  renameWorkspaceRecord,
  revokeWorkspaceInviteLink,
  transferWorkspaceOwnership,
  type CreateInviteLinkOptions,
  type InviteLink,
} from "@/lib/workspace/service";
import type { WorkspaceDocumentsResult } from "@/lib/workspace/document-types";
import type { WorkspaceRole } from "@/lib/workspace/roles";

export async function createInviteLink(
  workspaceId: string,
  role: WorkspaceRole,
  options: CreateInviteLinkOptions = {},
): Promise<InviteLink> {
  const user = await requireUser(redirect);
  assertInvitableWorkspaceRole(role);

  // Centralized authorization (issue #483): only the workspace owner may
  // create invite links (manage capability).
  await requireWorkspaceCapability(user.id, workspaceId, "manage");

  const inviteLink = await createWorkspaceInviteLink({
    workspaceId,
    role,
    createdById: user.id,
    options,
  });

  revalidatePath(`/app/workspaces/${workspaceId}`);
  return inviteLink;
}

export async function revokeInviteLink(linkId: string): Promise<void> {
  const user = await requireUser(redirect);

  // Look up the link to get its workspaceId for centralized authorization.
  const link = await getInviteLinkTarget(linkId);

  if (!link) {
    throw new Error("Invite link not found or unauthorized.");
  }

  // Centralized authorization (issue #483): only the workspace owner may
  // revoke invite links (manage capability).
  await requireWorkspaceCapability(user.id, link.workspaceId, "manage");

  await revokeWorkspaceInviteLink(linkId);

  revalidatePath(`/app/workspaces/${link.workspaceId}`);
}

export async function removeMember(memberId: string): Promise<void> {
  const user = await requireUser(redirect);

  // Look up the member to get the workspaceId and their userId.
  const member = await getWorkspaceMemberRemovalTarget(memberId);

  if (!member) {
    throw new Error("Member not found or unauthorized.");
  }

  // Centralized authorization (issue #483): only the workspace owner may
  // remove members (manage capability).
  await requireWorkspaceCapability(user.id, member.workspaceId, "manage");

  await removeWorkspaceMemberAndDetachDocuments(memberId, member);

  revalidatePath("/app");
  revalidatePath(`/app/workspaces/${member.workspaceId}`);
}

/**
 * Renames a workspace. OWNER-only: the server re-checks ownership against
 * `Workspace.ownerId` and never trusts the client. The name is trimmed and
 * length-capped; an empty name is rejected.
 */
export async function renameWorkspace(
  workspaceId: string,
  rawName: string,
): Promise<void> {
  const user = await requireUser(redirect);
  await requireWorkspaceCapability(user.id, workspaceId, "manage");

  await renameWorkspaceRecord(workspaceId, rawName);

  revalidatePath("/app/workspaces");
  revalidatePath(`/app/workspaces/${workspaceId}`);
}

/**
 * Deletes a workspace. OWNER-only.
 *
 * Document handoff: before deletion, every document still attached to the
 * workspace is reassigned to its owner's personal space (`workspaceId = null`).
 * No document is ever deleted — each survives in the personal space of whoever
 * authored it. (The schema's `onDelete: SetNull` on the document→workspace
 * relation would null these out anyway; doing it explicitly keeps the behavior
 * intentional and self-documenting.) Members and invite links cascade-delete
 * with the workspace.
 */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const user = await requireUser(redirect);
  await requireWorkspaceCapability(user.id, workspaceId, "manage");

  await deleteWorkspaceAndDetachDocuments(workspaceId);

  revalidatePath("/app");
  revalidatePath("/app/workspaces");
  redirect("/app/workspaces");
}

/**
 * Lets the current user leave a workspace by deleting their own membership.
 *
 * Any non-owner member (EDITOR or VIEWER) may leave. The OWNER cannot leave —
 * doing so would orphan the workspace — so they receive a clear error directing
 * them to transfer ownership first. Documents the leaving member authored keep
 * their `ownerId`, so they remain accessible to that member in their personal
 * lists; only the membership row is removed.
 */
export async function leaveWorkspace(workspaceId: string): Promise<void> {
  const user = await requireUser(redirect);

  await leaveWorkspaceForUser(workspaceId, user.id);

  revalidatePath("/app");
  revalidatePath("/app/workspaces");
  redirect("/app/workspaces");
}

/**
 * Transfers workspace ownership to another existing member. OWNER-only.
 *
 * Ownership is modeled by `Workspace.ownerId` (the owner is not a
 * `WorkspaceMember` row), so the transfer, run atomically:
 *   1. promotes `newOwnerUserId` by setting `Workspace.ownerId`,
 *   2. removes the new owner's now-redundant membership row, and
 *   3. demotes the previous owner into an EDITOR membership row,
 * preserving the invariant "the owner has no member row; everyone else does."
 * The target must already be a member of the workspace.
 */
export async function transferOwnership(
  workspaceId: string,
  newOwnerUserId: string,
): Promise<void> {
  const user = await requireUser(redirect);
  await requireWorkspaceCapability(user.id, workspaceId, "manage");

  await transferWorkspaceOwnership(workspaceId, user.id, newOwnerUserId);

  revalidatePath("/app");
  revalidatePath("/app/workspaces");
  revalidatePath(`/app/workspaces/${workspaceId}`);
}

export async function getWorkspaceDocuments(
  workspaceId: string,
): Promise<WorkspaceDocumentsResult> {
  const user = await requireUser(redirect);
  return listWorkspaceDocumentsForUser(user.id, workspaceId);
}

/**
 * Creates a new document seeded from a starter template inside a workspace,
 * then redirects to its editor.
 *
 * The caller's workspace role is checked server-side: only OWNER and EDITOR
 * may proceed; a VIEWER (or non-member) receives an authorization error.
 * `workspaceId` is stored on the document so it appears in both the workspace
 * document list and the dashboard lists.
 */
export async function createWorkspaceDocument(
  workspaceId: string,
  templateId: string,
): Promise<void> {
  const user = await requireUser(redirect);
  const document = await createWorkspaceDocumentForUser(
    user.id,
    workspaceId,
    templateId,
  );

  revalidatePath("/app");
  revalidatePath(`/app/workspaces/${workspaceId}`);
  redirect(`/app/documents/${document.id}`);
}

/**
 * Creates a document from pre-extracted import text inside a workspace, then
 * redirects to its editor.
 *
 * The caller's workspace role is checked server-side: only OWNER and EDITOR
 * may proceed; a VIEWER (or non-member) receives an authorization error.
 * `workspaceId` is stored on the document so it appears in both the workspace
 * document list and the dashboard lists.
 */
export async function importWorkspaceDocument(
  workspaceId: string,
  content: string,
  rawTitle: string,
): Promise<void> {
  const user = await requireUser(redirect);
  const document = await importWorkspaceDocumentForUser(
    user.id,
    workspaceId,
    content,
    rawTitle,
  );

  revalidatePath("/app");
  revalidatePath(`/app/workspaces/${workspaceId}`);
  redirect(`/app/documents/${document.id}`);
}
