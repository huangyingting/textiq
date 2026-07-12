import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildBreadthReport,
  classifySourceFile,
  collectLoadedFiles,
  formatBreadthReport,
  globToRegExp,
  listEligibleSourceFiles,
  matchesAnyGlob,
  MODE,
  parseBreadthMarker,
  SOURCE_COVERAGE_STAGE,
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

// --- collectLoadedFiles (node:test run() API integration point) ----------

function fakeCoverageStream({ files, failCount = 0 }) {
  const listeners = { "test:coverage": [], "test:fail": [] };
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
