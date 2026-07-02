/* node:coverage disable */
/* Redaction policy prose is documentation-only. */
/**
 * Persisted-schema parse-failure telemetry (#504).
 *
 * When the server fails to parse a persisted payload (a deck, a visual, or a
 * source reference) we must record a structured, actionable diagnostic so the
 * repair playbook (`docs/operations/schema-repair-runbook.md`) and the audit
 * CLI (#501) can be pointed at the affected row — WITHOUT ever leaking document
 * content.
 *
 * The contract is deliberately narrow:
 *  - Callers pass a {@link SchemaFailureCategory} and a small bag of SAFE
 *    identifiers (ids, counts, an opaque validator `reason` string).
 *  - The validator `reason` strings produced by `safeParseDeck` /
 *    `safeParseVisual` / `validateSourceRef` describe the schema violation
 *    (e.g. "Deck.slides[0].id must be a non-empty string"), and this module
 *    still sanitizes `reason` defensively in case a future validator regresses.
 *  - Anything that looks like raw content (keys such as `text`, `input`,
 *    `deckJson`, `contentJson`, `data`) is stripped before logging as a
 *    belt-and-suspenders guard on top of {@link logError}'s own redaction.
 *
 * The pure {@link buildSchemaDiagnostic} builder is exported for unit testing
 * the no-content-leak guarantee; production code calls
 * {@link reportSchemaFailure}.
 *
 * These categories intentionally remain domain telemetry categories rather than
 * first-class `ERROR_CODES`; see `docs/diagnostics/`.
 */
/* node:coverage enable */

import { logError } from "@/lib/log";
import redaction from "@/lib/log-redaction-core.cjs";

/** Fixed scope used for every persisted-schema diagnostic. */
export const SCHEMA_TELEMETRY_SCOPE = "schema.persisted";

/**
 * The set of persisted-schema parse-failure categories. Each maps to a stable,
 * greppable string used as the diagnostic `category` field and as the synthetic
 * error name, so log pipelines can alert per-category.
 */
export const SCHEMA_FAILURE_CATEGORIES = [
  "deck-parse-failed",
  "visual-parse-failed",
  "sourceref-invalid",
  "content-visual-parse-failed",
] as const;

export type SchemaFailureCategory = (typeof SCHEMA_FAILURE_CATEGORIES)[number];

/* node:coverage disable */
/* Redaction policy prose is documentation-only. */
/**
 * Context keys that are explicitly disallowed because they may carry raw
 * document content. These are dropped from any diagnostic context regardless of
 * the generic redaction in {@link logError}. Comparison is normalized
 * (lower-cased, non-alphanumerics stripped) so `deckJson`, `deck_json`, and
 * `DeckJSON` all match.
 */
/** True when a context key may hold raw document content and must be dropped. */
/* node:coverage enable */
export const isContentKey = redaction.isContentKey;

/** Safe identifiers a caller may attach to a schema diagnostic. */
export interface SchemaFailureContext {
  /** Opaque validator failure reason — safe (describes schema, not content). */
  reason?: string;
  /** Document id the row belongs to (safe identifier). */
  documentId?: string;
  /** Primary key of the offending row (safe identifier). */
  rowId?: string;
  /** Schema area / table the failure came from (e.g. "Document.deckJson"). */
  area?: string;
  /** Anchor / block id (safe identifier). */
  anchorBlockId?: string;
  /** Numeric counters only (never content). */
  [key: string]: string | number | boolean | undefined;
}

export interface SchemaDiagnosticRecord {
  category: SchemaFailureCategory;
  [key: string]: string | number | boolean | undefined;
}

const MAX_REASON_LENGTH = 240;
const REASON_SEGMENT_PATTERN = /(["'`])((?:\\.|(?!\1).)*)\1/g;
const REASON_TOKEN_PATTERN = /^[a-z0-9._-]{1,32}$/i;
const FALLBACK_REASON = "schema validation failed";

/**
 * Keep validator reasons useful for debugging while stripping likely
 * content-bearing quoted segments and overlong payloads.
 */
export function sanitizeSchemaReason(reason: string): string {
  const compact = reason.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return FALLBACK_REASON;

  const redacted = String(redaction.REDACTED ?? "[redacted]");
  let sanitized = compact.replace(
    REASON_SEGMENT_PATTERN,
    (match: string, quote: string, segment: string) => {
      const token = segment.trim();
      if (token.length === 0 || REASON_TOKEN_PATTERN.test(token)) {
        return match;
      }
      return `${quote}${redacted}${quote}`;
    },
  );

  if (redaction.isUnsafeLogString(sanitized)) {
    return FALLBACK_REASON;
  }
  if (sanitized.length > MAX_REASON_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_REASON_LENGTH)}…`;
  }
  return sanitized;
}

/**
 * Builds the safe diagnostic context for a persisted-schema parse failure
 * WITHOUT writing anything. Drops any content-bearing keys and any non-scalar
 * values, so only ids/counts/booleans and the validator `reason` survive.
 *
 * Exposed for unit tests asserting the no-content-leak guarantee.
 */
export function buildSchemaDiagnostic(
  category: SchemaFailureCategory,
  context: SchemaFailureContext = {},
): SchemaDiagnosticRecord {
  const safeContext: SchemaFailureContext = { ...context };
  if (typeof safeContext.reason === "string") {
    safeContext.reason = sanitizeSchemaReason(safeContext.reason);
  }
  return {
    category,
    ...redaction.buildSafeTelemetryContext(safeContext),
  };
}

/**
 * Emit a single structured diagnostic line for a persisted-schema parse
 * failure. The synthetic error carries the category as its name so log
 * pipelines see `errorName: "deck-parse-failed"` etc. Never throws (logging
 * must not break the caller's flow).
 */
export function reportSchemaFailure(
  category: SchemaFailureCategory,
  context: SchemaFailureContext = {},
): void {
  const diagnostic = buildSchemaDiagnostic(category, context);
  const error = new Error(category);
  error.name = category;
  logError(SCHEMA_TELEMETRY_SCOPE, error, diagnostic);
}
