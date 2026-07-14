import type { EffectiveWorkspaceRole } from "./roles";

export type WorkspaceCapabilityFlags = {
  canView: boolean;
  canMutate: boolean;
  canManage: boolean;
};

export type WorkspaceAccessRole = EffectiveWorkspaceRole | "none";

export const WORKSPACE_CAPABILITIES_BY_EFFECTIVE_ROLE = {
  owner: {
    canView: true,
    canMutate: true,
    canManage: true,
  },
  editor: {
    canView: true,
    canMutate: true,
    canManage: false,
  },
  viewer: {
    canView: true,
    canMutate: false,
    canManage: false,
  },
} as const satisfies Record<EffectiveWorkspaceRole, WorkspaceCapabilityFlags>;

const NO_WORKSPACE_CAPABILITIES: WorkspaceCapabilityFlags = {
  canView: false,
  canMutate: false,
  canManage: false,
};

export function capabilitiesForEffectiveWorkspaceRole(
  role: EffectiveWorkspaceRole,
): WorkspaceCapabilityFlags {
  return WORKSPACE_CAPABILITIES_BY_EFFECTIVE_ROLE[role];
}

export function capabilitiesForWorkspaceAccessRole(
  role: WorkspaceAccessRole,
): WorkspaceCapabilityFlags {
  if (role === "none") {
    return NO_WORKSPACE_CAPABILITIES;
  }
  return capabilitiesForEffectiveWorkspaceRole(role);
}
