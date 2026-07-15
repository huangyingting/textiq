/**
 * Shared permission-builder factory (issue #1133).
 *
 * Both `document-permissions` and `workspace-capabilities` share an identical
 * algorithm:
 *
 *   1. Derive a role from an owner-id + flat member list.
 *   2. Map that role to three capability flags (canView, a mid-tier capability,
 *      and canManage) where owner gets all three, editor gets the first two,
 *      viewer gets only canView, and none gets none.
 *   3. Produce an `AccessDecision` for a capability check.
 *
 * This module provides the shared primitives so both consumers produce
 * structurally identical results from one implementation.
 */

import {
  parsePersistedWorkspaceMemberRole,
  persistedMemberRoleToEffectiveRole,
  type WorkspaceMemberRoleParseError,
} from "@/lib/workspace/roles";
import type { WorkspaceAccessRole } from "@/lib/workspace/capabilities";
import {
  allowAccess,
  denyAccess,
  type AccessCapabilityMode,
  type AccessDecision,
  type AccessResourceKind,
} from "@/lib/access-policy/taxonomy";

/** Shared access-role union (`none` means no relationship to the resource). */
export type ResourceRole = WorkspaceAccessRole;

/** Membership row shape shared by both resource types. */
export type MemberRow = { userId: string; role: string };

export type RoleResolutionDataIntegrity = {
  ownerId: string;
  userId: string;
  membershipRole: unknown;
  parseError: WorkspaceMemberRoleParseError;
};

/**
 * Raised when a persisted membership role cannot be interpreted safely.
 *
 * This is a data-integrity signal: permission consumers must surface it
 * explicitly (never coerce to viewer/owner and continue).
 */
export class RoleResolutionDataIntegrityError extends Error {
  readonly details: RoleResolutionDataIntegrity;

  constructor(details: RoleResolutionDataIntegrity) {
    super(details.parseError.message);
    this.name = "RoleResolutionDataIntegrityError";
    this.details = details;
  }
}

/**
 * Derives a `ResourceRole` from a flat owner-id and member list.
 *
 * - `owner` is derived ONLY from `ownerId`.
 * - membership rows may only contribute `editor` or `viewer`.
 * - malformed or `OWNER` membership rows throw
 *   {@link RoleResolutionDataIntegrityError}.
 */
export function deriveRoleFromOwnerAndMembers(
  ownerId: string,
  members: MemberRow[],
  userId: string,
): ResourceRole {
  if (ownerId === userId) return "owner";
  const membership = members.find((member) => member.userId === userId);
  if (!membership) {
    return "none";
  }

  const parsedMembershipRole = parsePersistedWorkspaceMemberRole(
    membership.role,
  );
  if (!parsedMembershipRole.success) {
    throw new RoleResolutionDataIntegrityError({
      ownerId,
      userId,
      membershipRole: membership.role,
      parseError: parsedMembershipRole.error,
    });
  }

  return persistedMemberRoleToEffectiveRole(parsedMembershipRole.value);
}

/**
 * Generic capability set produced by {@link createPermissionBuilder}.
 * `TMidCapKey` is the property name of the mid-tier capability
 * (e.g. `"canEdit"` or `"canMutate"`).
 */
export type ResourceCapabilities<TMidCapKey extends string> = {
  role: ResourceRole;
  canView: boolean;
  canManage: boolean;
} & Record<TMidCapKey, boolean>;

/**
 * Builds the `capabilitiesForRole` and `capabilityAccessDecision` functions for
 * a resource type.
 *
 * Parameterized by:
 * - `resource`    — the `AccessResourceKind` ("document" | "workspace")
 * - `midCapKey`   — property name of the mid-tier capability flag
 *                   (e.g. `"canEdit"` or `"canMutate"`)
 * - `midCapMode`  — the `AccessCapabilityMode` that governs the mid-tier check
 *                   (e.g. `"edit"` or `"mutate"`)
 * - `messages`    — per-resource denial messages
 */
export function createPermissionBuilder<TMidCapKey extends string>(config: {
  resource: AccessResourceKind;
  midCapKey: TMidCapKey;
  midCapMode: AccessCapabilityMode;
  messages: {
    notFound: string;
    midCapDenied: string;
    manageDenied: string;
  };
  isCapabilityAllowed?: (
    caps: ResourceCapabilities<TMidCapKey>,
    capability: AccessCapabilityMode,
  ) => boolean;
}): {
  capabilitiesForRole: (role: ResourceRole) => ResourceCapabilities<TMidCapKey>;
  capabilityAccessDecision: (
    caps: ResourceCapabilities<TMidCapKey>,
    capability: AccessCapabilityMode,
  ) => AccessDecision;
} {
  const { resource, midCapKey, midCapMode, messages, isCapabilityAllowed } =
    config;

  function capabilitiesForRole(
    role: ResourceRole,
  ): ResourceCapabilities<TMidCapKey> {
    const canMid = role === "owner" || role === "editor";
    return {
      role,
      canView: role !== "none",
      [midCapKey]: canMid,
      canManage: role === "owner",
    } as ResourceCapabilities<TMidCapKey>;
  }

  function capabilityAccessDecision(
    caps: ResourceCapabilities<TMidCapKey>,
    capability: AccessCapabilityMode,
  ): AccessDecision {
    if (!caps.canView) {
      return denyAccess({
        resource: { kind: resource },
        capability,
        reason: "resource-not-found",
        status: 404,
        safeMessage: messages.notFound,
        concealResource: true,
      });
    }
    const canMid = (caps as { [K in TMidCapKey]: boolean })[midCapKey];
    const defaultAllowed =
      capability === midCapMode
        ? canMid
        : capability === "manage"
          ? caps.canManage
          : true;
    const allowed = isCapabilityAllowed
      ? isCapabilityAllowed(caps, capability)
      : defaultAllowed;

    if (!allowed && capability === midCapMode) {
      return denyAccess({
        resource: { kind: resource },
        capability,
        reason: "insufficient-capability",
        status: 403,
        safeMessage: messages.midCapDenied,
        concealResource: false,
      });
    }
    if (!allowed && capability === "manage") {
      return denyAccess({
        resource: { kind: resource },
        capability,
        reason: "insufficient-capability",
        status: 403,
        safeMessage: messages.manageDenied,
        concealResource: false,
      });
    }
    return allowAccess({ resource: { kind: resource }, capability });
  }

  return { capabilitiesForRole, capabilityAccessDecision };
}
