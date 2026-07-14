import assert from "node:assert/strict";
import test from "node:test";

import {
  REDACTED,
  buildErrorLog,
  isSensitiveKey,
  logError,
  normalizeLogKey,
} from "@/lib/log";
import { buildInfoLog, logInfo } from "@/lib/log";
import redaction from "@/lib/log-redaction-core.cjs";
import {
  buildScriptErrorLog,
  buildScriptLogRecord,
} from "../../scripts/structured-log.mjs";

test("buildErrorLog redacts configured sensitive context keys", () => {
  const record = buildErrorLog("api.generate", new Error("boom"), {
    requestId: "req-1",
    reason: "generation-failed",
    text: "raw user input that must never be logged",
    payload: { text: "nested raw content" },
    input: "another raw input",
    prompt: "system prompt",
    apiKey: "sk-super-secret",
    api_key: "sk-also-secret",
    AUTH_SECRET: "top-secret",
    password: "hunter2",
    passwordHash: "$2a$12$abc",
    Authorization: "Bearer xyz",
    cookie: "session=abc",
    accessToken: "tok-123",
  });

  for (const key of [
    "text",
    "payload",
    "input",
    "prompt",
    "apiKey",
    "api_key",
    "AUTH_SECRET",
    "password",
    "passwordHash",
    "Authorization",
    "cookie",
    "accessToken",
  ]) {
    assert.equal(record[key], REDACTED, `expected ${key} to be redacted`);
  }

  // Non-sensitive correlation/diagnostic fields are preserved.
  assert.equal(record.requestId, "req-1");
  assert.equal(record.reason, "generation-failed");
});

test("buildErrorLog redacts PII-like message, stack, and generic context strings", () => {
  const error = new Error("failed for ada@example.com");
  error.stack = "Error: failed for ada@example.com\n    at x";
  const record = buildErrorLog("api.generate", error, {
    reason: "safe-code",
    emailLikeValue: "ada@example.com",
  });

  assert.equal(record.message, REDACTED);
  assert.equal(record.stack, REDACTED);
  assert.equal(record.emailLikeValue, REDACTED);
  assert.equal(record.reason, "safe-code");
});

test("buildErrorLog keeps reserved fields authoritative", () => {
  const record = buildErrorLog("my.scope", new Error("kaboom"), {
    level: "info",
    scope: "spoofed",
    message: "spoofed message",
  });

  assert.equal(record.level, "error");
  assert.equal(record.scope, "my.scope");
  assert.equal(record.message, "kaboom");
  assert.equal(record.errorName, "Error");
  assert.equal(typeof record.timestamp, "string");
});

test("buildErrorLog normalizes non-Error values", () => {
  assert.equal(buildErrorLog("s", "just a string").message, "just a string");
  assert.equal(buildErrorLog("s", { code: 7 }).message, '{"code":7}');
  assert.equal(buildErrorLog("s", "x").errorName, "Error");
});

test("buildErrorLog stringifies unserializable non-Error values safely", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  assert.equal(buildErrorLog("s", circular).message, "[object Object]");
});

test("isSensitiveKey matches secrets and raw-input keys, not safe ones", () => {
  for (const key of [
    "text",
    "input",
    "prompt",
    "apiKey",
    "api_key",
    "AUTH_SECRET",
    "password",
    "passwordHash",
    "authorization",
    "cookie",
    "refreshToken",
  ]) {
    assert.equal(isSensitiveKey(key), true, `${key} should be sensitive`);
  }
  for (const key of ["requestId", "reason", "scope", "status", "durationMs"]) {
    assert.equal(isSensitiveKey(key), false, `${key} should be safe`);
  }
});

test("normalizeLogKey strips separators and casing for shared redaction", () => {
  assert.equal(normalizeLogKey("AUTH_SECRET"), "authsecret");
  assert.equal(normalizeLogKey("api-key"), "apikey");
  assert.equal(normalizeLogKey("DeckJSON"), "deckjson");
});

test("logError emits a single JSON line with no raw newline", () => {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    logError("api.generate", new Error("with\nnewline\nstack"), {
      requestId: "abc",
      apiKey: "secret",
    });
  } finally {
    console.error = original;
  }

  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.ok(!line.includes("\n"), "log line must not contain a raw newline");
  const parsed = JSON.parse(line) as Record<string, unknown>;
  assert.equal(parsed.level, "error");
  assert.equal(parsed.scope, "api.generate");
  assert.equal(parsed.requestId, "abc");
  assert.equal(parsed.apiKey, REDACTED);
});

