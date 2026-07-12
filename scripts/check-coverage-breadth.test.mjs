import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_MAX_GAP_FILES,
  MAX_GAP_ENV_KEY,
  listSourceTestFiles,
  parseMaxGapFiles,
  runCoverageBreadthCheck,
} from "./check-coverage-breadth.mjs";
import { MODE } from "./coverage-breadth.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

function fakeReport({
  gapFiles = [],
  loaded = 5,
  typeOnly = 2,
  barrel = 1,
} = {}) {
  return {
    eligibleCount: loaded + gapFiles.length + typeOnly + barrel,
    runtimeEligibleCount: loaded + gapFiles.length,
    loadedRuntimeCount: loaded,
    unloadedRuntimeCount: gapFiles.length,
    typeOnlyCount: typeOnly,
    barrelCount: barrel,
    mappedInteractionCount: 0,
    approvedExceptionCount: 0,
    actionableGapCount: gapFiles.length,
    files: {
      [MODE.UNIT_LOADED]: [],
      [MODE.TYPE_ONLY]: [],
      [MODE.BARREL]: [],
      [MODE.MAPPED_E2E]: [],
      [MODE.APPROVED_EXCEPTION]: [],
      [MODE.GAP]: gapFiles,
    },
  };
}

function harness({ gapFiles = [], failureCount = 0, env = {} } = {}) {
  const logs = [];
  const errors = [];
  const collectLoadedCalls = [];
  return {
    logs,
    errors,
    collectLoadedCalls,
    options: {
      env,
      repoRoot: "/repo",
      listEligible: () => ["src/a.ts", "src/b.ts"],
      listTestFiles: () => ["src/a.test.ts"],
      collectLoaded: async (options) => {
        collectLoadedCalls.push(options);
        return { loaded: new Set(), failureCount };
      },
      buildReport: () => fakeReport({ gapFiles }),
      formatReport: () => "FORMATTED REPORT",
      log: (line) => logs.push(line),
      logError: (line) => errors.push(line),
    },
  };
}

test("DEFAULT_MAX_GAP_FILES documents the derived non-regression baseline", () => {
  assert.equal(typeof DEFAULT_MAX_GAP_FILES, "number");
  assert.ok(DEFAULT_MAX_GAP_FILES >= 0);
});

test("parseMaxGapFiles falls back to the default when unset", () => {
  assert.equal(parseMaxGapFiles({}), DEFAULT_MAX_GAP_FILES);
});

test("parseMaxGapFiles honors the environment override", () => {
  assert.equal(parseMaxGapFiles({ [MAX_GAP_ENV_KEY]: "42" }), 42);
});

test("parseMaxGapFiles rejects a non-integer override", () => {
  assert.throws(
    () => parseMaxGapFiles({ [MAX_GAP_ENV_KEY]: "12.5" }),
    /non-negative integer/,
  );
});

test("parseMaxGapFiles rejects a negative override", () => {
  assert.throws(
    () => parseMaxGapFiles({ [MAX_GAP_ENV_KEY]: "-1" }),
    /non-negative integer/,
  );
});

test("parseMaxGapFiles rejects a non-numeric override", () => {
  assert.throws(
    () => parseMaxGapFiles({ [MAX_GAP_ENV_KEY]: "banana" }),
    /non-negative integer/,
  );
});

test("runCoverageBreadthCheck passes when the gap count is within the baseline", async () => {
  const h = harness({ gapFiles: [], env: { [MAX_GAP_ENV_KEY]: "5" } });
  const exitCode = await runCoverageBreadthCheck(h.options);

  assert.equal(exitCode, 0);
  assert.equal(h.errors.length, 0);
  assert.ok(
    h.logs.some((line) => line.includes("Coverage breadth gate passed")),
  );
  assert.equal(h.collectLoadedCalls.length, 1);
});

