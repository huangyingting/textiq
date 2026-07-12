import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildRetentionCliConfig,
  runRetentionMain,
} from "./retention-runner.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

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

  it("explicit --dry-run flag preserves dry-run mode", () => {
    assert.deepEqual(buildRetentionCliConfig(["--dry-run"], {}), {
      dryRun: true,
      batchSize: 100,
    });
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

describe("runRetentionMain lifecycle", () => {
  function makeDisconnect() {
    let called = 0;
    return {
      get callCount() {
        return called;
      },
      fn: async () => {
        called++;
      },
    };
  }

  function makeDeps(opts = {}) {
    const disconnect = makeDisconnect();
    const calls = [];
    const fakeResult = opts.result ?? { dryRun: true, batchSize: 100 };
    const runOperationalRetention = async (args) => {
      calls.push(args);
      if (opts.runThrows) throw opts.runThrows;
      return fakeResult;
    };
    const importDeps = opts.importThrows
      ? async () => {
          throw opts.importThrows;
        }
      : async () => [
          { runOperationalRetention },
          { prisma: { $disconnect: disconnect.fn } },
        ];
    return { importDeps, calls, disconnect, fakeResult };
  }

  it("dry-run mode: calls runOperationalRetention with dryRun:true and propagates default config", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    const { importDeps, calls, disconnect } = makeDeps();
    const out = [];
    process.exitCode = undefined;

    await runRetentionMain({
      argv: [],
      env: {},
      importDeps,
      stdout: (msg) => out.push(msg),
      stderr: () => {},
    });

    assert.equal(process.exitCode, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dryRun, true);
    assert.equal(calls[0].batchSize, 100);
    assert.equal(typeof calls[0].logger, "object");
    assert.equal(typeof calls[0].logger.info, "function");
    assert.equal(typeof calls[0].logger.error, "function");
    assert.equal(disconnect.callCount, 1);
    assert.equal(out.length, 1);
    assert.deepEqual(JSON.parse(out[0]).event, "maintenance.retention.result");
  });

  it("execute mode: calls runOperationalRetention with dryRun:false", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    const { importDeps, calls } = makeDeps();
    process.exitCode = undefined;

    await runRetentionMain({
      argv: ["--execute"],
      env: { RETENTION_RUNNER_CONFIRM: "delete-expired" },
      importDeps,
      stdout: () => {},
      stderr: () => {},
    });

    assert.equal(process.exitCode, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dryRun, false);
  });

  it("propagates all config overrides to runOperationalRetention in exact call order", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    const { importDeps, calls } = makeDeps();
    process.exitCode = undefined;

    await runRetentionMain({
      argv: [
        "--execute",
        "--batch-size=50",
        "--auth-token-retention-days=3",
        "--rate-limit-retention-hours=6",
        "--asset-retention-days=14",
      ],
      env: { RETENTION_RUNNER_CONFIRM: "delete-expired" },
      importDeps,
      stdout: () => {},
      stderr: () => {},
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(
      {
        dryRun: calls[0].dryRun,
        batchSize: calls[0].batchSize,
        authTokenRetentionMs: calls[0].authTokenRetentionMs,
        rateLimitRetentionMs: calls[0].rateLimitRetentionMs,
        assetRetentionMs: calls[0].assetRetentionMs,
      },
      {
        dryRun: false,
        batchSize: 50,
        authTokenRetentionMs: 3 * 24 * 60 * 60 * 1000,
        rateLimitRetentionMs: 6 * 60 * 60 * 1000,
        assetRetentionMs: 14 * 24 * 60 * 60 * 1000,
      },
    );
  });

  it("result is logged as maintenance.retention.result to stdout", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    const fakeResult = {
      dryRun: true,
      batchSize: 100,
      now: "2026-01-01T00:00:00.000Z",
    };
    const { importDeps } = makeDeps({ result: fakeResult });
    const out = [];
    process.exitCode = undefined;

    await runRetentionMain({
      argv: [],
      env: {},
      importDeps,
      stdout: (msg) => out.push(msg),
      stderr: () => {},
    });

    assert.equal(out.length, 1);
    const parsed = JSON.parse(out[0]);
    assert.equal(parsed.event, "maintenance.retention.result");
    assert.deepEqual(parsed.result, fakeResult);
  });

  it("disconnects prisma after successful run", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    const { importDeps, disconnect } = makeDeps();
    process.exitCode = undefined;

    await runRetentionMain({
      argv: [],
      env: {},
      importDeps,
      stdout: () => {},
      stderr: () => {},
    });

    assert.equal(disconnect.callCount, 1);
    assert.equal(process.exitCode, undefined);
  });

  it("disconnects prisma and sets exitCode=1 when runOperationalRetention throws", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    const runErr = new TypeError("retention exploded");
    const { importDeps, disconnect } = makeDeps({ runThrows: runErr });
    const errOut = [];
    process.exitCode = undefined;

    await runRetentionMain({
      argv: [],
      env: {},
      importDeps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });

    assert.equal(process.exitCode, 1);
    assert.equal(disconnect.callCount, 1);
    assert.equal(errOut.length, 1);
    const parsed = JSON.parse(errOut[0]);
    assert.equal(parsed.event, "maintenance.retention.failed");
    assert.equal(parsed.errorName, "TypeError");
  });

  it("sets exitCode=1 and skips disconnect when importDeps throws", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    const importErr = new Error("Cannot find module");
    const { importDeps } = makeDeps({ importThrows: importErr });
    const errOut = [];
    process.exitCode = undefined;

    await runRetentionMain({
      argv: [],
      env: {},
      importDeps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });

    assert.equal(process.exitCode, 1);
    assert.equal(errOut.length, 1);
    const parsed = JSON.parse(errOut[0]);
    assert.equal(parsed.event, "maintenance.retention.failed");
    assert.equal(parsed.errorName, "Error");
  });

  it("invalid argv: sets exitCode=1, logs config_failed, never calls importDeps", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    let importDepsCalled = false;
    const importDeps = async () => {
      importDepsCalled = true;
      return [];
    };
    const errOut = [];
    process.exitCode = undefined;

    await runRetentionMain({
      argv: ["--unknown-flag"],
      env: {},
      importDeps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });

    assert.equal(process.exitCode, 1);
    assert.equal(importDepsCalled, false);
    assert.equal(errOut.length, 1);
    const parsed = JSON.parse(errOut[0]);
    assert.equal(parsed.event, "maintenance.retention.config_failed");
  });

  it("logger.info routes to stdout as JSON", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    const allStdout = [];
    let capturedLogger;
    const { importDeps: baseDeps } = makeDeps();
    const importDeps = async () => {
      const deps = await baseDeps();
      const [_retentionMod, prismaMod] = deps;
      return [
        {
          runOperationalRetention: async (args) => {
            capturedLogger = args.logger;
            capturedLogger.info("maintenance.retention.started", {
              dryRun: true,
              batchSize: 100,
            });
            return { dryRun: true };
          },
        },
        prismaMod,
      ];
    };
    process.exitCode = undefined;

    await runRetentionMain({
      argv: [],
      env: {},
      importDeps,
      stdout: (msg) => allStdout.push(msg),
      stderr: () => {},
    });

    const logLine = allStdout.find((l) => {
      try {
        return JSON.parse(l).event === "maintenance.retention.started";
      } catch {
        return false;
      }
    });
    assert.ok(logLine, "logger.info should write to stdout");
    const rec = JSON.parse(logLine);
    assert.equal(rec.dryRun, true);
    assert.equal(rec.batchSize, 100);
  });

  it("logger.error routes to stderr as JSON with errorName", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    const allStderr = [];
    const { importDeps: baseDeps } = makeDeps();
    const importDeps = async () => {
      const [_retentionMod, prismaMod] = await baseDeps();
      return [
        {
          runOperationalRetention: async (args) => {
            args.logger.error(
              "maintenance.retention.asset_storage_delete_failed",
              new RangeError("disk full"),
              { domain: "slide", assetId: "asset-1" },
            );
            return { dryRun: false };
          },
        },
        prismaMod,
      ];
    };
    process.exitCode = undefined;

    await runRetentionMain({
      argv: [],
      env: {},
      importDeps,
      stdout: () => {},
      stderr: (msg) => allStderr.push(msg),
    });

    const errLine = allStderr.find((l) => {
      try {
        return (
          JSON.parse(l).event ===
          "maintenance.retention.asset_storage_delete_failed"
        );
      } catch {
        return false;
      }
    });
    assert.ok(errLine, "logger.error should write to stderr");
    const rec = JSON.parse(errLine);
    assert.equal(rec.errorName, "RangeError");
    assert.equal(rec.domain, "slide");
    assert.equal(rec.assetId, "asset-1");
  });
});

