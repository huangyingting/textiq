import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  aggregateCoverageTotals,
  BreadthMarkerValidationError,
  BREADTH_COVERAGE_STAGE,
  buildBreadthReport,
  classifySourceFile,
  collectLoadedFiles,
  E2E_ROOT,
  E2E_SPEC_EXTENSION,
  formatBreadthMarkerProblems,
  formatBreadthReport,
  globToRegExp,
  listEligibleSourceFiles,
  listExistingE2eSpecFiles,
  matchesAnyGlob,
  MODE,
  parseBreadthMarker,
  parseBreadthMarkers,
  PERCENTAGE_ONLY_EXCLUDE_GLOBS,
  REF_PROBLEM,
  SOURCE_COVERAGE_STAGE,
  validateBreadthMarkerRef,
} from "./coverage-breadth.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";
import { toPosix } from "./source-scan-utils.mjs";

// --- glob matching -----------------------------------------------------

test("globToRegExp matches nested paths for a src/**/*.ts style glob", () => {
  const re = globToRegExp("src/**/*.ts");
  assert.ok(re.test("src/auth.ts"));
  assert.ok(re.test("src/lib/foo/bar.ts"));
  assert.ok(re.test("src/lib/foo/bar/baz.ts"));
  assert.ok(!re.test("src/lib/foo/bar.tsx"));
  assert.ok(!re.test("scripts/foo.ts"));
});

test("globToRegExp matches a directory-prefix glob (src/generated/**)", () => {
  const re = globToRegExp("src/generated/**");
  assert.ok(re.test("src/generated/prisma/client.ts"));
  assert.ok(re.test("src/generated/a/b/c.ts"));
  assert.ok(!re.test("src/generated.ts"));
  assert.ok(!re.test("src/lib/generated/x.ts"));
});

test("globToRegExp escapes regex metacharacters in literal path segments", () => {
  const re = globToRegExp("src/lib/document/deck-kernel/**");
  assert.ok(re.test("src/lib/document/deck-kernel/deck-diff.ts"));
  assert.ok(!re.test("src/lib/documentXdeck-kernel/deck-diff.ts"));
});

test("matchesAnyGlob is true when any glob in the list matches", () => {
  assert.ok(
    matchesAnyGlob("src/lib/foo.test.ts", [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ]),
  );
  assert.ok(
    !matchesAnyGlob("src/lib/foo.ts", [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ]),
  );
});

test("matchesAnyGlob accepts toPosix-normalized native-separator paths", () => {
  const nativePath = path.join("src", "lib", "foo", "bar.ts");
  const normalized = toPosix(nativePath);
  assert.equal(normalized, "src/lib/foo/bar.ts");
  assert.ok(matchesAnyGlob(normalized, ["src/**/*.ts"]));
});

test("globToRegExp matches a single-character `?` wildcard segment", () => {
  const re = globToRegExp("src/logs/day-?.ts");
  assert.ok(re.test("src/logs/day-1.ts"));
  assert.ok(re.test("src/logs/day-a.ts"));
  assert.ok(!re.test("src/logs/day-10.ts"));
  assert.ok(!re.test("src/logs/day-.ts"));
});

// --- eligibility scan ----------------------------------------------------

test("listEligibleSourceFiles reuses the source line coverage stage globs and normalizes platform paths", (t) => {
  const root = createTestFixtureRoot("coverage-breadth-eligible", t);
  const srcDir = path.join(root, "src");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(path.join(srcDir, "runtime.ts"), "export const x = 1;\n");
  writeFileSync(
    path.join(srcDir, "runtime.test.ts"),
    "import test from 'node:test';\ntest('x', () => {});\n",
  );

  const nestedDir = path.join(srcDir, "generated");
  mkdirSync(nestedDir, { recursive: true });
  writeFileSync(path.join(nestedDir, "skip.ts"), "export const y = 1;\n");

  const stage = {
    includes: ["src/**/*.ts"],
    excludes: ["src/**/*.test.ts", "src/generated/**"],
  };
  const files = listEligibleSourceFiles(root, stage);
  assert.deepEqual(files, ["src/runtime.ts"]);
});

test("SOURCE_COVERAGE_STAGE is the source unit line coverage stage", () => {
  assert.equal(SOURCE_COVERAGE_STAGE.name, "Source unit line coverage");
  assert.deepEqual(SOURCE_COVERAGE_STAGE.includes, [
    "src/**/*.ts",
    "src/**/*.tsx",
  ]);
});

// --- deck-kernel breadth widening (#1925) ---------------------------------

test("BREADTH_COVERAGE_STAGE widens the source stage to no longer exclude deck-kernel", () => {
  assert.ok(
    SOURCE_COVERAGE_STAGE.excludes.includes("src/lib/document/deck-kernel/**"),
    "the standalone line-coverage stage must keep excluding deck-kernel",
  );
  assert.ok(
    !BREADTH_COVERAGE_STAGE.excludes.includes(
      "src/lib/document/deck-kernel/**",
    ),
    "the shared breadth/instrumentation stage must not exclude deck-kernel",
  );
  assert.deepEqual(
    BREADTH_COVERAGE_STAGE.includes,
    SOURCE_COVERAGE_STAGE.includes,
  );
  assert.deepEqual(
    BREADTH_COVERAGE_STAGE.excludes,
    SOURCE_COVERAGE_STAGE.excludes.filter(
      (glob) => glob !== "src/lib/document/deck-kernel/**",
    ),
  );
});

test("PERCENTAGE_ONLY_EXCLUDE_GLOBS keeps only the deck-kernel exclusion, for percentage-floor filtering", () => {
  assert.deepEqual(PERCENTAGE_ONLY_EXCLUDE_GLOBS, [
    "src/lib/document/deck-kernel/**",
  ]);
});

