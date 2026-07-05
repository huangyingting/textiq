import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  GENERATED_END,
  GENERATED_START,
  collectPlaywrightSpecs,
  renderInventoryMarkdown,
  replaceGeneratedInventorySection,
  validateUiMatrixInventory,
} from "./check-ui-matrix-inventory.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

const CASE_SUMMARY = {
  total: 1,
  byStatus: { automated: 1, manual: 0, blocked: 0, catalog: 0 },
  bySubsystem: {
    presentation: {
      total: 1,
      automated: 1,
      manual: 0,
      blocked: 0,
      catalog: 0,
    },
  },
};

function specEntry(spec) {
  return {
    spec,
    owners: ["presentation"],
    coverage: "fixture coverage",
    runMode: "opt-in-local",
    prerequisites: ["running app"],
    roles: ["anonymous"],
    devices: ["Desktop Chrome"],
    ciStatus: "opt-in local",
    sourceRefs: [spec],
  };
}

function manualGap() {
  return {
    id: "MANUAL-GAP",
    owner: "presentation",
    gap: "manual fixture gap",
    status: "manual",
    sourceRefs: ["e2e/one.spec.ts"],
  };
}

function writeCliFixture(
  root,
  { missingSpec = false, missingMarkers = false } = {},
) {
  mkdirSync(join(root, "e2e", "ui-matrix"), { recursive: true });
  writeFileSync(join(root, "e2e", "one.spec.ts"), "");
  if (missingSpec) {
    writeFileSync(join(root, "e2e", "missing.spec.ts"), "");
  }
  writeFileSync(
    join(root, "e2e", "ui-matrix", "inventory.ts"),
    [
      "export const UI_MATRIX_SPEC_INVENTORY = [",
      JSON.stringify(specEntry("e2e/one.spec.ts")),
      "];",
      "export const UI_MATRIX_MANUAL_GAPS = [",
      JSON.stringify(manualGap()),
      "];",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "e2e", "ui-matrix", "cases.ts"),
    [
      "export const UI_TEST_CASES = [{ status: 'automated', automation: { spec: 'e2e/one.spec.ts' } }];",
      "export function summarizeUiCases() {",
      "return { total: 1, byStatus: { automated: 1, manual: 0, blocked: 0, catalog: 0 }, bySubsystem: { presentation: { total: 1, automated: 1, manual: 0, blocked: 0, catalog: 0 } } };",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "e2e", "ui-matrix", "README.md"),
    missingMarkers
      ? "# Missing markers\n"
      : ["# Fixture", GENERATED_START, "stale", GENERATED_END].join("\n"),
  );
}

test("ui matrix inventory: collects nested Playwright specs", (t) => {
  const root = createTestFixtureRoot("ui-matrix-spec-collect", t);
  mkdirSync(join(root, "e2e", "ui-matrix"), { recursive: true });
  writeFileSync(join(root, "e2e", "one.spec.ts"), "");
  writeFileSync(join(root, "e2e", "ui-matrix", "two.spec.ts"), "");
  writeFileSync(join(root, "e2e", "helper.ts"), "");

  assert.deepEqual(collectPlaywrightSpecs(root), [
    "e2e/one.spec.ts",
    "e2e/ui-matrix/two.spec.ts",
  ]);
});

test("ui matrix inventory: fails when an e2e spec is missing from the matrix", (t) => {
  const root = createTestFixtureRoot("ui-matrix-missing-spec", t);
  mkdirSync(join(root, "e2e"), { recursive: true });
  writeFileSync(join(root, "e2e", "one.spec.ts"), "");
  writeFileSync(join(root, "e2e", "missing.spec.ts"), "");

  const result = validateUiMatrixInventory({
    repoRoot: root,
    specInventory: [specEntry("e2e/one.spec.ts")],
    manualGaps: [manualGap()],
    caseSummary: CASE_SUMMARY,
    automatedSpecs: ["e2e/one.spec.ts"],
  });

  assert.deepEqual(result.findings, [
    { rule: "missing-spec-inventory", item: "e2e/missing.spec.ts" },
  ]);
});

