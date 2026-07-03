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
  "e2e/present-export.spec.ts",
  "scripts/collab-auth.test.mjs",
  "scripts/check-docs-links.test.mjs",
  "src/app/api/collab/authorize/parser.test.ts",
  "src/lib/auth/password.test.ts",
  "src/lib/collab/room-access.test.ts",
  "src/lib/presentation/validation.test.ts",
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
  assert.ok(
    classifyTestFile("e2e/present-export.spec.ts").includes("presentation"),
  );
  assert.deepEqual(
    classifyTestFile("e2e/ui-matrix/document-editor-ui.spec.ts"),
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

  assert.deepEqual(withoutE2e.skippedE2e, ["e2e/present-export.spec.ts"]);
  assert.deepEqual(withE2e.commands.at(-1), {
    label: "e2e tests",
    command: "npx",
    args: ["playwright", "test", "e2e/present-export.spec.ts"],
  });
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
  mkdirSync(join(root, "e2e"), { recursive: true });
  mkdirSync(join(root, "e2e", "ui-matrix"), { recursive: true });
  mkdirSync(join(root, "node_modules", "ignored"), { recursive: true });
  writeFileSync(join(root, "src", "lib", "auth", "password.test.ts"), "");
  writeFileSync(join(root, "scripts", "collab-auth.test.mjs"), "");
  writeFileSync(join(root, "e2e", "present-export.spec.ts"), "");
  writeFileSync(join(root, "e2e", "ui-matrix", "catalog.spec.ts"), "");
  writeFileSync(join(root, "node_modules", "ignored", "fake.test.ts"), "");

  assert.deepEqual(listTestFiles(root), [
    "e2e/present-export.spec.ts",
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
  mkdirSync(join(root, "e2e"), { recursive: true });
  writeFileSync(join(root, "e2e", "present-export.spec.ts"), "");

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

test("test subsystem CLI supports help mode", () => {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "scripts", "test-subsystem.mjs"), "--help"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});