test("listEligibleSourceFiles includes deck-kernel files by default (breadth eligibility excludes only generated/tests, not deck-kernel)", (t) => {
  const root = createTestFixtureRoot("coverage-breadth-deck-kernel", t);
  const deckKernelDir = path.join(
    root,
    "src",
    "lib",
    "document",
    "deck-kernel",
  );
  mkdirSync(deckKernelDir, { recursive: true });
  writeFileSync(
    path.join(deckKernelDir, "deck-diff.ts"),
    "export function diff() { return 1; }\n",
  );
  writeFileSync(
    path.join(deckKernelDir, "deck-diff.test.ts"),
    "import test from 'node:test';\ntest('x', () => {});\n",
  );

  const generatedDir = path.join(root, "src", "generated");
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(path.join(generatedDir, "skip.ts"), "export const y = 1;\n");

  const files = listEligibleSourceFiles(root);

  assert.ok(
    files.includes("src/lib/document/deck-kernel/deck-diff.ts"),
    "deck-kernel source files must be breadth-eligible",
  );
  assert.ok(
    !files.includes("src/lib/document/deck-kernel/deck-diff.test.ts"),
    "test files stay excluded",
  );
  assert.ok(
    !files.includes("src/generated/skip.ts"),
    "generated files stay excluded",
  );
});

// --- aggregateCoverageTotals (percentage-only deck-kernel exclusion) ------

test("aggregateCoverageTotals sums per-file counts across included files", () => {
  const files = [
    {
      path: "/repo/src/a.ts",
      totalLineCount: 10,
      coveredLineCount: 8,
      totalBranchCount: 4,
      coveredBranchCount: 2,
      totalFunctionCount: 2,
      coveredFunctionCount: 2,
    },
    {
      path: "/repo/src/b.ts",
      totalLineCount: 20,
      coveredLineCount: 20,
      totalBranchCount: 6,
      coveredBranchCount: 6,
      totalFunctionCount: 4,
      coveredFunctionCount: 2,
    },
  ];

  const totals = aggregateCoverageTotals(files, { repoRoot: "/repo" });

  assert.equal(totals.totalLineCount, 30);
  assert.equal(totals.coveredLineCount, 28);
  assert.equal(totals.coveredLinePercent, (28 / 30) * 100);
  assert.equal(totals.totalBranchCount, 10);
  assert.equal(totals.coveredBranchCount, 8);
  assert.equal(totals.coveredBranchPercent, 80);
  assert.equal(totals.totalFunctionCount, 6);
  assert.equal(totals.coveredFunctionCount, 4);
  assert.ok(Math.abs(totals.coveredFunctionPercent - (4 / 6) * 100) < 1e-9);
});

test("aggregateCoverageTotals excludes files matching excludeGlobs from every metric", () => {
  const files = [
    {
      path: "/repo/src/a.ts",
      totalLineCount: 10,
      coveredLineCount: 10,
      totalBranchCount: 2,
      coveredBranchCount: 2,
      totalFunctionCount: 1,
      coveredFunctionCount: 1,
    },
    {
      // A deck-kernel file with terrible coverage — must not drag the
      // aggregate down once excluded.
      path: "/repo/src/lib/document/deck-kernel/deck-diff.ts",
      totalLineCount: 1000,
      coveredLineCount: 0,
      totalBranchCount: 1000,
      coveredBranchCount: 0,
      totalFunctionCount: 1000,
      coveredFunctionCount: 0,
    },
  ];

  const totals = aggregateCoverageTotals(files, {
    repoRoot: "/repo",
    excludeGlobs: ["src/lib/document/deck-kernel/**"],
  });

  assert.equal(totals.totalLineCount, 10);
  assert.equal(totals.coveredLineCount, 10);
  assert.equal(totals.coveredLinePercent, 100);
  assert.equal(totals.coveredBranchPercent, 100);
  assert.equal(totals.coveredFunctionPercent, 100);
});

test("aggregateCoverageTotals reports 100% for an empty (or fully excluded) file set, matching node:test's own totals convention", () => {
  const totals = aggregateCoverageTotals([], { repoRoot: "/repo" });
  assert.equal(totals.coveredLinePercent, 100);
  assert.equal(totals.coveredBranchPercent, 100);
  assert.equal(totals.coveredFunctionPercent, 100);

  const filteredToEmpty = aggregateCoverageTotals(
    [
      {
        path: "/repo/src/lib/document/deck-kernel/deck-diff.ts",
        totalLineCount: 5,
        coveredLineCount: 1,
        totalBranchCount: 5,
        coveredBranchCount: 1,
        totalFunctionCount: 5,
        coveredFunctionCount: 1,
      },
    ],
    { repoRoot: "/repo", excludeGlobs: ["src/lib/document/deck-kernel/**"] },
  );
  assert.equal(filteredToEmpty.coveredLinePercent, 100);
});

test("aggregateCoverageTotals normalizes native-separator absolute paths before matching excludeGlobs", () => {
  const repoRoot = path.join(path.sep, "repo");
  const deckKernelPath = path.join(
    repoRoot,
    "src",
    "lib",
    "document",
    "deck-kernel",
    "deck-diff.ts",
  );
  const totals = aggregateCoverageTotals(
    [
      {
        path: deckKernelPath,
        totalLineCount: 100,
        coveredLineCount: 0,
      },
    ],
    { repoRoot, excludeGlobs: ["src/lib/document/deck-kernel/**"] },
  );
  assert.equal(totals.totalLineCount, 0);
  assert.equal(totals.coveredLinePercent, 100);
});

// --- classifySourceFile ---------------------------------------------------

