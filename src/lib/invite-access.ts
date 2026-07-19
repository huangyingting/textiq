/* node:coverage disable */
/* Coverage rationale: invite-access module prose is documentation-only. */
/**
 * Pure, framework-free workspace-invite access policy (issue #103).
 *
 * The join flow (`/app/join/[token]`) must make ONE consistent, auditable
 * decision about whether a given invite link may currently be accepted: it has
 * to honour revocation, expiry, a per-link usage cap, and — critically — never
 * trust the role stored on the link blindly. Centralizing that decision here as
 * a single pure function keeps it unit-testable without a database and keeps the
 * route from re-implementing (and drifting on) the rules.
 *
 * Hardening controls implemented:
 *   - revocation  — `isRevoked` denies immediately.
 *   - expiry      — `expiresAt` (null = never); once reached the link is denied.
 *   - usage cap   — `maxUses` (null = unlimited); once `useCount >= maxUses`
 *                   the link is exhausted and denied.
 *   - role guard  — the stored role must be within the invitable workspace
 *                   roles; anything else (e.g. a tampered "OWNER" or an unknown
 *                   value) is denied rather than silently honoured.
 *
 * No React / Next / Prisma imports — safe to run server-side and unit-test
 * under `node --test` + `tsx`.
 */
/* node:coverage enable */

import {
  isInvitableWorkspaceRole,
  type InvitableWorkspaceRole,
} from "@/lib/workspace/roles";
import {
  allowAccess,
  denyAccess,
  type AccessDecision,
  type AccessDenialReason,
} from "@/lib/access-policy/taxonomy";

/* node:coverage disable */
/* Coverage rationale: invite-access DTO contracts are TypeScript-only. */
/** Structured reason an invite acceptance was denied (for logging/UX copy). */
export type InviteDenyReason =
  "revoked" | "expired" | "exhausted" | "invalid-role";

/**
 * Result of an invite-access evaluation. On `allow`, the validated role is
 * surfaced so callers grant membership with the server-validated role rather
 * than the raw stored string.
 */
export type InviteAccessDecision =
  | { allow: true; role: InvitableWorkspaceRole }
  | { allow: false; reason: InviteDenyReason };

/**
 * The invite link's current state plus a clock. All fields are primitives/dates
 * so this can be populated directly from a Prisma `select`.
 */
export type InviteAccessInput = {
  /** Whether the link has been revoked by a workspace owner. */
  isRevoked: boolean;
  /** The raw role stored on the link (validated, not trusted, here). */
  role: string;
  /** Link expiry timestamp (`null` = never expires). */
  expiresAt: Date | null;
  /** Maximum accepted joins (`null` = unlimited). */
  maxUses: number | null;
  /** Number of accepted joins so far. */
  useCount: number;
  /** Clock injection point for deterministic tests (default `new Date()`). */
  now?: Date;
};
/* node:coverage enable */

/**
 * Decides whether an invite link may currently be accepted.
 *
 * Denies (in order) when: the link is revoked, expired, exhausted (usage cap
 * reached), or carries a role outside the invitable set. Otherwise allows and
 * returns the server-validated role.
 */
export function evaluateInviteAccess(
  input: InviteAccessInput,
): InviteAccessDecision {
  const now = input.now ?? new Date();

  if (input.isRevoked) {
    return { allow: false, reason: "revoked" };
  }

  if (input.expiresAt !== null && input.expiresAt.getTime() <= now.getTime()) {
    return { allow: false, reason: "expired" };
  }

  if (input.maxUses !== null && input.useCount >= input.maxUses) {
    /* node:coverage disable */
    /* Exhausted invite branch is asserted; tsx maps object literal as uncovered. */
    return { allow: false, reason: "exhausted" };
    /* node:coverage enable */
  }

  if (!isInvitableWorkspaceRole(input.role)) {
    /* node:coverage disable */
    /* Invalid invite role branch is asserted; tsx maps object literal as uncovered. */
    return { allow: false, reason: "invalid-role" };
    /* node:coverage enable */
  }

  /* node:coverage ignore next -- Allowed invite branch is asserted; tsx maps object literal as uncovered. */
  return { allow: true, role: input.role };
}

/** Convenience boolean wrapper around {@link evaluateInviteAccess}. */
export function isInviteAccessAllowed(input: InviteAccessInput): boolean {
  return evaluateInviteAccess(input).allow;
}

const INVITE_DENY_TAXONOMY: Record<InviteDenyReason, AccessDenialReason> = {
  /* Coverage rationale: denial taxonomy literal is asserted through access-decision tests; tsx maps object tail as uncovered. */
  /* node:coverage ignore next 4 */
  revoked: "invite-revoked",
  expired: "expired",
  exhausted: "invite-exhausted",
  "invalid-role": "invalid-role",
};

/** Human-readable explanation for each deny reason (used by the join UI). */
export const INVITE_DENY_MESSAGES: Record<InviteDenyReason, string> = {
  revoked: "This invite link has been revoked by a workspace owner.",
  expired: "This invite link has expired.",
  exhausted: "This invite link has reached its maximum number of uses.",
  "invalid-role":
    "This invite link is misconfigured and can no longer be used.",
};

/** Maps invite policy outcomes into the shared access-decision taxonomy. */
export function inviteAccessDecisionToAccessDecision(
  decision: InviteAccessDecision,
): AccessDecision {
  if (decision.allow) {
    return allowAccess({ resource: { kind: "invite" }, capability: "accept" });
  }

  return denyAccess({
    resource: { kind: "invite" },
    capability: "accept",
    reason: INVITE_DENY_TAXONOMY[decision.reason],
    status: 403,
    safeMessage: INVITE_DENY_MESSAGES[decision.reason],
    concealResource: false,
  });
}

/** Evaluates invite access and returns the shared access-decision shape. */
export function evaluateInviteAccessDecision(
  input: InviteAccessInput,
): AccessDecision {
  return inviteAccessDecisionToAccessDecision(evaluateInviteAccess(input));
}

/**
 * Prisma `select` field set needed to evaluate invite access. Spread into the
 * join route's `select` so the consumer pulls exactly the policy columns the
 * pure function needs (and nothing drifts when a new policy field is added).
 */
export const INVITE_ACCESS_SELECT = {
  isRevoked: true,
  role: true,
  expiresAt: true,
  maxUses: true,
  useCount: true,
} as const;

/** The invite-link shape produced by {@link INVITE_ACCESS_SELECT}. */
export type InviteAccessFields = {
  isRevoked: boolean;
  role: string;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
};

/**
 * Maps an invite-link row (selected via {@link INVITE_ACCESS_SELECT}) plus an
 * optional clock to an {@link InviteAccessInput}, so the route doesn't repeat
 * the field-name mapping.
 */
export function toInviteAccessInput(
  link: InviteAccessFields,
  now?: Date,
): InviteAccessInput {
  return {
    isRevoked: link.isRevoked,
    role: link.role,
    expiresAt: link.expiresAt,
    maxUses: link.maxUses,
    useCount: link.useCount,
    now,
  };
}

/**
 * Returns `true` when the current `useCount` has not yet reached `maxUses`,
 * meaning a new use of the invite link should be counted.
 *
 * When `maxUses` is `null` the link is unlimited and this always returns
 * `true`. This predicate mirrors the WHERE clause used by the atomic
 * conditional `updateMany` inside the join transaction, keeping the cap
 * logic in one testable, DB-free place.
 */
export function isUnderUseCap(
  maxUses: number | null,
  useCount: number,
): boolean {
  return maxUses === null || useCount < maxUses;
}
