import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildTestPlan,
  classifyTestFile,
  findSubsystemCoverageGaps,
  findTestFileNameProblems,
  findUnclassifiedTestFiles,
  findWeakTestTitleProblems,
  listTestFiles,
  listSubsystems,
  main,
  runTestCoverageAudit,
  scanTestText,
} from "./test-subsystem.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

function fixtureRoot(name) {
  return createTestFixtureRoot(name);
}

function captureConsole(callback) {
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  const errors = [];
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const result = callback();
    return { result, logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

const SAMPLE_TEST_FILES = [
  "e2e/presentation/present-export.spec.ts",
  "scripts/collab-auth.test.mjs",
  "scripts/check-docs-links.test.mjs",
  "src/app/api/collab/authorize/parser.test.ts",
  "src/lib/auth/password.test.ts",
  "src/lib/collab/room-access.test.ts",
  "src/lib/presentation/validation.test.ts",
  "src/lib/validation-primitives.test.ts",
];

test("test subsystem map exposes stable subsystem names", () => {
  assert.ok(listSubsystems().includes("editor"));
  assert.ok(listSubsystems().includes("presentation"));
  assert.ok(listSubsystems().includes("security"));
});

test("test subsystem map classifies files by owning subsystem", () => {
  assert.deepEqual(classifyTestFile("src/lib/auth/password.test.ts"), ["auth"]);
  assert.ok(
    classifyTestFile(
      "src/components/editor/use-slide-editor-open.test.ts",
    ).includes("editor"),
  );
  assert.ok(
    classifyTestFile("src/lib/presentation/validation.test.ts").includes(
      "data-model",
    ),
  );
  assert.deepEqual(
    classifyTestFile("src/components/motion/presets.test.ts"),
    ["system", "ui"],
    "shared motion behavior must run in both cross-cutting UI buckets",
  );
  assert.deepEqual(
    classifyTestFile("src/components/ui/button.test.tsx"),
    ["system", "ui"],
    "UI primitives must retain their existing cross-cutting ownership",
  );
  assert.deepEqual(
    classifyTestFile("e2e/ui-matrix/app-shell-ui.spec.ts"),
    ["system", "ui"],
    "app-shell browser coverage must run with both cross-cutting UI buckets",
  );
  assert.ok(
    classifyTestFile("src/lib/validation-primitives.test.ts").includes(
      "data-model",
    ),
    "src/lib/validation-primitives.test.ts must classify under data-model",
  );
  assert.ok(
    classifyTestFile("e2e/presentation/present-export.spec.ts").includes(
      "presentation",
    ),
  );
  assert.ok(
    classifyTestFile(
      "e2e/presentation/overlap-selection-regression.spec.ts",
    ).includes("presentation"),
  );
  assert.deepEqual(
    classifyTestFile("e2e/ui-matrix/document-editor-ui.spec.ts"),
    ["editor"],
  );
  assert.deepEqual(
    classifyTestFile("e2e/editor/document-table-autosave.spec.ts"),
    ["editor"],
  );
  assert.ok(
    classifyTestFile("e2e/ui-matrix/public-render-ui.spec.ts").includes(
      "public-render",
    ),
  );
  assert.ok(
    classifyTestFile(
      "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
    ).includes("billing"),
  );
  assert.deepEqual(
    classifyTestFile("e2e/ui-matrix/account-lifecycle-ui.spec.ts"),
    ["auth", "security"],
    "account lifecycle browser coverage must run with both owning subsystems",
  );
  assert.deepEqual(
    classifyTestFile("e2e/ui-matrix/dashboard-document-lifecycle-ui.spec.ts"),
    ["documents"],
    "dashboard lifecycle browser coverage must run with the documents subsystem",
  );
  assert.deepEqual(
    classifyTestFile("e2e/documents/template-creation.spec.ts"),
    ["documents", "editor", "security", "ui", "workspace"],
    "template creation browser coverage must run with every owning subsystem",
  );
  assert.deepEqual(
    classifyTestFile("e2e/ui-matrix/workspace-lifecycle-ui.spec.ts"),
    ["security", "workspace"],
    "workspace lifecycle browser coverage must run with both owning subsystems",
  );
  assert.deepEqual(
    classifyTestFile("e2e/ui-matrix/document-metadata-history-ui.spec.ts"),
    ["documents", "editor", "security"],
    "document metadata/history browser coverage must run with every owning subsystem",
  );
  assert.deepEqual(
    classifyTestFile("e2e/ui-matrix/document-comments-lifecycle-ui.spec.ts"),
    ["documents", "editor", "security"],
    "document comment lifecycle browser coverage must run with every owning subsystem",
  );
  assert.deepEqual(
    classifyTestFile("e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts"),
    ["documents", "public-render", "security"],
    "document sharing lifecycle browser coverage must run with every owning subsystem",
  );
  assert.ok(
    classifyTestFile("src/app/api/brand/route.test.ts").includes("brand"),
    "src/app/api/brand/** must classify under the brand subsystem",
  );
  assert.ok(
    classifyTestFile("src/app/api/brand/logo/route.test.ts").includes("brand"),
  );
  assert.ok(
    classifyTestFile("src/app/api/brand/font/route.test.ts").includes("brand"),
  );
  assert.deepEqual(
    classifyTestFile("src/app/login/actions.test.ts"),
    ["auth"],
    "src/app/login/** action-boundary tests must classify under auth",
  );
  assert.deepEqual(
    classifyTestFile("src/app/signup/actions.test.ts"),
    ["auth"],
    "src/app/signup/** action-boundary tests must classify under auth",
  );
  assert.deepEqual(
    classifyTestFile("src/app/forgot-password/actions.test.ts"),
    ["auth"],
    "src/app/forgot-password/** action-boundary tests must classify under auth",
  );
  assert.deepEqual(
    classifyTestFile("src/app/reset-password/actions.test.ts"),
    ["auth"],
    "src/app/reset-password/** action-boundary tests must classify under auth",
  );
  assert.deepEqual(
    classifyTestFile("src/components/auth/auth-form.test.tsx"),
    ["auth"],
    "src/components/auth/** shared form primitives must classify under auth",
  );
  assert.deepEqual(
    classifyTestFile("src/components/google-sign-in-button.test.tsx"),
    ["auth"],
    "the Google sign-in action contract must classify under auth",
  );
  assert.deepEqual(
    classifyTestFile("src/app/api/brand-assets/route.test.ts").includes(
      "brand",
    ),
    false,
    "src/app/api/brand-assets/** stays owned by security, not brand",
  );
});

test("test subsystem plan routes source and script files without e2e by default", () => {
  const plan = buildTestPlan({
    subsystems: ["collaboration"],
    testFiles: SAMPLE_TEST_FILES,
  });

  assert.deepEqual(plan.commands, [
    {
      label: "source unit tests",
      command: "node",
      args: [
        "--import",
        "tsx",
        "--test",
        "src/app/api/collab/authorize/parser.test.ts",
        "src/lib/collab/room-access.test.ts",
      ],
    },
    {
      label: "script tests",
      command: "node",
      args: ["--test", "scripts/collab-auth.test.mjs"],
    },
  ]);
  assert.deepEqual(plan.skippedE2e, []);
});

test("test subsystem plan keeps e2e specs opt-in", () => {
  const withoutE2e = buildTestPlan({
    subsystems: ["presentation"],
    testFiles: SAMPLE_TEST_FILES,
  });
  const withE2e = buildTestPlan({
    subsystems: ["presentation"],
    testFiles: SAMPLE_TEST_FILES,
    includeE2e: true,
  });

  assert.deepEqual(withoutE2e.skippedE2e, [
    "e2e/presentation/present-export.spec.ts",
  ]);
  assert.deepEqual(withE2e.commands.at(-1), {
    label: "e2e tests",
    command: "npx",
    args: ["playwright", "test", "e2e/presentation/present-export.spec.ts"],
  });
});

test("test subsystem plan keeps the Postgres billing harness opt-in", () => {
  const postgresHarness = "scripts/usage-ledger-postgres-integration.test.ts";
  const plan = buildTestPlan({
    subsystems: ["billing"],
    testFiles: ["src/lib/billing/usage-ledger.test.ts", postgresHarness],
  });

  assert.deepEqual(plan.commands, [
    {
      label: "source unit tests",
      command: "node",
      args: [
        "--import",
        "tsx",
        "--test",
        "src/lib/billing/usage-ledger.test.ts",
      ],
    },
  ]);
  assert.deepEqual(plan.skippedOptIn, [
    {
      filePath: postgresHarness,
      command: "npm run test:billing:postgres",
    },
  ]);
});

test("test subsystem plan routes the document table autosave regression to editor e2e", () => {
  const filePath = "e2e/editor/document-table-autosave.spec.ts";
  const plan = buildTestPlan({
    subsystems: ["editor"],
    testFiles: [filePath],
    includeE2e: true,
  });

  assert.deepEqual(plan.commands, [
    {
      label: "e2e tests",
      command: "npx",
      args: ["playwright", "test", filePath],
    },
  ]);
});

test("test subsystem coverage check flags unmapped test files", () => {
  assert.deepEqual(findUnclassifiedTestFiles(SAMPLE_TEST_FILES), []);
  assert.deepEqual(
    findUnclassifiedTestFiles(["src/lib/unowned/example.test.ts"]),
    ["src/lib/unowned/example.test.ts"],
  );
});

test("test subsystem coverage check flags empty subsystem buckets", () => {
  assert.deepEqual(findSubsystemCoverageGaps(SAMPLE_TEST_FILES), [
    "ai",
    "billing",
    "brand",
    "commands",
    "comments",
    "diagnostics",
    "documents",
    "editor",
    "import",
    "localization",
    "product",
    "security",
    "system",
    "ui",
    "visual",
    "workspace",
  ]);
});

test("test naming audit flags unclear file names", () => {
  assert.deepEqual(
    findTestFileNameProblems(["src/lib/auth/password.test.ts"]),
    [],
  );
  assert.deepEqual(
    findTestFileNameProblems([
      "src/lib/auth/password.spec.ts",
      "e2e/auth_redirect.test.ts",
    ]).map((item) => item.rule),
    ["test-file-name", "e2e-spec-name", "unit-test-name"],
  );
});

test("test naming audit flags weak test case names", () => {
  assert.deepEqual(
    scanTestText(
      "src/lib/example.test.ts",
      [
        'test("delete", () => {});',
        'test("returns null when everything is deleted", () => {});',
      ].join("\n"),
    ).map((item) => item.match),
    ["delete"],
  );
});

test("test naming audit handles js-like files, property calls, and nonliteral titles", () => {
  assert.deepEqual(
    scanTestText(
      "scripts/example.test.mjs",
      [
        'test.only("save", () => {});',
        "test(dynamicTitle, () => {});",
        'it("ok", () => {});',
      ].join("\n"),
    ).map((item) => item.match),
    ["save", "ok"],
  );
  assert.deepEqual(
    scanTestText(
      "src/lib/example.test.jsx",
      'it("renders clearly", () => {});',
    ),
    [],
  );
  assert.deepEqual(
    scanTestText(
      "src/lib/example.test.tsx",
      "test();\ntest(`renders a descriptive template title`, () => {});",
    ),
    [],
  );
});

test("test coverage audit combines coverage and naming checks", () => {
  const audit = runTestCoverageAudit(["src/lib/unowned/example.test.ts"], {
    readText: () => 'test("works", () => {});',
  });

  assert.deepEqual(audit.unclassified, ["src/lib/unowned/example.test.ts"]);
  assert.equal(audit.weakTitleProblems[0].match, "works");
});

test("test naming audit reads supplied test file text", () => {
  const findings = findWeakTestTitleProblems(
    ["src/lib/auth/password.test.ts"],
    {
      readText: () => 'test("selection", () => {});',
    },
  );

  assert.equal(findings[0].rule, "weak-test-title");
});

test("test naming audit sorts weak titles by file before line number", () => {
  const findings = findWeakTestTitleProblems(
    ["src/lib/auth/z.test.ts", "src/lib/auth/a.test.ts"],
    {
      readText: () => 'test("works", () => {});',
    },
  );

  assert.deepEqual(
    findings.map((finding) => finding.filePath),
    ["src/lib/auth/a.test.ts", "src/lib/auth/z.test.ts"],
  );
});

test("test subsystem file lister finds unit, script, and e2e tests", () => {
  const root = fixtureRoot("test-subsystem-list-files");
  mkdirSync(join(root, "src", "lib", "auth"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "e2e", "presentation"), { recursive: true });
  mkdirSync(join(root, "e2e", "ui-matrix"), { recursive: true });
  mkdirSync(join(root, "node_modules", "ignored"), { recursive: true });
  writeFileSync(join(root, "src", "lib", "auth", "password.test.ts"), "");
  writeFileSync(join(root, "scripts", "collab-auth.test.mjs"), "");
  writeFileSync(
    join(root, "e2e", "presentation", "present-export.spec.ts"),
    "",
  );
  writeFileSync(join(root, "e2e", "ui-matrix", "catalog.spec.ts"), "");
  writeFileSync(join(root, "node_modules", "ignored", "fake.test.ts"), "");

  assert.deepEqual(listTestFiles(root), [
    "e2e/presentation/present-export.spec.ts",
    "e2e/ui-matrix/catalog.spec.ts",
    "scripts/collab-auth.test.mjs",
    "src/lib/auth/password.test.ts",
  ]);
});

test("test subsystem main handles help, list, check failure, and bad input", () => {
  const root = fixtureRoot("test-subsystem-main-controls");
  mkdirSync(join(root, "src", "lib", "unowned"), { recursive: true });
  writeFileSync(
    join(root, "src", "lib", "unowned", "example.test.ts"),
    'test("works", () => {});',
  );

  assert.equal(captureConsole(() => main(["--help"], root)).result, 0);
  assert.equal(captureConsole(() => main(["--list"], root)).result, 0);

  const check = captureConsole(() => main(["--check"], root));
  assert.equal(check.result, 1);
  assert.ok(
    check.errors.some((line) => line.includes("Unclassified test files")),
  );

  const badSubsystem = captureConsole(() => main(["not-a-subsystem"], root));
  assert.equal(badSubsystem.result, 1);
  assert.ok(
    badSubsystem.errors.some((line) => line.includes("Unknown subsystem")),
  );

  const noSubsystem = captureConsole(() => main([], root));
  assert.equal(noSubsystem.result, 1);
  assert.ok(
    noSubsystem.errors.some((line) => line.includes("Choose at least one")),
  );
});

test("test subsystem main prints all audit problem groups and success", () => {
  const badRoot = fixtureRoot("test-subsystem-main-audit-groups");
  mkdirSync(join(badRoot, "scripts"), { recursive: true });
  writeFileSync(
    join(badRoot, "scripts", "collab-auth.spec.mjs"),
    'import test from "node:test";\ntest("works", () => {});\n',
  );

  const audit = captureConsole(() => main(["--check"], badRoot));
  assert.equal(audit.result, 1);
  assert.ok(
    audit.errors.some((line) => line.includes("Unclear test file names")),
  );
  assert.ok(audit.errors.some((line) => line.includes("Weak test case names")));

  const currentRepo = captureConsole(() => main(["--check"], process.cwd()));
  assert.equal(currentRepo.result, 0);
  assert.ok(currentRepo.logs.some((line) => line.includes("audit passed")));
});

test("test subsystem main supports dry runs, skipped e2e notices, and empty selections", () => {
  const root = fixtureRoot("test-subsystem-main-dry-run");
  mkdirSync(join(root, "e2e", "presentation"), { recursive: true });
  writeFileSync(
    join(root, "e2e", "presentation", "present-export.spec.ts"),
    "",
  );

  const dryRun = captureConsole(() =>
    main(["presentation", "--dry-run"], root),
  );
  assert.equal(dryRun.result, 0);
  assert.ok(dryRun.logs.some((line) => line.includes("skipped")));
  assert.ok(
    dryRun.logs.some((line) =>
      line.includes("No unit/script commands selected"),
    ),
  );

  const e2eAlias = captureConsole(() =>
    main(["presentation", "--e2e", "--dry-run"], root),
  );
  assert.equal(e2eAlias.result, 0);
  assert.ok(e2eAlias.logs.some((line) => line.includes("playwright test")));

  const e2eLongOption = captureConsole(() =>
    main(["presentation", "--with-e2e", "--dry-run"], root),
  );
  assert.equal(e2eLongOption.result, 0);
  assert.ok(
    e2eLongOption.logs.some((line) => line.includes("playwright test")),
  );

  const noCommands = captureConsole(() => main(["presentation"], root));
  assert.equal(noCommands.result, 1);
  assert.ok(
    noCommands.errors.some((line) =>
      line.includes("No unit/script tests selected"),
    ),
  );

  const noFiles = captureConsole(() => main(["auth"], root));
  assert.equal(noFiles.result, 1);
  assert.ok(
    noFiles.errors.some((line) => line.includes("No test files matched")),
  );
});

test("test subsystem main runs selected script commands", () => {
  const root = fixtureRoot("test-subsystem-main-run-scripts");
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "scripts", "collab-auth.test.mjs"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'test("collaboration auth fixture passes", () => assert.equal(1, 1));',
    ].join("\n"),
  );

  const result = captureConsole(() => main(["collaboration"], root)).result;

  assert.equal(result, 0);
});

