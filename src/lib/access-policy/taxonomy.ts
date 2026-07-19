/**
 * Shared access-policy vocabulary for domain-specific permission helpers.
 *
 * This module intentionally does NOT define a generic role model. Document,
 * workspace, public-share, and invite policies keep their own pure role/mode
 * logic; they map their allow/deny outcomes into this small taxonomy for safe
 * adapters, diagnostics, and tests.
 */

export type AccessSubject =
  { kind: "anonymous" } | { kind: "user"; userId?: string };

/* node:coverage ignore next 7 -- Access resource kind union is a TypeScript-only taxonomy facade. */
export type AccessResourceKind =
  "document" | "workspace" | "share" | "invite" | "slide-asset" | "collab-room";

export type AccessResource = {
  kind: AccessResourceKind;
};

export type AccessCapabilityMode =
  | "view"
  | "edit"
  | "manage"
  | "mutate"
  | "embed"
  | "present"
  | "accept"
  | "serve"
  | "connect";

export type AccessDenialReason =
  | "unauthenticated"
  | "resource-not-found"
  | "resource-deleted"
  | "insufficient-capability"
  | "share-not-enabled"
  | "share-revoked"
  | "expired"
  | "mode-disabled"
  | "passcode-required"
  | "invite-revoked"
  | "invite-exhausted"
  | "invalid-role"
  | "asset-not-found"
  | "forbidden";

export type AccessHttpStatus = 401 | 403 | 404;

/* node:coverage ignore next 5 -- Access decision base fields are type-only source-map rows. */
export type AccessDecisionBase = {
  subject?: AccessSubject;
  resource: AccessResource;
  capability: AccessCapabilityMode;
};

export type AccessAllowedDecision = AccessDecisionBase & {
  allow: true;
};

export type AccessDeniedDecision = AccessDecisionBase & {
  allow: false;
  reason: AccessDenialReason;
  status: AccessHttpStatus;
  safeMessage: string;
  /**
   * True when adapters must avoid confirming that the resource exists. A
   * privacy-preserving 404 (or route-specific 403, such as collab authorize)
   * must not be "normalized" into a more revealing status.
   */
  concealResource: boolean;
};

export type AccessDecision = AccessAllowedDecision | AccessDeniedDecision;

export function allowAccess(
  decision: AccessDecisionBase,
): AccessAllowedDecision {
  return { ...decision, allow: true };
}

export function denyAccess(
  decision: AccessDecisionBase & {
    reason: AccessDenialReason;
    status: AccessHttpStatus;
    safeMessage: string;
    concealResource: boolean;
  },
): AccessDeniedDecision {
  return { ...decision, allow: false };
}
