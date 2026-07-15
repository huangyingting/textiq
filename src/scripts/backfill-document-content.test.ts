import assert from "node:assert/strict";
import { test } from "node:test";

import { runBackfillDocumentContentMain } from "./backfill-document-content";

test("backfill CLI logs the result and disconnects", async () => {
  const events: unknown[] = [];

  await runBackfillDocumentContentMain({
    backfill: async () => ({
      scanned: 3,
      updated: 2,
      skippedConcurrent: 1,
    }),
    info: (...args) => {
      events.push(["info", ...args]);
    },
    error: (...args) => {
      events.push(["error", ...args]);
    },
    disconnect: async () => {
      events.push(["disconnect"]);
    },
    setExitCode: (code) => {
      events.push(["exit", code]);
    },
  });

  assert.deepEqual(events, [
    [
      "info",
      "document.content-projection.backfill",
      "backfill complete",
      { scanned: 3, updated: 2, skippedConcurrent: 1 },
    ],
    ["disconnect"],
  ]);
});

test("backfill CLI reports failures, sets exit status, and still disconnects", async () => {
  const failure = new Error("database unavailable");
  const events: unknown[] = [];

  await runBackfillDocumentContentMain({
    backfill: async () => {
      throw failure;
    },
    info: (...args) => {
      events.push(["info", ...args]);
    },
    error: (...args) => {
      events.push(["error", ...args]);
    },
    disconnect: async () => {
      events.push(["disconnect"]);
    },
    setExitCode: (code) => {
      events.push(["exit", code]);
    },
  });

  assert.deepEqual(events, [
    ["error", "document.content-projection.backfill", failure],
    ["exit", 1],
    ["disconnect"],
  ]);
});
