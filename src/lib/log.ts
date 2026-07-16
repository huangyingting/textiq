/**
 * Minimal structured error logging (US-019).
 *
 * `logError` emits exactly ONE JSON line to `stderr` (via `console.error`) so
 * logs aggregate cleanly in production log pipelines. It is deliberately
 * PII-aware: callers must never pass raw user input text or secrets in
 * `context`, and as a safety net any context key that looks sensitive (api
 * keys, tokens, cookies, passwords, the AUTH_SECRET, raw input/prompt text) is
 * redacted before the line is written.
 *
 * The module is framework-free (only `console`) so it is safe server-side and
 * unit-testable via {@link buildErrorLog}, which builds the record without
 * writing anything.
 *
 * Key normalization/redaction comes from `log-redaction-core.cjs` so plain
 * `.mjs` runtime scripts can use the same safety rules without TS path aliases.
 */

import redaction from "@/lib/log-redaction-core.cjs";

/** Replacement value written in place of a redacted sensitive context value. */
export const REDACTED = redaction.REDACTED;

/** Normalized key form used for log redaction comparisons. */
export const normalizeLogKey = redaction.normalizeLogKey;

/** True when a context key should be redacted before logging. */
export const isSensitiveKey = redaction.isSensitiveKey;
const buildLogRecord = redaction.buildLogRecord;
const normalizeErrorForLog = redaction.normalizeErrorForLog;

export interface ErrorLogRecord {
  level: "error";
  scope: string;
  timestamp: string;
  errorName: string;
  message: string;
  stack?: string;
  [key: string]: unknown;
}

/**
 * Build the structured error record (redacting sensitive context keys) WITHOUT
 * writing it. Exposed for unit tests; production code should call
 * {@link logError}.
 *
 * Reserved fields (`level`, `scope`, `timestamp`, `errorName`, `message`,
 * `stack`) always win over context keys, so a caller cannot clobber them.
 */
export function buildErrorLog(
  scope: string,
  error: unknown,
  context: Record<string, unknown> = {},
): ErrorLogRecord {
  const { errorName, message, stack } = normalizeErrorForLog(error);
  return buildLogRecord({
    level: "error",
    scope,
    context,
    fields: {
      errorName,
      message,
      ...(stack ? { stack } : {}),
    },
  });
}

/* node:coverage disable */
/* logError JSDoc is documentation-only; logging behavior is asserted. */
/**
 * Emit a single structured JSON error line to `stderr` (via `console.error`).
 * Sensitive context keys are redacted. Never throws (logging must not break
 * request handling).
 */
/* node:coverage enable */
export function logError(
  scope: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  try {
    console.error(JSON.stringify(buildErrorLog(scope, error, context)));
  } catch {
    // Logging must never break the caller.
  }
}

export interface InfoLogRecord {
  level: "info";
  scope: string;
  timestamp: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Build the structured info record (redacting sensitive context keys) WITHOUT
 * writing it. Exposed for unit tests; production code should call
 * {@link logInfo}.
 *
 * Reserved fields (`level`, `scope`, `timestamp`, `message`) always win over
 * context keys, so a caller cannot clobber them. Like {@link buildErrorLog},
 * any context key that looks sensitive (secrets/tokens/raw input text) is
 * redacted — callers must still only pass ids, counts, and numbers.
 */
export function buildInfoLog(
  scope: string,
  message: string,
  context: Record<string, unknown> = {},
): InfoLogRecord {
  return buildLogRecord({
    level: "info",
    scope,
    context,
    fields: { message },
  });
}

/**
 * Emit a single structured JSON info line to `stdout` (via `console.info`).
 * Sensitive context keys are redacted. Never throws (logging must not break
 * request handling). Use only for ids/counts/numbers — never document content
 * or PII.
 */
export function logInfo(
  scope: string,
  message: string,
  context: Record<string, unknown> = {},
): void {
  try {
    console.info(JSON.stringify(buildInfoLog(scope, message, context)));
  } catch {
    // Logging must never break the caller.
  }
}
