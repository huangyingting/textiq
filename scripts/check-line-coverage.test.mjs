import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildCoverageCommand,
  coverageMinimum,
  evaluateCoverageFloors,
  LINE_COVERAGE_STAGES,
  parseCoverageMinimum,
  resolveStageThresholds,
  runLineCoverage,
} from "./check-line-coverage.mjs";

test("line coverage stages cover source and script unit gates", () => {
  assert.deepEqual(
    LINE_COVERAGE_STAGES.map((stage) => stage.name),
    ["Source unit line coverage", "Script line coverage"],
  );
  assert.deepEqual(LINE_COVERAGE_STAGES[0].includes, [
    "src/**/*.ts",
    "src/**/*.tsx",
  ]);
  assert.deepEqual(LINE_COVERAGE_STAGES[0].testFiles, [
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
  ]);
  assert.deepEqual(LINE_COVERAGE_STAGES[1].testFiles, [
    "scripts/**/*.test.mjs",
  ]);
  assert.equal(LINE_COVERAGE_STAGES[1].coverageTool, "c8");
});

test("line coverage minimum uses global and stage-specific overrides", () => {
  assert.equal(coverageMinimum(LINE_COVERAGE_STAGES[0], {}), 95);
  assert.equal(coverageMinimum(LINE_COVERAGE_STAGES[1], {}), 97);
  assert.equal(
    coverageMinimum(LINE_COVERAGE_STAGES[0], { LINE_COVERAGE_MIN: "100" }),
    100,
  );
  assert.equal(
    coverageMinimum(LINE_COVERAGE_STAGES[0], {
      LINE_COVERAGE_MIN: "100",
      SOURCE_LINE_COVERAGE_MIN: "92",
    }),
    92,
  );
});

test("line coverage minimum rejects invalid thresholds", () => {
  assert.throws(
    () => parseCoverageMinimum("101", "LINE_COVERAGE_MIN"),
    /integer between 0 and 100/,
  );
  assert.throws(
    () => parseCoverageMinimum("not-a-number", "LINE_COVERAGE_MIN"),
    /integer between 0 and 100/,
  );
  assert.throws(
    () => parseCoverageMinimum("91.5", "LINE_COVERAGE_MIN"),
    /integer between 0 and 100/,
  );
});

test("source line coverage command excludes tests, generated code, and test support", () => {
  const command = buildCoverageCommand(LINE_COVERAGE_STAGES[0], {
    SOURCE_LINE_COVERAGE_MIN: "92",
  });

  assert.equal(command.command, "node");
  assert.deepEqual(command.args, [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    "--experimental-test-coverage",
    "--test-coverage-lines=92",
    "--test-coverage-branches=89",
    "--test-coverage-functions=93",
    "--test-coverage-include=src/**/*.ts",
    "--test-coverage-include=src/**/*.tsx",
    "--test-coverage-exclude=src/**/*.test.ts",
    "--test-coverage-exclude=src/**/*.test.tsx",
    "--test-coverage-exclude=src/generated/**",
    "--test-coverage-exclude=src/test/**",
    "--test-coverage-exclude=src/lib/document/deck-kernel/**",
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
  ]);
});

test("line coverage runner stops on the first failed stage", () => {
  const calls = [];
  const exitCode = runLineCoverage({
    stages: LINE_COVERAGE_STAGES,
    env: {},
    spawn: (command, args) => {
      calls.push([command, args]);
      return { status: 7 };
    },
  });

  assert.equal(exitCode, 7);
  assert.equal(calls.length, 1);
});

test("line coverage runner reports invalid environment thresholds", () => {
  const originalError = console.error;
  const errors = [];
  console.error = (line) => errors.push(String(line));
  try {
    const exitCode = runLineCoverage({
      stages: [LINE_COVERAGE_STAGES[0]],
      env: { SOURCE_LINE_COVERAGE_MIN: "invalid" },
      spawn: () => {
        throw new Error("must not spawn");
      },
    });
    assert.equal(exitCode, 1);
  } finally {
    console.error = originalError;
  }
  assert.match(errors[0], /SOURCE_LINE_COVERAGE_MIN/);
});