test("ui matrix inventory: reports stale, duplicate, and missing source refs", (t) => {
  const root = createTestFixtureRoot("ui-matrix-stale-spec", t);
  mkdirSync(join(root, "e2e"), { recursive: true });
  writeFileSync(join(root, "e2e", "one.spec.ts"), "");

  const result = validateUiMatrixInventory({
    repoRoot: root,
    specInventory: [
      specEntry("e2e/one.spec.ts"),
      specEntry("e2e/stale.spec.ts"),
      specEntry("e2e/stale.spec.ts"),
    ],
    manualGaps: [
      {
        ...manualGap(),
        sourceRefs: ["docs/missing.md"],
      },
    ],
    caseSummary: CASE_SUMMARY,
    automatedSpecs: ["e2e/one.spec.ts"],
  });

  assert.deepEqual(
    result.findings.filter(
      (finding) => finding.rule !== "readme-inventory-drift",
    ),
    [
      { rule: "stale-spec-inventory", item: "e2e/stale.spec.ts" },
      { rule: "stale-spec-inventory", item: "e2e/stale.spec.ts" },
      { rule: "duplicate-spec-inventory", item: "e2e/stale.spec.ts" },
      { rule: "missing-source-reference", item: "docs/missing.md" },
      { rule: "missing-source-reference", item: "e2e/stale.spec.ts" },
    ],
  );
});

test("ui matrix inventory: replaces and detects generated README sections", (t) => {
  const root = createTestFixtureRoot("ui-matrix-readme-drift", t);
  mkdirSync(join(root, "e2e"), { recursive: true });
  writeFileSync(join(root, "e2e", "one.spec.ts"), "");
  const rendered = renderInventoryMarkdown({
    specInventory: [specEntry("e2e/one.spec.ts")],
    manualGaps: [manualGap()],
    caseSummary: CASE_SUMMARY,
  });
  const staleReadme = [
    "before",
    GENERATED_START,
    "stale",
    GENERATED_END,
    "after",
  ].join("\n");
  const freshReadme = replaceGeneratedInventorySection(staleReadme, rendered);

  assert.match(freshReadme, /before/);
  assert.match(freshReadme, /after/);
  assert.match(freshReadme, /e2e\/one\.spec\.ts/);

  const result = validateUiMatrixInventory({
    repoRoot: root,
    specInventory: [specEntry("e2e/one.spec.ts")],
    manualGaps: [manualGap()],
    caseSummary: CASE_SUMMARY,
    automatedSpecs: ["e2e/one.spec.ts"],
    readmeText: staleReadme,
  });
  assert(
    result.findings.some(
      (finding) => finding.rule === "readme-inventory-drift",
    ),
  );
});

test("ui matrix inventory CLI refreshes and then accepts fixture README", (t) => {
  const root = createTestFixtureRoot("ui-matrix-cli-pass", t);
  writeCliFixture(root);
  const scriptPath = join(
    process.cwd(),
    "scripts",
    "check-ui-matrix-inventory.mjs",
  );

  const written = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath, "--write"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(written.status, 0);
  assert.match(written.stdout, /refreshed/);
  assert.match(
    readFileSync(join(root, "e2e", "ui-matrix", "README.md"), "utf8"),
    /Playwright spec inventory/,
  );

  const checked = spawnSync(process.execPath, ["--import", "tsx", scriptPath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(checked.status, 0);
  assert.match(checked.stdout, /passed/);
});

test("ui matrix inventory CLI fails missing specs and missing README markers", (t) => {
  const scriptPath = join(
    process.cwd(),
    "scripts",
    "check-ui-matrix-inventory.mjs",
  );
  const missingSpecRoot = createTestFixtureRoot(
    "ui-matrix-cli-missing-spec",
    t,
  );
  writeCliFixture(missingSpecRoot, { missingSpec: true });
  const missingSpec = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath],
    { cwd: missingSpecRoot, encoding: "utf8" },
  );
  assert.equal(missingSpec.status, 1);
  assert.match(missingSpec.stderr, /missing-spec-inventory/);

  const missingMarkerRoot = createTestFixtureRoot(
    "ui-matrix-cli-missing-marker",
    t,
  );
  writeCliFixture(missingMarkerRoot, { missingMarkers: true });
  const missingMarker = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath, "--write"],
    { cwd: missingMarkerRoot, encoding: "utf8" },
  );
  assert.equal(missingMarker.status, 1);
  assert.match(missingMarker.stderr, /readme-marker-error/);
});
