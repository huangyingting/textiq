import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { spec } from "node:test/reporters";
import {
  defaultReporter,
  runCombinedCoverageGate,
} from "./check-combined-coverage.mjs";
import { LINE_COVERAGE_STAGES } from "./check-line-coverage.mjs";
import { MAX_GAP_ENV_KEY } from "./check-coverage-breadth.mjs";
import { BREADTH_COVERAGE_STAGE, MODE } from "./coverage-breadth.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

const [SOURCE_STAGE, SCRIPT_STAGE] = LINE_COVERAGE_STAGES;

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

// Builds a single structured `summary.files` entry whose aggregated
// percentages equal the given values exactly (each metric denominator is
// 100, so `coveredXCount` doubles as `coveredXPercent`). Combined-gate
// percentage floors are now derived from `summary.files` via
// `aggregateCoverageTotals` (#1925), not from `summary.totals` directly, so
// harness fixtures build files instead of a pre-computed totals object.
function summaryFilesFromPercents({
  coveredLinePercent = 100,
  coveredBranchPercent = 100,
  coveredFunctionPercent = 100,
} = {}) {
  return [
    {
      path: "/repo/src/a.ts",
      totalLineCount: 100,
      coveredLineCount: coveredLinePercent,
      totalBranchCount: 100,
      coveredBranchCount: coveredBranchPercent,
      totalFunctionCount: 100,
      coveredFunctionCount: coveredFunctionPercent,
    },
  ];
}

function harness({
  gapFiles = [],
  failureCount = 0,
  summaryFiles = summaryFilesFromPercents(),
  env = {},
  spawnResult = { status: 0 },
} = {}) {
  const logs = [];
  const errors = [];
  const collectLoadedCalls = [];
  const spawnCalls = [];
  return {
    logs,
    errors,
    collectLoadedCalls,
    spawnCalls,
    options: {
      env,
      repoRoot: "/repo",
      listEligible: () => ["src/a.ts", "src/b.ts"],
      listTestFiles: () => ["src/a.test.ts"],
      collectLoaded: async (callOptions) => {
        collectLoadedCalls.push(callOptions);
        return {
          loaded: new Set(),
          failureCount,
          summary: { files: summaryFiles },
        };
      },
      buildReport: () => fakeReport({ gapFiles }),
      formatReport: () => "FORMATTED REPORT",
      spawn: (command, args, spawnOptions) => {
        spawnCalls.push({ command, args, spawnOptions });
        return spawnResult;
      },
      reporter: null,
      log: (line) => logs.push(line),
      logError: (line) => errors.push(line),
    },
  };
}

// --- single-source-suite-execution regression evidence (#1919) -----------

test("runCombinedCoverageGate invokes the source suite collector exactly once when everything passes", async () => {
  const h = harness();
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 0);
  assert.equal(
    h.collectLoadedCalls.length,
    1,
    "the combined gate must run the source unit suite exactly once, sharing its summary between the percentage floors and the breadth report",
  );
});

test("runCombinedCoverageGate invokes the source suite collector exactly once even when the run ultimately fails", async () => {
  const h = harness({ gapFiles: ["src/a.ts", "src/b.ts", "src/c.ts"] });
  h.options.env = { [MAX_GAP_ENV_KEY]: "1" };
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 1);
  assert.equal(h.collectLoadedCalls.length, 1);
  assert.equal(
    h.spawnCalls.length,
    0,
    "the script coverage stage must not spawn once the shared source run's breadth gate has already failed",
  );
});

test("runCombinedCoverageGate derives both the deck-kernel-inclusive breadth report and the deck-kernel-excluded percentage floors from a single collector invocation (#1925)", async () => {
  const h = harness({
    summaryFiles: [
      ...summaryFilesFromPercents({
        coveredLinePercent: SOURCE_STAGE.defaultMinimum,
        coveredBranchPercent: SOURCE_STAGE.defaultBranchMinimum,
        coveredFunctionPercent: SOURCE_STAGE.defaultFunctionMinimum,
      }),
      {
        path: "/repo/src/lib/document/deck-kernel/deck-diff.ts",
        totalLineCount: 500,
        coveredLineCount: 1,
        totalBranchCount: 500,
        coveredBranchCount: 1,
        totalFunctionCount: 500,
        coveredFunctionCount: 1,
      },
    ],
  });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 0);
  assert.equal(
    h.collectLoadedCalls.length,
    1,
    "a single structured source suite run must serve both the widened breadth report and the deck-kernel-excluded percentage floors — no second run for either concern",
  );
  const [call] = h.collectLoadedCalls;
  assert.ok(
    !call.stage.excludes.includes("src/lib/document/deck-kernel/**"),
    "the one shared run instruments deck-kernel for breadth",
  );
});