test("test subsystem main returns failing command status", () => {
  const root = fixtureRoot("test-subsystem-main-failing-script");
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "scripts", "collab-auth.test.mjs"),
    'import test from "node:test";\ntest("collaboration auth fixture fails", () => { throw new Error("nope"); });\n',
  );

  const originalPath = process.env.PATH;
  let result;
  try {
    process.env.PATH = "";
    result = captureConsole(() => main(["collaboration"], root)).result;
  } finally {
    process.env.PATH = originalPath;
  }

  assert.equal(result, 1);
});

test("test subsystem plan escapes bracket paths so node --test executes them", () => {
  const root = fixtureRoot("test-subsystem-bracket-escape");
  mkdirSync(join(root, "src", "app", "app", "documents", "[id]"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "src", "app", "app", "documents", "[id]", "actions.test.ts"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'test("bracket path action executes", () => assert.equal(1, 1));',
    ].join("\n"),
  );

  const plan = buildTestPlan({
    subsystems: ["editor"],
    testFiles: ["src/app/app/documents/[id]/actions.test.ts"],
  });

  // The raw path must be preserved in files for classification/reporting
  assert.ok(plan.files.includes("src/app/app/documents/[id]/actions.test.ts"));

  // The command args must escape brackets so node --test treats them literally
  const sourceCmd = plan.commands.find((c) => c.label === "source unit tests");
  assert.ok(sourceCmd, "source unit test command must exist");
  const testArg = sourceCmd.args.find((a) => a.includes("actions.test.ts"));
  assert.ok(testArg, "test file argument must exist");
  assert.ok(
    !testArg.includes("[id]"),
    "bracket segment must be escaped in command args",
  );
  assert.ok(
    testArg.includes("[[]id[]]"),
    "brackets must be escaped with bracket quoting",
  );

  // Subprocess proof: escaped arg must actually make node --test find the file
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST_")),
  );
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", testArg],
    { encoding: "utf8", cwd: root, env: cleanEnv },
  );

  assert.equal(
    result.status,
    0,
    `node --test with escaped path should succeed, got: ${result.stderr}`,
  );
  assert.match(
    result.stdout + result.stderr,
    /bracket path action executes/,
    "test case must actually run under escaped argument",
  );
});

