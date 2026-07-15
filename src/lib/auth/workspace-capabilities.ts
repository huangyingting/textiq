/* @preserve node:coverage ignore start -- Module documentation is a source-map artifact; workspace capability behavior is asserted below. */
/**
 * Centralized, role-aware workspace permission helper.
 *
 * A user's effective role for a workspace is derived from workspace ownership
 * and their `WorkspaceMember` row:
 *
 *   - owner  — `Workspace.ownerId === userId`
 *   - editor — persisted `WorkspaceMember.role = EDITOR`
 *   - viewer — persisted `WorkspaceMember.role = VIEWER`
 *   - none   — no relationship to the workspace
 *
 * Persisted `OWNER`/unknown membership rows are treated as data-integrity
 * violations and surfaced explicitly (never coerced to viewer/owner).
 */
/* @preserve node:coverage ignore stop */

import { prisma } from "@/lib/prisma";
import {
  denyAccess,
  type AccessDecision,
  type AccessDeniedDecision,
} from "@/lib/access-policy/taxonomy";
import {
  capabilitiesForWorkspaceAccessRole,
  workspaceRoleCan,
  type WorkspaceCapabilityMode,
  type WorkspaceAccessRole,
} from "@/lib/workspace/capabilities";
import {
  createPermissionBuilder,
  deriveRoleFromOwnerAndMembers,
  RoleResolutionDataIntegrityError,
} from "./permission-builder";

/** Effective access role of a user for a single workspace. */
export type WorkspaceRole = WorkspaceAccessRole;

/** A workspace capability that an action can require. */
export type WorkspaceCapability = WorkspaceCapabilityMode;

/** The resolved capability set for a (user, workspace) pair. */
export type WorkspaceCapabilities = {
  role: WorkspaceRole;
  canView: boolean;
  canMutate: boolean;
  canManage: boolean;
};

/**
 * Minimal workspace shape needed to derive a role. The `members` list should
 * contain membership row(s) for the acting user.
 */
export type WorkspaceRoleInput = {
  ownerId: string;
  members: { userId: string; role: string }[];
};

/** Minimal workspace identity returned by async permission lookups. */
export type WorkspaceIdentity = {
  id: string;
  ownerId: string;
};

/**
 * Thrown when a user attempts a workspace action they are not authorized to
 * perform. The `capability` is `null` for pure no-access/not-found checks.
 */
export class WorkspacePermissionError extends Error {
  readonly capability: WorkspaceCapability | null;
  readonly accessDecision: AccessDeniedDecision | null;

  constructor(
    message: string,
    capability: WorkspaceCapability | null = null,
    accessDecision: AccessDeniedDecision | null = null,
  ) {
    super(message);
    this.name = "WorkspacePermissionError";
    this.capability = capability;
    this.accessDecision = accessDecision;
  }
}

function workspaceInvalidMembershipDecision(
  capability: WorkspaceCapability,
): AccessDeniedDecision {
  return denyAccess({
    resource: { kind: "workspace" },
    capability,
    reason: "invalid-role",
    status: 403,
    safeMessage:
      "Workspace membership data is invalid and must be repaired before this action can proceed.",
    concealResource: false,
  });
}

function asWorkspaceDataIntegrityPermissionError(
  capability: WorkspaceCapability,
  error: unknown,
): WorkspacePermissionError | null {
  if (!(error instanceof RoleResolutionDataIntegrityError)) {
    return null;
  }
  const decision = workspaceInvalidMembershipDecision(capability);
  return new WorkspacePermissionError(
    decision.safeMessage,
    capability,
    decision,
  );
}

export function deriveWorkspaceRole(
  workspace: WorkspaceRoleInput,
  userId: string,
): WorkspaceRole {
  return deriveRoleFromOwnerAndMembers(
    workspace.ownerId,
    workspace.members,
    userId,
  );
}

/** Permission-builder instance for workspace access decisions. */
const _wsBuilder = createPermissionBuilder({
  resource: "workspace",
  /*! @preserve node:coverage ignore next 8 -- Builder metadata is asserted via workspace decision tests; tsx maps object-literal fields as uncovered. */
  midCapKey: "canMutate" as const,
  midCapMode: "mutate" as const,
  messages: {
    notFound: "Workspace not found.",
    midCapDenied:
      "Only workspace owners and editors may create or import documents.",
    manageDenied: "Only the workspace owner may perform this action.",
  },
  isCapabilityAllowed: (caps, capability) => {
    if (
      capability !== "view" &&
      capability !== "mutate" &&
      capability !== "manage"
    ) {
      return true;
    }
    return workspaceRoleCan(caps.role, capability);
  },
});

/** Maps a {@link WorkspaceRole} to concrete capability flags. */
export function capabilitiesForWorkspaceRole(
  role: WorkspaceRole,
): WorkspaceCapabilities {
  const capabilities = capabilitiesForWorkspaceAccessRole(role);
  return { role, ...capabilities };
}

/** Convenience: derive role and map capabilities in one pure call. */
export function workspaceCapabilities(
  workspace: WorkspaceRoleInput,
  userId: string,
): WorkspaceCapabilities {
  return capabilitiesForWorkspaceRole(deriveWorkspaceRole(workspace, userId));
}

/**
 * Throws a {@link WorkspacePermissionError} when `capabilities` does not satisfy
 * `capability`.
 */
export function assertWorkspaceCapability(
  capabilities: WorkspaceCapabilities,
  capability: WorkspaceCapability,
): void {
  const decision = workspaceCapabilityAccessDecision(capabilities, capability);
  if (decision.allow) {
    return;
  }

  const deniedCapability = capabilities.canView ? capability : null;
  throw new WorkspacePermissionError(
    decision.safeMessage,
    deniedCapability,
    decision,
  );
}

/** Maps a workspace capability check to the shared access-decision taxonomy. */
export function workspaceCapabilityAccessDecision(
  capabilities: WorkspaceCapabilities,
  capability: WorkspaceCapability,
): AccessDecision {
  return _wsBuilder.capabilityAccessDecision(capabilities, capability);
}

async function getWorkspaceCapabilities(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceCapabilities & { workspace: WorkspaceIdentity | null }> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      ownerId: true,
      members: {
        where: { userId },
        select: { userId: true, role: true },
      },
    },
  });

  if (!workspace) {
    return { ...capabilitiesForWorkspaceRole("none"), workspace: null };
  }

  const capabilities = workspaceCapabilities(workspace, userId);
  return {
    ...capabilities,
    workspace: { id: workspace.id, ownerId: workspace.ownerId },
  };
}

/**
 * Authorizes the current user for `capability` on a workspace.
 */
export async function requireWorkspaceCapability(
  userId: string,
  workspaceId: string,
  capability: WorkspaceCapability,
): Promise<WorkspaceCapabilities & { workspace: WorkspaceIdentity }> {
  let result: WorkspaceCapabilities & { workspace: WorkspaceIdentity | null };
  try {
    result = await getWorkspaceCapabilities(userId, workspaceId);
  } catch (error) {
    const integrityError = asWorkspaceDataIntegrityPermissionError(
      capability,
      error,
    );
    if (integrityError) {
      throw integrityError;
    }
    throw error;
  }

  if (!result.workspace) {
    throw new WorkspacePermissionError(
      "Workspace not found.",
      null,
      denyAccess({
        resource: { kind: "workspace" },
        capability,
        reason: "resource-not-found",
        status: 404,
        safeMessage: "Workspace not found.",
        concealResource: true,
      }),
    );
  }

  assertWorkspaceCapability(result, capability);

  return { ...result, workspace: result.workspace };
}
