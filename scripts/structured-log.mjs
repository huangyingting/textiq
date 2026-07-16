/**
 * Structured JSON logger for plain Node `.mjs` scripts.
 *
 * Mirrors the app logger shape (`timestamp`, `level`, `scope`, `message`) while
 * avoiding TS path aliases so collaboration scripts can import it directly.
 */
import redaction from "../src/lib/log-redaction-core.cjs";

const { buildLogRecord, normalizeErrorForLog } = redaction;

function emit(writer, record) {
  try {
    writer(JSON.stringify(record));
  } catch {
    // Logging must never break runtime scripts.
  }
}

export function buildScriptLogRecord(level, scope, message, context = {}) {
  return buildLogRecord({
    level,
    scope,
    context,
    fields: { message },
  });
}

export function buildScriptErrorLog(scope, error, context = {}) {
  const normalized = normalizeErrorForLog(error);
  return buildLogRecord({
    level: "error",
    scope,
    context,
    fields: normalized,
  });
}

export function logScriptInfo(scope, message, context = {}) {
  emit(
    (line) => console.info(line),
    buildScriptLogRecord("info", scope, message, context),
  );
}

export function logScriptWarning(scope, message, context = {}) {
  emit(
    (line) => console.warn(line),
    buildScriptLogRecord("warning", scope, message, context),
  );
}

export function logScriptError(scope, error, context = {}) {
  emit(
    (line) => console.error(line),
    buildScriptErrorLog(scope, error, context),
  );
}