test("classifySourceFile marks plain functions/consts as runtime", () => {
  const text = `
    export function add(a: number, b: number): number {
      return a + b;
    }
  `;
  assert.equal(classifySourceFile(text, "add.ts"), "runtime");
});

test("classifySourceFile marks interface/type-only files as type-only", () => {
  const text = `
    export interface Foo {
      id: string;
    }
    export type Bar = { id: string };
  `;
  assert.equal(classifySourceFile(text, "types.ts"), "type-only");
});

test("classifySourceFile treats type-only imports/exports as type-only", () => {
  const text = `
    import type { Session } from "next-auth";
    export type { Session };
  `;
  assert.equal(classifySourceFile(text, "reexport-types.ts"), "type-only");
});

test("classifySourceFile treats ambient declare module augmentation as type-only", () => {
  const text = `
    import type { DefaultSession } from "next-auth";

    declare module "next-auth" {
      interface Session {
        user: { id: string } & DefaultSession["user"];
      }
    }
  `;
  assert.equal(classifySourceFile(text, "next-auth.d.ts"), "type-only");
});

test("classifySourceFile marks pure re-export files as barrel", () => {
  const text = `
    export { useReducedMotion } from "framer-motion";
  `;
  assert.equal(classifySourceFile(text, "barrel.ts"), "barrel");
});

test("classifySourceFile treats a barrel with a leading directive prologue as barrel", () => {
  const text = `
    "use client";

    export { useReducedMotion } from "framer-motion";
  `;
  assert.equal(classifySourceFile(text, "barrel-directive.ts"), "barrel");
});

test("classifySourceFile treats a barrel with a side-effect import as barrel", () => {
  const text = `
    import "server-only";

    export { parsePptx } from "./pptx-parser";
  `;
  assert.equal(classifySourceFile(text, "boundary-barrel.ts"), "barrel");
});

test("classifySourceFile treats mixed type + value re-exports as barrel", () => {
  const text = `
    export { compileBrandKitDraft } from "./compiler";
    export type { BrandKitDraftV1 } from "./schema";
  `;
  assert.equal(classifySourceFile(text, "mixed-barrel.ts"), "barrel");
});

test("classifySourceFile treats an empty file as barrel", () => {
  assert.equal(classifySourceFile("", "empty.ts"), "barrel");
  assert.equal(
    classifySourceFile("// just a comment\n", "empty2.ts"),
    "barrel",
  );
});

test("classifySourceFile treats enum declarations as runtime", () => {
  const text = `
    export enum Color {
      Red,
      Blue,
    }
  `;
  assert.equal(classifySourceFile(text, "enum.ts"), "runtime");
});

test("classifySourceFile treats a barrel-shaped file with one local declaration as runtime", () => {
  const text = `
    export { parsePptx } from "./pptx-parser";
    export const DEFAULT_LIMIT = 10;
  `;
  assert.equal(classifySourceFile(text, "not-quite-barrel.ts"), "runtime");
});

test("classifySourceFile handles .tsx files", () => {
  const text = `
    export function Widget() {
      return null;
    }
  `;
  assert.equal(classifySourceFile(text, "widget.tsx"), "runtime");
});

test("classifySourceFile treats a namespace re-export mixed with local behavior as runtime", () => {
  const text = `
    export * from "./other";
    export const value = 1;
  `;
  assert.equal(classifySourceFile(text, "star-export-mixed.ts"), "runtime");
});

test("classifySourceFile treats element-level type-only named imports as type-only", () => {
  const text = `
    import { type Session } from "next-auth";
    export type { Session };
  `;
  assert.equal(
    classifySourceFile(text, "named-type-only-import.ts"),
    "type-only",
  );
});

test("classifySourceFile treats a namespace import mixed with local behavior as runtime", () => {
  const text = `
    import * as pdfLib from "pdf-lib";
    export const wrapper = pdfLib.PDFDocument;
  `;
  assert.equal(
    classifySourceFile(text, "namespace-import-mixed.ts"),
    "runtime",
  );
});

// --- breadth markers -------------------------------------------------------

test("parseBreadthMarker recognizes a mapped-e2e marker with a ref", () => {
  const text = `
    // coverage-breadth: mapped-e2e ref=e2e/product/billing-brand.spec.ts
    export function renderBrandStudio() {}
  `;
  assert.deepEqual(parseBreadthMarker(text), {
    mode: MODE.MAPPED_E2E,
    detail: "e2e/product/billing-brand.spec.ts",
  });
});

test("parseBreadthMarker recognizes an approved-exception marker with a reason", () => {
  const text = `
    // coverage-breadth: approved-exception reason=manual-qa-runbook-only
    export function legacyMigrationStep() {}
  `;
  assert.deepEqual(parseBreadthMarker(text), {
    mode: MODE.APPROVED_EXCEPTION,
    detail: "manual-qa-runbook-only",
  });
});

test("parseBreadthMarker returns null when no marker is present", () => {
  assert.equal(parseBreadthMarker("export function foo() {}\n"), null);
});

test("parseBreadthMarker ignores a marker-shaped string literal (AST comment scan, not text regex)", () => {
  const text = `
    export const NOTE =
      "coverage-breadth: mapped-e2e ref=e2e/product/billing-brand.spec.ts";
  `;
  assert.equal(
    parseBreadthMarker(text),
    null,
    "a marker-shaped string literal must never be mistaken for a real marker comment",
  );
});

// --- parseBreadthMarkers (AST comment-trivia scan, multiple markers) -------