test("runCombinedCoverageGate shares the widened BREADTH_COVERAGE_STAGE with the collector for deck-kernel breadth (#1925)", async () => {
  const h = harness();
  await runCombinedCoverageGate(h.options);

  const [call] = h.collectLoadedCalls;
  assert.equal(call.stage, BREADTH_COVERAGE_STAGE);
  assert.ok(
    !call.stage.excludes.includes("src/lib/document/deck-kernel/**"),
    "the shared run's own instrumentation must not exclude deck-kernel",
  );
});

test("runCombinedCoverageGate does not forward source-stage thresholds to the shared collector's own run() threshold annotation (#1925)", async () => {
  const h = harness();
  await runCombinedCoverageGate(h.options);

  const [call] = h.collectLoadedCalls;
  // Once the shared run is widened to instrument deck-kernel,
  // `summary.totals` (what `run()`'s own lineCoverage/branchCoverage/
  // functionCoverage options are compared against) no longer matches the
  // percentage-only, deck-kernel-excluded totals this gate actually
  // enforces via `evaluateCoverageFloors` below. Forwarding the un-widened
  // thresholds here would make `run()`'s reporter print spurious "does not
  // meet threshold" diagnostics derived from the wrong (deck-kernel
  // inclusive) totals, so these stay at the collector's own default of 0.
  assert.equal(call.lineCoverage, undefined);
  assert.equal(call.branchCoverage, undefined);
  assert.equal(call.functionCoverage, undefined);
});

test("runCombinedCoverageGate defaults the shared run's concurrency to 1, matching the source stage's own --test-concurrency=1", async () => {
  const h = harness();
  await runCombinedCoverageGate(h.options);

  const [call] = h.collectLoadedCalls;
  assert.equal(call.concurrency, 1);
});

test("runCombinedCoverageGate honors source threshold environment overrides in the percentage-floor evaluation", async () => {
  // Env overrides are no longer forwarded to the shared collector call (see
  // the "does not forward source-stage thresholds" test above) — they must
  // still change the outcome of this gate's own `evaluateCoverageFloors`
  // comparison against `aggregateCoverageTotals`. A summary that would fail
  // the default 95/89/93 floors but passes a lowered 80/70/60 override
  // proves the override reaches that comparison.
  const h = harness({
    summaryFiles: summaryFilesFromPercents({
      coveredLinePercent: 80,
      coveredBranchPercent: 70,
      coveredFunctionPercent: 60,
    }),
    env: {
      SOURCE_LINE_COVERAGE_MIN: "80",
      SOURCE_BRANCH_COVERAGE_MIN: "70",
      SOURCE_FUNCTION_COVERAGE_MIN: "60",
    },
  });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 0);
});

// --- fail-fast on invalid environment overrides ---------------------------

test("runCombinedCoverageGate fails without running the source suite when a threshold override is invalid", async () => {
  const h = harness();
  h.options.env = { SOURCE_LINE_COVERAGE_MIN: "invalid" };
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 1);
  assert.equal(h.collectLoadedCalls.length, 0);
  assert.ok(h.errors.some((line) => line.includes("SOURCE_LINE_COVERAGE_MIN")));
});

test("runCombinedCoverageGate fails without running the source suite when the max-gap-files override is invalid", async () => {
  const h = harness();
  h.options.env = { [MAX_GAP_ENV_KEY]: "not-a-number" };
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 1);
  assert.equal(h.collectLoadedCalls.length, 0);
  assert.ok(h.errors.some((line) => line.includes(MAX_GAP_ENV_KEY)));
});

// --- source unit test failures ---------------------------------------------

test("runCombinedCoverageGate fails and skips breadth/script stage when source unit tests fail", async () => {
  const h = harness({ failureCount: 2 });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 1);
  assert.ok(
    h.errors.some((line) => line.includes("2 source unit test failure(s)")),
  );
  assert.equal(h.spawnCalls.length, 0);
});

