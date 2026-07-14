import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { scanActionPorts, scanText } from "./check-action-ports.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

test("action-port check: flags shared component imports from app actions", () => {
  const findings = scanText(
    "src/components/editor/example.tsx",
    'import { saveDeckJson } from "@/app/app/documents/[id]/actions";',
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "component-app-actions-import");
});

test("action-port check: flags shared component imports from app dash actions", () => {
  const findings = scanText(
    "src/components/dashboard/example.tsx",
    'import { toggleFavorite } from "@/app/app/actions";',
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "component-app-actions-import");
});

test("action-port check: accepts component imports from stable port modules", () => {
  const findings = scanText(
    "src/components/editor/example.tsx",
    'import type { DeckActionPort } from "@/lib/action-ports";',
  );

  assert.deepEqual(findings, []);
});

test("action-port check: accepts package imports in shared components", () => {
  assert.deepEqual(
    scanText("src/components/example.tsx", 'import React from "react";'),
    [],
  );
});

test("action-port check: flags shared lib imports from app route modules", () => {
  const findings = scanText(
    "src/lib/example.ts",
    'import { VisualNode } from "@/app/app/documents/[id]/visual-node";',
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "lib-app-import");
});

test("action-port check: allows route-only app components to import sibling actions", () => {
  const findings = scanText(
    "src/app/app/document-card.tsx",
    'import { renameDocument } from "./actions";',
  );

  assert.deepEqual(findings, []);
});

test("action-port check: scans repository roots and skips unsupported files", (t) => {
  const repoRoot = createTestFixtureRoot("action-port-scan-test", t);
  mkdirSync(join(repoRoot, "src", "components", "nested"), { recursive: true });
  mkdirSync(join(repoRoot, "src", "lib"), { recursive: true });
  writeFileSync(
    join(repoRoot, "src", "components", "nested", "bad.tsx"),
    'export { save } from "@/app/app/actions";\n',
  );
  writeFileSync(
    join(repoRoot, "src", "lib", "bad.js"),
    'const route = import("@/app/app/documents/view");\n',
  );
  writeFileSync(
    join(repoRoot, "src", "components", "notes.txt"),
    'import { save } from "@/app/app/actions";\n',
  );

  const findings = scanActionPorts(repoRoot);

  assert.deepEqual(
    findings.map((finding) => finding.rule),
    ["component-app-actions-import", "lib-app-import"],
  );
});

test("action-port check: table-driven source filter keeps scan coverage", (t) => {
  const repoRoot = createTestFixtureRoot("action-port-filter-table", t);
  const cases = [
    {
      path: ["src", "components", "included.tsx"],
      text: 'import { save } from "@/app/app/actions";\n',
      shouldReport: true,
    },
    {
      path: ["src", "lib", "included.mjs"],
      text: 'const route = import("@/app/app/documents/view");\n',
      shouldReport: true,
    },
    {
      path: ["src", "components", "notes.txt"],
      text: 'import { save } from "@/app/app/actions";\n',
      shouldReport: false,
    },
    {
      path: ["src", "components", ".next", "ignored.tsx"],
      text: 'import { save } from "@/app/app/actions";\n',
      shouldReport: false,
    },
    {
      path: ["src", "lib", "node_modules", "pkg", "ignored.ts"],
      text: 'const route = import("@/app/app/documents/view");\n',
      shouldReport: false,
    },
  ];

  for (const item of cases) {
    mkdirSync(join(repoRoot, ...item.path.slice(0, -1)), { recursive: true });
    writeFileSync(join(repoRoot, ...item.path), item.text);
  }

  const reportedFiles = scanActionPorts(repoRoot)
    .map((finding) => finding.filePath)
    .sort();
  const expectedFiles = cases
    .filter((item) => item.shouldReport)
    .map((item) => item.path.join("/"))
    .sort();

  assert.deepEqual([...new Set(reportedFiles)], expectedFiles);
});

test("action-port CLI reports pass and failure results", (t) => {
  const scriptPath = join(process.cwd(), "scripts", "check-action-ports.mjs");
  const passRoot = createTestFixtureRoot("action-port-cli-pass", t);
  const failRoot = createTestFixtureRoot("action-port-cli-fail", t);
  mkdirSync(join(passRoot, "src", "components"), { recursive: true });
  mkdirSync(join(failRoot, "src", "components"), { recursive: true });
  writeFileSync(
    join(passRoot, "src", "components", "ok.ts"),
    'import { port } from "@/lib/action-ports";\n',
  );
  writeFileSync(
    join(failRoot, "src", "components", "bad.ts"),
    'import { save } from "@/app/app/actions";\n',
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
  assert.match(failed.stderr, /component-app-actions-import/);
  assert.match(failed.stderr, /Allowed exception/);
});
