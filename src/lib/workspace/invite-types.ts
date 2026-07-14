import type { WorkspaceRole } from "@/lib/workspace/roles";
import type { InviteDenyReason } from "@/lib/invite-access";

export type InviteLink = {
  id: string;
  token: string;
  role: WorkspaceRole;
  createdAt: Date;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
};

export type CreateInviteLinkOptions = {
  expiresInDays?: number | null;
  maxUses?: number | null;
};

export type InviteLinkTarget = {
  workspaceId: string;
};

/** Input required by {@link acceptWorkspaceInvite}. */
export type AcceptInviteInput = {
  inviteLinkId: string;
  userId: string;
  now?: Date;
};

/** Exhaustive outcome of an invite acceptance attempt. */
export type AcceptInviteResult =
  | { outcome: "joined"; workspaceId: string }
  | { outcome: "already-member"; workspaceId: string }
  | { outcome: "already-owner"; workspaceId: string }
  | { outcome: "denied"; reason: InviteDenyReason };
