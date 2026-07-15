import type { EffectiveWorkspaceRole } from "./roles";

export type WorkspaceCapabilityFlags = {
  readonly canView: boolean;
  readonly canMutate: boolean;
  readonly canManage: boolean;
};

export type WorkspaceAccessRole = EffectiveWorkspaceRole | "none";
export type WorkspaceCapabilityMode = "view" | "mutate" | "manage";

// Private frozen canonical map — not exported to prevent runtime mutation of shared state.
// Callers must use the exported query functions below.
const CAPABILITIES = Object.freeze({
  owner: Object.freeze({ canView: true, canMutate: true, canManage: true }),
  editor: Object.freeze({ canView: true, canMutate: true, canManage: false }),
  viewer: Object.freeze({ canView: true, canMutate: false, canManage: false }),
  none: Object.freeze({ canView: false, canMutate: false, canManage: false }),
} as const satisfies Record<WorkspaceAccessRole, WorkspaceCapabilityFlags>);

export function capabilitiesForWorkspaceAccessRole(
  role: WorkspaceAccessRole,
): Readonly<WorkspaceCapabilityFlags> {
  return CAPABILITIES[role];
}

export function workspaceRoleCan(
  role: WorkspaceAccessRole,
  capability: WorkspaceCapabilityMode,
): boolean {
  const capabilities = CAPABILITIES[role];
  if (capability === "view") {
    return capabilities.canView;
  }
  if (capability === "mutate") {
    return capabilities.canMutate;
  }
  return capabilities.canManage;
}