test("parseBreadthMarkers returns every marker in file order with 1-based line numbers", () => {
  const text = [
    "// coverage-breadth: mapped-e2e ref=e2e/auth/auth-redirect.spec.ts",
    "// coverage-breadth: mapped-e2e ref=e2e/auth/oauth-disabled.spec.ts",
    "export function LoginPage() {}",
  ].join("\n");
  const markers = parseBreadthMarkers(text, "login-page.ts");
  assert.deepEqual(markers, [
    {
      mode: MODE.MAPPED_E2E,
      detail: "e2e/auth/auth-redirect.spec.ts",
      line: 1,
    },
    {
      mode: MODE.MAPPED_E2E,
      detail: "e2e/auth/oauth-disabled.spec.ts",
      line: 2,
    },
  ]);
});

test("parseBreadthMarkers finds a marker attached to any top-level statement, not only the first", () => {
  const text = [
    "import { z } from 'zod';",
    "",
    "export const schema = z.object({});",
    "",
    "// coverage-breadth: mapped-e2e ref=e2e/product/mapped.spec.ts",
    "export function parse() { return schema; }",
  ].join("\n");
  const markers = parseBreadthMarkers(text, "parser.ts");
  assert.deepEqual(markers, [
    { mode: MODE.MAPPED_E2E, detail: "e2e/product/mapped.spec.ts", line: 5 },
  ]);
});

test("parseBreadthMarkers finds a trailing marker with no statement after it", () => {
  const text = [
    "export function legacy() {}",
    "",
    "// coverage-breadth: approved-exception reason=trailing-marker",
  ].join("\n");
  const markers = parseBreadthMarkers(text, "trailing.ts");
  assert.deepEqual(markers, [
    { mode: MODE.APPROVED_EXCEPTION, detail: "trailing-marker", line: 3 },
  ]);
});

test("parseBreadthMarkers returns an empty array when no marker is present", () => {
  assert.deepEqual(parseBreadthMarkers("export function foo() {}\n"), []);
});

test("parseBreadthMarkers ignores comments nested inside function bodies (top-level only)", () => {
  const text = [
    "export function wrapper() {",
    "  // coverage-breadth: mapped-e2e ref=e2e/product/nested.spec.ts",
    "  return 1;",
    "}",
  ].join("\n");
  assert.deepEqual(parseBreadthMarkers(text, "wrapper.ts"), []);
});

// --- validateBreadthMarkerRef (structural + existence) ---------------------

test("validateBreadthMarkerRef accepts a well-formed ref that exists on disk", () => {
  const result = validateBreadthMarkerRef("e2e/product/mapped.spec.ts", {
    existingE2eSpecFiles: new Set(["e2e/product/mapped.spec.ts"]),
  });
  assert.deepEqual(result, {
    ok: true,
    normalized: "e2e/product/mapped.spec.ts",
  });
});

test("validateBreadthMarkerRef rejects a missing ref value", () => {
  const result = validateBreadthMarkerRef(null);
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.MISSING);
});

test("validateBreadthMarkerRef rejects an empty-string ref value", () => {
  const result = validateBreadthMarkerRef("   ");
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.MISSING);
});

test("validateBreadthMarkerRef rejects a backslash-ambiguous ref", () => {
  const result = validateBreadthMarkerRef("e2e\\auth\\login.spec.ts");
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.BACKSLASH);
});

test("validateBreadthMarkerRef rejects a POSIX absolute-path ref", () => {
  const result = validateBreadthMarkerRef("/e2e/auth/login.spec.ts");
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.ABSOLUTE);
});

test("validateBreadthMarkerRef rejects a Windows drive-letter absolute-path ref", () => {
  const result = validateBreadthMarkerRef("C:/e2e/auth/login.spec.ts");
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.ABSOLUTE);
});

test("validateBreadthMarkerRef rejects a ref that traverses out of the repo", () => {
  const result = validateBreadthMarkerRef("e2e/../../etc/passwd");
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.TRAVERSAL);
});

test("validateBreadthMarkerRef rejects a leading-traversal ref even when it textually starts under e2e/", () => {
  // "e2e/" only appears after a ".." segment is walked, so this must still be
  // rejected outright rather than resolved and re-checked against the root.
  const result = validateBreadthMarkerRef("foo/../e2e/product/mapped.spec.ts");
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.TRAVERSAL);
});

test("validateBreadthMarkerRef rejects a ref outside the e2e/ root", () => {
  const result = validateBreadthMarkerRef("src/app/login/page.tsx");
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.OUTSIDE_E2E_ROOT);
});

