#!/usr/bin/env node

/**
 * Coverage breadth inventory (#1896).
 *
 * Node's `--experimental-test-coverage` only scores files that were actually
 * `require()`d/imported while tests ran ("loaded" files). Files that are
 * eligible for coverage (matched by the include/exclude globs) but never
 * imported by any test are silently absent from the printed report, so a
 * high line/branch/function percentage can coexist with large blind spots.
 *
 * This module builds a structured breadth inventory instead of scraping the
 * human-readable coverage table:
 *   1. `listEligibleSourceFiles` walks the same include/exclude globs used by
 *      the "Source unit line coverage" stage in `check-line-coverage.mjs`
 *      (single source of truth for what counts as "eligible").
 *   2. `collectLoadedFiles` runs the source unit test suite through the
 *      `node:test` `run()` API and reads the structured `test:coverage`
 *      event (`data.summary.files`), which is the supported, non-text
 *      mechanism for discovering which files V8 actually instrumented.
 *   3. `classifySourceFile` uses the TypeScript compiler API (already a
 *      dependency and already used by `import-graph.mjs`,
 *      `client-boundary.mjs`, `perf-budgets.mjs`, and `test-subsystem.mjs`)
 *      to separate files that have no runtime behavior to unit-test
 *      (`type-only`, `barrel`) from files that do (`runtime`).
 *   4. `buildBreadthReport` assigns every eligible runtime file exactly one
 *      testing mode: `unit-loaded`, `type-only`, `barrel`, `mapped-e2e`,
 *      `approved-exception`, or `gap` (an unresolved, actionable blind
 *      spot). E2E-mapped and approved-exception files are never counted as
 *      unit-covered — they are reported in their own bucket.
 *
 * Files opt into `mapped-e2e` or `approved-exception` with an inline marker
 * comment near the top of the file, mirroring the `e2e-governance-allow`
 * marker convention in `check-e2e-governance.mjs`:
 *
 *   // coverage-breadth: mapped-e2e ref=e2e/product/billing-brand.spec.ts
 *   // coverage-breadth: approved-exception reason=manual QA runbook only
 *
 * The marker lives next to the code it excuses so the reason is reviewable
 * in the same diff that introduces or removes it, instead of drifting out of
 * sync with a separate allowlist file.
 *
 * `mapped-e2e` is evidence, not a free-form label: `ref=` must name a real,
 * repo-relative `e2e/**\/*.spec.ts` file that actually exists, so the
 * exception is checkable instead of a permanent, driftable assertion. Marker
 * comments are extracted with the TypeScript compiler's comment-trivia API
 * (`ts.getLeadingCommentRanges`) against the same parsed `sourceFile` used
 * for classification, not by regexing the raw file text, so a marker-shaped
 * string inside an actual string literal or template is never mistaken for a
 * marker. A file can declare more than one `mapped-e2e` marker (multiple
 * specs reaching the same file); every declared `ref=` must independently
 * validate — structurally (non-empty, repo-relative, under `e2e/`, no
 * backslashes/absolute paths/`..` traversal, `.spec.ts` extension) and by
 * existence (the file is actually present under `e2e/`) — before the file is
 * assigned `mapped-e2e`. `validateBreadthMarkerRef` and
 * `listExistingE2eSpecFiles` implement those two checks. A dangling or
 * malformed `ref=` is never silently downgraded to `gap`: `buildBreadthReport`
 * throws a `BreadthMarkerValidationError` naming every offending file/line so
 * the failure is an actionable, source-attributed diagnostic instead of a
 * quiet accuracy regression in the inventory.
 */

import { readFileSync } from "node:fs";
import ts from "typescript";
import { LINE_COVERAGE_STAGES } from "./check-line-coverage.mjs";
import { scanRepositoryRoots, toPosix } from "./source-scan-utils.mjs";

export const SOURCE_COVERAGE_STAGE = LINE_COVERAGE_STAGES[0];
export const ELIGIBLE_ROOTS = ["src"];
export const ELIGIBLE_SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

// The e2e evidence root and spec naming convention `mapped-e2e ref=` values
// must satisfy — matches `testMatch: /.*\.spec\.ts/` in playwright.config.ts
// and the `E2E_SPEC_FILE_PATTERN` naming rule in `test-subsystem.mjs`.
export const E2E_ROOT = "e2e";
export const E2E_SPEC_EXTENSION = ".spec.ts";
const E2E_SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  "coverage",
  "dist",
  "playwright-report",
  "test-results",
]);

