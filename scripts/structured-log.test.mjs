import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildScriptErrorLog,
  buildScriptLogRecord,
  logScriptError,
  logScriptInfo,
  logScriptWarning,
} from "./structured-log.mjs";

describe("structured-log.mjs", () => {
  test("buildScriptLogRecord aligns core fields with app logs and redacts", () => {
    const record = buildScriptLogRecord("info", "collab.flush.result", "ok", {
      room: "doc-1",
      token: "secret-token",
      text: "raw document content",
      level: "error",
      scope: "spoofed",
      message: "spoofed",
    });

    assert.equal(record.level, "info");
    assert.equal(record.scope, "collab.flush.result");
    assert.equal(record.message, "ok");
    assert.equal(record.room, "doc-1");
    assert.equal(record.token, "[redacted]");
    assert.equal(record.text, "[redacted]");
    assert.ok(!JSON.stringify(record).includes("secret-token"));
    assert.ok(!JSON.stringify(record).includes("raw document content"));
  });

  test("buildScriptErrorLog records error fields and redacts context", () => {
    const record = buildScriptErrorLog(
      "collab.core.message",
      new TypeError("boom"),
      {
        cookie: "session=secret",
      },
    );

    assert.equal(record.level, "error");
    assert.equal(record.scope, "collab.core.message");
    assert.equal(record.errorName, "TypeError");
    assert.equal(record.message, "boom");
    assert.equal(record.cookie, "[redacted]");
  });

  test("buildScriptErrorLog normalizes string and circular error values", () => {
    assert.deepEqual(
      {
        errorName: buildScriptErrorLog("scope", "plain failure").errorName,
        message: buildScriptErrorLog("scope", "plain failure").message,
      },
      { errorName: "Error", message: "plain failure" },
    );

    const circular = {};
    circular.self = circular;
    const record = buildScriptErrorLog("scope", circular);
    assert.equal(record.errorName, "Error");
    assert.equal(record.message, "[object Object]");
  });

  test("emit helpers swallow console writer failures", () => {
    const originalInfo = console.info;
    console.info = () => {
      throw new Error("console unavailable");
    };
    try {
      assert.doesNotThrow(() => logScriptInfo("scope", "message"));
    } finally {
      console.info = originalInfo;
    }
  });

  test("emit helpers write one JSON line to the expected console method", () => {
    const originals = {
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
    const lines = { info: [], warn: [], error: [] };
    console.info = (line) => lines.info.push(String(line));
    console.warn = (line) => lines.warn.push(String(line));
    console.error = (line) => lines.error.push(String(line));
    try {
      logScriptInfo("collab.server.listen", "listening", { port: 1234 });
      logScriptWarning("collab.flush.configure", "disabled", {
        reason: "missing-secret",
      });
      logScriptError("collab.auth.request", new Error("failed"), {
        Authorization: "Bearer secret",
      });
    } finally {
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
    }

    assert.equal(lines.info.length, 1);
    assert.equal(lines.warn.length, 1);
    assert.equal(lines.error.length, 1);
    assert.equal(JSON.parse(lines.info[0]).level, "info");
    assert.equal(JSON.parse(lines.warn[0]).level, "warning");
    const error = JSON.parse(lines.error[0]);
    assert.equal(error.level, "error");
    assert.equal(error.Authorization, "[redacted]");
    assert.ok(!lines.error[0].includes("Bearer secret"));
  });

  // --- issue-1833: embedded URL / Bearer redaction ---

  test("buildScriptErrorLog redacts embedded URL in Error message and stack", () => {
    const err = new Error(
      "request failed: https://api.example.com/secret-path",
    );
    err.stack =
      "Error: request failed: https://api.example.com/secret-path\n    at Object.<anonymous>";
    const record = buildScriptErrorLog("collab.fetch", err);
    assert.equal(
      record.message,
      "[redacted]",
      "embedded URL in message must be redacted",
    );
    assert.equal(
      record.stack,
      "[redacted]",
      "embedded URL in stack must be redacted",
    );
    assert.equal(record.errorName, "Error");
  });

  test("buildScriptErrorLog redacts embedded Bearer token in Error message", () => {
    const err = new Error("auth failed: Bearer synthetic-token-abc123");
    const record = buildScriptErrorLog("collab.auth", err);
    assert.equal(
      record.message,
      "[redacted]",
      "embedded Bearer in message must be redacted",
    );
    assert.equal(record.errorName, "Error");
  });

  test("buildScriptErrorLog redacts direct string error with embedded URL", () => {
    const record = buildScriptErrorLog(
      "collab.fetch",
      "upstream error: https://internal.example.com/api",
    );
    assert.equal(
      record.message,
      "[redacted]",
      "embedded URL in string error must be redacted",
    );
    assert.equal(record.errorName, "Error");
  });

  test("buildScriptErrorLog redacts object with embedded URL via safeStringify", () => {
    const record = buildScriptErrorLog("collab.fetch", {
      code: 403,
      endpoint: "https://api.example.com/data",
    });
    assert.equal(
      record.message,
      "[redacted]",
      "safeStringify output with embedded URL must be redacted",
    );
    assert.equal(record.errorName, "Error");
  });

  test("safe operational message remains unchanged in script logger", () => {
    const record = buildScriptErrorLog(
      "collab.db",
      new Error("room not found"),
    );
    assert.equal(record.message, "room not found");
    assert.equal(record.errorName, "Error");
    assert.equal(record.level, "error");
  });

  test("errorName, level, and output shape preserved after script logger sanitization", () => {
    const err = new TypeError("sync failed: https://collab.example.com/ws");
    const record = buildScriptErrorLog("collab.sync", err);
    assert.equal(record.errorName, "TypeError");
    assert.equal(record.level, "error");
    assert.equal(record.message, "[redacted]");
    assert.ok(typeof record.timestamp === "string");
  });

  test("context with embedded URL and Bearer values redacted in script logger", () => {
    const record = buildScriptErrorLog(
      "collab.request",
      new Error("sync failed"),
      {
        roomId: "safe-room-1",
        endpoint: "service call to https://collab.example.com/ws",
        callDescription: "received: Bearer synthetic-token-xyz123",
      },
    );
    assert.equal(
      record.endpoint,
      "[redacted]",
      "context value with embedded URL must be redacted",
    );
    assert.equal(
      record.callDescription,
      "[redacted]",
      "context value with embedded Bearer must be redacted",
    );
    assert.equal(record.roomId, "safe-room-1");
  });
});
