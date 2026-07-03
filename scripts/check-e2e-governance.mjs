#!/usr/bin/env node

import process from "node:process";
import {
  lineAndColumn,
  scanRepositoryRoots,
  toPosix,
} from "./source-scan-utils.mjs";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const TEST_SIZE_LIMIT = 1_500;
const OVERSIZED_TEST_ALLOWLIST = new Set([
  // deck-schema.test.ts was split into focused per-concern files (#1147)
]);
const FIXTURE_FACTORY_FILES = new Set([
  "e2e/screenshot-regression.spec.ts",
  "e2e/helpers/screenshot-fixtures.ts",
]);
const RULES = [
  { rule: "test-only", pattern: /\btest\.only\s*\(/g },
  { rule: "test-skip", pattern: /\btest\.skip\s*\(/g },
  { rule: "wait-for-timeout", pattern: /\bwaitForTimeout\s*\(/g },
  {
    rule: "nondeterministic-id",
    pattern:
      /\b(?:Date\.now|Math\.random|randomUUID|crypto\.randomUUID|nanoid)\s*\(/g,
  },
  {
    rule: "broad-catch",
    pattern:
      /\.catch\s*\(\s*(?:\(\s*\)|[a-zA-Z_$][\w$]*)\s*=>\s*(?:\{\s*\}|null|false)\s*\)/g,
  },
  { rule: "broad-catch", pattern: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g },
];
const FACTORY_PATTERN =
  /\b(?:function|const)\s+(makeDeck|makeSlide|textEl|shapeEl)\b/g;
const ALLOW_MARKER = "e2e-governance-allow";

function hasAllowComment(lines, lineNumber, rule) {
  const window = lines.slice(Math.max(0, lineNumber - 3), lineNumber);
  return window.some(
    (line) => line.includes(ALLOW_MARKER) && line.includes(rule),
  );
}

function hasFileAllowComment(lines, rule) {
  return lines.some(
    (line) => line.includes(ALLOW_MARKER) && line.includes(rule),
  );
}

function isApprovedFinding(filePath, lines, item) {
  if (hasAllowComment(lines, item.lineNumber, item.rule)) {
    return true;
  }
  if (item.rule === "test-skip") {
    const callWindow = lines
      .slice(item.lineNumber - 1, Math.min(lines.length, item.lineNumber + 4))
      .join("\n");
    if (/Set E2E_|E2E_PROFILE|E2E_SCREENSHOT_REGRESSION/.test(callWindow)) {
      return true;
    }
  }
  return false;
}

function finding(filePath, text, index, rule, match) {
  const { lineNumber, columnNumber } = lineAndColumn(text, index);
  return { filePath, lineNumber, columnNumber, rule, match };
}

export function scanText(filePath, text) {
  const findings = [];
  const normalized = toPosix(filePath);
  const lines = text.split(/\r?\n/);

  if (normalized.startsWith("e2e/")) {
    for (const { rule, pattern } of RULES) {
      for (const match of text.matchAll(pattern)) {
        const item = finding(
          normalized,
          text,
          match.index ?? 0,
          rule,
          match[0],
        );
        if (!isApprovedFinding(normalized, lines, item)) {
          findings.push(item);
        }
      }
    }
  }

  if (FIXTURE_FACTORY_FILES.has(normalized)) {
    for (const match of text.matchAll(FACTORY_PATTERN)) {
      const item = finding(
        normalized,
        text,
        match.index ?? 0,
        "local-fixture-factory",
        match[0],
      );
      if (!isApprovedFinding(normalized, lines, item)) {
        findings.push(item);
      }
    }
  }

  if (
    (normalized.endsWith(".test.ts") || normalized.endsWith(".spec.ts")) &&
    !OVERSIZED_TEST_ALLOWLIST.has(normalized)
  ) {
    const lineCount = lines.length;
    if (
      lineCount > TEST_SIZE_LIMIT &&
      !hasFileAllowComment(lines, "oversized-test")
    ) {
      findings.push({
        filePath: normalized,
        lineNumber: TEST_SIZE_LIMIT + 1,
        columnNumber: 1,
        rule: "oversized-test",
        match: `${lineCount} lines`,
      });
    }
  }

  return findings;
}

export function scanGovernance(repoRoot = process.cwd()) {
  return scanRepositoryRoots({
    repoRoot,
    roots: ["e2e", "src", "scripts"],
    sourceExtensions: SOURCE_EXTENSIONS,
    scanText,
  });
}

function main() {
  const findings = scanGovernance();
  if (findings.length === 0) {
    console.log("E2E governance guard passed.");
    return;
  }

  console.error("E2E governance guard failed:");
  for (const item of findings) {
    console.error(
      `${item.filePath}:${item.lineNumber}:${item.columnNumber} ${item.rule} ${item.match} — use shared builders/readiness helpers or add an ${ALLOW_MARKER} comment with a reason.`,
    );
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
