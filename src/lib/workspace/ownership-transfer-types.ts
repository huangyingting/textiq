export type TransferWorkspaceOwnershipInput = {
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
};

export type WorkspaceOwnershipTransferConflictReason = "stale-owner";

export class WorkspaceOwnershipTransferConflictError extends Error {
  readonly reason: WorkspaceOwnershipTransferConflictReason;
  readonly workspaceId: string;
  readonly actorUserId: string;

  constructor(input: {
    workspaceId: string;
    actorUserId: string;
    reason?: WorkspaceOwnershipTransferConflictReason;
  }) {
    super(
      "Workspace ownership transfer conflicted because the acting user is no longer the owner.",
    );
    this.name = "WorkspaceOwnershipTransferConflictError";
    this.reason = input.reason ?? "stale-owner";
    this.workspaceId = input.workspaceId;
    this.actorUserId = input.actorUserId;
  }
}

export function isWorkspaceOwnershipTransferConflictError(
  error: unknown,
): error is WorkspaceOwnershipTransferConflictError {
  return error instanceof WorkspaceOwnershipTransferConflictError;
}