// deck-kernel was previously excluded from the "Source unit line coverage"
// stage entirely, which excluded it from both instrumentation *and* breadth
// eligibility. #1925 widens the shared structured source coverage run (the
// `node:test` `run()` API path used by `collectLoadedFiles` below, and the
// eligibility scan in `listEligibleSourceFiles`) to include deck-kernel, so
// deck-kernel files are no longer invisible to the breadth inventory.
//
// The line/branch/function coverage *percentage* floors must not shift just
// because deck-kernel is now instrumented, so `PERCENTAGE_ONLY_EXCLUDE_GLOBS`
// preserves the original deck-kernel exclusion for percentage purposes only
// (see `aggregateCoverageTotals` below and `check-combined-coverage.mjs`,
// which filters `summary.files` by this list instead of trusting
// `summary.totals`). The standalone `test:line-coverage` CLI stage is
// untouched — it still passes `SOURCE_COVERAGE_STAGE.excludes` (including
// deck-kernel) straight to `node --test-coverage-exclude`.
const DECK_KERNEL_EXCLUDE_GLOB = "src/lib/document/deck-kernel/**";

export const PERCENTAGE_ONLY_EXCLUDE_GLOBS = [DECK_KERNEL_EXCLUDE_GLOB];

export const BREADTH_COVERAGE_STAGE = {
  ...SOURCE_COVERAGE_STAGE,
  excludes: SOURCE_COVERAGE_STAGE.excludes.filter(
    (glob) => glob !== DECK_KERNEL_EXCLUDE_GLOB,
  ),
};

export const MODE = Object.freeze({
  UNIT_LOADED: "unit-loaded",
  TYPE_ONLY: "type-only",
  BARREL: "barrel",
  MAPPED_E2E: "mapped-e2e",
  APPROVED_EXCEPTION: "approved-exception",
  GAP: "gap",
});

const MARKER_MODE_BY_TOKEN = Object.freeze({
  "mapped-e2e": MODE.MAPPED_E2E,
  "approved-exception": MODE.APPROVED_EXCEPTION,
});

const BREADTH_MARKER_PATTERN =
  /coverage-breadth:\s*(mapped-e2e|approved-exception)(?:\s+(?:ref|reason)=(\S+))?/;

/**
 * Convert a fixed, non-arbitrary glob (the kind used in
 * `LINE_COVERAGE_STAGES`) into a RegExp. Supports `**`, `*`, and `?` — the
 * only glob metacharacters used by the coverage include/exclude lists.
 */
export function globToRegExp(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      i += 1;
      if (glob[i + 1] === "/") {
        pattern += "(?:.*/)?";
        i += 1;
      } else {
        pattern += ".*";
      }
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else if (/[.+^$()|[\]{}\\]/.test(char)) {
      pattern += `\\${char}`;
    } else {
      pattern += char;
    }
  }
  return new RegExp(`^${pattern}$`);
}

export function matchesAnyGlob(filePath, globs) {
  return globs.some((glob) => globToRegExp(glob).test(filePath));
}

/**
 * Deterministically (sorted) list every eligible runtime source file using
 * the widened breadth coverage stage's include/exclude globs — the same
 * globs the source unit line coverage stage uses, minus the deck-kernel
 * exclusion (see `BREADTH_COVERAGE_STAGE`). Breadth eligibility excludes
 * only generated code, test files, and (via `classifySourceFile`)
 * type-only/barrel files — never deck-kernel.
 */
export function listEligibleSourceFiles(
  repoRoot = process.cwd(),
  stage = BREADTH_COVERAGE_STAGE,
) {
  return scanRepositoryRoots({
    repoRoot,
    roots: ELIGIBLE_ROOTS,
    sourceExtensions: ELIGIBLE_SOURCE_EXTENSIONS,
    scanText: (filePath) => [filePath],
    shouldScanFile: (filePath) =>
      matchesAnyGlob(filePath, stage.includes) &&
      !matchesAnyGlob(filePath, stage.excludes),
  }).sort();
}

function sourceKindFor(filePath) {
  return filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function hasDeclareModifier(node) {
  return Boolean(
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword,
    ),
  );
}

function isDirectivePrologue(statement) {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression)
  );
}

function isReexportDeclaration(statement) {
  return (
    ts.isExportDeclaration(statement) && Boolean(statement.moduleSpecifier)
  );
}