test("test subsystem plan preserves raw paths for catch-all bracket forms", () => {
  const plan = buildTestPlan({
    subsystems: ["editor"],
    testFiles: [
      "src/app/app/documents/[id]/actions.test.ts",
      "src/app/app/documents/[...slug]/page.test.ts",
      "src/app/app/documents/[[...params]]/layout.test.ts",
    ],
  });

  // All raw paths preserved in plan.files
  assert.equal(plan.files.length, 3);
  assert.ok(plan.files.includes("src/app/app/documents/[id]/actions.test.ts"));
  assert.ok(
    plan.files.includes("src/app/app/documents/[...slug]/page.test.ts"),
  );
  assert.ok(
    plan.files.includes("src/app/app/documents/[[...params]]/layout.test.ts"),
  );

  // All args must be escaped using bracket quoting — no bare bracket segments
  const sourceCmd = plan.commands.find((c) => c.label === "source unit tests");
  for (const arg of sourceCmd.args.slice(3)) {
    // A bare bracket segment like [id] or [...slug] should not appear
    assert.ok(
      !/\[[^\[\]]*\]/.test(arg.replace(/\[[\[\]*?{}]\]/g, "")),
      `arg must escape brackets: ${arg}`,
    );
  }
});

test("test subsystem CLI supports help mode", () => {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "scripts", "test-subsystem.mjs"), "--help"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);

  const shortResult = spawnSync(
    process.execPath,
    [join(process.cwd(), "scripts", "test-subsystem.mjs"), "-h"],
    { encoding: "utf8" },
  );
  assert.equal(shortResult.status, 0);
  assert.match(shortResult.stdout, /Usage:/);
});
