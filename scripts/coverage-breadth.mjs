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
 */

import { readFileSync } from "node:fs";
import ts from "typescript";
import { LINE_COVERAGE_STAGES } from "./check-line-coverage.mjs";
import { scanRepositoryRoots, toPosix } from "./source-scan-utils.mjs";

export const SOURCE_COVERAGE_STAGE = LINE_COVERAGE_STAGES[0];
export const ELIGIBLE_ROOTS = ["src"];
export const ELIGIBLE_SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

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
 * the same include/exclude globs as the source unit line coverage stage.
 */
export function listEligibleSourceFiles(
  repoRoot = process.cwd(),
  stage = SOURCE_COVERAGE_STAGE,
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
 * Parse an explicit `coverage-breadth: mapped-e2e|approved-exception` marker
 * comment out of a file's text. Returns `null` when no marker is present.
 */
export function parseBreadthMarker(fileText) {
  const match = BREADTH_MARKER_PATTERN.exec(fileText);
  if (!match) return null;
  return { mode: MARKER_MODE_BY_TOKEN[match[1]], detail: match[2] ?? null };
}

/**
 * Run the source unit test suite through the `node:test` `run()` API and
 * resolve with the set of eligible source files that V8 actually
 * instrumented (i.e. were `require()`d/imported by at least one test),
 * derived from the structured `test:coverage` event rather than the
 * human-readable console table.
 */
export async function collectLoadedFiles({
  repoRoot = process.cwd(),
  testFiles,
  stage = SOURCE_COVERAGE_STAGE,
  concurrency = 4,
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

  // Drain the stream to completion; coverage is only finalized at the end.
  for await (const _event of stream) {
    // Intentionally empty: side effects are captured by the listeners above.
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

  return { loaded, failureCount };
}

function modeForEligibleFile({ filePath, fileText, loadedFiles }) {
  const classification = classifySourceFile(fileText, filePath);
  if (classification === "type-only") return MODE.TYPE_ONLY;
  if (classification === "barrel") return MODE.BARREL;
  if (loadedFiles.has(filePath)) return MODE.UNIT_LOADED;

  const marker = parseBreadthMarker(fileText);
  if (marker) return marker.mode;
  return MODE.GAP;
}

/**
 * Build the deterministic breadth report: every eligible file assigned to
 * exactly one testing mode, plus roll-up counts. `readFile` is injectable so
 * this stays unit-testable without touching disk.
 */
export function buildBreadthReport({
  repoRoot = process.cwd(),
  eligibleFiles,
  loadedFiles,
  readFile = (filePath) => readFileSync(filePath, "utf8"),
} = {}) {
  const byMode = {
    [MODE.UNIT_LOADED]: [],
    [MODE.TYPE_ONLY]: [],
    [MODE.BARREL]: [],
    [MODE.MAPPED_E2E]: [],
    [MODE.APPROVED_EXCEPTION]: [],
    [MODE.GAP]: [],
  };

  for (const filePath of [...eligibleFiles].sort()) {
    const absolutePath = filePath.startsWith(repoRoot)
      ? filePath
      : `${repoRoot}/${filePath}`;
    const fileText = readFile(absolutePath);
    const mode = modeForEligibleFile({ filePath, fileText, loadedFiles });
    byMode[mode].push(filePath);
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
