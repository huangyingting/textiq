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
 *  - Callers pass a {@link SchemaFailureCategory} and canonical non-sensitive
 *    codes/counts only.
 *  - Validator messages, paths, property keys, and caught errors are never
 *    accepted into the emitted record.
 *  - Only strict opaque identifiers for known repair keys are accepted.
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
import {
  DECK_VALIDATION_CODES,
  isDeckValidationCode,
} from "@/lib/presentation/validation";

/** Fixed scope used for every persisted-schema diagnostic. */
export const SCHEMA_TELEMETRY_SCOPE = "schema.persisted";

/**
 * The set of persisted-schema parse-failure categories. Each maps to a stable,
 * greppable string used as the diagnostic `category` field.
 */
export const SCHEMA_FAILURE_CATEGORIES = [
  "deck-parse-failed",
  "visual-parse-failed",
  "sourceref-invalid",
  "content-visual-parse-failed",
] as const;

export type SchemaFailureCategory = (typeof SCHEMA_FAILURE_CATEGORIES)[number];

export const SCHEMA_TELEMETRY_CODES = [
  "schema_validation_failed",
  ...DECK_VALIDATION_CODES,
] as const;

export type SchemaTelemetryCode = (typeof SCHEMA_TELEMETRY_CODES)[number];

const SCHEMA_FAILURE_AREAS = new Set([
  "Document.deckJson",
  "Document.contentJson:visual",
  "DocumentVersion.deckJson",
  "DocumentVersion.contentJson:visual",
  "Visual.data",
  "persistDeck.input",
]);

const SAFE_SCHEMA_IDENTIFIER_KEYS = [
  "documentId",
  "rowId",
  "anchorBlockId",
] as const;

const SAFE_SCHEMA_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isSafeSchemaIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && SAFE_SCHEMA_IDENTIFIER_PATTERN.test(value)
  );
}

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

export interface SchemaFailureContext {
  code?: unknown;
  area?: string;
  issueCount?: number;
  schemaVersion?: number;
  documentId?: unknown;
  rowId?: unknown;
  anchorBlockId?: unknown;
  [key: string]: unknown;
}

export interface SchemaDiagnosticRecord {
  category: SchemaFailureCategory;
  code: SchemaTelemetryCode;
  area?: string;
  issueCount?: number;
  schemaVersion?: number;
  documentId?: string;
  rowId?: string;
  anchorBlockId?: string;
  [key: string]: unknown;
}

function normalizeSchemaTelemetryCode(code: unknown): SchemaTelemetryCode {
  return typeof code === "string" && isDeckValidationCode(code)
    ? code
    : "schema_validation_failed";
}

/**
 * Builds a canonical log-safe diagnostic without forwarding caller strings.
 *
 * Exposed for unit tests asserting the no-content-leak guarantee.
 */
export function buildSchemaDiagnostic(
  category: SchemaFailureCategory,
  context: SchemaFailureContext = {},
): SchemaDiagnosticRecord {
  const diagnostic: SchemaDiagnosticRecord = {
    category,
    code: normalizeSchemaTelemetryCode(context.code),
  };
  if (
    typeof context.area === "string" &&
    SCHEMA_FAILURE_AREAS.has(context.area)
  ) {
    diagnostic.area = context.area;
  }
  if (
    Number.isSafeInteger(context.issueCount) &&
    Number(context.issueCount) >= 0
  ) {
    diagnostic.issueCount = Number(context.issueCount);
  }
  if (
    Number.isSafeInteger(context.schemaVersion) &&
    Number(context.schemaVersion) >= 0
  ) {
    diagnostic.schemaVersion = Number(context.schemaVersion);
  }
  for (const key of SAFE_SCHEMA_IDENTIFIER_KEYS) {
    const value = context[key];
    if (isSafeSchemaIdentifier(value)) {
      diagnostic[key] = value;
    }
  }
  return diagnostic;
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
  const error = new Error("Persisted schema validation failed");
  error.name = "SchemaValidationError";
  logError(SCHEMA_TELEMETRY_SCOPE, error, diagnostic);
}
