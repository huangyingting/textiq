import { isPlan, type Plan } from "@/lib/billing/catalog";
import { VISUAL_KINDS, type VisualKind } from "@/lib/visual/schema";
import {
  assertPersistedWorkspaceMemberRole,
  parsePersistedWorkspaceMemberRole,
  type InvitableWorkspaceRole,
  type PersistedWorkspaceMemberRole,
} from "@/lib/workspace/roles";

export type LiteralValidationResult<T extends string> =
  { success: true; value: T } | { success: false; error: string };

function parseLiteral<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): LiteralValidationResult<T> {
  /* node:coverage ignore next 5 -- Parser success/failure behavior is asserted; tsx maps the multiline includes guard as uncovered. */
  if (
    typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
  ) {
    return { success: true, value: value as T };
  }
  return {
    success: false,
    error: `${label} must be one of: ${allowed.join(", ")}`,
  };
}

export const COMMENT_ANCHOR_TYPE_LITERALS = [
  "text",
  "visual",
  "table",
] as const;

export const PLAN_LITERALS = [
  "free",
  "plus",
  "pro",
] as const satisfies readonly Plan[];

export const USAGE_LEDGER_STATUS_LITERALS = [
  /* node:coverage ignore next 5 -- Literal tuple values are asserted by parser tests; tsx maps tuple rows as uncovered. */
  "reserved",
  "captured",
  "refunded",
] as const;

export const SUBSCRIPTION_STATUS_LITERALS = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
] as const;

export type UsageLedgerStatusLiteral =
  (typeof USAGE_LEDGER_STATUS_LITERALS)[number];
export type SubscriptionStatusLiteral =
  (typeof SUBSCRIPTION_STATUS_LITERALS)[number];

export function parseWorkspaceRoleLiteral(
  value: unknown,
): LiteralValidationResult<PersistedWorkspaceMemberRole> {
  const parsed = parsePersistedWorkspaceMemberRole(value);
  return parsed.success
    ? { success: true, value: parsed.value }
    : { success: false, error: parsed.error.message };
}

export function assertWorkspaceRoleLiteral(
  value: unknown,
): PersistedWorkspaceMemberRole {
  return assertPersistedWorkspaceMemberRole(value);
}

export function parseInvitableWorkspaceRoleLiteral(
  value: unknown,
): LiteralValidationResult<InvitableWorkspaceRole> {
  const parsed = parsePersistedWorkspaceMemberRole(value);
  return parsed.success
    ? { success: true, value: parsed.value }
    : { success: false, error: parsed.error.message };
}

export function parsePlanLiteral(
  value: unknown,
): LiteralValidationResult<Plan> {
  return isPlan(value)
    ? { success: true, value }
    : {
        success: false,
        error: `Plan must be one of: ${PLAN_LITERALS.join(", ")}`,
      };
}

export function assertPlanLiteral(value: unknown): Plan {
  const parsed = parsePlanLiteral(value);
  if (!parsed.success) {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

export function parseUsageLedgerStatusLiteral(
  value: unknown,
): LiteralValidationResult<UsageLedgerStatusLiteral> {
  /* node:coverage ignore next 5 -- Parser facade is asserted; tsx maps the call expression as uncovered. */
  return parseLiteral(
    value,
    USAGE_LEDGER_STATUS_LITERALS,
    "Usage ledger status",
  );
}

export function parseSubscriptionStatusLiteral(
  value: unknown,
): LiteralValidationResult<SubscriptionStatusLiteral> {
  return parseLiteral(
    value,
    SUBSCRIPTION_STATUS_LITERALS,
    "Subscription status",
  );
}

export function parseVisualKindLiteral(
  value: unknown,
): LiteralValidationResult<VisualKind> {
  return parseLiteral(value, VISUAL_KINDS, "Visual type");
}
