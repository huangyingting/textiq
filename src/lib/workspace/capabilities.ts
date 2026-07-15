import type { EffectiveWorkspaceRole } from "./roles";

export type WorkspaceCapabilityFlags = {
  canView: boolean;
  canMutate: boolean;
  canManage: boolean;
};

export type WorkspaceAccessRole = EffectiveWorkspaceRole | "none";
export type WorkspaceCapabilityMode = "view" | "mutate" | "manage";

export const WORKSPACE_CAPABILITIES_BY_ROLE = {
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
  none: {
    canView: false,
    canMutate: false,
    canManage: false,
  },
} as const satisfies Record<WorkspaceAccessRole, WorkspaceCapabilityFlags>;

export function capabilitiesForWorkspaceAccessRole(
  role: WorkspaceAccessRole,
): WorkspaceCapabilityFlags {
  return WORKSPACE_CAPABILITIES_BY_ROLE[role];
}

export function workspaceRoleCan(
  role: WorkspaceAccessRole,
  capability: WorkspaceCapabilityMode,
): boolean {
  const capabilities = capabilitiesForWorkspaceAccessRole(role);
  if (capability === "view") {
    return capabilities.canView;
  }
  if (capability === "mutate") {
    return capabilities.canMutate;
  }
  return capabilities.canManage;
}