test("line coverage runner maps signal-only failures to exit code 1", () => {
  const exitCode = runLineCoverage({
    stages: [LINE_COVERAGE_STAGES[0]],
    env: {},
    spawn: () => ({ status: null }),
  });

  assert.equal(exitCode, 1);
});

test("line coverage runner succeeds after all stages pass", () => {
  const calls = [];
  const exitCode = runLineCoverage({
    stages: LINE_COVERAGE_STAGES,
    env: {},
    spawn: (command, args) => {
      calls.push([command, args]);
      return { status: 0 };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 2);
});

test("line coverage CLI maps an unavailable runner to failure", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-line-coverage.mjs"],
    {
      cwd: process.cwd(),
      env: { ...process.env, PATH: "" },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
});

test("coverage stages have branch and function floor defaults at safe baselines", () => {
  const [source, scripts] = LINE_COVERAGE_STAGES;

  assert.equal(source.defaultBranchMinimum, 89);
  assert.equal(source.branchEnvKey, "SOURCE_BRANCH_COVERAGE_MIN");
  assert.equal(source.defaultFunctionMinimum, 93);
  assert.equal(source.functionEnvKey, "SOURCE_FUNCTION_COVERAGE_MIN");

  assert.equal(scripts.defaultBranchMinimum, 93);
  assert.equal(scripts.branchEnvKey, "SCRIPT_BRANCH_COVERAGE_MIN");
  assert.equal(scripts.defaultFunctionMinimum, 97);
  assert.equal(scripts.functionEnvKey, "SCRIPT_FUNCTION_COVERAGE_MIN");
});

test("buildCoverageCommand includes source branch and function flags after lines in Node metric order", () => {
  const cmd = buildCoverageCommand(LINE_COVERAGE_STAGES[0], {});
  const linesIdx = cmd.args.findIndex((a) =>
    a.startsWith("--test-coverage-lines="),
  );
  const branchIdx = cmd.args.findIndex((a) =>
    a.startsWith("--test-coverage-branches="),
  );
  const funcIdx = cmd.args.findIndex((a) =>
    a.startsWith("--test-coverage-functions="),
  );

  assert.ok(linesIdx !== -1, "--test-coverage-lines must be present");
  assert.ok(branchIdx !== -1, "--test-coverage-branches must be present");
  assert.ok(funcIdx !== -1, "--test-coverage-functions must be present");
  assert.ok(linesIdx < branchIdx, "lines must precede branches");
  assert.ok(branchIdx < funcIdx, "branches must precede functions");
});

test("buildCoverageCommand uses source stage branch and function defaults", () => {
  const cmd = buildCoverageCommand(LINE_COVERAGE_STAGES[0], {});
  assert.ok(cmd.args.includes("--test-coverage-branches=89"));
  assert.ok(cmd.args.includes("--test-coverage-functions=93"));
});

test("buildCoverageCommand uses script stage branch and function defaults", () => {
  const cmd = buildCoverageCommand(LINE_COVERAGE_STAGES[1], {});
  assert.equal(cmd.command, "node_modules/.bin/c8");
  assert.ok(cmd.args.includes("--check-coverage"));
  assert.ok(cmd.args.includes("--lines=97"));
  assert.ok(cmd.args.includes("--branches=93"));
  assert.ok(cmd.args.includes("--functions=97"));
  assert.ok(cmd.args.includes("--reporter=text-summary"));
  assert.ok(cmd.args.includes("node"));
  assert.ok(cmd.args.includes("--test"));
  assert.ok(cmd.args.includes("--test-concurrency=1"));
  assert.deepEqual(cmd.args.slice(-1), ["scripts/**/*.test.mjs"]);
});

test("buildCoverageCommand respects branch and function env-key overrides", () => {
  const cmd = buildCoverageCommand(LINE_COVERAGE_STAGES[0], {
    SOURCE_BRANCH_COVERAGE_MIN: "80",
    SOURCE_FUNCTION_COVERAGE_MIN: "85",
  });
  assert.ok(cmd.args.includes("--test-coverage-branches=80"));
  assert.ok(cmd.args.includes("--test-coverage-functions=85"));
});

test("resolveStageThresholds returns the same line/branch/function minimums buildCoverageCommand embeds in its CLI flags", () => {
  const env = {
    SOURCE_LINE_COVERAGE_MIN: "80",
    SOURCE_BRANCH_COVERAGE_MIN: "70",
    SOURCE_FUNCTION_COVERAGE_MIN: "60",
  };
  const thresholds = resolveStageThresholds(LINE_COVERAGE_STAGES[0], env);
  const cmd = buildCoverageCommand(LINE_COVERAGE_STAGES[0], env);

  assert.deepEqual(thresholds, { line: 80, branch: 70, function: 60 });
  assert.ok(cmd.args.includes("--test-coverage-lines=80"));
  assert.ok(cmd.args.includes("--test-coverage-branches=70"));
  assert.ok(cmd.args.includes("--test-coverage-functions=60"));
});

test("resolveStageThresholds returns the same script minimums buildCoverageCommand embeds in c8 flags", () => {
  const env = {
    SCRIPT_LINE_COVERAGE_MIN: "98",
    SCRIPT_BRANCH_COVERAGE_MIN: "91",
    SCRIPT_FUNCTION_COVERAGE_MIN: "96",
  };
  const thresholds = resolveStageThresholds(LINE_COVERAGE_STAGES[1], env);
  const cmd = buildCoverageCommand(LINE_COVERAGE_STAGES[1], env);

  assert.deepEqual(thresholds, { line: 98, branch: 91, function: 96 });
  assert.ok(cmd.args.includes("--lines=98"));
  assert.ok(cmd.args.includes("--branches=91"));
  assert.ok(cmd.args.includes("--functions=96"));
});

test("resolveStageThresholds falls back to stage defaults when unset", () => {
  const thresholds = resolveStageThresholds(LINE_COVERAGE_STAGES[0], {});
  assert.deepEqual(thresholds, { line: 95, branch: 89, function: 93 });
});

test("resolveStageThresholds rejects an invalid override", () => {
  assert.throws(
    () =>
      resolveStageThresholds(LINE_COVERAGE_STAGES[0], {
        SOURCE_BRANCH_COVERAGE_MIN: "not-a-number",
      }),
    /SOURCE_BRANCH_COVERAGE_MIN/,
  );
});

test("evaluateCoverageFloors returns no failures when every metric meets its threshold", () => {
  const summary = {
    totals: {
      coveredLinePercent: 95,
      coveredBranchPercent: 89,
      coveredFunctionPercent: 93,
    },
  };
  const failures = evaluateCoverageFloors(summary, {
    line: 95,
    branch: 89,
    function: 93,
  });
  assert.deepEqual(failures, []);
});

test("evaluateCoverageFloors reports every metric that falls below its threshold", () => {
  const summary = {
    totals: {
      coveredLinePercent: 50,
      coveredBranchPercent: 89,
      coveredFunctionPercent: 10,
    },
  };
  const failures = evaluateCoverageFloors(summary, {
    line: 95,
    branch: 89,
    function: 93,
  });

  assert.deepEqual(
    failures.map((f) => f.name),
    ["line", "function"],
  );
  assert.equal(failures[0].actual, 50);
  assert.equal(failures[0].threshold, 95);
});

test("evaluateCoverageFloors treats a missing summary as 0% on every metric", () => {
  const failures = evaluateCoverageFloors(null, {
    line: 1,
    branch: 1,
    function: 1,
  });
  assert.deepEqual(
    failures.map((f) => f.name),
    ["line", "branch", "function"],
  );
});
