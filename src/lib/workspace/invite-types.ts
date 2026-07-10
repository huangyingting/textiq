import type { WorkspaceRole } from "@/lib/workspace/roles";

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
  maxUses: number | null;
  workspaceId: string;
  userId: string;
  role: string;
};

/** Exhaustive outcome of an invite acceptance attempt. */
export type AcceptInviteResult =
  | { outcome: "joined" }
  | { outcome: "cap-exhausted" }
  | { outcome: "already-member" };