test("runCoverageBreadthCheck fails when the gap count exceeds the baseline", async () => {
  const h = harness({
    gapFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
    env: { [MAX_GAP_ENV_KEY]: "1" },
  });
  const exitCode = await runCoverageBreadthCheck(h.options);

  assert.equal(exitCode, 1);
  assert.ok(
    h.errors.some((line) => line.includes("Coverage breadth regression")),
  );
  assert.ok(h.errors.some((line) => line.includes("src/a.ts")));
  assert.ok(h.errors.some((line) => line.includes("src/b.ts")));
  assert.ok(h.errors.some((line) => line.includes("src/c.ts")));
});

test("runCoverageBreadthCheck allows an improvement (fewer gap files than baseline)", async () => {
  const h = harness({
    gapFiles: ["src/a.ts"],
    env: { [MAX_GAP_ENV_KEY]: "167" },
  });
  const exitCode = await runCoverageBreadthCheck(h.options);
  assert.equal(exitCode, 0);
});

test("runCoverageBreadthCheck fails without running tests when the environment override is invalid", async () => {
  const h = harness({ env: { [MAX_GAP_ENV_KEY]: "not-a-number" } });
  const exitCode = await runCoverageBreadthCheck(h.options);

  assert.equal(exitCode, 1);
  assert.equal(h.collectLoadedCalls.length, 0);
  assert.ok(h.errors.some((line) => line.includes(MAX_GAP_ENV_KEY)));
});

test("runCoverageBreadthCheck fails when underlying source unit tests fail during the run", async () => {
  const h = harness({ gapFiles: [], failureCount: 2 });
  const exitCode = await runCoverageBreadthCheck(h.options);

  assert.equal(exitCode, 1);
  assert.ok(
    h.errors.some((line) => line.includes("2 source unit test failure(s)")),
  );
});

test("runCoverageBreadthCheck output is deterministic given the same report", async () => {
  const h1 = harness({ gapFiles: ["src/a.ts", "src/b.ts"] });
  const h2 = harness({ gapFiles: ["src/a.ts", "src/b.ts"] });
  const [code1, code2] = await Promise.all([
    runCoverageBreadthCheck(h1.options),
    runCoverageBreadthCheck(h2.options),
  ]);

  assert.equal(code1, code2);
  assert.deepEqual(h1.logs, h2.logs);
  assert.deepEqual(h1.errors, h2.errors);
});

test("listSourceTestFiles returns a sorted list of *.test.ts(x) files under src", (t) => {
  const root = createTestFixtureRoot("check-coverage-breadth-list-tests", t);
  const srcDir = path.join(root, "src");
  const nested = path.join(srcDir, "lib");
  mkdirSync(nested, { recursive: true });
  writeFileSync(path.join(srcDir, "z.test.ts"), "export {};\n");
  writeFileSync(path.join(nested, "a.test.tsx"), "export {};\n");
  writeFileSync(path.join(srcDir, "not-a-test.ts"), "export {};\n");

  const files = listSourceTestFiles(root);

  assert.deepEqual(files, ["src/lib/a.test.tsx", "src/z.test.ts"]);
});

test("check-coverage-breadth CLI entrypoint runs and reports pass when invoked as a subprocess", (t) => {
  // An empty cwd (no src/ or scripts/ trees) yields zero eligible files, so
  // the real run() call over zero test files resolves almost instantly.
  // This exercises the actual `import.meta.url === pathToFileURL(...)` CLI
  // entrypoint branch without paying the cost of a full repo run.
  const root = createTestFixtureRoot("check-coverage-breadth-cli-entry", t);
  const scriptPath = path.resolve(
    import.meta.dirname,
    "check-coverage-breadth.mjs",
  );

  // Strip NODE_V8_COVERAGE so this child process does not write its own raw
  // V8 coverage entries for the shared coverage-breadth.mjs/
  // check-coverage-breadth.mjs modules into the parent test run's coverage
  // directory. A second process re-instrumenting the same files with a
  // different execution profile has been observed to corrupt the merged
  // per-file coverage summary (lines/functions covered by the parent
  // process's dedicated unit tests are reported as uncovered afterward).
  const { NODE_V8_COVERAGE: _unused, ...envWithoutCoverage } = process.env;
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: envWithoutCoverage,
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Coverage breadth gate passed/);
});
