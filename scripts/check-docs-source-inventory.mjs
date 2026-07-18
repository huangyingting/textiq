#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import process from "node:process";
import { toPosix } from "./source-scan-utils.mjs";

const SOURCE_ROOTS = ["src", "scripts", "prisma", "e2e"];
const SOURCE_FILES = ["server.mjs", "playwright.config.mts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs", ".js"]);
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "coverage",
  "src/generated",
]);

function walkFiles(root) {
  const files = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    const normalized = toPosix(fullPath);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(normalized) && !IGNORED_DIRS.has(entry.name)) {
        files.push(...walkFiles(fullPath));
      }
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function shouldScanSourceFile(filePath) {
  const normalized = toPosix(filePath);
  if (!SOURCE_EXTENSIONS.has(extname(normalized))) {
    return false;
  }
  if (/\.(test)\.(?:ts|tsx|mts|mjs|js)$/.test(normalized)) {
    return false;
  }
  return ![...IGNORED_DIRS].some(
    (ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`),
  );
}

function addEnvRead(reads, name, filePath, index, text) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    return;
  }
  const lineNumber = text.slice(0, index).split(/\r?\n/).length;
  const locations = reads.get(name) ?? [];
  locations.push(`${filePath}:${lineNumber}`);
  reads.set(name, locations);
}

export function scanEnvReadsInText(filePath, text) {
  const reads = new Map();
  const source = stripComments(text);
  const constants = new Map();

  for (const match of source.matchAll(
    /(?:const|export\s+const)\s+([A-Z][A-Z0-9_]*)\s*=\s*["']([A-Z][A-Z0-9_]*)["']/g,
  )) {
    constants.set(match[1], match[2]);
  }

  const literalPatterns = [
    /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g,
    /\bprocess\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
    /(?<!process\.)\benv\.([A-Z][A-Z0-9_]*)/g,
    /\b(?:readOptional|readRequired|readPositiveIntEnv)\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
    /\b(?:limitEnv|windowEnv):\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
    /\benvKey:\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  ];

  for (const pattern of literalPatterns) {
    for (const match of source.matchAll(pattern)) {
      addEnvRead(reads, match[1], filePath, match.index ?? 0, source);
    }
  }

  for (const match of source.matchAll(
    /(?<!process\.)\benv\[\s*([A-Z][A-Z0-9_]*)\s*\]/g,
  )) {
    const value = constants.get(match[1]);
    if (value) {
      addEnvRead(reads, value, filePath, match.index ?? 0, source);
    }
  }

  return reads;
}

export function scanEnvReads(repoRoot = process.cwd()) {
  const files = [];
  for (const root of SOURCE_ROOTS) {
    const absoluteRoot = join(repoRoot, root);
    if (statSync(absoluteRoot, { throwIfNoEntry: false })?.isDirectory()) {
      files.push(...walkFiles(absoluteRoot));
    }
  }
  for (const file of SOURCE_FILES) {
    const absolutePath = join(repoRoot, file);
    if (statSync(absolutePath, { throwIfNoEntry: false })?.isFile()) {
      files.push(absolutePath);
    }
  }

  const reads = new Map();
  for (const absolutePath of files) {
    const filePath = toPosix(relative(repoRoot, absolutePath));
    if (!shouldScanSourceFile(filePath)) {
      continue;
    }
    const fileReads = scanEnvReadsInText(
      filePath,
      readFileSync(absolutePath, "utf8"),
    );
    for (const [name, locations] of fileReads) {
      const existing = reads.get(name) ?? [];
      existing.push(...locations);
      reads.set(name, existing);
    }
  }
  return reads;
}

export function parseRuntimeConfigNames(markdown) {
  const names = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.trim().match(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/);
    if (match) {
      names.push(match[1]);
    }
  }
  return names;
}

export function collectApiRouteKeys(repoRoot = process.cwd()) {
  const apiRoot = join(repoRoot, "src", "app", "api");
  if (!existsSync(apiRoot)) {
    return [];
  }
  return walkFiles(apiRoot)
    .filter((file) => file.endsWith(`${sep}route.ts`))
    .map((file) =>
      toPosix(relative(apiRoot, file))
        .replace(/\/route\.ts$/, "")
        .replace(/^route\.ts$/, ""),
    )
    .sort();
}

export function parseRouteMatrixKeys(markdown) {
  const keys = [];
  let inMatrix = false;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      inMatrix = trimmed === "## Matrix";
      continue;
    }
    if (!inMatrix || !trimmed.startsWith("|")) {
      continue;
    }
    const firstCell = trimmed.split("|")[1]?.trim() ?? "";
    const match = firstCell.match(/^`([^`]+)`$/);
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys.sort();
}

function compareSets(actual, documented) {
  const documentedSet = new Set(documented);
  const actualSet = new Set(actual);
  return {
    missing: actual.filter((item) => !documentedSet.has(item)),
    stale: documented.filter((item) => !actualSet.has(item)),
  };
}

export function checkEnvInventory(repoRoot = process.cwd()) {
  const runtimeDoc = readFileSync(
    join(repoRoot, "docs", "operations", "runtime-config.md"),
    "utf8",
  );
  const reads = scanEnvReads(repoRoot);
  const actual = [...reads.keys()].sort();
  const documented = parseRuntimeConfigNames(runtimeDoc).sort();
  return { ...compareSets(actual, documented), reads };
}

export function checkRouteInventory(repoRoot = process.cwd()) {
  const matrixDoc = readFileSync(
    join(repoRoot, "docs", "security", "api-route-security-matrix.md"),
    "utf8",
  );
  return compareSets(
    collectApiRouteKeys(repoRoot),
    parseRouteMatrixKeys(matrixDoc),
  );
}

function printList(title, items, describe) {
  if (items.length === 0) {
    return;
  }
  console.error(title);
  for (const item of items) {
    console.error(`  - ${item}${describe ? ` (${describe(item)})` : ""}`);
  }
}

function main() {
  const env = checkEnvInventory();
  const routes = checkRouteInventory();
  let failed = false;

  if (env.missing.length > 0 || env.stale.length > 0) {
    failed = true;
    console.error("Runtime config inventory drift detected.");
    printList(
      "Env reads missing from docs/operations/runtime-config.md:",
      env.missing,
      (name) => (env.reads.get(name) ?? []).slice(0, 4).join(", "),
    );
    printList(
      "Env rows that no source file reads:",
      env.stale,
      () => "remove the row or update the source scanner scope if intentional",
    );
  }

  if (routes.missing.length > 0 || routes.stale.length > 0) {
    failed = true;
    console.error("API route security matrix drift detected.");
    printList(
      "Routes missing from docs/security/api-route-security-matrix.md:",
      routes.missing,
      () => "add a matrix row with classification, denial behavior, and owner",
    );
    printList(
      "Matrix rows whose route.ts no longer exists:",
      routes.stale,
      () => "remove or rename the stale row",
    );
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log("Docs source inventory checks passed.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
