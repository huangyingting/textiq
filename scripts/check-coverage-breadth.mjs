#!/usr/bin/env node

/**
 * Coverage breadth non-regression gate (#1896).
 *
 * Runs the source unit test suite through the `node:test` `run()` API,
 * builds the structured breadth inventory from `scripts/coverage-breadth.mjs`,
 * and fails only when the number of unresolved, actionable runtime-file
 * coverage gaps *increases* past the recorded baseline. Improvements (fewer
 * gap files) always pass; this PR intentionally does not force every
 * existing gap closed (#1896 scope: visibility + non-regression, not a full
 * backfill).
 *
 * The baseline below (167) was measured directly against this repository at
 * the time this gate was added, using this gate's own eligibility scan and
 * TypeScript-AST classification: 781 eligible runtime source files under
 * `src/**` (same include/exclude globs as the "Source unit line coverage"
 * stage), 590 loaded by the source unit suite, 191 absent. Of those 191
 * absent files, 22 are type-only (no runtime behavior — up from a rough
 * pre-#1896 estimate of 14, because this classifier also recognizes ambient
 * `declare module` augmentation files such as `src/types/next-auth.d.ts` and
 * ordinary `*-types.ts` files that a plain-text scan missed) and 2 are pure
 * re-export barrels (matching the pre-#1896 estimate exactly), leaving 167
 * actionable gap files. See docs/operations/quality-gates.md for the full
 * breakdown. Lower this constant by hand whenever gap files are closed in
 * the same commit; never raise it to hide a regression. Use
 * COVERAGE_BREADTH_MAX_GAP_FILES for local experimentation only — do not use
 * it to mask a real regression in CI.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  buildBreadthReport,
  collectLoadedFiles,
  formatBreadthReport,
  listEligibleSourceFiles,
  SOURCE_COVERAGE_STAGE,
} from "./coverage-breadth.mjs";
import { scanRepositoryRoots } from "./source-scan-utils.mjs";

export const DEFAULT_MAX_GAP_FILES = 167;
export const MAX_GAP_ENV_KEY = "COVERAGE_BREADTH_MAX_GAP_FILES";

export function parseMaxGapFiles(env = process.env) {
  const raw = env[MAX_GAP_ENV_KEY];
  if (raw === undefined) {
    return DEFAULT_MAX_GAP_FILES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${MAX_GAP_ENV_KEY} must be a non-negative integer.`);
  }
  return parsed;
}

export function listSourceTestFiles(repoRoot = process.cwd()) {
  return scanRepositoryRoots({
    repoRoot,
    roots: ["src"],
    sourceExtensions: new Set([".ts", ".tsx"]),
    scanText: (filePath) => [filePath],
    shouldScanFile: (filePath) => /\.test\.tsx?$/.test(filePath),
  }).sort();
}

export async function runCoverageBreadthCheck({
  repoRoot = process.cwd(),
  env = process.env,
  concurrency = 4,
  collectLoaded = collectLoadedFiles,
  listEligible = listEligibleSourceFiles,
  listTestFiles = listSourceTestFiles,
  buildReport = buildBreadthReport,
  formatReport = formatBreadthReport,
  log = console.log,
  logError = console.error,
} = {}) {
  let maxGapFiles;
  try {
    maxGapFiles = parseMaxGapFiles(env);
  } catch (error) {
    logError(error.message);
    return 1;
  }

  const eligibleFiles = listEligible(repoRoot);
  const testFiles = listTestFiles(repoRoot);

  const { loaded, failureCount } = await collectLoaded({
    repoRoot,
    testFiles,
    stage: SOURCE_COVERAGE_STAGE,
    concurrency,
  });

  const report = buildReport({
    repoRoot,
    eligibleFiles,
    loadedFiles: loaded,
  });

  log(formatReport(report));

  if (failureCount > 0) {
    logError(
      `\n${failureCount} source unit test failure(s) occurred during the coverage breadth run; fix failures before trusting this inventory.`,
    );
    return 1;
  }

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
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCoverageBreadthCheck().then((code) => {
    process.exitCode = code;
  });
}
