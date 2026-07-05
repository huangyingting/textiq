import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { buildRetentionCliConfig } from "./retention-runner.mjs";

describe("retention-runner CLI config", () => {
  it("defaults to dry-run with bounded batches", () => {
    assert.deepEqual(buildRetentionCliConfig([], {}), {
      dryRun: true,
      batchSize: 100,
    });
  });

  it("rejects execute mode unless the destructive confirmation is present", () => {
    assert.throws(
      () => buildRetentionCliConfig(["--execute"], {}),
      /Unsafe config/,
    );
  });

  it("accepts execute mode with explicit confirmation and retention overrides", () => {
    assert.deepEqual(
      buildRetentionCliConfig(
        [
          "--execute",
          "--batch-size=25",
          "--auth-token-retention-days=14",
          "--rate-limit-retention-hours=2",
          "--asset-retention-days=30",
        ],
        { RETENTION_RUNNER_CONFIRM: "delete-expired" },
      ),
      {
        dryRun: false,
        batchSize: 25,
        authTokenRetentionMs: 14 * 24 * 60 * 60 * 1000,
        rateLimitRetentionMs: 2 * 60 * 60 * 1000,
        assetRetentionMs: 30 * 24 * 60 * 60 * 1000,
      },
    );
  });

  it("rejects unsafe batch-size values", () => {
    assert.throws(
      () => buildRetentionCliConfig(["--batch-size=0"], {}),
      /positive integer/,
    );
  });

  it("exits non-zero on unsafe execute config without importing the app runner", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/retention-runner.mjs", "--execute"],
      {
        cwd: process.cwd(),
        env: { ...process.env, RETENTION_RUNNER_CONFIRM: "" },
        encoding: "utf8",
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 1);
    assert.match(output, /maintenance\.retention\.config_failed/);
    assert.match(output, /Unsafe config/);
    assert.ok(!output.includes("tokenHash"));
    assert.ok(!output.includes("storageKey"));
  });
});