// --- percentage floor enforcement (shared summary, filtered via summary.files) ---

test("runCombinedCoverageGate fails when the shared summary misses a percentage floor", async () => {
  const h = harness({
    summaryFiles: summaryFilesFromPercents({
      coveredLinePercent: 50,
      coveredBranchPercent: 100,
      coveredFunctionPercent: 100,
    }),
  });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 1);
  assert.ok(
    h.errors.some((line) =>
      line.includes("50.00% line coverage does not meet threshold"),
    ),
  );
  assert.equal(h.spawnCalls.length, 0);
});

test("runCombinedCoverageGate passes when the shared summary meets every percentage floor exactly", async () => {
  const h = harness({
    summaryFiles: summaryFilesFromPercents({
      coveredLinePercent: SOURCE_STAGE.defaultMinimum,
      coveredBranchPercent: SOURCE_STAGE.defaultBranchMinimum,
      coveredFunctionPercent: SOURCE_STAGE.defaultFunctionMinimum,
    }),
  });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 0);
});

test("runCombinedCoverageGate logs the deck-kernel-excluded percentage totals it actually enforces (#1925)", async () => {
  // The reporter's own coverage table sums every instrumented file
  // (deck-kernel included), so once deck-kernel is widened into the shared
  // run's instrumentation that table no longer matches what this gate
  // enforces. This explicit log line is what lets CI/local output state the
  // filtered numbers the floor check actually used.
  const h = harness({
    summaryFiles: summaryFilesFromPercents({
      coveredLinePercent: 96,
      coveredBranchPercent: 90,
      coveredFunctionPercent: 94,
    }),
  });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 0);
  assert.ok(
    h.logs.some((line) =>
      line.includes(
        "Percentage floor totals (deck-kernel excluded): 96.00% lines, 90.00% branches, 94.00% functions.",
      ),
    ),
  );
});

// --- unchanged percentage metrics despite the deck-kernel breadth widening (#1925) ---

test("runCombinedCoverageGate ignores a deck-kernel file's coverage when evaluating percentage floors", async () => {
  const h = harness({
    summaryFiles: [
      ...summaryFilesFromPercents({
        coveredLinePercent: SOURCE_STAGE.defaultMinimum,
        coveredBranchPercent: SOURCE_STAGE.defaultBranchMinimum,
        coveredFunctionPercent: SOURCE_STAGE.defaultFunctionMinimum,
      }),
      {
        // Instrumented for breadth (BREADTH_COVERAGE_STAGE no longer
        // excludes deck-kernel), but must not move the percentage floors:
        // zero coverage here would fail every floor if summary.totals (or
        // an unfiltered summary.files aggregate) were trusted directly.
        path: "/repo/src/lib/document/deck-kernel/deck-diff.ts",
        totalLineCount: 10_000,
        coveredLineCount: 0,
        totalBranchCount: 10_000,
        coveredBranchCount: 0,
        totalFunctionCount: 10_000,
        coveredFunctionCount: 0,
      },
    ],
  });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(
    exitCode,
    0,
    "a poorly-covered deck-kernel file must not fail the percentage floors",
  );
});

test("runCombinedCoverageGate still fails a percentage floor breached by a non-deck-kernel file even when a deck-kernel file is present", async () => {
  const h = harness({
    summaryFiles: [
      ...summaryFilesFromPercents({ coveredLinePercent: 10 }),
      {
        path: "/repo/src/lib/document/deck-kernel/deck-diff.ts",
        totalLineCount: 10_000,
        coveredLineCount: 10_000,
        totalBranchCount: 10_000,
        coveredBranchCount: 10_000,
        totalFunctionCount: 10_000,
        coveredFunctionCount: 10_000,
      },
    ],
  });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(
    exitCode,
    1,
    "a perfectly-covered deck-kernel file must not mask a real non-deck-kernel regression",
  );
  assert.ok(
    h.errors.some((line) =>
      line.includes("10.00% line coverage does not meet threshold"),
    ),
  );
});

// --- breadth gate reuse of the shared run ----------------------------------

test("runCombinedCoverageGate fails when the breadth gap count exceeds the baseline", async () => {
  const h = harness({
    gapFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
    env: { [MAX_GAP_ENV_KEY]: "1" },
  });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 1);
  assert.ok(
    h.errors.some((line) => line.includes("Coverage breadth regression")),
  );
});

