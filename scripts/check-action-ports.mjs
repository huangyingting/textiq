#!/usr/bin/env node

import { dirname, join, normalize } from "node:path";
import process from "node:process";
import {
  lineAndColumn,
  makeShouldScanFile,
  scanRepositoryRoots,
  toPosix,
} from "./source-scan-utils.mjs";

const SCAN_ROOTS = ["src/components", "src/lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const IMPORT_RE =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const shouldScanFile = makeShouldScanFile({
  sourceExtensions: SOURCE_EXTENSIONS,
});

function resolveImport(filePath, specifier) {
  if (specifier.startsWith("@/")) {
    return `src/${specifier.slice(2)}`;
  }
  if (!specifier.startsWith(".")) {
    return specifier;
  }
  return toPosix(normalize(join(dirname(filePath), specifier)));
}

function isAppActionsImport(resolvedSpecifier) {
  if (!resolvedSpecifier.startsWith("src/app/")) {
    return false;
  }
  const basename = resolvedSpecifier.split("/").at(-1) ?? "";
  return basename.endsWith("actions");
}

function finding(filePath, index, text, rule, specifier) {
  const { lineNumber, columnNumber } = lineAndColumn(text, index);
  return { filePath, lineNumber, columnNumber, rule, specifier };
}

export function scanText(filePath, text) {
  const findings = [];
  const normalizedFile = toPosix(filePath);
  for (const match of text.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    const resolvedSpecifier = resolveImport(normalizedFile, specifier);
    if (
      normalizedFile.startsWith("src/components/") &&
      isAppActionsImport(resolvedSpecifier)
    ) {
      findings.push(
        finding(
          normalizedFile,
          match.index ?? 0,
          text,
          "component-app-actions-import",
          specifier,
        ),
      );
    }
    if (
      normalizedFile.startsWith("src/lib/") &&
      resolvedSpecifier.startsWith("src/app/")
    ) {
      findings.push(
        finding(
          normalizedFile,
          match.index ?? 0,
          text,
          "lib-app-import",
          specifier,
        ),
      );
    }
  }
  return findings;
}

export function scanActionPorts(repoRoot = process.cwd()) {
  return scanRepositoryRoots({
    repoRoot,
    roots: SCAN_ROOTS,
    sourceExtensions: SOURCE_EXTENSIONS,
    scanText,
    shouldScanFile,
  });
}

function main() {
  const findings = scanActionPorts();
  if (findings.length === 0) {
    console.log("Action-port import guard passed.");
    return;
  }

  console.error("Action-port import guard failed:");
  for (const item of findings) {
    const guidance =
      item.rule === "component-app-actions-import"
        ? "Shared src/components code must receive typed action ports from a route shell instead of importing src/app action modules."
        : "Shared src/lib code must stay independent of src/app route modules; move route-independent code into src/lib first.";
    console.error(
      `${item.filePath}:${item.lineNumber}:${item.columnNumber} ${item.rule} ${item.specifier} — ${guidance}`,
    );
  }
  console.error(
    "Allowed exception: small route-only client components may live under src/app and import sibling route actions directly.",
  );
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
