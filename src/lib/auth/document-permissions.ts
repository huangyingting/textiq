/**
 * Centralized, role-aware document permission helper (issue #89).
 *
 * Every document mutation (and the editor UI) derives the acting user's
 * capabilities from a single place so authorization stays consistent. A user's
 * effective role for a document is derived from document ownership plus their
 * workspace relationship:
 *
 *   - owner  — owns the document, or owns its workspace
 *   - editor — `EDITOR` workspace member
 *   - viewer — `VIEWER` workspace member
 *   - none   — no access at all
 *
 * Persisted `OWNER`/unknown membership roles are treated as data-integrity
 * violations and surfaced explicitly.
 */

import { prisma } from "@/lib/prisma";
import {
  denyAccess,
  type AccessDecision,
  type AccessDeniedDecision,
} from "@/lib/access-policy/taxonomy";
import {
  type ResourceRole,
  createPermissionBuilder,
  deriveRoleFromOwnerAndMembers,
  RoleResolutionDataIntegrityError,
} from "./permission-builder";

/** Effective role of a user for a single document. */
export type DocumentRole = ResourceRole;

/** A document capability that a mutation/action can require. */
export type Capability = "view" | "edit" | "manage";

/** The resolved capability set for a (user, document) pair. */
export type DocumentCapabilities = {
  role: DocumentRole;
  canView: boolean;
  canEdit: boolean;
  canManage: boolean;
};

/**
 * Minimal document shape needed to derive a role. The `workspace.members` list
 * should contain membership row(s) for the acting user.
 */
export type DocumentRoleInput = {
  ownerId: string;
  workspaceId: string | null;
  workspace: {
    ownerId: string;
    members: { userId: string; role: string }[];
  } | null;
};

/** Minimal document identity returned by async permission lookups. */
export type DocumentIdentity = {
  id: string;
  ownerId: string;
  workspaceId: string | null;
};

/**
 * Thrown when a user attempts an action they are not authorized to perform.
 * The `capability` is `null` for pure "no access" decisions.
 */
export class DocumentPermissionError extends Error {
  readonly capability: Capability | null;
  readonly accessDecision: AccessDeniedDecision | null;

  constructor(
    message: string,
    capability: Capability | null = null,
    accessDecision: AccessDeniedDecision | null = null,
  ) {
    super(message);
    this.name = "DocumentPermissionError";
    this.capability = capability;
    this.accessDecision = accessDecision;
  }
}

function documentInvalidMembershipDecision(
  capability: Capability,
): AccessDeniedDecision {
  return denyAccess({
    resource: { kind: "document" },
    capability,
    reason: "invalid-role",
    status: 403,
    safeMessage:
      "Document permissions are misconfigured because workspace membership data is invalid.",
    concealResource: false,
  });
}

function asDocumentDataIntegrityPermissionError(
  capability: Capability,
  error: unknown,
): DocumentPermissionError | null {
  if (!(error instanceof RoleResolutionDataIntegrityError)) {
    return null;
  }
  const decision = documentInvalidMembershipDecision(capability);
  return new DocumentPermissionError(
    decision.safeMessage,
    capability,
    decision,
  );
}

/**
 * Derives the acting user's effective {@link DocumentRole} from document
 * ownership and workspace membership.
 */
export function deriveDocumentRole(
  document: DocumentRoleInput,
  userId: string,
): DocumentRole {
  if (document.ownerId === userId) {
    return "owner";
  }

  if (document.workspaceId && document.workspace) {
    return deriveRoleFromOwnerAndMembers(
      document.workspace.ownerId,
      document.workspace.members,
      userId,
    );
  }

  return "none";
}

/** Permission-builder instance for the document resource type. */
const _docBuilder = createPermissionBuilder({
  resource: "document",
  midCapKey: "canEdit" as const,
  midCapMode: "edit" as const,
  messages: {
    notFound: "Document not found.",
    midCapDenied: "You do not have permission to edit this document.",
    manageDenied: "You do not have permission to manage this document.",
  },
});

/** Maps a {@link DocumentRole} to its concrete capability flags. */
/* node:coverage ignore next 3 -- capabilitiesForRole is exercised; tsx maps this builder delegation as uncovered. */
export function capabilitiesForRole(role: DocumentRole): DocumentCapabilities {
  return _docBuilder.capabilitiesForRole(role);
}

/** Convenience: derive role and map capabilities in one pure call. */
export function documentCapabilities(
  document: DocumentRoleInput,
  userId: string,
): DocumentCapabilities {
  return capabilitiesForRole(deriveDocumentRole(document, userId));
}

/**
 * Throws a {@link DocumentPermissionError} when `capabilities` does not satisfy
 * the required `capability`.
 */
export function assertCapability(
  capabilities: DocumentCapabilities,
  capability: Capability,
): void {
  const decision = documentCapabilityAccessDecision(capabilities, capability);
  if (decision.allow) {
    return;
  }

  const deniedCapability = capabilities.canView ? capability : null;
  throw new DocumentPermissionError(
    decision.safeMessage,
    deniedCapability,
    decision,
  );
}

/** Maps a document capability check to the shared access-decision taxonomy. */
export function documentCapabilityAccessDecision(
  capabilities: DocumentCapabilities,
  capability: Capability,
): AccessDecision {
  return _docBuilder.capabilityAccessDecision(capabilities, capability);
}

/**
 * Fetches the document (with the acting user's membership context) and resolves
 * its capabilities.
 */
export async function getDocumentCapabilities(
  userId: string,
  documentId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<DocumentCapabilities & { document: DocumentIdentity | null }> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      ownerId: true,
      workspaceId: true,
      deletedAt: true,
      workspace: {
        select: {
          ownerId: true,
          members: {
            where: { userId },
            select: { userId: true, role: true },
          },
        },
      },
    },
  });

  if (!document || (document.deletedAt && !options.includeDeleted)) {
    return { ...capabilitiesForRole("none"), document: null };
  }

  const capabilities = documentCapabilities(document, userId);
  return {
    ...capabilities,
    document: {
      id: document.id,
      ownerId: document.ownerId,
      workspaceId: document.workspaceId,
    },
  };
}

/**
 * Authorizes the current user for `capability` on a document.
 */
export async function requireDocumentCapability(
  userId: string,
  documentId: string,
  capability: Capability,
  options: { includeDeleted?: boolean } = {},
): Promise<DocumentCapabilities & { document: DocumentIdentity }> {
  let result: DocumentCapabilities & { document: DocumentIdentity | null };
  try {
    result = await getDocumentCapabilities(userId, documentId, options);
  } catch (error) {
    const integrityError = asDocumentDataIntegrityPermissionError(
      capability,
      error,
    );
    if (integrityError) {
      throw integrityError;
    }
    throw error;
  }

  if (!result.document) {
    throw new DocumentPermissionError(
      "Document not found.",
      null,
      denyAccess({
        resource: { kind: "document" },
        capability,
        reason: "resource-not-found",
        status: 404,
        safeMessage: "Document not found.",
        concealResource: true,
      }),
    );
  }

  assertCapability(result, capability);

  return { ...result, document: result.document };
}
