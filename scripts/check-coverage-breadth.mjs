#!/usr/bin/env node

/**
 * Coverage breadth non-regression gate (#1896, widened to deck-kernel in
 * #1925, ratcheted to the authoritative merged Wave 5 baseline in #1943,
 * ratcheted again for direct visual-export/editor coverage in #1947, closed
 * nine framework/page exception-audit gaps in #1948).
 *
 * Runs the source unit test suite through the `node:test` `run()` API,
 * builds the structured breadth inventory from `scripts/coverage-breadth.mjs`,
 * and fails only when the number of unresolved, actionable runtime-file
 * coverage gaps *increases* past the recorded baseline. Improvements (fewer
 * gap files) always pass; this gate intentionally does not force every
 * existing gap closed (#1896 scope: visibility + non-regression, not a full
 * backfill).
 *
 * The baseline below (70) is #1948 rebased onto `main` after #1954
 * (the rebased #1947 ratchet, which itself absorbed #1951 and #1952)
 * independently raised the inherited ceiling to 94 without #1948's own gap
 * closures. #1948 replaced the "untestable exception" conclusion for ten
 * framework/page files with direct coverage: nine files
 * (`src/app/layout.tsx`, `error.tsx`, `not-found.tsx`, `signout/route.ts`,
 * `forgot-password/page.tsx`, `reset-password/page.tsx`, `visuals/page.tsx`,
 * `src/components/site-header.tsx`, `src/app/app/trash/page.tsx`) gained
 * direct module-hook/server-component render tests, and the tenth
 * (`src/app/page.tsx`) gained a `coverage-breadth: mapped-e2e` marker
 * referencing the always-running `e2e/public-render/public-pages.spec.ts`.
 * Re-measured directly against the rebased branch: 848 eligible runtime
 * source files under `src/**`, 24 type-only, 30 barrel, 794 runtime-eligible,
 * 718 loaded by the source unit suite (695 #1954 baseline + 23 from #1948 —
 * some sibling files the original #1948 measurement counted as newly loaded
 * were already loaded transitively via #1947/#1951/#1952 by rebase time), 6
 * mapped-e2e (up from 5), 0 approved exceptions, leaving 70 actionable gap
 * files (`DEFAULT_MAX_GAP_FILES` was lowered from 94 to 70 to match, with
 * zero stale slack). This is the authoritative baseline going forward; the
 * branch-local #1948 numbers below (90, measured before #1948 was rebased
 * onto #1954) are historical/superseded and remain only as context for how
 * the ceiling evolved.
 *
 * #1948 branch-local measurement (superseded above by the rebased
 * measurement): added direct unit/render tests for the same nine
 * previously-gap framework files and the same `src/app/page.tsx`
 * mapped-e2e marker described above. Re-measured on top of the #1943
 * baseline (before #1947/#1951/#1952/#1954 existed): 848 eligible runtime
 * source files, 24 type-only, 30 barrel, 794 runtime-eligible, 698 loaded by
 * the source unit suite (up from 672), 6 mapped-e2e (up from 5), 0 approved
 * exceptions, leaving 90 actionable gap files (`DEFAULT_MAX_GAP_FILES` was
 * lowered from 117 to 90 to match at the time). That number is historical
 * and no longer reflects `main`.
 *
 * The baseline prior to #1948 (94) is #1947 rebased onto `main` after #1951
 * and #1952 independently landed their own gap-closing coverage (client
 * runtime hooks and server loader contracts, respectively) without lowering
 * the 117 ceiling they inherited from #1943. #1947 itself added direct unit
 * coverage for five previously-untested files
 * (`src/lib/visual/document-export-targets.ts`,
 * `src/app/app/documents/[id]/visual-context-popover-hooks.ts`,
 * `src/app/app/documents/[id]/visual-panel-context.tsx`,
 * `src/app/app/documents/[id]/source-block-jump.tsx`,
 * `src/components/lexical/lexical-read-only.tsx`). Re-measured directly
 * against the rebased branch: 848 eligible runtime source files under
 * `src/**`, 24 type-only, 30 barrel, 794 runtime-eligible, 695 loaded by the
 * source unit suite (672 Wave 5 baseline + 8 from #1951 + 10 from #1952 + 5
 * from #1947), 5 mapped-e2e, 0 approved exceptions, leaving 94 actionable
 * gap files (`DEFAULT_MAX_GAP_FILES` was lowered from 117 to 94 to match,
 * with zero stale slack). Prior to #1947 (and #1951/#1952), the authoritative
 * merged Wave 5 baseline (#1943), re-measured directly against `main` at
 * cd38a40df82ce9d90d89e1784d2b2d0841eab2ac: 848 eligible runtime source files
 * under `src/**`, 24 type-only, 30 barrel, 794 runtime-eligible, 672 loaded
 * by the source unit suite, 5 mapped-e2e, 0 approved exceptions, leaving 117
 * actionable gap files (`DEFAULT_MAX_GAP_FILES` was lowered from 130 to 117
 * to match). This supersedes the prior 130 ceiling: that number was only ever
 * measured branch-locally on #1933's own feature branch, and went stale once
 * several independently merged Wave 5 batch-2 PRs landed on `main` afterward
 * and closed additional gaps invisible to #1933's branch at measurement time.
 * Branch-local #1933 measured 848 eligible, 24 type-only, 30 barrel, 794
 * runtime-eligible, 664 loaded, leaving 130 actionable gap files
 * (`DEFAULT_MAX_GAP_FILES` was lowered from 148 to 130 to match at the time)
 * — that number is historical and no longer reflects `main`; see
 * docs/operations/quality-gates.md for the full breakdown of both
 * measurements. Before #1933 (as of #1925, which widened
 * `listEligibleSourceFiles`/`collectLoadedFiles` to include
 * `src/lib/document/deck-kernel/**` in breadth eligibility and
 * instrumentation — previously excluded entirely, see
 * `BREADTH_COVERAGE_STAGE` in `coverage-breadth.mjs`): 848 eligible runtime
 * source files, 24 type-only, 30 barrel, 794 runtime-eligible, 646 loaded by
 * the source unit suite, leaving 148 actionable gap files. Widening to
 * include deck-kernel added 66 eligible files (1 type-only, 4 barrel, 61
 * runtime-eligible), of which 60 were already loaded by deck-kernel's own
 * test suite and 1 (`src/lib/document/deck-kernel/theme-typography.ts`) is a
 * new actionable gap — deck-kernel was already well unit-tested, so widening
 * breadth to cover it barely moved the gap count even though it moved the
 * eligible and loaded counts substantially. This is a zero-slack baseline: it
 * is set to the exact measured count, not a rounded-up buffer. See
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

export const DEFAULT_MAX_GAP_FILES = 70;
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

  let report;
  try {
    report = buildReport({
      repoRoot,
      eligibleFiles,
      loadedFiles: loaded,
    });
  } catch (error) {
    logError(error.message);
    return 1;
  }

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
