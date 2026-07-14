import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { scanDesignSystem, scanText } from "./check-design-system.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

test("design-system check: flags raw numeric z-index classes", () => {
  const findings = scanText(
    "src/components/example.tsx",
    '<div className="fixed z-50" />',
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "raw-z-index");
  assert.equal(findings[0].match, "z-50");
});

test("design-system check: accepts named semantic z-index utilities", () => {
  const findings = scanText(
    "src/components/example.tsx",
    '<div className="fixed z-toast" />',
  );

  assert.deepEqual(findings, []);
});

test("design-system check: flags raw arbitrary hex color classes", () => {
  const findings = scanText(
    "src/app/app/example.tsx",
    '<div className="bg-[#ffffff]" />',
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "raw-hex-class");
  assert.equal(findings[0].match, "bg-[#ffffff]");
});

test("design-system check: ignores token-owned UI primitive hex values", () => {
  const findings = scanText(
    "src/components/ui/color-picker.tsx",
    'const white = "#ffffff";',
  );

  assert.deepEqual(findings, []);
});

test("design-system check: flags raw arbitrary radius classes outside token layers", () => {
  const findings = scanText(
    "src/app/app/example.tsx",
    '<div className="rounded-[4px]" />',
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "raw-radius-class");
  assert.equal(findings[0].match, "rounded-[4px]");
});

test("design-system check: accepts DS token radius classes", () => {
  const findings = scanText(
    "src/app/app/example.tsx",
    '<div className="rounded-[var(--ds-radius-sm,8px)]" />',
  );

  assert.deepEqual(findings, []);
});

test("design-system check: flags raw arbitrary shadow classes outside token layers", () => {
  const findings = scanText(
    "src/app/app/example.tsx",
    '<div className="shadow-[0_4px_12px_rgba(0,0,0,0.2)]" />',
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "raw-shadow-class");
  assert.equal(findings[0].match, "shadow-[0_4px_12px_rgba(0,0,0,0.2)]");
});

test("design-system check: flags non-DS neutral utility classes", () => {
  const findings = scanText(
    "src/components/example.tsx",
    '<div className="bg-zinc-100 text-gray-900" />',
  );

  assert.equal(findings.length, 2);
  assert.equal(findings[0].rule, "non-ds-neutral-class");
  assert.equal(findings[1].match, "text-gray-900");
});

test("design-system check: skips token-owned chrome files but still scans z-index", () => {
  assert.deepEqual(
    scanText(
      "src/app/globals.css",
      ".x { @apply bg-[#fff] rounded-[4px] shadow-[0_0_1px_black] z-50; }",
    ),
    [
      {
        filePath: "src/app/globals.css",
        lineNumber: 1,
        columnNumber: 60,
        rule: "raw-z-index",
        match: "z-50",
      },
    ],
  );
  assert.deepEqual(
    scanText(
      "src/components/ui/button.tsx",
      '<button className="bg-[#fff] rounded-[4px] shadow-[0_0_1px_black]" />',
    ),
    [],
  );
});

test("design-system check: scans repository roots and skips unsupported files", (t) => {
  const repoRoot = createTestFixtureRoot("design-system-scan-test", t);
  mkdirSync(join(repoRoot, "src", "app", "nested"), { recursive: true });
  mkdirSync(join(repoRoot, "src", "app", ".next"), { recursive: true });
  mkdirSync(join(repoRoot, "src", "components"), { recursive: true });
  mkdirSync(join(repoRoot, "src", "components", "node_modules", "package"), {
    recursive: true,
  });
  writeFileSync(
    join(repoRoot, "src", "app", "nested", "bad.tsx"),
    '<div className="z-50 bg-[#abcdef]" />\n',
  );
  writeFileSync(
    join(repoRoot, "src", "components", "bad.css"),
    ".x { @apply rounded-[2px]; }\n",
  );
  writeFileSync(
    join(repoRoot, "src", "components", "notes.md"),
    '<div className="z-50" />\n',
  );
  writeFileSync(
    join(repoRoot, "src", "app", ".next", "ignored.tsx"),
    '<div className="z-50" />\n',
  );
  writeFileSync(
    join(
      repoRoot,
      "src",
      "components",
      "node_modules",
      "package",
      "ignored.tsx",
    ),
    '<div className="z-50" />\n',
  );

  const findings = scanDesignSystem(repoRoot);

  assert.deepEqual(
    findings.map((finding) => finding.rule),
    ["raw-z-index", "raw-hex-class", "raw-radius-class"],
  );
});

test("design-system check: table-driven source filter keeps scan coverage", (t) => {
  const repoRoot = createTestFixtureRoot("design-system-filter-table", t);
  const cases = [
    { path: ["src", "app", "included.tsx"], shouldReport: true },
    { path: ["src", "components", "included.js"], shouldReport: true },
    { path: ["src", "components", "notes.md"], shouldReport: false },
    { path: ["src", "app", ".next", "ignored.tsx"], shouldReport: false },
    {
      path: ["src", "components", "node_modules", "pkg", "ignored.tsx"],
      shouldReport: false,
    },
  ];

  for (const item of cases) {
    mkdirSync(join(repoRoot, ...item.path.slice(0, -1)), { recursive: true });
    writeFileSync(
      join(repoRoot, ...item.path),
      '<div className="z-50 bg-[#fff]" />\n',
    );
  }

  const reportedFiles = scanDesignSystem(repoRoot)
    .map((finding) => finding.filePath)
    .sort();
  const expectedFiles = cases
    .filter((item) => item.shouldReport)
    .map((item) => item.path.join("/"))
    .sort();

  assert.deepEqual([...new Set(reportedFiles)], expectedFiles);
});

test("design-system CLI reports pass and failure results", (t) => {
  const scriptPath = join(process.cwd(), "scripts", "check-design-system.mjs");
  const passRoot = createTestFixtureRoot("design-system-cli-pass", t);
  const failRoot = createTestFixtureRoot("design-system-cli-fail", t);
  mkdirSync(join(passRoot, "src", "app"), { recursive: true });
  mkdirSync(join(failRoot, "src", "app"), { recursive: true });
  writeFileSync(
    join(passRoot, "src", "app", "ok.tsx"),
    '<div className="z-modal bg-surface" />\n',
  );
  writeFileSync(
    join(failRoot, "src", "app", "bad.tsx"),
    '<div className="z-50 shadow-[0_0_1px_black]" />\n',
  );

  const passed = spawnSync(process.execPath, [scriptPath], {
    cwd: passRoot,
    encoding: "utf8",
  });
  assert.equal(passed.status, 0);
  assert.match(passed.stdout, /passed/);

  const failed = spawnSync(process.execPath, [scriptPath], {
    cwd: failRoot,
    encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /raw-z-index/);
  assert.match(failed.stderr, /raw-shadow-class/);
});