describe("default dependency loading (loadRetentionDependencies)", () => {
  it("runRetentionMain invokes the real default loader when importDeps is not overridden", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });

    const out = [];
    const errOut = [];
    process.exitCode = undefined;

    // No `importDeps` override here: this exercises the actual
    // `loadRetentionDependencies` default parameter -- the exact seam every
    // other test in this file replaces with a double. Under the plain
    // `node --test` harness used for the scripts suite (no TS-aware loader
    // registered), the "@/..." path aliases the real modules depend on
    // cannot resolve, so the genuine dynamic imports reject deterministically.
    // That failure still proves the production wiring is correct: the real
    // loader is called, its rejection is caught and reported, and no Prisma
    // client is disconnected because none was ever obtained.
    await runRetentionMain({
      argv: [],
      env: {},
      stdout: (msg) => out.push(msg),
      stderr: (msg) => errOut.push(msg),
    });

    assert.equal(process.exitCode, 1);
    assert.equal(out.length, 0);
    assert.equal(errOut.length, 1);
    const parsed = JSON.parse(errOut[0]);
    assert.equal(parsed.event, "maintenance.retention.failed");
    assert.equal(parsed.errorName, "Error");
  });

  it("loadRetentionDependencies resolves the real maintenance runner and Prisma client without mutating data", (t) => {
    // Runs under `--import tsx`, the same loader `npm run retention:run`
    // uses in production, so the "@/..." aliases resolve and the two real
    // dynamic imports in `loadRetentionDependencies` succeed. The probe only
    // compares module bindings and disconnects the client -- it never calls
    // a query or mutation method, so no data is read or changed.
    //
    // The probe is written to a real fixture file (not passed inline via
    // `-e`): on Node 22, `--input-type=module -e "<script>"` fails to
    // statically resolve named exports re-exported through tsx's
    // CJS-interop transform for `src/lib/prisma.ts` (a genuine
    // `SyntaxError: ... does not provide an export named 'prisma'`, verified
    // to reproduce even outside this test), while the identical source
    // loaded from a real module file resolves correctly. Using a file keeps
    // this test's assertions genuine on every supported Node version instead
    // of just happening to avoid a loader quirk.
    //
    // `runOperationalRetention` is compared by name + exact source text
    // rather than by object identity: Node 22's tsx/ESM interop has been
    // verified (independently of this seam) to sometimes instantiate
    // `src/lib/maintenance/retention-runner.ts` twice -- once for the static
    // "expected" import below and once for `loadRetentionDependencies`'s own
    // dynamic import -- so `===` is not a reliable check on every supported
    // Node version. Matching source text still proves the loaded function is
    // the real production code, not a stub or double; `prisma`'s reference
    // equality is reliable because `src/lib/prisma.ts` caches its client on
    // `globalThis`, so both imports resolve the same singleton regardless.
    const root = createTestFixtureRoot("retention-runner-loader-probe", t);
    const probePath = join(root, "probe.mjs");
    writeFileSync(
      probePath,
      `
      import { loadRetentionDependencies } from ${JSON.stringify(join(import.meta.dirname, "retention-runner.mjs"))};
      import { runOperationalRetention as expectedRunOperationalRetention } from ${JSON.stringify(join(import.meta.dirname, "..", "src", "lib", "maintenance", "retention-runner.ts"))};
      import { prisma as expectedPrisma } from ${JSON.stringify(join(import.meta.dirname, "..", "src", "lib", "prisma.ts"))};

      const [{ runOperationalRetention }, { prisma }] =
        await loadRetentionDependencies();
      const report = {
        runOperationalRetentionIsRealExport:
          runOperationalRetention.name === expectedRunOperationalRetention.name &&
          runOperationalRetention.toString() ===
            expectedRunOperationalRetention.toString(),
        runOperationalRetentionName: runOperationalRetention.name,
        prismaIsRealExport: prisma === expectedPrisma,
        prismaHasDisconnect: typeof prisma.$disconnect === "function",
      };
      await prisma.$disconnect();
      console.log(JSON.stringify(report));
      `,
    );

    // Strip NODE_V8_COVERAGE defensively so this subprocess never inherits
    // the parent `node --test --experimental-test-coverage` run's shared
    // coverage directory.
    const { NODE_V8_COVERAGE: _omitted, ...envWithoutCoverage } = process.env;
    const result = spawnSync(process.execPath, ["--import", "tsx", probePath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: envWithoutCoverage,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      runOperationalRetentionIsRealExport: true,
      runOperationalRetentionName: "runOperationalRetention",
      prismaIsRealExport: true,
      prismaHasDisconnect: true,
    });
  });
});
