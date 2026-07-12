#!/usr/bin/env node

/**
 * Combined coverage gate (#1919).
 *
 * `npm test` used to run the source unit test suite twice:
 *   1. `check-line-coverage.mjs` spawned `node --test
 *      --experimental-test-coverage --test-coverage-lines=... <files>` as a
 *      CLI child process to enforce the line/branch/function percentage
 *      floors.
 *   2. `check-coverage-breadth.mjs` ran the exact same source unit suite a
 *      second time, in-process, through the `node:test` `run()` API
 *      (`collectLoadedFiles` in `coverage-breadth.mjs`) purely to learn
 *      which eligible files were actually loaded, for the breadth
 *      inventory.
 *
 * Both runs execute the identical `src/**\/*.test.ts(x)` suite, so the
 * combined `npm test` gate paid for that suite's wall-clock cost twice for
 * no additional signal. This script runs the source suite exactly once,
 * programmatically, and derives both results from the single structured
 * `test:coverage` summary it produces:
 *   - the percentage floors are checked with the same `actual < threshold`
 *     comparison Node's own test runner uses for `--test-coverage-lines`
 *     `-branches`/`-functions` (see `evaluateCoverageFloors` in
 *     `check-line-coverage.mjs`), using the exact same threshold resolution
 *     (and environment overrides) as the standalone `test:line-coverage`
 *     source stage.
 *   - the breadth report is built from the same run's loaded-file set,
 *     reusing `buildBreadthReport` unchanged from `coverage-breadth.mjs`.
 *
 * The "Script line coverage" stage is unrelated to source breadth (it
 * covers `scripts/**\/*.mjs`, not `src/**`), so it keeps running exactly as
 * `check-line-coverage.mjs` always has: a spawned CLI child process with
 * `stdio: "inherit"`.
 *
 * Standalone `npm run test:line-coverage` and `npm run test:coverage-breadth`
 * are untouched by this file and continue to run the source suite
 * independently through their existing code paths — this gate only removes
 * the duplication on the combined `npm test` path.
 */

import { spawnSync } from "node:child_process";
import process from "node:process";
import { spec } from "node:test/reporters";
import { pathToFileURL } from "node:url";
import {
  buildCoverageCommand,
  displayCommand,
  evaluateCoverageFloors,
  LINE_COVERAGE_STAGES,
  resolveStageThresholds,
} from "./check-line-coverage.mjs";
import {
  listSourceTestFiles,
  parseMaxGapFiles,
} from "./check-coverage-breadth.mjs";
import {
  buildBreadthReport,
  collectLoadedFiles,
  formatBreadthReport,
  listEligibleSourceFiles,
} from "./coverage-breadth.mjs";

const [SOURCE_STAGE, SCRIPT_STAGE] = LINE_COVERAGE_STAGES;

/**
 * Match the CLI test runner's own default reporter. Node's `node --test`
 * always defaults to `spec` (see `kDefaultReporter` in
 * `lib/internal/test_runner/utils.js`) regardless of whether stdout is a
 * TTY, so the combined gate's source-stage output looks the same as the
 * CLI-spawn output it replaces in both interactive and CI environments.
 * `destination` is accepted for symmetry with `collectLoadedFiles`'s
 * `reporterDestination` option, not because reporter choice depends on it.
 */
export function defaultReporter(_destination = process.stdout) {
  return spec;
}

export async function runCombinedCoverageGate({
  env = process.env,
  repoRoot = process.cwd(),
  // Matches the source stage's own `--test-concurrency=1` (see
  // `LINE_COVERAGE_STAGES` in check-line-coverage.mjs) so the shared run
  // preserves that stage's execution characteristics exactly; only the
  // duplicate second pass is removed, not its concurrency behavior.
  concurrency = 1,
  spawn = spawnSync,
  collectLoaded = collectLoadedFiles,
  listEligible = listEligibleSourceFiles,
  listTestFiles = listSourceTestFiles,
  buildReport = buildBreadthReport,
  formatReport = formatBreadthReport,
  reporter = defaultReporter(),
  reporterDestination = process.stdout,
  log = console.log,
  logError = console.error,
} = {}) {
  let sourceThresholds;
  let maxGapFiles;
  try {
    sourceThresholds = resolveStageThresholds(SOURCE_STAGE, env);
    maxGapFiles = parseMaxGapFiles(env);
  } catch (error) {
    logError(error.message);
    return 1;
  }

  log(
    `\n[combined-coverage 1/2] ${SOURCE_STAGE.name} + coverage breadth: minimum ${sourceThresholds.line}% lines, ${sourceThresholds.branch}% branches, ${sourceThresholds.function}% functions (single source suite run)`,
  );

  const testFiles = listTestFiles(repoRoot);
  const { loaded, failureCount, summary } = await collectLoaded({
    repoRoot,
    testFiles,
    stage: SOURCE_STAGE,
    concurrency,
    lineCoverage: sourceThresholds.line,
    branchCoverage: sourceThresholds.branch,
    functionCoverage: sourceThresholds.function,
    reporter,
    reporterDestination,
  });

  if (failureCount > 0) {
    logError(
      `\n${failureCount} source unit test failure(s) occurred; fix failures before trusting coverage or breadth results.`,
    );
    return 1;
  }

  const floorFailures = evaluateCoverageFloors(summary, sourceThresholds);
  if (floorFailures.length > 0) {
    for (const { name, actual, threshold } of floorFailures) {
      logError(
        `Error: ${actual.toFixed(2)}% ${name} coverage does not meet threshold of ${threshold}%.`,
      );
    }
    return 1;
  }

  const eligibleFiles = listEligible(repoRoot);
  const report = buildReport({ repoRoot, eligibleFiles, loadedFiles: loaded });
  log(formatReport(report));

  if (report.actionableGapCount > maxGapFiles) {
    logError(
      `\nCoverage breadth regression: ${report.actionableGapCount} unresolved runtime-file gap(s) exceeds the allowed maximum of ${maxGapFiles}.`,
    );
    logError("Unresolved gap files:");
    for (const filePath of report.files.gap) {
      logError(`  - ${filePath}`);
    }
    return 1;
  }

  log(
    `\nCoverage breadth gate passed (${report.actionableGapCount} unresolved gap file(s), allowed maximum ${maxGapFiles}).`,
  );

  let scriptCommand;
  try {
    scriptCommand = buildCoverageCommand(SCRIPT_STAGE, env);
  } catch (error) {
    logError(error.message);
    return 1;
  }

  log(
    `\n[combined-coverage 2/2] ${SCRIPT_STAGE.name}: minimum ${scriptCommand.minimum}%`,
  );
  log(displayCommand(scriptCommand.command, scriptCommand.args));
  const scriptResult = spawn(scriptCommand.command, scriptCommand.args, {
    stdio: "inherit",
    env,
  });
  if (scriptResult.status !== 0) {
    return scriptResult.status ?? 1;
  }

  log("\nCombined coverage gate passed.");
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCombinedCoverageGate().then((code) => {
    process.exitCode = code;
  });
}