test("logError swallows console serialization failures", () => {
  const original = console.error;
  console.error = () => {
    throw new Error("stderr unavailable");
  };
  try {
    assert.doesNotThrow(() => logError("api.generate", new Error("boom")));
  } finally {
    console.error = original;
  }
});

test("buildInfoLog redacts sensitive context keys and keeps counts", () => {
  const record = buildInfoLog("api.generate-deck", "deck-generated", {
    requestId: "req-9",
    slideCount: 12,
    wordsPerSlide: 18.5,
    text: "raw outline content that must never be logged",
    apiKey: "sk-secret",
  });

  assert.equal(record.level, "info");
  assert.equal(record.scope, "api.generate-deck");
  assert.equal(record.message, "deck-generated");
  assert.equal(record.requestId, "req-9");
  assert.equal(record.slideCount, 12);
  assert.equal(record.wordsPerSlide, 18.5);
  assert.equal(record.text, REDACTED);
  assert.equal(record.apiKey, REDACTED);
});

test("buildInfoLog keeps reserved fields authoritative", () => {
  const record = buildInfoLog("my.scope", "real-message", {
    level: "error",
    scope: "spoofed",
    message: "spoofed message",
  });

  assert.equal(record.level, "info");
  assert.equal(record.scope, "my.scope");
  assert.equal(record.message, "real-message");
  assert.equal(typeof record.timestamp, "string");
});

test("app and script info record builders stay field-for-field aligned", () => {
  const context = {
    requestId: "req-7",
    message: "spoofed-message",
    scope: "spoofed-scope",
    token: "secret-token",
  };
  const appRecord = buildInfoLog("collab.flush", "ok", context);
  const scriptRecord = buildScriptLogRecord(
    "info",
    "collab.flush",
    "ok",
    context,
  );

  assert.deepEqual(
    { ...appRecord, timestamp: "<fixed>" },
    { ...scriptRecord, timestamp: "<fixed>" },
  );
  assert.deepEqual(Object.keys(appRecord), Object.keys(scriptRecord));
});

test("app and script error record builders stay field-for-field aligned", () => {
  const err = new TypeError("request failed: https://api.example.com/secret");
  err.stack =
    "TypeError: request failed: https://api.example.com/secret\n at x";
  const context = {
    requestId: "req-8",
    errorName: "spoofed",
    message: "spoofed",
    Authorization: "Bearer secret",
    payload: { text: "raw content" },
  };
  const appRecord = buildErrorLog("collab.sync", err, context);
  const scriptRecord = buildScriptErrorLog("collab.sync", err, context);

  assert.deepEqual(
    { ...appRecord, timestamp: "<fixed>" },
    { ...scriptRecord, timestamp: "<fixed>" },
  );
  assert.deepEqual(Object.keys(appRecord), Object.keys(scriptRecord));
  assert.equal(appRecord.message, REDACTED);
  assert.equal(appRecord.Authorization, REDACTED);
});

test("logInfo emits a single JSON line with no raw newline", () => {
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    logInfo("api.generate-deck", "deck-generated", {
      requestId: "abc",
      slideCount: 5,
      apiKey: "secret",
    });
  } finally {
    console.info = original;
  }

  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.ok(!line.includes("\n"), "log line must not contain a raw newline");
  const parsed = JSON.parse(line) as Record<string, unknown>;
  assert.equal(parsed.level, "info");
  assert.equal(parsed.scope, "api.generate-deck");
  assert.equal(parsed.message, "deck-generated");
  assert.equal(parsed.requestId, "abc");
  assert.equal(parsed.slideCount, 5);
  assert.equal(parsed.apiKey, REDACTED);
});

test("logInfo swallows console serialization failures", () => {
  const original = console.info;
  console.info = () => {
    throw new Error("stdout unavailable");
  };
  try {
    assert.doesNotThrow(() => logInfo("api.generate-deck", "deck-generated"));
  } finally {
    console.info = original;
  }
});

// --- issue-1833: embedded URL / Bearer redaction ---

test("buildErrorLog redacts embedded https URL in Error message and stack", () => {
  const err = new Error("request failed: https://api.example.com/secret-path");
  err.stack =
    "Error: request failed: https://api.example.com/secret-path\n    at Object.<anonymous> (app.js:1:1)";
  const record = buildErrorLog("api.fetch", err);
  assert.equal(
    record.message,
    REDACTED,
    "embedded URL in message must be redacted",
  );
  assert.equal(
    record.stack,
    REDACTED,
    "embedded URL in stack must be redacted",
  );
  assert.equal(record.errorName, "Error");
});

test("buildErrorLog redacts embedded Bearer token in Error message", () => {
  const err = new Error("auth failed: Bearer synthetic-token-abc123");
  const record = buildErrorLog("api.auth", err);
  assert.equal(
    record.message,
    REDACTED,
    "embedded Bearer in message must be redacted",
  );
  assert.equal(record.errorName, "Error");
});