test("runCombinedCoverageGate allows a breadth improvement (fewer gap files than baseline)", async () => {
  const h = harness({
    gapFiles: ["src/a.ts"],
    env: { [MAX_GAP_ENV_KEY]: "167" },
  });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 0);
  assert.equal(h.spawnCalls.length, 1);
});

// --- script coverage stage (unchanged CLI-spawn semantics) -----------------

test("runCombinedCoverageGate spawns the script coverage stage with the same command shape as check-line-coverage.mjs", async () => {
  const h = harness();
  await runCombinedCoverageGate(h.options);

  assert.equal(h.spawnCalls.length, 1);
  const [{ command, args, spawnOptions }] = h.spawnCalls;
  assert.equal(command, SCRIPT_STAGE.command);
  assert.ok(
    args.includes(`--test-coverage-lines=${SCRIPT_STAGE.defaultMinimum}`),
  );
  assert.ok(
    args.includes(
      `--test-coverage-branches=${SCRIPT_STAGE.defaultBranchMinimum}`,
    ),
  );
  assert.ok(
    args.includes(
      `--test-coverage-functions=${SCRIPT_STAGE.defaultFunctionMinimum}`,
    ),
  );
  assert.deepEqual(args.slice(-1), SCRIPT_STAGE.testFiles);
  assert.equal(spawnOptions.stdio, "inherit");
});

test("runCombinedCoverageGate propagates a failing script coverage stage exit code", async () => {
  const h = harness({ spawnResult: { status: 3 } });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 3);
});

test("runCombinedCoverageGate maps a signal-only script coverage stage failure to exit code 1", async () => {
  const h = harness({ spawnResult: { status: null } });
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 1);
});

test("runCombinedCoverageGate reports the combined pass message once every stage succeeds", async () => {
  const h = harness();
  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 0);
  assert.ok(
    h.logs.some((line) => line.includes("Combined coverage gate passed.")),
  );
});

// --- default reporter selection ---------------------------------------------

test("defaultReporter always selects spec, matching node --test's own default (kDefaultReporter)", () => {
  assert.equal(defaultReporter({ isTTY: true }), spec);
  assert.equal(defaultReporter({ isTTY: false }), spec);
  assert.equal(defaultReporter({}), spec);
  assert.equal(defaultReporter(), spec);
});

// --- CLI entrypoint smoke test ----------------------------------------------

test("check-combined-coverage CLI entrypoint runs and reports pass when invoked as a subprocess", (t) => {
  // An empty cwd (no src/ or scripts/ trees) yields zero eligible files and
  // zero test files for both stages, so the real run() calls resolve almost
  // instantly (0/0 coverage totals are treated as 100% by node:test, so the
  // configured floors trivially pass). This exercises the actual
  // `import.meta.url === pathToFileURL(...)` CLI entrypoint branch and a
  // real (not mocked) shared source-suite run without paying the cost of a
  // full repository run.
  const root = createTestFixtureRoot("check-combined-coverage-cli-entry", t);
  const scriptPath = path.resolve(
    import.meta.dirname,
    "check-combined-coverage.mjs",
  );

  // Strip NODE_V8_COVERAGE for the same reason check-coverage-breadth.mjs's
  // CLI entrypoint test does: a second process re-instrumenting the same
  // shared modules with a different execution profile can corrupt the
  // parent test run's merged per-file coverage summary. Also strip
  // NODE_TEST_CONTEXT: this test file is itself a `node --test` test file,
  // so the current process already has NODE_TEST_CONTEXT=child-v8 set;
  // leaving it in the spawned child's env makes the child's own internal
  // `run()` call (inside check-combined-coverage.mjs) think it is a
  // recursive `run()` invocation and skip executing entirely, which does
  // not happen for the real `node scripts/check-combined-coverage.mjs`
  // invocation `npm test` performs.
  const {
    NODE_V8_COVERAGE: _unusedCoverage,
    NODE_TEST_CONTEXT: _unusedTestContext,
    ...envWithoutCoverage
  } = process.env;
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: envWithoutCoverage,
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Coverage breadth gate passed/);
  assert.match(result.stdout, /Combined coverage gate passed/);
});
