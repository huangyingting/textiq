#!/usr/bin/env node

/**
 * Coverage breadth non-regression gate (#1896, widened to deck-kernel in
 * #1925, ratcheted to the authoritative merged Wave 5 baseline in #1943,
 * ratcheted again for direct visual-export/editor coverage in #1947, closed
 * nine framework/page exception-audit gaps in #1948, closed the loading-
 * boundary and editor-glue exception candidates in #1949, folded static-data
 * and import-alias-barrel classification into the breadth inventory in
 * #1950, closed brand and billing product-surface gaps in #1956, closed the
 * six public-render page/lightbox/fallback exception candidates in #1960).
 *
 * Runs the source unit test suite through the `node:test` `run()` API,
 * builds the structured breadth inventory from `scripts/coverage-breadth.mjs`,
 * and fails only when the number of unresolved, actionable runtime-file
 * coverage gaps *increases* past the recorded baseline. Improvements (fewer
 * gap files) always pass; this gate intentionally does not force every
 * existing gap closed (#1896 scope: visibility + non-regression, not a full
 * backfill).
 *
 * The baseline below (46) is #1960 rebased onto `main` after #1956 (the
 * merged brand/billing product-surface ratchet). #1960 added direct
 * module-hook/server-component tests for the five files that were
 * previously only exercised by E2E `notFound()` paths — `src/app/embed/
 * [shareId]/page.tsx`, `src/app/present/[shareId]/embed/page.tsx`,
 * `src/app/present/[shareId]/page.tsx`, `src/app/share/[shareId]/page.tsx`,
 * and `src/app/share/[shareId]/share-lightbox.tsx` (the last via a real-DOM
 * `happy-dom` + `react-dom/client` harness for its portal/focus/keyboard
 * interactions) — plus a direct render test for
 * `src/components/not-found-fallback.tsx`, which was already unit-loaded
 * transitively through `src/app/not-found.test.tsx` and so does not change
 * the loaded count on its own. This branch was originally rebased onto
 * `main` at `969e6387` (post #1950's static-data/import-alias-barrel
 * classification: 782 runtime-eligible, 717 loaded), closing 5 actionable
 * gaps for 722 loaded / 54 actionable gap files at that time. That 722/54
 * measurement is now historical: this commit was mechanically rebased a
 * second time onto `main` (#1956, which closed 8 brand/billing/
 * product-surface gaps, raising unit-loaded to 725 and lowering the gap
 * ceiling to 51 with zero gap-count change of its own to the six #1960
 * target files). Re-measured directly against this twice-rebased tree, the
 * same five newly-tested target files leave 848 eligible runtime source
 * files, 24 type-only, 31 barrel, 11 static-data, 782 runtime-eligible (all
 * unchanged), 730 loaded by the source unit suite (725 #1956 baseline + 5
 * from #1960), 6 mapped-e2e (unchanged), 0 approved exceptions, leaving 46
 * actionable gap files (`DEFAULT_MAX_GAP_FILES` was lowered from 51 to 46 to
 * match, with zero stale slack). This is the authoritative baseline going
 * forward; the historical entries below (including #1960's own pre-second-
 * rebase 722/54 measurement) remain only as context for how the ceiling
 * evolved.
 *
 * The baseline prior to #1960's second rebase (51) is #1956 rebased onto
 * `main` after #1950 (see below); the baseline prior to that (59) is #1950
 * rebased onto `main` after #1970 (the merged #1949 ratchet). #1950 widened
 * `barrel` to also cover
 * re-export glue built from `const` aliases to non-computed property
 * accesses on imported bindings (e.g.
 * `src/app/api/auth/[...nextauth]/route.ts`'s `export const GET =
 * handlers.GET;`) and added a new `static-data` category for modules
 * containing nothing but type declarations and `const` exports built
 * entirely from static primitive/template literals and recursively static
 * arrays/objects (e.g. `src/lib/app-shell/chrome.ts`). Re-measured directly
 * against the rebased branch: 848 eligible runtime source files under
 * `src/**`, 24 type-only, 31 barrel (up from 30 — the nextauth route
 * handler), 11 static-data (new bucket: `src/lib/app-shell/chrome.ts`,
 * `src/components/motion/tokens.ts`, `src/lib/auth/form-state.ts`,
 * `src/lib/presentation/schema.ts`, `src/lib/icons/data.ts`,
 * `src/lib/visual/{display-styles,registry-prompt,themes}.ts`, and three
 * `src/lib/document/deck-kernel/*-primitives.ts`/`presentation-theme-ids.ts`
 * files — all independently audited and confirmed to contain no functions,
 * classes, or value imports), 782 runtime-eligible (down from 794 — 31 + 11
 * moved out of `runtime-eligible` into the two excluded buckets), 717
 * loaded by the source unit suite (down from 728 — 11 of the 12
 * reclassified files were previously unit-loaded and moved with their
 * source files into the excluded buckets), 6 mapped-e2e (unchanged), 0
 * approved exceptions, leaving 59 actionable gap files (`DEFAULT_MAX_GAP_FILES`
 * was lowered from 60 to 59 to match — the twelfth reclassified file, the
 * nextauth route handler, was the prior gap file that moved directly into
 * `barrel`, with zero stale slack). This was the authoritative baseline
 * until superseded by the #1960 ratchet above.
 *
 * The baseline prior to #1950 (60) is #1949 rebased onto `main` after #1966
 * (the merged #1948 ratchet). #1949 replaced the "rejected exception
 * candidate" conclusion for nine files with direct coverage: `src/lib/visual/
 * export-settings.ts` and `src/app/app/documents/[id]/insert-visual-plugin.tsx`
 * gained real headless-Lexical/React-render tests, and all seven route
 * `loading.tsx` boundaries (`app`, `documents/[id]`, `brands`, `settings`,
 * `settings/billing`, `workspaces`, `workspaces/[id]`) gained a single
 * batch-render test asserting distinct accessible labels/status/busy
 * semantics and meaningful skeleton structure. Re-measured directly against
 * the rebased branch: 848 eligible runtime source files, 24 type-only, 30
 * barrel, 794 runtime-eligible, **728** loaded by the source unit suite (718
 * #1966 baseline + 9 target files + `src/components/ui/skeleton.tsx`, the
 * shared primitive closed transitively by the loading-boundary batch test),
 * 6 mapped-e2e (unchanged), 0 approved exceptions, leaving **60** actionable
 * gap files. `DEFAULT_MAX_GAP_FILES` was lowered from 70 to 60 to match,
 * with zero stale slack. This was the authoritative baseline until
 * superseded by the #1950 rebase above.
 *
 * The baseline prior to #1949 (70) is #1948 rebased onto `main` after #1954
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
 * zero stale slack). This was the authoritative baseline until superseded by
 * the #1950 rebase above; the branch-local #1948 numbers below (90, measured
 * before #1948 was rebased onto #1954) are historical/superseded and remain
 * only as context for how the ceiling evolved.
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
 *
 * #1956 re-baseline (historical, pre-#1950). Rebased onto `main` after #1949
 * (which independently lowered the inherited ceiling to 60, 728 loaded):
 * re-measured directly against that (pre-#1950) tree, 848 eligible runtime
 * source files, 24 type-only, 30 barrel, 794 runtime-eligible, 736 loaded, 6
 * mapped-e2e (unchanged), 0 approved exceptions, and 52 actionable gap
 * files. This measurement predates the mandatory #1950 rebase below and is
 * retained only as historical context; it is no longer authoritative.
 *
 * #1956 re-baseline, mechanically rebased onto `main` at `969e6387` (post
 * #1950's static-data/import-alias-barrel classification, which lowered
 * runtime-eligible to 782 and unit-loaded to 717). #1956 closed 8
 * actionable gaps with direct unit tests: `brand-studio-teaser.tsx`,
 * `brand-studio.tsx`, `brands/page.tsx`, `import-document-button.tsx`,
 * `new-document-button.tsx`, `onboarding-checklist.tsx`, and
 * `settings/billing/page.tsx` (the seven files this issue targeted,
 * previously rejected from mapped-E2E coverage), plus one legitimate
 * transitive gap file, `src/app/app/brands/brand-studio-ports.ts`, whose
 * `BrandUploadPort` contract is now genuinely exercised (not stubbed) by the
 * new `brand-studio.test.tsx`'s logo/font upload tests. Re-measured
 * directly against the rebased tree: 848 eligible runtime source files
 * (unchanged), 24 type-only (unchanged), 31 barrel (unchanged), 11
 * static-data (unchanged), 782 runtime-eligible (unchanged — #1956 adds no
 * new source files, only tests and extractions within already-eligible
 * files), 725 loaded by the source unit suite (717 #1950 baseline + 8 from
 * #1956), 6 mapped-e2e (unchanged), 0 approved exceptions, and 51 actionable
 * gap files. `DEFAULT_MAX_GAP_FILES` is lowered from 59 to 51 to match, with
 * zero stale slack. This was the authoritative baseline until superseded by
 * the #1960 second-rebase ratchet above.
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

export const DEFAULT_MAX_GAP_FILES = 46;
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
