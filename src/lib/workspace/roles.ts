/**
 * Canonical workspace role policy.
 *
 * Persisted workspace membership rows store ONLY `EDITOR` or `VIEWER`.
 * Workspace ownership is never encoded in a membership row; owner is derived
 * strictly from `Workspace.ownerId`.
 */

export const PERSISTED_WORKSPACE_MEMBER_ROLES = ["EDITOR", "VIEWER"] as const;

/* node:coverage ignore start */
/* Coverage rationale: type aliases are erased at runtime. */
export type PersistedWorkspaceMemberRole =
  (typeof PERSISTED_WORKSPACE_MEMBER_ROLES)[number];
export type InvitableWorkspaceRole = PersistedWorkspaceMemberRole;
export type EffectiveWorkspaceRole = "owner" | "editor" | "viewer";
export type MemberEffectiveWorkspaceRole = Exclude<
  EffectiveWorkspaceRole,
  "owner"
>;
/* node:coverage ignore stop */

export type WorkspaceMemberRoleParseErrorCode =
  "owner-membership-row" | "invalid-workspace-member-role";

export type WorkspaceMemberRoleParseError = {
  code: WorkspaceMemberRoleParseErrorCode;
  value: unknown;
  message: string;
};

export type WorkspaceMemberRoleParseResult =
  | { success: true; value: PersistedWorkspaceMemberRole }
  | { success: false; error: WorkspaceMemberRoleParseError };

const WORKSPACE_MEMBER_ROLE_SET = new Set<string>(
  PERSISTED_WORKSPACE_MEMBER_ROLES,
);

function isPersistedWorkspaceMemberRole(
  value: unknown,
): value is PersistedWorkspaceMemberRole {
  return typeof value === "string" && WORKSPACE_MEMBER_ROLE_SET.has(value);
}

/**
 * Parses a persisted `WorkspaceMember.role` value.
 *
 * `OWNER` is rejected explicitly because ownership is derived from
 * `Workspace.ownerId` and must not be represented by a membership row.
 */
export function parsePersistedWorkspaceMemberRole(
  value: unknown,
): WorkspaceMemberRoleParseResult {
  if (isPersistedWorkspaceMemberRole(value)) {
    return { success: true, value };
  }

  if (value === "OWNER") {
    return {
      success: false,
      error: {
        code: "owner-membership-row",
        value,
        message:
          "Workspace member role must not be OWNER; ownership is derived from Workspace.ownerId.",
      },
    };
  }

  return {
    success: false,
    error: {
      code: "invalid-workspace-member-role",
      value,
      message: `Workspace member role must be one of: ${PERSISTED_WORKSPACE_MEMBER_ROLES.join(", ")}`,
    },
  };
}

export class WorkspaceRoleDataIntegrityError extends Error {
  readonly code: WorkspaceMemberRoleParseErrorCode;
  readonly value: unknown;

  constructor(error: WorkspaceMemberRoleParseError) {
    super(error.message);
    this.name = "WorkspaceRoleDataIntegrityError";
    this.code = error.code;
    this.value = error.value;
  }
}

export function assertPersistedWorkspaceMemberRole(
  value: unknown,
): PersistedWorkspaceMemberRole {
  const parsed = parsePersistedWorkspaceMemberRole(value);
  if (!parsed.success) {
    throw new WorkspaceRoleDataIntegrityError(parsed.error);
  }
  return parsed.value;
}

/**
 * Converts a validated persisted membership role to a non-owner effective role.
 * This is the single canonical persisted→effective role conversion.
 */
export function persistedMemberRoleToEffectiveRole(
  role: PersistedWorkspaceMemberRole,
): MemberEffectiveWorkspaceRole {
  return role === "EDITOR" ? "editor" : "viewer";
}

/** Whether `value` is a role that an invite link is allowed to grant. */
export function isInvitableWorkspaceRole(
  value: unknown,
): value is PersistedWorkspaceMemberRole {
  return parsePersistedWorkspaceMemberRole(value).success;
}