test("validateBreadthMarkerRef rejects a ref with an unsupported extension", () => {
  const result = validateBreadthMarkerRef("e2e/helpers/auth.ts", {
    existingE2eSpecFiles: new Set(["e2e/helpers/auth.ts"]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.UNSUPPORTED_EXTENSION);
});

test("validateBreadthMarkerRef rejects a dangling (well-formed but nonexistent) ref", () => {
  const result = validateBreadthMarkerRef("e2e/auth/does-not-exist.spec.ts", {
    existingE2eSpecFiles: new Set(["e2e/auth/auth-redirect.spec.ts"]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.DANGLING);
});

test("validateBreadthMarkerRef defaults to an empty existing-file set (every ref dangles without one)", () => {
  const result = validateBreadthMarkerRef("e2e/auth/auth-redirect.spec.ts");
  assert.equal(result.ok, false);
  assert.equal(result.problem, REF_PROBLEM.DANGLING);
});

test("validateBreadthMarkerRef normalizes repeated slashes and './' segments before comparing against the existing-file set", () => {
  const result = validateBreadthMarkerRef("e2e//product/./mapped.spec.ts", {
    existingE2eSpecFiles: new Set(["e2e/product/mapped.spec.ts"]),
  });
  assert.deepEqual(result, {
    ok: true,
    normalized: "e2e/product/mapped.spec.ts",
  });
});

// --- listExistingE2eSpecFiles (real disk existence inventory) --------------

test("listExistingE2eSpecFiles lists real .spec.ts files under e2e/ and excludes helpers/non-spec files", (t) => {
  const root = createTestFixtureRoot("coverage-breadth-e2e-specs", t);
  const authDir = path.join(root, "e2e", "auth");
  const helpersDir = path.join(root, "e2e", "helpers");
  mkdirSync(authDir, { recursive: true });
  mkdirSync(helpersDir, { recursive: true });
  writeFileSync(path.join(authDir, "auth-redirect.spec.ts"), "export {};\n");
  writeFileSync(path.join(helpersDir, "auth.ts"), "export {};\n");
  writeFileSync(path.join(root, "e2e", "README.md"), "# e2e\n");

  const files = listExistingE2eSpecFiles(root);

  assert.ok(files.has("e2e/auth/auth-redirect.spec.ts"));
  assert.ok(!files.has("e2e/helpers/auth.ts"));
  assert.ok(!files.has("e2e/README.md"));
  assert.equal(files.size, 1);
});

test("listExistingE2eSpecFiles skips node_modules/build-artifact directories nested under e2e/", (t) => {
  const root = createTestFixtureRoot("coverage-breadth-e2e-specs-skip-dirs", t);
  const nodeModulesDir = path.join(root, "e2e", "node_modules", "pkg");
  const testResultsDir = path.join(root, "e2e", "test-results");
  mkdirSync(nodeModulesDir, { recursive: true });
  mkdirSync(testResultsDir, { recursive: true });
  writeFileSync(path.join(nodeModulesDir, "vendored.spec.ts"), "export {};\n");
  writeFileSync(path.join(testResultsDir, "leftover.spec.ts"), "export {};\n");

  const files = listExistingE2eSpecFiles(root);
  assert.equal(files.size, 0);
});

test("listExistingE2eSpecFiles returns an empty set when the repo has no e2e/ directory (test-root edge case)", (t) => {
  const root = createTestFixtureRoot("coverage-breadth-e2e-specs-missing", t);
  const files = listExistingE2eSpecFiles(root);
  assert.deepEqual([...files], []);
});

test("E2E_ROOT and E2E_SPEC_EXTENSION document the evidence-ref naming convention", () => {
  assert.equal(E2E_ROOT, "e2e");
  assert.equal(E2E_SPEC_EXTENSION, ".spec.ts");
});

// --- formatBreadthMarkerProblems / BreadthMarkerValidationError ------------

test("formatBreadthMarkerProblems renders an actionable file:line diagnostic per problem", () => {
  const text = formatBreadthMarkerProblems([
    {
      filePath: "src/app/login/page.tsx",
      line: 4,
      ref: "e2e/auth/does-not-exist.spec.ts",
      problem: REF_PROBLEM.DANGLING,
      message: "referenced e2e spec file does not exist (dangling reference)",
    },
  ]);
  assert.match(text, /src\/app\/login\/page\.tsx:4/);
  assert.match(text, /mapped-e2e ref="e2e\/auth\/does-not-exist\.spec\.ts"/);
  assert.match(text, /does not exist \(dangling reference\)/);
});

test("BreadthMarkerValidationError exposes the full problem list and a formatted message", () => {
  const problems = [
    {
      filePath: "src/a.ts",
      line: 1,
      ref: "../etc/passwd",
      problem: REF_PROBLEM.TRAVERSAL,
      message: 'ref must not contain ".." path traversal segments',
    },
  ];
  const error = new BreadthMarkerValidationError(problems);
  assert.equal(error.name, "BreadthMarkerValidationError");
  assert.deepEqual(error.problems, problems);
  assert.match(error.message, /src\/a\.ts:1/);
});

// --- collectLoadedFiles (node:test run() API integration point) ----------

function fakeCoverageStream({ files, failCount = 0, composedChunks }) {
  const listeners = { "test:coverage": [], "test:fail": [] };
  const emitCoverageAndFailures = () => {
    for (let i = 0; i < failCount; i += 1) {
      for (const handler of listeners["test:fail"]) handler({});
    }
    for (const handler of listeners["test:coverage"]) {
      handler({ summary: { files } });
    }
  };
  return {
    on(event, handler) {
      listeners[event]?.push(handler);
    },
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < failCount; i += 1) {
        for (const handler of listeners["test:fail"]) handler({});
        // Yield so callers draining the stream via `for await` observe at
        // least one event, matching the real run() stream's shape.
        yield { type: "test:fail" };
      }
      for (const handler of listeners["test:coverage"]) {
        handler({ summary: { files } });
      }
      yield { type: "test:coverage" };
    },
    // Mirrors `Readable.prototype.compose`: consuming the composed stream
    // (rather than `this` directly) is how `collectLoadedFiles` drains the
    // run() stream when a reporter is supplied.
    compose() {
      return {
        async *[Symbol.asyncIterator]() {
          emitCoverageAndFailures();
          for (const chunk of composedChunks ?? []) {
            yield chunk;
          }
        },
      };
    },
  };
}

test("collectLoadedFiles derives loaded paths from the test:coverage event summary", async () => {
  const repoRoot = "/repo";
  const { loaded, failureCount } = await collectLoadedFiles({
    repoRoot,
    testFiles: ["src/foo.test.ts"],
    stage: SOURCE_COVERAGE_STAGE,
    run: () =>
      fakeCoverageStream({
        files: [
          { path: "/repo/src/foo.ts" },
          { path: "/repo/src/bar.ts" },
          { path: "src/already-relative.ts" },
        ],
      }),
  });

  assert.deepEqual([...loaded].sort(), [
    "src/already-relative.ts",
    "src/bar.ts",
    "src/foo.ts",
  ]);
  assert.equal(failureCount, 0);
});

test("collectLoadedFiles normalizes native-separator coverage paths", async () => {
  const repoRoot = path.join(path.sep, "repo");
  const filePath = path.join(repoRoot, "src", "foo.ts");
  const { loaded } = await collectLoadedFiles({
    repoRoot,
    testFiles: [path.join("src", "foo.test.ts")],
    run: () => fakeCoverageStream({ files: [{ path: filePath }] }),
  });
  assert.deepEqual([...loaded], ["src/foo.ts"]);
});

test("collectLoadedFiles counts test:fail events", async () => {
  const { failureCount } = await collectLoadedFiles({
    repoRoot: "/repo",
    testFiles: ["src/foo.test.ts"],
    run: () => fakeCoverageStream({ files: [], failCount: 3 }),
  });
  assert.equal(failureCount, 3);
});

test("collectLoadedFiles passes coverage include/exclude globs from the stage through to run()", async () => {
  let receivedOptions;
  await collectLoadedFiles({
    repoRoot: "/repo",
    testFiles: ["src/foo.test.ts"],
    stage: SOURCE_COVERAGE_STAGE,
    run: (options) => {
      receivedOptions = options;
      return fakeCoverageStream({ files: [] });
    },
  });

  assert.deepEqual(
    receivedOptions.coverageIncludeGlobs,
    SOURCE_COVERAGE_STAGE.includes,
  );
  assert.deepEqual(
    receivedOptions.coverageExcludeGlobs,
    SOURCE_COVERAGE_STAGE.excludes,
  );
  assert.equal(receivedOptions.coverage, true);
});

test("collectLoadedFiles defaults to BREADTH_COVERAGE_STAGE, so deck-kernel is instrumented without an explicit stage", async () => {
  let receivedOptions;
  await collectLoadedFiles({
    repoRoot: "/repo",
    testFiles: ["src/foo.test.ts"],
    run: (options) => {
      receivedOptions = options;
      return fakeCoverageStream({ files: [] });
    },
  });

  assert.deepEqual(
    receivedOptions.coverageIncludeGlobs,
    BREADTH_COVERAGE_STAGE.includes,
  );
  assert.deepEqual(
    receivedOptions.coverageExcludeGlobs,
    BREADTH_COVERAGE_STAGE.excludes,
  );
  assert.ok(
    !receivedOptions.coverageExcludeGlobs.includes(
      "src/lib/document/deck-kernel/**",
    ),
  );
});

test("collectLoadedFiles defaults line/branch/function coverage thresholds to 0 (no enforced floor)", async () => {
  let receivedOptions;
  await collectLoadedFiles({
    repoRoot: "/repo",
    testFiles: ["src/foo.test.ts"],
    run: (options) => {
      receivedOptions = options;
      return fakeCoverageStream({ files: [] });
    },
  });

  assert.equal(receivedOptions.lineCoverage, 0);
  assert.equal(receivedOptions.branchCoverage, 0);
  assert.equal(receivedOptions.functionCoverage, 0);
});

test("collectLoadedFiles forwards custom line/branch/function coverage thresholds through to run(), for shared use by the combined coverage gate", async () => {
  let receivedOptions;
  await collectLoadedFiles({
    repoRoot: "/repo",
    testFiles: ["src/foo.test.ts"],
    lineCoverage: 95,
    branchCoverage: 89,
    functionCoverage: 93,
    run: (options) => {
      receivedOptions = options;
      return fakeCoverageStream({ files: [] });
    },
  });

  assert.equal(receivedOptions.lineCoverage, 95);
  assert.equal(receivedOptions.branchCoverage, 89);
  assert.equal(receivedOptions.functionCoverage, 93);
});

test("collectLoadedFiles returns the raw structured coverage summary alongside the derived loaded set", async () => {
  const summaryFiles = [{ path: "/repo/src/foo.ts" }];
  const { summary, loaded } = await collectLoadedFiles({
    repoRoot: "/repo",
    testFiles: ["src/foo.test.ts"],
    run: () => fakeCoverageStream({ files: summaryFiles }),
  });

  assert.deepEqual(summary, { files: summaryFiles });
  assert.deepEqual([...loaded], ["src/foo.ts"]);
});

test("collectLoadedFiles pipes the run() stream through a supplied reporter instead of silently draining it", async () => {
  const written = [];
  const { loaded, failureCount } = await collectLoadedFiles({
    repoRoot: "/repo",
    testFiles: ["src/foo.test.ts"],
    reporter: () => {}, // identity is irrelevant to the fake stream's compose()
    reporterDestination: { write: (chunk) => written.push(chunk) },
    run: () =>
      fakeCoverageStream({
        files: [{ path: "/repo/src/foo.ts" }],
        failCount: 1,
        composedChunks: ["chunk-a", "chunk-b"],
      }),
  });

  assert.deepEqual([...loaded], ["src/foo.ts"]);
  assert.equal(failureCount, 1);
  assert.deepEqual(written, ["chunk-a", "chunk-b"]);
});

test("collectLoadedFiles does not pipe anything when no reporter is supplied (standalone breadth check semantics)", async () => {
  const written = [];
  await collectLoadedFiles({
    repoRoot: "/repo",
    testFiles: ["src/foo.test.ts"],
    reporterDestination: { write: (chunk) => written.push(chunk) },
    run: () => fakeCoverageStream({ files: [], composedChunks: ["unused"] }),
  });

  assert.deepEqual(written, []);
});

// --- buildBreadthReport / formatBreadthReport -----------------------------

function fixtureFiles() {
  return {
    "src/lib/runtime-loaded.ts": {
      text: "export function loaded() { return 1; }",
      loaded: true,
    },
    "src/lib/runtime-gap.ts": {
      text: "export function unloaded() { return 1; }",
      loaded: false,
    },
    "src/lib/types.ts": {
      text: "export interface Foo { id: string }",
      loaded: false,
    },
    "src/lib/barrel.ts": {
      text: 'export { thing } from "./thing";',
      loaded: false,
    },
    "src/lib/mapped.ts": {
      text: [
        "// coverage-breadth: mapped-e2e ref=e2e/product/mapped.spec.ts",
        "export function mapped() { return 1; }",
      ].join("\n"),
      loaded: false,
    },
    "src/lib/excepted.ts": {
      text: [
        "// coverage-breadth: approved-exception reason=manual-only",
        "export function excepted() { return 1; }",
      ].join("\n"),
      loaded: false,
    },
  };
}

function buildFixtureReport() {
  const fixtures = fixtureFiles();
  const eligibleFiles = Object.keys(fixtures).sort();
  const loadedFiles = new Set(eligibleFiles.filter((f) => fixtures[f].loaded));
  return buildBreadthReport({
    repoRoot: "/repo",
    eligibleFiles,
    loadedFiles,
    // "src/lib/mapped.ts" declares ref=e2e/product/mapped.spec.ts — the
    // fixture existence set stands in for a real e2e/ directory scan so this
    // suite stays hermetic (no disk access) while still exercising the real
    // existence-validation path `buildBreadthReport` runs in production.
    existingE2eSpecFiles: new Set(["e2e/product/mapped.spec.ts"]),
    readFile: (absolutePath) => {
      const relative = absolutePath.replace("/repo/", "");
      return fixtures[relative].text;
    },
  });
}

test("buildBreadthReport assigns each eligible file exactly one testing mode", () => {
  const report = buildFixtureReport();

  assert.deepEqual(report.files[MODE.UNIT_LOADED], [
    "src/lib/runtime-loaded.ts",
  ]);
  assert.deepEqual(report.files[MODE.TYPE_ONLY], ["src/lib/types.ts"]);
  assert.deepEqual(report.files[MODE.BARREL], ["src/lib/barrel.ts"]);
  assert.deepEqual(report.files[MODE.MAPPED_E2E], ["src/lib/mapped.ts"]);
  assert.deepEqual(report.files[MODE.APPROVED_EXCEPTION], [
    "src/lib/excepted.ts",
  ]);
  assert.deepEqual(report.files[MODE.GAP], ["src/lib/runtime-gap.ts"]);
});

test("buildBreadthReport counts do not double-count mapped/exception files as loaded", () => {
  const report = buildFixtureReport();
  assert.equal(report.eligibleCount, 6);
  assert.equal(report.typeOnlyCount, 1);
  assert.equal(report.barrelCount, 1);
  assert.equal(report.runtimeEligibleCount, 4);
  assert.equal(report.loadedRuntimeCount, 1);
  assert.equal(report.mappedInteractionCount, 1);
  assert.equal(report.approvedExceptionCount, 1);
  assert.equal(report.actionableGapCount, 1);
  assert.equal(report.unloadedRuntimeCount, 3);
});

test("buildBreadthReport output is deterministic across repeated calls", () => {
  const first = buildFixtureReport();
  const second = buildFixtureReport();
  assert.deepEqual(first, second);
  for (const mode of Object.values(MODE)) {
    const files = first.files[mode];
    assert.deepEqual(files, [...files].sort());
  }
});

test("formatBreadthReport renders the roll-up counts", () => {
  const report = buildFixtureReport();
  const text = formatBreadthReport(report);
  assert.match(text, /Eligible runtime source files: 6/);
  assert.match(text, /Type-only \(excluded, no runtime behavior\): 1/);
  assert.match(text, /Barrel \(excluded, re-export only\): 1/);
  assert.match(text, /Unit-loaded: 1/);
  assert.match(text, /Mapped interaction\/E2E \(not unit-covered\): 1/);
  assert.match(text, /Approved exception: 1/);
  assert.match(text, /Unresolved gap \(actionable\): 1/);
});

test("buildBreadthReport throws BreadthMarkerValidationError for a dangling mapped-e2e ref", () => {
  const fixtures = {
    "src/lib/dangling.ts": {
      text: [
        "// coverage-breadth: mapped-e2e ref=e2e/product/does-not-exist.spec.ts",
        "export function dangling() { return 1; }",
      ].join("\n"),
    },
  };
  const eligibleFiles = Object.keys(fixtures);
  assert.throws(
    () =>
      buildBreadthReport({
        repoRoot: "/repo",
        eligibleFiles,
        loadedFiles: new Set(),
        existingE2eSpecFiles: new Set(["e2e/product/mapped.spec.ts"]),
        readFile: (absolutePath) =>
          fixtures[absolutePath.replace("/repo/", "")].text,
      }),
    (error) => {
      assert.ok(error instanceof BreadthMarkerValidationError);
      assert.match(error.message, /src\/lib\/dangling\.ts/);
      assert.match(error.message, /e2e\/product\/does-not-exist\.spec\.ts/);
      assert.match(error.message, /does not exist/i);
      return true;
    },
  );
});

test("buildBreadthReport throws BreadthMarkerValidationError for a malformed mapped-e2e ref", () => {
  const fixtures = {
    "src/lib/traversal.ts": {
      text: [
        "// coverage-breadth: mapped-e2e ref=e2e/../secrets/leak.spec.ts",
        "export function traversal() { return 1; }",
      ].join("\n"),
    },
  };
  const eligibleFiles = Object.keys(fixtures);
  assert.throws(
    () =>
      buildBreadthReport({
        repoRoot: "/repo",
        eligibleFiles,
        loadedFiles: new Set(),
        existingE2eSpecFiles: new Set(),
        readFile: (absolutePath) =>
          fixtures[absolutePath.replace("/repo/", "")].text,
      }),
    BreadthMarkerValidationError,
  );
});

test("buildBreadthReport aggregates problems across multiple files before throwing", () => {
  const fixtures = {
    "src/lib/bad-one.ts": {
      text: [
        "// coverage-breadth: mapped-e2e ref=/etc/passwd",
        "export function badOne() { return 1; }",
      ].join("\n"),
    },
    "src/lib/bad-two.ts": {
      text: [
        "// coverage-breadth: mapped-e2e ref=e2e/product/ghost.spec.ts",
        "export function badTwo() { return 1; }",
      ].join("\n"),
    },
  };
  const eligibleFiles = Object.keys(fixtures).sort();
  assert.throws(
    () =>
      buildBreadthReport({
        repoRoot: "/repo",
        eligibleFiles,
        loadedFiles: new Set(),
        existingE2eSpecFiles: new Set(),
        readFile: (absolutePath) =>
          fixtures[absolutePath.replace("/repo/", "")].text,
      }),
    (error) => {
      assert.ok(error instanceof BreadthMarkerValidationError);
      // Both files' problems must be reported together (collect-then-throw),
      // not just the first one encountered — this is what lets a caller fix
      // every dangling/malformed ref in one pass instead of playing whack-a-mole.
      assert.match(error.message, /src\/lib\/bad-one\.ts/);
      assert.match(error.message, /src\/lib\/bad-two\.ts/);
      return true;
    },
  );
});

test("buildBreadthReport accepts multiple valid mapped-e2e markers on one file", () => {
  const fixtures = {
    "src/lib/multi-mapped.ts": {
      text: [
        "// coverage-breadth: mapped-e2e ref=e2e/product/mapped.spec.ts",
        "// coverage-breadth: mapped-e2e ref=e2e/product/other.spec.ts",
        "export function multiMapped() { return 1; }",
      ].join("\n"),
    },
  };
  const eligibleFiles = Object.keys(fixtures);
  const report = buildBreadthReport({
    repoRoot: "/repo",
    eligibleFiles,
    loadedFiles: new Set(),
    existingE2eSpecFiles: new Set([
      "e2e/product/mapped.spec.ts",
      "e2e/product/other.spec.ts",
    ]),
    readFile: (absolutePath) =>
      fixtures[absolutePath.replace("/repo/", "")].text,
  });
  assert.deepEqual(report.files[MODE.MAPPED_E2E], ["src/lib/multi-mapped.ts"]);
  assert.equal(report.mappedInteractionCount, 1);
});

test("buildBreadthReport rejects a duplicated mapped-e2e marker where one ref is invalid", () => {
  const fixtures = {
    "src/lib/mixed-mapped.ts": {
      text: [
        "// coverage-breadth: mapped-e2e ref=e2e/product/mapped.spec.ts",
        "// coverage-breadth: mapped-e2e ref=e2e/product/ghost.spec.ts",
        "export function mixedMapped() { return 1; }",
      ].join("\n"),
    },
  };
  const eligibleFiles = Object.keys(fixtures);
  assert.throws(
    () =>
      buildBreadthReport({
        repoRoot: "/repo",
        eligibleFiles,
        loadedFiles: new Set(),
        existingE2eSpecFiles: new Set(["e2e/product/mapped.spec.ts"]),
        readFile: (absolutePath) =>
          fixtures[absolutePath.replace("/repo/", "")].text,
      }),
    (error) => {
      assert.ok(error instanceof BreadthMarkerValidationError);
      assert.match(error.message, /e2e\/product\/ghost\.spec\.ts/);
      return true;
    },
  );
});

// --- deck-kernel loaded/gap classification (#1925) ------------------------

test("buildBreadthReport classifies a loaded deck-kernel runtime file as unit-loaded, not silently skipped", () => {
  const deckKernelPath = "src/lib/document/deck-kernel/deck-diff.ts";
  const report = buildBreadthReport({
    repoRoot: "/repo",
    eligibleFiles: [deckKernelPath],
    loadedFiles: new Set([deckKernelPath]),
    readFile: () => "export function diff() { return 1; }",
  });

  assert.deepEqual(report.files[MODE.UNIT_LOADED], [deckKernelPath]);
  assert.equal(report.loadedRuntimeCount, 1);
  assert.equal(report.actionableGapCount, 0);
});

test("buildBreadthReport classifies an unloaded deck-kernel runtime file as an actionable gap, not silently skipped", () => {
  const deckKernelPath = "src/lib/document/deck-kernel/theme-typography.ts";
  const report = buildBreadthReport({
    repoRoot: "/repo",
    eligibleFiles: [deckKernelPath],
    loadedFiles: new Set(),
    readFile: () => "export function unusedByTests() { return 1; }",
  });

  assert.deepEqual(report.files[MODE.GAP], [deckKernelPath]);
  assert.equal(report.actionableGapCount, 1);
  assert.equal(report.loadedRuntimeCount, 0);
});

test("buildBreadthReport still classifies deck-kernel type-only/barrel files as excluded (not runtime-eligible), matching non-deck-kernel files", () => {
  const typeOnlyPath = "src/lib/document/deck-kernel/types.ts";
  const barrelPath = "src/lib/document/deck-kernel/index.ts";
  const report = buildBreadthReport({
    repoRoot: "/repo",
    eligibleFiles: [typeOnlyPath, barrelPath],
    loadedFiles: new Set(),
    readFile: (absolutePath) => {
      if (absolutePath.endsWith("types.ts")) {
        return "export interface Foo { id: string }";
      }
      return 'export { diff } from "./deck-diff";';
    },
  });

  assert.deepEqual(report.files[MODE.TYPE_ONLY], [typeOnlyPath]);
  assert.deepEqual(report.files[MODE.BARREL], [barrelPath]);
  assert.equal(report.runtimeEligibleCount, 0);
  assert.equal(report.actionableGapCount, 0);
});