function isTypeOnlyExportDeclaration(statement) {
  if (!ts.isExportDeclaration(statement)) return false;
  if (statement.isTypeOnly) return true;
  if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
    return statement.exportClause.elements.every(
      (element) => element.isTypeOnly,
    );
  }
  return false;
}

function isTypeOnlyImportDeclaration(statement) {
  if (!ts.isImportDeclaration(statement)) return false;
  const clause = statement.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    return (
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((element) => element.isTypeOnly)
    );
  }
  return false;
}

function isAmbientModuleDeclaration(statement) {
  return ts.isModuleDeclaration(statement) && hasDeclareModifier(statement);
}

function isPureTypeStatement(statement) {
  return (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    isTypeOnlyExportDeclaration(statement) ||
    isTypeOnlyImportDeclaration(statement) ||
    isAmbientModuleDeclaration(statement)
  );
}

function isPureBarrelStatement(statement) {
  return isReexportDeclaration(statement) || ts.isImportDeclaration(statement);
}

/**
 * Classify a source file as `type-only` (nothing but type declarations,
 * type-only imports/exports, or ambient module augmentation), `barrel`
 * (nothing but import/re-export statements — no local runtime logic), or
 * `runtime` (has behavior that unit tests can and should exercise).
 */
export function classifySourceFile(fileText, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fileText,
    ts.ScriptTarget.Latest,
    true,
    sourceKindFor(filePath),
  );
  const statements = sourceFile.statements.filter(
    (statement) => !isDirectivePrologue(statement),
  );

  if (statements.length === 0) {
    return "barrel";
  }
  if (statements.every(isPureTypeStatement)) {
    return "type-only";
  }
  if (
    statements.every(isPureBarrelStatement) &&
    statements.some(isReexportDeclaration)
  ) {
    return "barrel";
  }
  return "runtime";
}

/**
 * Extract every `coverage-breadth: mapped-e2e|approved-exception` marker
 * comment attached to a top-level statement (or trailing at end-of-file) in
 * `fileText`, using the TypeScript compiler's own comment-trivia API
 * (`ts.getLeadingCommentRanges`) against a freshly parsed `sourceFile`
 * instead of regexing the raw text. This means a marker-shaped string that
 * happens to appear inside a string literal, template, or nested comment
 * deep in a function body is never mistaken for a real marker — only actual
 * leading comment trivia is inspected, and only at the top level, matching
 * where the module docstring says the marker is meant to live ("near the top
 * of the file", immediately above the declaration it excuses).
 *
 * Returns an array (possibly empty) of `{ mode, detail, line }` — `line` is
 * 1-based and points at the marker comment itself, for actionable
 * diagnostics. A file may carry more than one `mapped-e2e` marker (multiple
 * e2e specs independently reaching the same file); every one of them is
 * returned so the caller can validate each `ref=` individually.
 */
export function parseBreadthMarkers(fileText, filePath = "marker-scan.ts") {
  const sourceFile = ts.createSourceFile(
    filePath,
    fileText,
    ts.ScriptTarget.Latest,
    true,
    sourceKindFor(filePath),
  );

  const markers = [];
  const seenRangeStarts = new Set();
  const nodesToScan = [...sourceFile.statements, sourceFile.endOfFileToken];

  for (const node of nodesToScan) {
    const ranges = ts.getLeadingCommentRanges(
      sourceFile.text,
      node.getFullStart(),
    );
    for (const range of ranges ?? []) {
      if (seenRangeStarts.has(range.pos)) continue;
      seenRangeStarts.add(range.pos);

      const commentText = sourceFile.text.slice(range.pos, range.end);
      const match = BREADTH_MARKER_PATTERN.exec(commentText);
      if (!match) continue;

      const { line } = sourceFile.getLineAndCharacterOfPosition(range.pos);
      markers.push({
        mode: MARKER_MODE_BY_TOKEN[match[1]],
        detail: match[2] ?? null,
        line: line + 1,
      });
    }
  }

  return markers;
}

/**
 * Convenience wrapper over `parseBreadthMarkers` for callers that only care
 * about the first marker in a file (e.g. a file that opts into exactly one
 * mode). Returns `null` when no marker is present.
 */
export function parseBreadthMarker(fileText, filePath) {
  const [marker] = parseBreadthMarkers(fileText, filePath);
  return marker ? { mode: marker.mode, detail: marker.detail } : null;
}

