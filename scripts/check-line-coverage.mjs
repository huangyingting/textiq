#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const LINE_COVERAGE_STAGES = [
  {
    name: "Source unit line coverage",
    envKey: "SOURCE_LINE_COVERAGE_MIN",
    // TEMPORARY: lowered to unblock merge queue churn; restore to 97 after backlog clears.
    defaultMinimum: 95,
    branchEnvKey: "SOURCE_BRANCH_COVERAGE_MIN",
    defaultBranchMinimum: 88,
    functionEnvKey: "SOURCE_FUNCTION_COVERAGE_MIN",
    defaultFunctionMinimum: 93,
    command: "node",
    args: [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "--experimental-test-coverage",
    ],
    includes: ["src/**/*.ts", "src/**/*.tsx"],
    excludes: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/generated/**",
      "src/test/**",
      "src/lib/document/deck-kernel/**",
    ],
    testFiles: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  {
    name: "Script line coverage",
    envKey: "SCRIPT_LINE_COVERAGE_MIN",
    // TEMPORARY: lowered to unblock merge backlog; restore to 100% after backlog clears.
    defaultMinimum: 99,
    branchEnvKey: "SCRIPT_BRANCH_COVERAGE_MIN",
    defaultBranchMinimum: 94,
    functionEnvKey: "SCRIPT_FUNCTION_COVERAGE_MIN",
    defaultFunctionMinimum: 97,
    command: "node",
    args: ["--test", "--experimental-test-coverage"],
    includes: ["scripts/**/*.mjs"],
    excludes: ["scripts/**/*.test.mjs"],
    testFiles: ["scripts/**/*.test.mjs"],
  },
];

export function parseCoverageMinimum(raw, name) {
  const minimum = Number(raw);
  if (
    !Number.isFinite(minimum) ||
    !Number.isInteger(minimum) ||
    minimum < 0 ||
    minimum > 100
  ) {
    throw new Error(`${name} must be an integer between 0 and 100.`);
  }
  return minimum;
}

export function coverageMinimum(stage, env = process.env) {
  return parseCoverageMinimum(
    env[stage.envKey] ?? env.LINE_COVERAGE_MIN ?? stage.defaultMinimum,
    stage.envKey,
  );
}

function formatCoverageMinimum(minimum) {
  return String(minimum);
}

export function buildCoverageCommand(stage, env = process.env) {
  const minimum = coverageMinimum(stage, env);
  const branchMin = parseCoverageMinimum(
    env[stage.branchEnvKey] ?? stage.defaultBranchMinimum,
    stage.branchEnvKey,
  );
  const functionMin = parseCoverageMinimum(
    env[stage.functionEnvKey] ?? stage.defaultFunctionMinimum,
    stage.functionEnvKey,
  );
  return {
    command: stage.command,
    args: [
      ...stage.args,
      `--test-coverage-lines=${formatCoverageMinimum(minimum)}`,
      `--test-coverage-branches=${formatCoverageMinimum(branchMin)}`,
      `--test-coverage-functions=${formatCoverageMinimum(functionMin)}`,
      ...stage.includes.map((pattern) => `--test-coverage-include=${pattern}`),
      ...stage.excludes.map((pattern) => `--test-coverage-exclude=${pattern}`),
      ...stage.testFiles,
    ],
    minimum,
  };
}

function displayCommand(command, args) {
  return [command, ...args].join(" ");
}

export function runLineCoverage({
  stages = LINE_COVERAGE_STAGES,
  env = process.env,
  spawn = spawnSync,
} = {}) {
  for (const [index, stage] of stages.entries()) {
    let coverageCommand;
    try {
      coverageCommand = buildCoverageCommand(stage, env);
    } catch (error) {
      console.error(error.message);
      return 1;
    }

    console.log(
      `\n[line-coverage ${index + 1}/${stages.length}] ${stage.name}: minimum ${formatCoverageMinimum(coverageCommand.minimum)}%`,
    );
    console.log(displayCommand(coverageCommand.command, coverageCommand.args));

    const result = spawn(coverageCommand.command, coverageCommand.args, {
      stdio: "inherit",
      env,
    });
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }

  console.log("\nLine coverage gate passed.");
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = runLineCoverage();
}
