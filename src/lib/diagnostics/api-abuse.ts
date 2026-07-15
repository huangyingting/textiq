/**
 * Abuse-control observability for public, expensive endpoints (Epic #495,
 * issue #512).
 *
 * The public AI and import routes (`/api/generate`, `/api/generate-deck`,
 * `/api/import`) are the surfaces most exposed to abuse: they are reachable
 * without a session and each call can be costly (an LLM round-trip or a heavy
 * document parse). When one of those routes turns a caller away — a rate-limit
 * window is full, an anonymous trial is exhausted, a parser/AI call times out,
 * or a credit balance is empty — operators need a structured, greppable signal
 * to spot attacks and tune limits.
 *
 * This module is the ONE place those denials are reported. It emits a single
 * structured `logInfo` line per denial through `@/lib/log`, carrying ONLY safe
 * fields: a route tag, a fixed category, the HTTP status, and optional
 * already-hashed/opaque identifiers (a hashed rate-limit subject, a document
 * id, a user id). It NEVER accepts — and by construction cannot forward — the
 * prompt text, imported file contents, or raw bytes that triggered the denial.
 */

import { logInfo } from "@/lib/log";

/** Scope tag for every abuse-control log line. */
const LOG_SCOPE = "api.abuse";

/** Stable structured message for the emitted log line. */
const DENIAL_MESSAGE = "route-denial";

/**
 * Fixed abuse categories. STABLE identifiers — log pipelines and alerts key on
 * these, so do NOT rename or remove a value.
 */
export const ABUSE_CATEGORIES = {
  /** A fixed-window rate limit (per-user or per-IP) was exhausted → 429. */
  RATE_LIMIT_HIT: "rate-limit-hit",
  /** An anonymous caller's lifetime trial quota was used up → 429. */
  ANON_QUOTA_DENIED: "anon-quota-denied",
  /** A document parse exceeded its timeout budget → 422. */
  PARSER_TIMEOUT: "parser-timeout",
  /** A document archive exceeded parser-complexity budgets → 422. */
  PARSER_BUDGET: "parser-budget",
  /** An AI generation call exceeded its abort deadline → 504. */
  AI_TIMEOUT: "ai-timeout",
  /** A metered caller had insufficient credits → 402. */
  /* Coverage rationale: literal category member is asserted through diagnostics tests; tsx maps object tail as uncovered. */
  /* node:coverage ignore next */
  CREDIT_DENIED: "credit-denied",
} as const;

export type AbuseCategory =
  (typeof ABUSE_CATEGORIES)[keyof typeof ABUSE_CATEGORIES];

/**
 * A single abuse-control denial event. Every field is a safe scalar: a route
 * tag, a fixed category, a status code, and optional OPAQUE identifiers.
 *
 * Note there is deliberately no field for prompt text, file content, or bytes —
 * the type makes content leakage impossible at the call site.
 */
export interface RouteDenialEvent {
  /** Short route tag, e.g. `"api.generate"`. */
  route: string;
  /** The abuse category (one of {@link ABUSE_CATEGORIES}). */
  reason: AbuseCategory;
  /** The HTTP status the route returned for this denial. */
  status: number;
  /** Optional already-hashed rate-limit subject (never a raw IP). */
  subjectHash?: string;
  /** Optional document id involved in the denial. */
  docId?: string;
  /** Optional authenticated user id. */
  userId?: string;
  /** Optional `Retry-After` seconds advertised to the caller. */
  retryAfterSeconds?: number;
}

/**
 * Builds the safe log context for a denial event WITHOUT writing anything.
 * Only the allowlisted scalar fields are copied through; optional fields are
 * omitted when absent. Exposed for unit tests (assert no content leakage).
 */
export function buildRouteDenialContext(
  event: RouteDenialEvent,
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    route: event.route,
    category: event.reason,
    status: event.status,
  };
  if (event.subjectHash !== undefined) {
    context.subjectHash = event.subjectHash;
  }
  if (event.docId !== undefined) {
    context.docId = event.docId;
  }
  if (event.userId !== undefined) {
    context.userId = event.userId;
  }
  if (event.retryAfterSeconds !== undefined) {
    context.retryAfterSeconds = event.retryAfterSeconds;
  }
  return context;
}

/**
 * Emit a single structured abuse-control denial line. Best-effort: delegates to
 * {@link logInfo}, which never throws, so instrumenting a route can never break
 * request handling.
 */
export function logRouteDenial(event: RouteDenialEvent): void {
  logInfo(LOG_SCOPE, DENIAL_MESSAGE, buildRouteDenialContext(event));
}
