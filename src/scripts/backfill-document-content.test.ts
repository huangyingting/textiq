import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDocumentContentBackfillCliConfig,
  runBackfillDocumentContentMain,
} from "./backfill-document-content";

const result = {
  scanned: 3,
  drifted: 2,
  updated: 0,
  skippedConcurrent: 0,
  retries: 0,
  sampleDocumentIds: ["doc-1"],
};

test("backfill CLI defaults to bounded dry-run configuration", () => {
  assert.deepEqual(buildDocumentContentBackfillCliConfig([]), {
    dryRun: true,
    batchSize: 200,
    maxRetries: 2,
    sampleLimit: 20,
  });
});

test("backfill CLI requires explicit confirmation for writes", () => {
  assert.throws(
    () => buildDocumentContentBackfillCliConfig(["--execute"], {}),
    /DOCUMENT_CONTENT_BACKFILL_CONFIRM=write-projections/,
  );
  assert.deepEqual(
    buildDocumentContentBackfillCliConfig(
      ["--execute", "--batch-size=50", "--max-retries=4", "--sample-limit=0"],
      { DOCUMENT_CONTENT_BACKFILL_CONFIRM: "write-projections" },
    ),
    {
      dryRun: false,
      batchSize: 50,
      maxRetries: 4,
      sampleLimit: 0,
    },
  );
});

test("backfill CLI rejects unknown and out-of-bounds arguments", () => {
  assert.throws(
    () => buildDocumentContentBackfillCliConfig(["--unknown"]),
    /Unknown argument/,
  );
  assert.throws(
    () => buildDocumentContentBackfillCliConfig(["--batch-size=0"]),
    /between 1 and 1000/,
  );
  assert.throws(
    () => buildDocumentContentBackfillCliConfig(["--max-retries=11"]),
    /between 0 and 10/,
  );
  assert.throws(
    () => buildDocumentContentBackfillCliConfig(["--sample-limit=-1"]),
    /between 0 and 100/,
  );
});

test("backfill CLI exits non-zero on invalid configuration without scanning", async () => {
  const events: unknown[] = [];
  let scanned = false;

  await runBackfillDocumentContentMain({
    argv: ["--batch-size=0"],
    backfill: async () => {
      scanned = true;
      return result;
    },
    info: () => {},
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

  assert.equal(scanned, false);
  const firstEvent = events[0] as unknown[];
  assert.equal(firstEvent[0], "error");
  assert.equal(firstEvent[1], "document.content-projection.backfill");
  assert.match(String(firstEvent[2]), /between 1 and 1000/);
  assert.deepEqual(events.slice(1), [["exit", 1], ["disconnect"]]);
});

test("backfill CLI previews without write mode and logs only safe metadata", async () => {
  const events: unknown[] = [];
  const configs: unknown[] = [];

  await runBackfillDocumentContentMain({
    argv: ["--dry-run", "--sample-limit=1"],
    backfill: async (_db, config) => {
      configs.push(config);
      return result;
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

  assert.deepEqual(configs, [
    { dryRun: true, batchSize: 200, maxRetries: 2, sampleLimit: 1 },
  ]);
  assert.deepEqual(events, [
    [
      "info",
      "document.content-projection.backfill",
      "dry run complete",
      {
        config: {
          dryRun: true,
          batchSize: 200,
          maxRetries: 2,
          sampleLimit: 1,
        },
        result,
      },
    ],
    ["disconnect"],
  ]);
  assert.equal(JSON.stringify(events).includes("document body"), false);
});

test("backfill CLI executes only with confirmation", async () => {
  let config: unknown;
  await runBackfillDocumentContentMain({
    argv: ["--execute"],
    env: { DOCUMENT_CONTENT_BACKFILL_CONFIRM: "write-projections" },
    backfill: async (_db, received) => {
      config = received;
      return { ...result, updated: 2 };
    },
    info: () => {},
    error: () => {},
    disconnect: async () => {},
  });

  assert.deepEqual(config, {
    dryRun: false,
    batchSize: 200,
    maxRetries: 2,
    sampleLimit: 20,
  });
});

test("backfill CLI reports operation failures and still disconnects", async () => {
  const failure = new Error("database unavailable");
  const events: unknown[] = [];

  await runBackfillDocumentContentMain({
    argv: [],
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

test("backfill CLI reports disconnect failures with a failing exit status", async () => {
  const failure = new Error("disconnect failed");
  const events: unknown[] = [];

  await runBackfillDocumentContentMain({
    argv: [],
    backfill: async () => result,
    info: () => {},
    error: (...args) => {
      events.push(["error", ...args]);
    },
    disconnect: async () => {
      throw failure;
    },
    setExitCode: (code) => {
      events.push(["exit", code]);
    },
  });

  assert.deepEqual(events, [
    ["error", "document.content-projection.backfill.disconnect", failure],
    ["exit", 1],
  ]);
});