export const REF_PROBLEM = Object.freeze({
  MISSING: "missing-ref",
  BACKSLASH: "backslash-in-ref",
  ABSOLUTE: "absolute-ref",
  TRAVERSAL: "path-traversal-ref",
  OUTSIDE_E2E_ROOT: "outside-e2e-root-ref",
  UNSUPPORTED_EXTENSION: "unsupported-spec-extension-ref",
  DANGLING: "dangling-ref",
});

const REF_PROBLEM_MESSAGES = Object.freeze({
  [REF_PROBLEM.MISSING]:
    "mapped-e2e marker is missing a non-empty ref=<path> value",
  [REF_PROBLEM.BACKSLASH]: "ref must use forward slashes, not backslashes",
  [REF_PROBLEM.ABSOLUTE]:
    "ref must be a repo-relative path, not an absolute path",
  [REF_PROBLEM.TRAVERSAL]: 'ref must not contain ".." path traversal segments',
  [REF_PROBLEM.OUTSIDE_E2E_ROOT]: `ref must point under ${E2E_ROOT}/`,
  [REF_PROBLEM.UNSUPPORTED_EXTENSION]: `ref must reference a ${E2E_SPEC_EXTENSION} spec file`,
  [REF_PROBLEM.DANGLING]:
    "referenced e2e spec file does not exist (dangling reference)",
});

const WINDOWS_DRIVE_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/;

function hasTraversalSegment(ref) {
  return ref.split("/").some((segment) => segment === "..");
}

/**
 * Collapse repeated slashes and drop no-op `.` segments without resolving
 * `..` segments — traversal is rejected outright by `hasTraversalSegment`
 * before this runs, never silently resolved.
 */
