import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  GENERATED_END,
  GENERATED_START,
  collectPlaywrightSpecs,
  playwrightTestRegistrations,
  playwrightTestTitles,
  renderInventoryMarkdown,
  replaceGeneratedInventorySection,
  validateDocxDeterministicProfileMapping,
  validateMappedTestContract,
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

function docxSpecEntry() {
  return {
    ...specEntry("e2e/import/import-roundtrip.spec.ts"),
    owners: ["import", "editor"],
    runMode: "required-ci",
    ciStatus: "required normal deterministic E2E workflow",
    tests: [
      {
        test: "imports DOCX, renders blocks, and persists content across reload @required-profile",
        surface: "dashboard import → document editor render/reload",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
    ],
  };
}

const IMPORT_TESTS = [
  {
    test: "imports Markdown, renders blocks, and persists content across reload",
    required: true,
  },
  {
    test: "imports DOCX, renders blocks, and persists content across reload",
    required: true,
  },
  {
    test: "workspace import by owner persists across reload",
    required: true,
  },
  {
    test: "workspace import by editor persists across reload",
    required: true,
  },
  {
    test: "workspace import by viewer is forbidden and creates zero documents",
    required: true,
  },
  {
    test: "rejects an unsupported file type with a graceful error",
    required: false,
  },
];

function exactImportEntry() {
  return {
    ...docxSpecEntry(),
    expectedTestCount: IMPORT_TESTS.length,
    expectedTests: IMPORT_TESTS.map(({ test: title, required }) => ({
      test: title,
      profiles: [
        "deterministic-profile",
        ...(required ? ["required-profile"] : []),
      ],
    })),
  };
}

function exactImportSource(overrides = new Map()) {
  return [
    'import { test } from "@playwright/test";',
    ...IMPORT_TESTS.map(({ test: title, required }) => {
      const replacement = overrides.get(title);
      if (replacement !== undefined) return replacement;
      const annotation = required ? " @required-profile" : "";
      return `test(${JSON.stringify(`${title}${annotation}`)}, async () => {});`;
    }),
  ].join("\n");
}

function writeCliFixture(
  root,
  { missingSpec = false, missingMarkers = false } = {},
) {
  mkdirSync(join(root, "e2e", "ui-matrix"), { recursive: true });
  writeFileSync(
    join(root, "e2e", "one.spec.ts"),
    [
      'import { test } from "@playwright/test";',
      'test("one exact test", async () => {});',
    ].join("\n"),
  );
  if (missingSpec) {
    writeFileSync(join(root, "e2e", "missing.spec.ts"), "");
  }
  writeFileSync(
    join(root, "e2e", "ui-matrix", "inventory.ts"),
    [
      "export const UI_MATRIX_SPEC_INVENTORY = [",
      JSON.stringify({
        ...specEntry("e2e/one.spec.ts"),
        expectedTestCount: 1,
        expectedTests: [
          { test: "one exact test", profiles: ["deterministic-profile"] },
        ],
      }),
      "];",
      "export const UI_MATRIX_MANUAL_GAPS = [",
      JSON.stringify(manualGap()),
      "];",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "e2e", "ui-matrix", "cases.ts"),
    [
      "export const UI_TEST_CASES = [{ id: 'CASE-001', status: 'automated', automation: { spec: 'e2e/one.spec.ts', test: 'one exact test' } }];",
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

test("ui matrix inventory: rejects automated cases without exact contracted test identities", (t) => {
  const root = createTestFixtureRoot("ui-matrix-automation-evidence", t);
  mkdirSync(join(root, "e2e"), { recursive: true });
  writeFileSync(join(root, "e2e", "one.spec.ts"), "");
  const entry = {
    ...specEntry("e2e/one.spec.ts"),
    expectedTests: [
      { test: "does the exact thing", profiles: ["deterministic-profile"] },
    ],
  };

  const missingIdentity = validateUiMatrixInventory({
    repoRoot: root,
    specInventory: [entry],
    manualGaps: [],
    caseSummary: CASE_SUMMARY,
    automatedSpecs: [entry.spec],
    automatedCases: [
      { id: "CASE-001", status: "automated", automation: { spec: entry.spec } },
    ],
  });
  assert.deepEqual(missingIdentity.findings, [
    { rule: "automated-case-missing-test-identity", item: "CASE-001" },
  ]);

  const vagueIdentity = validateUiMatrixInventory({
    repoRoot: root,
    specInventory: [entry],
    manualGaps: [],
    caseSummary: CASE_SUMMARY,
    automatedSpecs: [entry.spec],
    automatedCases: [
      {
        id: "CASE-002",
        status: "automated",
        automation: { spec: entry.spec, test: "representative smoke" },
      },
    ],
  });
  assert.deepEqual(vagueIdentity.findings, [
    {
      rule: "automated-case-test-not-contracted",
      item: "CASE-002: e2e/one.spec.ts :: representative smoke",
    },
  ]);

  const exactIdentity = validateUiMatrixInventory({
    repoRoot: root,
    specInventory: [entry],
    manualGaps: [],
    caseSummary: CASE_SUMMARY,
    automatedSpecs: [entry.spec],
    automatedCases: [
      {
        id: "CASE-003",
        status: "automated",
        automation: { spec: entry.spec, test: "does the exact thing" },
      },
    ],
  });
  assert.deepEqual(exactIdentity.findings, []);
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

test("ui matrix inventory: guards the required DOCX profile mapping and annotation", () => {
  const playwrightConfigText = [
    "const deterministicProfileSpecs = [",
    '  "import/import-roundtrip.spec.ts",',
    "];",
  ].join("\n");
  const importSpecText = [
    'import { test } from "@playwright/test";',
    'test("imports DOCX, renders blocks, and persists content across reload @required-profile", async () => {});',
  ].join("\n");
  const entry = docxSpecEntry();

  assert.deepEqual(
    validateDocxDeterministicProfileMapping({
      playwrightConfigText,
      importSpecText,
      specInventory: [entry],
      manualGaps: [],
    }),
    [],
  );

  const findings = validateDocxDeterministicProfileMapping({
    playwrightConfigText: playwrightConfigText.replace(
      "import/import-roundtrip.spec.ts",
      "editor/document-editor-profile.spec.ts",
    ),
    importSpecText: importSpecText.replace(" @required-profile", ""),
    specInventory: [{ ...entry, runMode: "advisory-ci" }],
    manualGaps: [
      {
        ...manualGap(),
        id: "DOCX-UI-ROUNDTRIP",
        gap: "DOCX UI round-trip is manual",
      },
    ],
  });
  const rules = new Set(findings.map((finding) => finding.rule));

  assert.equal(rules.has("docx-spec-not-in-deterministic-profile"), true);
  assert.equal(rules.has("docx-required-ci-tier-drift"), true);
  assert.equal(rules.has("docx-test-required-profile-annotation-drift"), true);
  assert.equal(rules.has("docx-test-not-in-inventory"), true);
  assert.equal(rules.has("stale-docx-test-inventory"), true);
  assert.equal(rules.has("docx-still-classified-as-gap"), true);
});

test("ui matrix inventory: resolves aliased and namespace Playwright bindings", () => {
  const title = "imports DOCX @required-profile";
  const cases = [
    [
      "named alias",
      `import { test as spec } from "@playwright/test"; spec("${title}", async () => {});`,
    ],
    [
      "namespace",
      `import * as playwright from "@playwright/test"; playwright.test.skip("${title}", async () => {});`,
    ],
    [
      "default",
      `import spec from "@playwright/test"; spec.only("${title}", async () => {});`,
    ],
  ];

  for (const [label, source] of cases) {
    assert.deepEqual(
      playwrightTestTitles(source, "e2e/import/import-roundtrip.spec.ts"),
      [title],
      label,
    );
  }
});

test("ui matrix inventory: ignores local, shadowed, and reassigned test bindings", () => {
  const source = [
    'import { test as spec } from "@playwright/test";',
    "function test(title, callback) { callback(); }",
    'test("fake DOCX local", () => {});',
    'spec("real DOCX outer @required-profile", () => {});',
    "{",
    "  const spec = (title, callback) => callback();",
    '  spec("fake DOCX shadow", () => {});',
    "}",
    "spec = test;",
    'spec("fake DOCX reassigned", () => {});',
  ].join("\n");

  assert.deepEqual(
    playwrightTestTitles(source, "e2e/import/import-roundtrip.spec.ts"),
    ["real DOCX outer @required-profile"],
  );
});

test("ui matrix inventory: scopes loop, switch, catch, parameter, and var shadows", () => {
  const source = [
    'import { test as spec } from "@playwright/test";',
    'spec("outer DOCX one", () => {});',
    "for (const spec of [() => {}]) {",
    '  spec("fake loop DOCX", () => {});',
    "}",
    "switch (1) {",
    "  case 1: {",
    "    const spec = (title, callback) => callback();",
    '    spec("fake switch DOCX", () => {});',
    "  }",
    "}",
    "try { throw new Error(); } catch (spec) {",
    '  spec("fake catch DOCX", () => {});',
    "}",
    "function parameterShadow(spec) {",
    '  spec("fake parameter DOCX", () => {});',
    "}",
    "function varShadow() {",
    '  spec("fake hoisted var DOCX", () => {});',
    "  if (true) { var spec = (title, callback) => callback(); }",
    "}",
    'spec("outer DOCX two", () => {});',
  ].join("\n");

  assert.deepEqual(
    playwrightTestTitles(source, "e2e/import/import-roundtrip.spec.ts"),
    ["outer DOCX one", "outer DOCX two"],
  );
});

test("ui matrix inventory: retains provenance through test.extend aliases", () => {
  const source = [
    'import { test } from "@playwright/test";',
    "const spec = test.extend({});",
    'spec("imports DOCX through fixture @required-profile", async () => {});',
  ].join("\n");

  assert.deepEqual(
    playwrightTestTitles(source, "e2e/import/import-roundtrip.spec.ts"),
    ["imports DOCX through fixture @required-profile"],
  );
});

test("ui matrix inventory: resolves custom fixture re-exports by module provenance", (t) => {
  const root = createTestFixtureRoot("ui-matrix-custom-fixture", t);
  mkdirSync(join(root, "e2e", "import"), { recursive: true });
  writeFileSync(
    join(root, "e2e", "fixtures.ts"),
    [
      'import { test as base } from "@playwright/test";',
      "export const test = base.extend({});",
    ].join("\n"),
  );
  const source = [
    'import { test as spec } from "../fixtures";',
    'spec("imports DOCX from custom fixture @required-profile", async () => {});',
  ].join("\n");

  assert.deepEqual(
    playwrightTestTitles(source, "e2e/import/import-roundtrip.spec.ts", {
      repoRoot: root,
    }),
    ["imports DOCX from custom fixture @required-profile"],
  );
});

test("ui matrix inventory: reports unresolved Playwright registration provenance", () => {
  const cases = [
    [
      "computed member",
      [
        'import * as playwright from "@playwright/test";',
        'const method = "test";',
        "playwright[method]('dynamic DOCX', async () => {});",
      ].join("\n"),
      0,
      1,
    ],
    [
      "dynamic import",
      [
        'const playwright = await import("@playwright/test");',
        "playwright.test('dynamic import DOCX', async () => {});",
      ].join("\n"),
      0,
      1,
    ],
    [
      "reassigned alias",
      [
        'import { test as spec } from "@playwright/test";',
        "spec = unknownRegistration;",
        "spec('reassigned DOCX', async () => {});",
      ].join("\n"),
      0,
      2,
    ],
    [
      "unknown alias",
      ["let spec;", "spec('unknown DOCX', async () => {});"].join("\n"),
      0,
      1,
    ],
    [
      "wrapper dynamic title",
      [
        'import { test } from "@playwright/test";',
        "function register(title) {",
        "  test(title, async () => {});",
        "}",
        "register('wrapped DOCX');",
      ].join("\n"),
      0,
      1,
    ],
  ];

  for (const [label, source, registrations, unsupported] of cases) {
    const scan = playwrightTestRegistrations(
      source,
      "e2e/import/import-roundtrip.spec.ts",
    );
    assert.equal(scan.registrations.length, registrations, label);
    assert.equal(scan.unsupported.length, unsupported, label);
  }
});

test("ui matrix inventory: covers final scanner provenance bypass probes", () => {
  const cases = [
    {
      label: "computed test method",
      source: [
        'import { test } from "@playwright/test";',
        'const method = "only";',
        'test[method]("computed method", async () => {});',
      ].join("\n"),
      registrations: 0,
      unsupported: 1,
    },
    {
      label: "unrecognized computed test method",
      source: [
        'import { test } from "@playwright/test";',
        'test["register"]("unrecognized method", async () => {});',
      ].join("\n"),
      registrations: 0,
      unsupported: 1,
    },
    {
      label: "mutated namespace test",
      source: [
        'import * as pw from "@playwright/test";',
        "pw.test = fake;",
        'pw.test("mutated namespace", async () => {});',
      ].join("\n"),
      registrations: 0,
      unsupported: 2,
    },
    {
      label: "destructuring assignment",
      source: [
        'import * as pw from "@playwright/test";',
        "let register;",
        "({ test: register } = pw);",
        'register("assigned destructure", async () => {});',
      ].join("\n"),
      registrations: 1,
      unsupported: 0,
    },
  ];

  for (const { label, source, registrations, unsupported } of cases) {
    const scan = playwrightTestRegistrations(
      source,
      "e2e/import/import-roundtrip.spec.ts",
    );
    assert.equal(scan.registrations.length, registrations, label);
    assert.equal(scan.unsupported.length, unsupported, label);
  }
});

test("ui matrix inventory: preserves static Playwright registration provenance", () => {
  const source = [
    'import { test } from "@playwright/test";',
    'import * as pw from "@playwright/test";',
    'test["only"]("computed literal modifier", async () => {});',
    "const { test: declared } = pw;",
    'declared("declared destructure", async () => {});',
    "let assigned;",
    "({ test: assigned } = pw);",
    'assigned("assigned destructure", async () => {});',
  ].join("\n");

  const scan = playwrightTestRegistrations(
    source,
    "e2e/import/import-roundtrip.spec.ts",
  );
  assert.deepEqual(
    scan.registrations.map(({ title }) => title),
    [
      "computed literal modifier",
      "declared destructure",
      "assigned destructure",
    ],
  );
  assert.equal(scan.unsupported.length, 0);
});

test("ui matrix inventory: ignores namespace-shaped local fakes", () => {
  const source = [
    "const pw = { test: (title, callback) => callback() };",
    'pw.test("local namespace fake", async () => {});',
    "pw.test = fake;",
    'pw.test("mutated local namespace fake", async () => {});',
  ].join("\n");

  const scan = playwrightTestRegistrations(
    source,
    "e2e/import/import-roundtrip.spec.ts",
  );
  assert.equal(scan.registrations.length, 0);
  assert.equal(scan.unsupported.length, 0);
});

test("ui matrix inventory: mutations stay unsupported after attempted restore", () => {
  const source = [
    'import { test } from "@playwright/test";',
    'import * as pw from "@playwright/test";',
    "const original = test;",
    "test.only = fake;",
    'test("after test mutation", async () => {});',
    "test = original;",
    'test("after test restore", async () => {});',
    "pw.test = fake;",
    "pw.test = original;",
    'pw.test("after namespace restore", async () => {});',
  ].join("\n");

  const scan = playwrightTestRegistrations(
    source,
    "e2e/import/import-roundtrip.spec.ts",
  );
  assert.equal(scan.registrations.length, 0);
  assert.equal(scan.unsupported.length, 7);
});

test("ui matrix inventory: rejects ambiguous Playwright destructuring", () => {
  const variants = [
    ["rest declaration", "const { test: register, ...rest } = pw;", "register"],
    ["computed declaration", 'const { ["test"]: register } = pw;', "register"],
    [
      "default declaration",
      "const { test: register = fake } = pw;",
      "register",
    ],
    [
      "destructive declaration",
      "const { test: { only: register } } = pw;",
      "register",
    ],
    [
      "rest assignment",
      "let register, rest; ({ test: register, ...rest } = pw);",
      "register",
    ],
    [
      "computed assignment",
      'let register; ({ ["test"]: register } = pw);',
      "register",
    ],
  ];

  for (const [label, destructuring, callee] of variants) {
    const source = [
      'import * as pw from "@playwright/test";',
      destructuring,
      `${callee}(${JSON.stringify(label)}, async () => {});`,
    ].join("\n");
    const scan = playwrightTestRegistrations(
      source,
      "e2e/import/import-roundtrip.spec.ts",
    );
    assert.equal(scan.registrations.length, 0, label);
    assert.equal(scan.unsupported.length, 2, label);
  }
});

test("ui matrix inventory: hidden dynamic DOCX cannot accompany a valid contract", () => {
  const source = [
    'import * as playwright from "@playwright/test";',
    exactImportSource(),
    'const method = "test";',
    "playwright[method]('hidden dynamic DOCX', async () => {});",
  ].join("\n");
  const findings = validateMappedTestContract({
    sourceText: source,
    fileName: "e2e/import/import-roundtrip.spec.ts",
    inventoryEntry: exactImportEntry(),
  });

  assert.ok(
    findings.some(
      (finding) => finding.rule === "unsupported-test-registration",
    ),
  );
});

test("ui matrix inventory: computed title is an unsupported registration", () => {
  const title = IMPORT_TESTS[0].test;
  const source = exactImportSource(
    new Map([
      [
        title,
        `const computedTitle = ${JSON.stringify(`${title} @required-profile`)};\ntest(computedTitle, async () => {});`,
      ],
    ]),
  );
  const findings = validateMappedTestContract({
    sourceText: source,
    fileName: "e2e/import/import-roundtrip.spec.ts",
    inventoryEntry: exactImportEntry(),
  });

  assert.ok(
    findings.some(
      (finding) => finding.rule === "unsupported-test-registration",
    ),
  );
  assert.ok(
    findings.some(
      (finding) => finding.rule === "test-registration-count-drift",
    ),
  );
});

test("ui matrix inventory: proven local fake registration is allowed", () => {
  const source = [
    exactImportSource(),
    "{",
    "  const test = (title, callback) => callback();",
    '  test("local fake DOCX", async () => {});',
    "}",
  ].join("\n");

  assert.deepEqual(
    validateMappedTestContract({
      sourceText: source,
      fileName: "e2e/import/import-roundtrip.spec.ts",
      inventoryEntry: exactImportEntry(),
    }),
    [],
  );
});

test("ui matrix inventory: enforces every required non-DOCX classification", () => {
  for (const expected of IMPORT_TESTS.filter(
    ({ test: title, required }) => required && !title.includes("DOCX"),
  )) {
    const source = exactImportSource(
      new Map([
        [
          expected.test,
          `test(${JSON.stringify(expected.test)}, async () => {});`,
        ],
      ]),
    );
    const findings = validateMappedTestContract({
      sourceText: source,
      fileName: "e2e/import/import-roundtrip.spec.ts",
      inventoryEntry: exactImportEntry(),
    });

    assert.ok(
      findings.some(
        (finding) =>
          finding.rule === "test-profile-classification-drift" &&
          finding.item.includes(expected.test),
      ),
      expected.test,
    );
  }
});

test("ui matrix inventory: rejects a seventh import test", () => {
  const findings = validateMappedTestContract({
    sourceText: [
      exactImportSource(),
      'test("seventh import @required-profile", async () => {});',
    ].join("\n"),
    fileName: "e2e/import/import-roundtrip.spec.ts",
    inventoryEntry: exactImportEntry(),
  });
  const rules = new Set(findings.map((finding) => finding.rule));

  assert.equal(rules.has("test-registration-count-drift"), true);
  assert.equal(rules.has("unexpected-test-registration"), true);
});

test("ui matrix inventory: rejects duplicate import titles", () => {
  const duplicate = IMPORT_TESTS[0];
  const findings = validateMappedTestContract({
    sourceText: [
      exactImportSource(),
      `test(${JSON.stringify(`${duplicate.test} @required-profile`)}, async () => {});`,
    ].join("\n"),
    fileName: "e2e/import/import-roundtrip.spec.ts",
    inventoryEntry: exactImportEntry(),
  });

  assert.ok(
    findings.some((finding) => finding.rule === "duplicate-test-registration"),
  );
});

test("ui matrix inventory: accepts the authoritative six-test import contract", () => {
  assert.deepEqual(
    validateMappedTestContract({
      sourceText: exactImportSource(),
      fileName: "e2e/import/import-roundtrip.spec.ts",
      inventoryEntry: exactImportEntry(),
    }),
    [],
  );
});

test("ui matrix inventory: local fake test cannot satisfy the DOCX inventory", () => {
  const title = "imports DOCX @required-profile";
  const playwrightConfigText =
    'const deterministicProfileSpecs = ["import/import-roundtrip.spec.ts"];';
  const entry = {
    ...docxSpecEntry(),
    tests: [{ ...docxSpecEntry().tests[0], test: title }],
  };
  const aliasedSource = [
    'import { test as spec } from "@playwright/test";',
    `spec("${title}", async () => {});`,
  ].join("\n");
  const localSource = [
    "const test = (title, callback) => callback();",
    `test("${title}", async () => {});`,
  ].join("\n");

  assert.deepEqual(
    validateDocxDeterministicProfileMapping({
      playwrightConfigText,
      importSpecText: aliasedSource,
      specInventory: [entry],
      manualGaps: [],
    }),
    [],
  );
  assert.deepEqual(
    validateDocxDeterministicProfileMapping({
      playwrightConfigText,
      importSpecText: localSource,
      specInventory: [entry],
      manualGaps: [],
    }),
    [
      {
        rule: "docx-test-count-drift",
        item: "e2e/import/import-roundtrip.spec.ts: expected 1, proven 0",
      },
      { rule: "stale-docx-test-inventory", item: title },
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