test("buildErrorLog redacts embedded URL in direct string error", () => {
  const record = buildErrorLog(
    "api.fetch",
    "upstream error: https://internal.example.com/api?key=val",
  );
  assert.equal(
    record.message,
    REDACTED,
    "embedded URL in string error must be redacted",
  );
  assert.equal(record.errorName, "Error");
});

test("buildErrorLog redacts object error with embedded URL serialized by safeStringify", () => {
  const record = buildErrorLog("api.fetch", {
    code: 403,
    endpoint: "https://api.example.com/data",
  });
  assert.equal(
    record.message,
    REDACTED,
    "safeStringify output with embedded URL must be redacted",
  );
  assert.equal(record.errorName, "Error");
});

test("email, API-key-like, and card-like synthetic patterns remain redacted", () => {
  const emailErr = buildErrorLog(
    "api.auth",
    new Error("user user@example.com submitted form"),
  );
  assert.equal(
    emailErr.message,
    REDACTED,
    "email-embedded message must be redacted",
  );

  const keyErr = buildErrorLog(
    "api.stripe",
    new Error("rejected: sk_live_abc12345678"),
  );
  assert.equal(
    keyErr.message,
    REDACTED,
    "api-key-embedded message must be redacted",
  );

  const cardErr = buildErrorLog(
    "api.payment",
    new Error("card 4111111111111111 declined"),
  );
  assert.equal(
    cardErr.message,
    REDACTED,
    "card-number-embedded message must be redacted",
  );
});

test("safe operational message remains byte-for-byte unchanged after sanitization", () => {
  const record = buildErrorLog("db.query", new Error("document not found"));
  assert.equal(record.message, "document not found");
  assert.equal(record.errorName, "Error");
  assert.equal(record.level, "error");
  assert.equal(record.scope, "db.query");
});

test("errorName and output shape are preserved when message is redacted", () => {
  const err = new TypeError("request failed: https://api.example.com/endpoint");
  const record = buildErrorLog("api.request", err);
  assert.equal(record.errorName, "TypeError");
  assert.equal(record.level, "error");
  assert.equal(record.message, REDACTED);
  assert.equal(typeof record.timestamp, "string");
  assert.equal(record.scope, "api.request");
});

test("context redaction detects embedded URL and Bearer values in string context fields", () => {
  const record = buildErrorLog("api.request", new Error("request failed"), {
    requestId: "req-safe-1",
    safeLabel: "generation-failed",
    endpoint: "service call to https://api.example.com/users",
    callDescription: "received: Bearer synthetic-token-xyz123",
  });
  assert.equal(
    record.endpoint,
    REDACTED,
    "context value with embedded URL must be redacted",
  );
  assert.equal(
    record.callDescription,
    REDACTED,
    "context value with embedded Bearer must be redacted",
  );
  assert.equal(record.requestId, "req-safe-1");
  assert.equal(record.safeLabel, "generation-failed");
});

test("buildLogRecord strips reserved keys from fields and keeps authoritative values", () => {
  const record = redaction.buildLogRecord({
    level: "debug" as const,
    scope: "test.scope",
    fields: {
      level: "spoofed-level",
      scope: "spoofed-scope",
      timestamp: "1970-01-01T00:00:00.000Z",
      requestId: "r1",
    },
  });

  assert.equal(record.level, "debug");
  assert.equal(record.scope, "test.scope");
  assert.notEqual(
    record.timestamp,
    "1970-01-01T00:00:00.000Z",
    "timestamp must be authoritative ISO string, not spoofed field value",
  );
  assert.equal(record.requestId, "r1");
});

// Compile-time type assertions for buildLogRecord — evaluated by tsc, not at runtime.
{
  // Reserved-key inputs must compile without error.
  const fields: {
    level: "spoofed";
    scope: "spoofed";
    timestamp: "spoofed";
    requestId: string;
  } = {
    level: "spoofed",
    scope: "spoofed",
    timestamp: "spoofed",
    requestId: "r1",
  };
  const record = redaction.buildLogRecord({
    level: "info" as const,
    scope: "s",
    fields,
  });

  // Non-reserved field retains declared type, not widened to unknown.
  const _safe: string = record.requestId;
  void _safe;

  // @ts-expect-error spoofed "level" field must not collapse or override authoritative TLevel
  const _level: "spoofed" = record.level;
  // @ts-expect-error spoofed "timestamp" field must not collapse or override authoritative string
  const _timestamp: "spoofed" = record.timestamp;
}