function normalizeRelativePosixPath(ref) {
  return ref
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

/**
 * Structurally validate a `mapped-e2e ref=` value and, when
 * `existingE2eSpecFiles` is supplied, confirm the referenced file actually
 * exists as a real, regular e2e spec. Every check below maps to a distinct
 * `REF_PROBLEM` code so callers can produce an actionable, specific
 * diagnostic instead of a generic "invalid marker" message:
 *
 *   - non-empty                        -> REF_PROBLEM.MISSING
 *   - no backslashes                   -> REF_PROBLEM.BACKSLASH
 *   - not an absolute path              -> REF_PROBLEM.ABSOLUTE
 *   - no ".." traversal segments        -> REF_PROBLEM.TRAVERSAL
 *   - normalizes under "e2e/"           -> REF_PROBLEM.OUTSIDE_E2E_ROOT
 *   - ends with ".spec.ts"              -> REF_PROBLEM.UNSUPPORTED_EXTENSION
 *   - exists in `existingE2eSpecFiles`  -> REF_PROBLEM.DANGLING
 *
 * Returns `{ ok: true, normalized }` on success or
 * `{ ok: false, problem, message }` on the first failing check.
 */
export function validateBreadthMarkerRef(
  ref,
  { existingE2eSpecFiles = new Set() } = {},
) {
  const fail = (problem) => ({
    ok: false,
    problem,
    message: REF_PROBLEM_MESSAGES[problem],
  });

  if (typeof ref !== "string" || ref.trim() === "") {
    return fail(REF_PROBLEM.MISSING);
  }
  if (ref.includes("\\")) {
    return fail(REF_PROBLEM.BACKSLASH);
  }
  if (ref.startsWith("/") || WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(ref)) {
    return fail(REF_PROBLEM.ABSOLUTE);
  }
  if (hasTraversalSegment(ref)) {
    return fail(REF_PROBLEM.TRAVERSAL);
  }

  const normalized = normalizeRelativePosixPath(ref);
  if (normalized === "" || !normalized.startsWith(`${E2E_ROOT}/`)) {
    return fail(REF_PROBLEM.OUTSIDE_E2E_ROOT);
  }
  if (!normalized.endsWith(E2E_SPEC_EXTENSION)) {
    return fail(REF_PROBLEM.UNSUPPORTED_EXTENSION);
  }
  if (!existingE2eSpecFiles.has(normalized)) {
    return fail(REF_PROBLEM.DANGLING);
  }

  return { ok: true, normalized };
}

/**
 * Deterministically list every real, regular `e2e/**\/*.spec.ts` file on
 * disk — the same naming convention Playwright's own `testMatch` and
 * `test-subsystem.mjs`'s `E2E_SPEC_FILE_PATTERN` use. This is the existence
 * side of `mapped-e2e ref=` validation: a `ref` is only "real evidence" if it
 * names a file in this set, not merely a structurally well-formed path.
 */
export function listExistingE2eSpecFiles(repoRoot = process.cwd()) {
  return new Set(
    scanRepositoryRoots({
      repoRoot,
      roots: [E2E_ROOT],
      sourceExtensions: new Set([".ts"]),
      scanText: (filePath) => [filePath],
      shouldScanFile: (filePath) => filePath.endsWith(E2E_SPEC_EXTENSION),
      skipDirectoryNames: E2E_SKIPPED_DIRECTORIES,
    }),
  );
}

/**
 * Raised by `buildBreadthReport` when one or more `mapped-e2e ref=` markers
 * fail structural or existence validation. Carries the full list of
 * `problems` (each `{ filePath, line, ref, problem, message }`) so callers
 * can print every offending marker at once instead of stopping at the first.
 */
export class BreadthMarkerValidationError extends Error {
  constructor(problems) {
    super(formatBreadthMarkerProblems(problems));
    this.name = "BreadthMarkerValidationError";
    this.problems = problems;
  }
}

export function formatBreadthMarkerProblems(problems) {
  const lines = [
    `Coverage breadth marker validation failed (${problems.length} invalid mapped-e2e ref(s)):`,
  ];
  for (const problem of problems) {
    lines.push(
      `  - ${problem.filePath}:${problem.line} coverage-breadth: mapped-e2e ref=${JSON.stringify(problem.ref ?? "")} — ${problem.message}.`,
    );
  }
  lines.push(
    "Fix the ref= path (or remove the marker) so mapped-e2e only ever names a real, existing e2e/**/*.spec.ts file.",
  );
  return lines.join("\n");
}

/**
 * Run the source unit test suite through the `node:test` `run()` API and
 * resolve with the set of eligible source files that V8 actually
 * instrumented (i.e. were `require()`d/imported by at least one test),
 * derived from the structured `test:coverage` event rather than the
 * human-readable console table.
 *
 * `lineCoverage`/`branchCoverage`/`functionCoverage` are forwarded straight
 * to `run()` (defaulting to 0, i.e. no enforced floor) so this single
 * invocation of the source suite can also serve the percentage-floor
 * checks in `check-combined-coverage.mjs` — that gate shares this exact
 * `summary` (also returned here, not just the derived `loaded` set) between
 * the floor comparison and the breadth report instead of running the suite
 * a second time.
 *
 * `reporter` is optional and off by default (matching this function's
 * standalone `check-coverage-breadth.mjs` caller, which never prints
 * per-test output). When supplied, the raw event stream is piped through
 * the given `node:test/reporters` reporter to `reporterDestination` so
 * callers that need visible failure output (the combined gate) get it
 * without changing the default, output-free behavior other callers rely on.
 *
 * `stage` defaults to `BREADTH_COVERAGE_STAGE` (not `SOURCE_COVERAGE_STAGE`)
 * so this run's `coverageIncludeGlobs`/`coverageExcludeGlobs` instrument
 * deck-kernel like every other eligible source file; the resulting
 * `summary.files` still carries deck-kernel entries, which
 * `aggregateCoverageTotals` filters back out for the percentage-only
 * comparison without re-running the suite.
 */
export async function collectLoadedFiles({
  repoRoot = process.cwd(),
  testFiles,
  stage = BREADTH_COVERAGE_STAGE,
  concurrency = 4,
  lineCoverage = 0,
  branchCoverage = 0,
  functionCoverage = 0,
  reporter = null,
  reporterDestination = process.stdout,
  run,
} = {}) {
  if (!run) {
    ({ run } = await import("node:test"));
  }

  const stream = run({
    files: testFiles,
    cwd: repoRoot,
    concurrency,
    coverage: true,
    coverageIncludeGlobs: stage.includes,
    coverageExcludeGlobs: stage.excludes,
    lineCoverage,
    branchCoverage,
    functionCoverage,
    // Explicit so the tsx loader is present in every spawned test-file
    // process regardless of how this script itself was invoked (matches
    // the "--import tsx" flag check-line-coverage.mjs passes on its CLI).
    execArgv: ["--import", "tsx"],
  });

  let coverageSummary = null;
  let failureCount = 0;
  stream.on("test:coverage", (data) => {
    coverageSummary = data.summary;
  });
  stream.on("test:fail", () => {
    failureCount += 1;
  });

  if (reporter) {
    // Composing consumes `stream` itself, so draining happens through the
    // formatted output stream instead of the raw `for await` loop below.
    for await (const chunk of stream.compose(reporter)) {
      reporterDestination.write(chunk);
    }
  } else {
    // Drain the stream to completion; coverage is only finalized at the end.
    for await (const _event of stream) {
      // Intentionally empty: side effects are captured by the listeners above.
    }
  }

  const loaded = new Set();
  for (const file of coverageSummary?.files ?? []) {
    const relative = toPosix(
      file.path.startsWith(repoRoot)
        ? file.path.slice(repoRoot.length + 1)
        : file.path,
    );
    loaded.add(relative);
  }

  return { loaded, failureCount, summary: coverageSummary };
}

function percentOf(covered, total) {
  // Matches node:test's own totals convention: an empty denominator (no
  // eligible lines/branches/functions in the filtered file set) reports
  // 100%, not 0% or NaN.
  return total === 0 ? 100 : (covered / total) * 100;
}

/**
 * Recompute line/branch/function coverage totals from a structured
 * `test:coverage` event's `summary.files` array, excluding any file whose
 * repo-relative path matches `excludeGlobs`. This is how the combined
 * coverage gate keeps the percentage floors filtered exactly like the
 * pre-#1925 `SOURCE_COVERAGE_STAGE.excludes` deck-kernel exclusion did, even
 * though the shared structured run's own `coverageExcludeGlobs` (via
 * `BREADTH_COVERAGE_STAGE`) no longer excludes deck-kernel from
 * instrumentation — `summary.totals` itself can no longer be trusted for the
 * percentage floors once deck-kernel is instrumented, so this aggregates
 * `summary.files` directly instead.
 */
export function aggregateCoverageTotals(
  files = [],
  { repoRoot = process.cwd(), excludeGlobs = [] } = {},
) {
  const totals = {
    totalLineCount: 0,
    totalBranchCount: 0,
    totalFunctionCount: 0,
    coveredLineCount: 0,
    coveredBranchCount: 0,
    coveredFunctionCount: 0,
  };

  for (const file of files) {
    const relative = toPosix(
      file.path.startsWith(repoRoot)
        ? file.path.slice(repoRoot.length + 1)
        : file.path,
    );
    if (matchesAnyGlob(relative, excludeGlobs)) continue;

    totals.totalLineCount += file.totalLineCount ?? 0;
    totals.totalBranchCount += file.totalBranchCount ?? 0;
    totals.totalFunctionCount += file.totalFunctionCount ?? 0;
    totals.coveredLineCount += file.coveredLineCount ?? 0;
    totals.coveredBranchCount += file.coveredBranchCount ?? 0;
    totals.coveredFunctionCount += file.coveredFunctionCount ?? 0;
  }

  return {
    ...totals,
    coveredLinePercent: percentOf(
      totals.coveredLineCount,
      totals.totalLineCount,
    ),
    coveredBranchPercent: percentOf(
      totals.coveredBranchCount,
      totals.totalBranchCount,
    ),
    coveredFunctionPercent: percentOf(
      totals.coveredFunctionCount,
      totals.totalFunctionCount,
    ),
  };
}

/**
 * Resolve an eligible, non-loaded file's testing mode from its declared
 * markers. `mapped-e2e` is only assigned once *every* `mapped-e2e` marker on
 * the file validates (structurally and by existence, via
 * `validateBreadthMarkerRef`) — a single dangling or malformed `ref=` is
 * recorded in `problems` (not silently downgraded to `gap`) so the caller can
 * fail the whole run with an actionable diagnostic instead of quietly
 * losing evidence coverage. `approved-exception` markers carry a free-form
 * `reason=` and are not evidence references, so they are not validated
 * against the e2e spec inventory.
 */
function modeForMarkers({ filePath, markers, existingE2eSpecFiles, problems }) {
  const mappedMarkers = markers.filter(
    (marker) => marker.mode === MODE.MAPPED_E2E,
  );
  const exceptionMarkers = markers.filter(
    (marker) => marker.mode === MODE.APPROVED_EXCEPTION,
  );

  if (mappedMarkers.length > 0) {
    let hasInvalidRef = false;
    for (const marker of mappedMarkers) {
      const result = validateBreadthMarkerRef(marker.detail, {
        existingE2eSpecFiles,
      });
      if (!result.ok) {
        hasInvalidRef = true;
        problems.push({
          filePath,
          line: marker.line,
          ref: marker.detail,
          problem: result.problem,
          message: result.message,
        });
      }
    }
    return hasInvalidRef ? null : MODE.MAPPED_E2E;
  }

  if (exceptionMarkers.length > 0) return MODE.APPROVED_EXCEPTION;
  return MODE.GAP;
}

/**
 * Build the deterministic breadth report: every eligible file assigned to
 * exactly one testing mode, plus roll-up counts. `readFile` and
 * `existingE2eSpecFiles` are injectable so this stays unit-testable without
 * touching disk.
 *
 * Throws `BreadthMarkerValidationError` (collecting every offending marker
 * across every file, not just the first) when any `mapped-e2e ref=` fails
 * structural or existence validation — a file only ever becomes `mapped-e2e`
 * once all of its declared refs validate.
 */
export function buildBreadthReport({
  repoRoot = process.cwd(),
  eligibleFiles,
  loadedFiles,
  readFile = (filePath) => readFileSync(filePath, "utf8"),
  existingE2eSpecFiles = listExistingE2eSpecFiles(repoRoot),
} = {}) {
  const byMode = {
    [MODE.UNIT_LOADED]: [],
    [MODE.TYPE_ONLY]: [],
    [MODE.BARREL]: [],
    [MODE.MAPPED_E2E]: [],
    [MODE.APPROVED_EXCEPTION]: [],
    [MODE.GAP]: [],
  };
  const problems = [];

  for (const filePath of [...eligibleFiles].sort()) {
    const absolutePath = filePath.startsWith(repoRoot)
      ? filePath
      : `${repoRoot}/${filePath}`;
    const fileText = readFile(absolutePath);
    const classification = classifySourceFile(fileText, filePath);

    if (classification === "type-only") {
      byMode[MODE.TYPE_ONLY].push(filePath);
      continue;
    }
    if (classification === "barrel") {
      byMode[MODE.BARREL].push(filePath);
      continue;
    }
    if (loadedFiles.has(filePath)) {
      byMode[MODE.UNIT_LOADED].push(filePath);
      continue;
    }

    const markers = parseBreadthMarkers(fileText, filePath);
    const mode = modeForMarkers({
      filePath,
      markers,
      existingE2eSpecFiles,
      problems,
    });
    if (mode) byMode[mode].push(filePath);
  }

  if (problems.length > 0) {
    throw new BreadthMarkerValidationError(problems);
  }

  const eligibleCount = eligibleFiles.length;
  const typeOnlyCount = byMode[MODE.TYPE_ONLY].length;
  const barrelCount = byMode[MODE.BARREL].length;
  const runtimeEligibleCount = eligibleCount - typeOnlyCount - barrelCount;
  const loadedRuntimeCount = byMode[MODE.UNIT_LOADED].length;
  const mappedInteractionCount = byMode[MODE.MAPPED_E2E].length;
  const approvedExceptionCount = byMode[MODE.APPROVED_EXCEPTION].length;
  const actionableGapCount = byMode[MODE.GAP].length;
  const unloadedRuntimeCount = runtimeEligibleCount - loadedRuntimeCount;

  return {
    eligibleCount,
    runtimeEligibleCount,
    loadedRuntimeCount,
    unloadedRuntimeCount,
    typeOnlyCount,
    barrelCount,
    mappedInteractionCount,
    approvedExceptionCount,
    actionableGapCount,
    files: byMode,
  };
}

export function formatBreadthReport(report) {
  const lines = [
    "Coverage breadth inventory:",
    `  Eligible runtime source files: ${report.eligibleCount}`,
    `  Type-only (excluded, no runtime behavior): ${report.typeOnlyCount}`,
    `  Barrel (excluded, re-export only): ${report.barrelCount}`,
    `  Runtime-eligible (must be tested or explicitly excepted): ${report.runtimeEligibleCount}`,
    `    Unit-loaded: ${report.loadedRuntimeCount}`,
    `    Mapped interaction/E2E (not unit-covered): ${report.mappedInteractionCount}`,
    `    Approved exception: ${report.approvedExceptionCount}`,
    `    Unresolved gap (actionable): ${report.actionableGapCount}`,
  ];
  return lines.join("\n");
}
