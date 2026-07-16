import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  makeShouldScanFile,
  scanRepositoryRoots,
  shouldScanSourceFile,
} from "./source-scan-utils.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

test("makeShouldScanFile keeps base inclusion/exclusion parity with shouldScanSourceFile", () => {
  const shouldScanFile = makeShouldScanFile({
    sourceExtensions: SOURCE_EXTENSIONS,
  });
  const cases = [
    ["src/app/page.tsx", true],
    ["src/components/button.jsx", true],
    ["src/lib/runtime.mjs", true],
    ["src/components/notes.md", false],
    ["src/components/node_modules/pkg/ignored.ts", false],
    ["src/components/.next/ignored.tsx", false],
  ];

  for (const [filePath, expected] of cases) {
    assert.equal(
      shouldScanFile(filePath),
      expected,
      `expected makeShouldScanFile(${filePath}) to equal ${expected}`,
    );
    assert.equal(
      shouldScanFile(filePath),
      shouldScanSourceFile(filePath, SOURCE_EXTENSIONS),
      `expected parity with shouldScanSourceFile for ${filePath}`,
    );
  }
});

test("makeShouldScanFile honors concern-specific path and prefix exclusions", () => {
  const shouldScanFile = makeShouldScanFile({
    sourceExtensions: SOURCE_EXTENSIONS,
    excludedPaths: ["src/app/globals.css", "src/app/internal.ts"],
    excludedPrefixes: ["src/components/ui/"],
  });

  assert.equal(shouldScanFile("src/app/internal.ts"), false);
  assert.equal(shouldScanFile("src/components/ui/button.tsx"), false);
  assert.equal(shouldScanFile("src/components/shell.tsx"), true);
  assert.equal(
    shouldScanFile("src/components/node_modules/pkg/file.ts"),
    false,
  );
});

test("scanRepositoryRoots applies extracted file-filter helper without shrinking coverage", (t) => {
  const repoRoot = createTestFixtureRoot("source-scan-utils-filter", t);
  mkdirSync(join(repoRoot, "src", "app"), { recursive: true });
  mkdirSync(join(repoRoot, "src", "components", "ui"), { recursive: true });
  mkdirSync(join(repoRoot, "src", "components", "node_modules", "pkg"), {
    recursive: true,
  });

  writeFileSync(
    join(repoRoot, "src", "app", "page.tsx"),
    "export default null;\n",
  );
  writeFileSync(
    join(repoRoot, "src", "app", "internal.ts"),
    "export const internal = true;\n",
  );
  writeFileSync(
    join(repoRoot, "src", "components", "ui", "button.tsx"),
    "export const Button = () => null;\n",
  );
  writeFileSync(
    join(repoRoot, "src", "components", "shell.tsx"),
    "export const Shell = () => null;\n",
  );
  writeFileSync(
    join(repoRoot, "src", "components", "node_modules", "pkg", "ignored.tsx"),
    "export const Ignored = () => null;\n",
  );

  const shouldScanFile = makeShouldScanFile({
    sourceExtensions: SOURCE_EXTENSIONS,
    excludedPaths: ["src/app/internal.ts"],
    excludedPrefixes: ["src/components/ui/"],
  });

  const findings = scanRepositoryRoots({
    repoRoot,
    roots: ["src/app", "src/components"],
    sourceExtensions: SOURCE_EXTENSIONS,
    shouldScanFile,
    scanText: (filePath) => [filePath],
  }).sort();

  assert.deepEqual(findings, ["src/app/page.tsx", "src/components/shell.tsx"]);
});
