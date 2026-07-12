#!/usr/bin/env node

/**
 * Coverage breadth non-regression gate (#1896, widened to deck-kernel in
 * #1925).
 *
 * Runs the source unit test suite through the `node:test` `run()` API,
 * builds the structured breadth inventory from `scripts/coverage-breadth.mjs`,
 * and fails only when the number of unresolved, actionable runtime-file
 * coverage gaps *increases* past the recorded baseline. Improvements (fewer
 * gap files) always pass; this gate intentionally does not force every
 * existing gap closed (#1896 scope: visibility + non-regression, not a full
 * backfill).
 *
 * The baseline below (148) was re-measured directly against this repository
 * when #1925 widened `listEligibleSourceFiles`/`collectLoadedFiles` to
 * include `src/lib/document/deck-kernel/**` in breadth eligibility and
 * instrumentation (previously excluded entirely — see
 * `BREADTH_COVERAGE_STAGE` in `coverage-breadth.mjs`): 848 eligible runtime
 * source files under `src/**`, 24 type-only, 30 barrel, 794 runtime-eligible,
 * 646 loaded by the source unit suite, leaving 148 actionable gap files.
 * Widening to include deck-kernel added 66 eligible files (1 type-only, 4
 * barrel, 61 runtime-eligible), of which 60 were already loaded by
 * deck-kernel's own test suite and 1
 * (`src/lib/document/deck-kernel/theme-typography.ts`) is a new actionable
 * gap — deck-kernel was already well unit-tested, so widening breadth to
 * cover it barely moved the gap count even though it moved the eligible and
 * loaded counts substantially. This is a zero-slack baseline: it is set to
 * the exact measured count, not a rounded-up buffer. See
 * docs/operations/quality-gates.md for the full breakdown. Lower this
 * constant by hand whenever gap files are closed in the same commit; never
 * raise it to hide a regression. Use COVERAGE_BREADTH_MAX_GAP_FILES for local
 * experimentation only — do not use it to mask a real regression in CI.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  BREADTH_COVERAGE_STAGE,
  buildBreadthReport,
  collectLoadedFiles,
  formatBreadthReport,
  listEligibleSourceFiles,
} from "./coverage-breadth.mjs";
import { scanRepositoryRoots } from "./source-scan-utils.mjs";

export const DEFAULT_MAX_GAP_FILES = 148;
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
    stage: BREADTH_COVERAGE_STAGE,
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
