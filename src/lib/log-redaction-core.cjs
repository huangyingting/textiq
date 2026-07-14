"use strict";

const REDACTED = "[redacted]";

const SENSITIVE_SUBSTRINGS = [
  "secret",
  "password",
  "passwd",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "privatekey",
];

const SENSITIVE_EXACT = new Set([
  "text",
  "input",
  "inputtext",
  "rawtext",
  "usertext",
  "prompt",
  "messages",
  "key",
]);

const CONTENT_KEYS = new Set([
  "deckjson",
  "contentjson",
  "data",
  "visual",
  "deck",
  "node",
  "payload",
  "raw",
  "rawdeck",
  "rawvisual",
  "value",
  "snapshot",
  "body",
]);

function normalizeLogKey(key) {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key) {
  const normalized = normalizeLogKey(key);
  if (SENSITIVE_EXACT.has(normalized)) {
    return true;
  }
  return SENSITIVE_SUBSTRINGS.some((part) => normalized.includes(part));
}

function isContentKey(key) {
  return CONTENT_KEYS.has(normalizeLogKey(key));
}

function redactContext(context = {}) {
  const out = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] =
      isSensitiveKey(key) ||
      isContentKey(key) ||
      (typeof value === "string" && isUnsafeLogString(value))
        ? REDACTED
        : value;
  }
  return out;
}

function isUnsafeLogString(value) {
  const trimmed = value.trim();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  return (
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(trimmed) ||
    // Detect URLs embedded anywhere in the string (not only at the start).
    /https?:\/\//i.test(trimmed) ||
    // Detect HTTP Bearer tokens embedded anywhere; \b prevents matching
    // mid-word and \S ensures at least one token character follows the space.
    /\bbearer\s+\S/i.test(trimmed) ||
    /(?:\d[ -]*?){13,19}/.test(trimmed) ||
    /(?:sk|rk|pk|whsec|tok|seti|pi|cs)_[A-Za-z0-9_=-]{8,}/.test(trimmed)
  );
}

function sanitizeLogString(value) {
  return isUnsafeLogString(value) ? REDACTED : value;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function normalizeErrorForLog(error) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      message: sanitizeLogString(error.message),
      ...(error.stack ? { stack: sanitizeLogString(error.stack) } : {}),
    };
  }
  if (typeof error === "string") {
    return { errorName: "Error", message: sanitizeLogString(error) };
  }
  return {
    errorName: "Error",
    message: sanitizeLogString(safeStringify(error)),
  };
}

function buildLogRecord({ level, scope, context = {}, fields = {} }) {
  const cleanedFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "level" || key === "scope" || key === "timestamp") {
      continue;
    }
    cleanedFields[key] = value;
  }
  return {
    ...redactContext(context),
    level,
    scope,
    timestamp: new Date().toISOString(),
    ...cleanedFields,
  };
}

function isSafeTelemetryScalar(value) {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function buildSafeTelemetryContext(context = {}) {
  const out = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    if (isContentKey(key)) continue;
    if (!isSafeTelemetryScalar(value)) continue;
    out[key] = isSensitiveKey(key) ? REDACTED : value;
  }
  return out;
}

module.exports = {
  REDACTED,
  normalizeLogKey,
  isSensitiveKey,
  isContentKey,
  redactContext,
  isSafeTelemetryScalar,
  buildSafeTelemetryContext,
  isUnsafeLogString,
  sanitizeLogString,
  normalizeErrorForLog,
  buildLogRecord,
};
