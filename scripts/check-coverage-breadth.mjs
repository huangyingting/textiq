#!/usr/bin/env node

/**
 * Coverage breadth non-regression gate (#1896, widened to deck-kernel in
 * #1925, ratcheted to the authoritative merged Wave 5 baseline in #1943,
 * ratcheted again for direct visual-export/editor coverage in #1947, closed
 * nine framework/page exception-audit gaps in #1948, closed the loading-
 * boundary and editor-glue exception candidates in #1949, folded static-data
 * and import-alias-barrel classification into the breadth inventory in
 * #1950, closed brand and billing product-surface gaps in #1956, closed the
 * six public-render page/lightbox/fallback exception candidates in #1960,
 * ratcheted again for direct workspace/dashboard page and member-interaction
 * coverage in #1957, closed nine dashboard/document-management-UI gaps in
 * #1961, closed nine core-editor-interaction gaps in #1958).
 *
 * Runs the source unit test suite through the `node:test` `run()` API,
 * builds the structured breadth inventory from `scripts/coverage-breadth.mjs`,
 * and fails only when the number of unresolved, actionable runtime-file
 * coverage gaps *increases* past the recorded baseline. Improvements (fewer
 * gap files) always pass; this gate intentionally does not force every
 * existing gap closed (#1896 scope: visibility + non-regression, not a full
 * backfill).
 *
 * The baseline below (7) is #1958 mechanically rebased onto `main` at
 * `a5ead8fc` (post #1984, which itself folds in #1957/#1961/#1959/#1960/#1962
 * and their dependents). #1958 adds direct behavior-level tests for the nine
 * core document-editor files previously represented only by mapped/skipped
 * E2E evidence: `src/app/app/documents/[id]/block-spark.tsx`,
 * `floating-text-toolbar.tsx`, `icon-picker.tsx`, `import-plugin.tsx`,
 * `insert-menu.tsx`, `lexical-editor.tsx`, `table-controls.tsx`,
 * `visual-card.tsx`, and `page.tsx`. No production files changed. Measured
 * directly against the rebased tree before this branch's own commit lands
 * (i.e. `main` at `a5ead8fc` alone): 848 eligible runtime source files, 24
 * type-only, 31 barrel, 11 static-data, 782 runtime-eligible, 760 loaded by
 * the source unit suite, 6 mapped-e2e, 0 approved exceptions, and 16
 * actionable gap files — nine of which are exactly the #1958 target files
 * above (the ceiling of 27 inherited from #1961 already had slack: later
 * `main` commits closed gaps of their own without ratcheting the constant
 * down, per this gate's improvements-always-pass design). With #1958's nine
 * target files now genuinely unit-loaded, re-measured against the full
 * rebased tree: 769 loaded (760 + 9), 6 mapped-e2e (unchanged), 0 approved
 * exceptions, leaving **7** actionable gap files (`src/app/api/slide-assets/
 * [documentId]/[...path]/route.ts`,
 * `src/app/app/documents/[id]/visual-context-popover-panels.tsx`,
 * `visual-context-popover.tsx`, `visual-editor.tsx`,
 * `src/components/visual/export-dialog.tsx`, `export-menu.tsx`, and
 * `src/scripts/audit-persisted-schema.ts` — all pre-existing, unrelated to
 * this branch). `DEFAULT_MAX_GAP_FILES` was lowered from 27 to **7** to
 * match, with zero stale slack. This is the authoritative baseline going
 * forward; the historical entries below remain only as context for how the
 * ceiling evolved.
 *
 * The baseline prior to #1958's rebase (27) is #1961 rebased onto `main`
 * after #1972 (the merged #1957 workspace/dashboard-page ratchet). #1961
 * closes 9
 * dashboard/document-management-UI gaps with direct behavior tests:
 * `document-card.tsx`, `document-grid.tsx`, `document-list.tsx`,
 * `document-list-toolbar.tsx`, `document-list-undo-toast.tsx`,
 * `documents/[id]/share-button.tsx`, `documents/[id]/tag-control.tsx`,
 * `documents/[id]/version-history-panel.tsx`, and `trash/trash-list.tsx`
 * (all nine previously untested; every server action they call was already
 * covered elsewhere and is stubbed via the new shared `@/test/module-stub`
 * helper), plus one legitimate transitive gap file,
 * `src/components/share/social-share-menu.tsx`, whose presence-gating and
 * intent-link rendering is now genuinely exercised (not stubbed) by the new
 * `share-button.test.tsx`'s toggled-on/disabled-prompt tests. This branch
 * was originally rebased onto `main` at `d9844dbf` (post #1956's brand/
 * billing product-surface ratchet: 782 runtime-eligible, 725 loaded),
 * closing the same 9 direct gaps plus the transitive one for 735 loaded /
 * 41 actionable gap files at that time, then mechanically rebased a second
 * time onto `main` at `90a23fcc` (#1960/#1975, which closed 5 public-render
 * gaps of its own, raising unit-loaded to 730 and lowering the gap ceiling
 * to 46 with zero gap-count change of its own to the nine #1961 target
 * files), measuring 740 loaded / 36 gap at that time (see the superseded
 * entry below). `main` then independently gained #1972 (the merged #1957
 * ratchet, closing nine workspace/dashboard-page gaps and raising
 * unit-loaded to 739 / lowering the ceiling to 37, with zero gap-count
 * change of its own to the #1961 target files). Rebased a third time onto
 * that `main`, and re-measured directly against this tree, the same nine
 * newly-tested target files plus the one transitive closure leave 848
 * eligible runtime source files, 24 type-only, 31 barrel, 11 static-data,
 * 782 runtime-eligible (all unchanged), **749** loaded by the source unit
 * suite (739 #1957 baseline + 10 from #1961), 6 mapped-e2e (unchanged), 0
 * approved exceptions, leaving **27** actionable gap files.
 * `DEFAULT_MAX_GAP_FILES` was lowered from 37 to **27** to match, with zero
 * stale slack. This was the authoritative baseline until superseded by the
 * #1958 rebase above; the historical entries below (including this branch's
 * own pre-third-rebase 735/41 and 740/36 measurements) remain only as
 * context for how the ceiling evolved.
 *
 * The baseline prior to #1961's third rebase (37) is #1957 rebased onto
 * `main` after
 * #1975 (the merged #1960 ratchet). #1957 added direct behavior coverage for
 * nine previously mapped-E2E-only workspace/dashboard files
 * (`src/app/app/page.tsx`, `src/app/app/join/[token]/page.tsx`,
 * `src/app/app/workspaces/page.tsx`, `src/app/app/workspaces/[id]/page.tsx`,
 * `src/app/app/workspaces/create-workspace-button.tsx`,
 * `src/app/app/workspaces/[id]/invite-link-manager.tsx`,
 * `src/app/app/workspaces/[id]/members-list.tsx`,
 * `src/app/app/workspaces/[id]/workspace-documents.tsx`,
 * `src/app/app/workspaces/[id]/workspace-settings.tsx`). An earlier revision
 * of this same test also left `src/app/app/page.tsx`'s new test importing
 * its `./document-list` sibling for real (unstubbed), which added
 * `document-list.tsx` itself plus four further transitively-loaded
 * dashboard components to the unit-loaded set — five files in total
 * (`src/app/app/document-list.tsx`, `src/app/app/document-grid.tsx`,
 * `src/app/app/document-card.tsx`, `src/app/app/document-list-toolbar.tsx`,
 * `src/app/app/document-list-undo-toast.tsx`) — briefly counted as 5
 * incremental gap closures (739 loaded / 32 gap, then later 744 loaded / 32
 * gap after the second rebase). None of those five files have a dedicated
 * test, and — because `DashboardPage`'s test never calls React's
 * reconciler — none of their component bodies actually run; they were
 * merely imported, so most of their lines/branches/functions were
 * instrumented but never exercised. That dragged the repo-wide line-
 * coverage floor from a passing 95.14% down to a failing 94.73% in the
 * Node 22 Quality Gate CI run (floor is 95% lines), even though every unit
 * suite passed. The fix, applied directly in `src/app/app/page.test.tsx`,
 * stubs `./document-list` the same way `./actions` is already stubbed
 * elsewhere in the same file (a relative specifier matched literally by the
 * `resolve` hook — there was never a technical restriction preventing this,
 * only a prior choice to leave it real), which removes all five files from
 * the instrumented set again and restores the floor to a passing 95.21%
 * lines. That correction gives back the five incidental gap "closures" that
 * were never true behavioral coverage in the first place, so the real,
 * durable improvement from #1957 is exactly the nine direct target files
 * above. This branch was originally rebased onto `main` at `d9844dbf` (post
 * #1956's merged brand/billing ratchet: 782 runtime-eligible, 725 loaded),
 * then mechanically rebased a second time onto `main` (#1960, which closed
 * 6 public-render page/lightbox/fallback gaps, raising unit-loaded to 730
 * and lowering the gap ceiling to 46, with zero gap-count change of its own
 * to the 9 #1957 target files). Re-measured directly against this
 * twice-rebased tree after the document-list stub fix, the 9 newly-tested
 * files leave 848 eligible runtime source files, 24 type-only, 31 barrel,
 * 11 static-data, 782 runtime-eligible (all unchanged), 739 loaded by the
 * source unit suite (730 #1960 baseline + 9 from #1957), 6 mapped-e2e
 * (unchanged), 0 approved exceptions, leaving 37 actionable gap
 * files (`DEFAULT_MAX_GAP_FILES` was lowered from 46 to 37 to
 * match, with zero stale slack). This was the authoritative baseline until
 * superseded by the #1961 third rebase above; the historical entries below
 * (including this branch's own earlier 739/32-then-744/32 transitive-credit
 * measurements) remain only as context for how the ceiling evolved.
 *
 * The baseline prior to #1961's third rebase (36) is #1961 rebased onto
 * `main` after #1960 (the merged public-render page/lightbox/fallback
 * ratchet, before #1972/#1957 landed). #1961 closed the same 9
 * dashboard/document-management-UI gaps with direct behavior tests plus one
 * legitimate transitive gap file, `src/components/share/social-share-menu.tsx`,
 * whose presence-gating and intent-link rendering is now genuinely
 * exercised (not stubbed) by `share-button.test.tsx`'s toggled-on/
 * disabled-prompt tests. This branch was originally rebased onto `main` at
 * `d9844dbf` (post #1956's brand/billing product-surface ratchet: 782
 * runtime-eligible, 725 loaded), closing the same 9 direct gaps plus the
 * transitive one for 735 loaded / 41 actionable gap files at that time, then
 * mechanically rebased a second time onto `main` (#1960, which closed 5
 * public-render gaps of its own, raising unit-loaded to 730 and lowering the
 * gap ceiling to 46 with zero gap-count change of its own to the nine #1961
 * target files). Re-measured directly against this twice-rebased tree, the
 * same nine newly-tested target files plus the one transitive closure left
 * 848 eligible runtime source files, 24 type-only, 31 barrel, 11
 * static-data, 782 runtime-eligible (all unchanged), 740 loaded by the
 * source unit suite (730 #1960 baseline + 10 from #1961), 6 mapped-e2e
 * (unchanged), 0 approved exceptions, and 36 actionable gap files
 * (`DEFAULT_MAX_GAP_FILES` was lowered from 46 to 36 to match at the time).
 * This was the authoritative baseline until superseded by the #1961 third
 * rebase above (`main` independently gained #1972/#1957 in the interim); the
 * 735/41 pre-second-rebase measurement remains only as historical context.
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
 * match, with zero stale slack). This was the authoritative baseline until
 * superseded by the #1957 rebase above; the historical entries below
 * (including #1960's own pre-second-rebase 722/54 measurement) remain only
 * as context for how the ceiling evolved.
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
 * until superseded by the #1957 rebase above.
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
 * the #1957 rebase above.
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

export const DEFAULT_MAX_GAP_FILES = 7;
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
