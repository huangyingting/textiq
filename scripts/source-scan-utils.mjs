import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Escape glob metacharacters in a literal file path so that Node's --test
 * runner (and other glob-based consumers) treat it as a literal match.
 * Handles Next.js dynamic segments ([id], [...slug], [[...params]]) and
 * standard glob metacharacters (*, ?, {, }).
 *
 * Node's glob implementation uses bracket-quoting (e.g. [[] for literal [)
 * rather than backslash escaping.
 */
export function escapeTestPattern(filePath) {
  return filePath.replace(/[[\]*?{}]/g, (ch) => `[${ch}]`);
}

export function extensionOf(filePath) {
  const index = filePath.lastIndexOf(".");
  return index === -1 ? "" : filePath.slice(index);
}

export function toPosix(path) {
  return path.split(sep).join("/");
}

export function lineAndColumn(text, index) {
  const before = text.slice(0, index);
  const lines = before.split(/\r?\n/);
  return {
    lineNumber: lines.length,
    columnNumber: lines[lines.length - 1].length + 1,
  };
}

function isBaseSourceFile(filePath, sourceExtensions) {
  if (!sourceExtensions.has(extensionOf(filePath))) {
    return false;
  }
  return !filePath.includes("/node_modules/") && !filePath.includes("/.next/");
}

function toPathSet(paths) {
  return new Set(paths.map((item) => toPosix(item)));
}

function toPrefixList(paths) {
  return paths.map((item) => toPosix(item));
}

export function shouldScanSourceFile(filePath, sourceExtensions) {
  const normalized = toPosix(filePath);
  return isBaseSourceFile(normalized, sourceExtensions);
}

export function makeShouldScanFile({
  sourceExtensions,
  excludedPaths = [],
  excludedPrefixes = [],
} = {}) {
  const pathExclusions = toPathSet(excludedPaths);
  const prefixExclusions = toPrefixList(excludedPrefixes);

  return (filePath) => {
    const normalized = toPosix(filePath);
    if (!isBaseSourceFile(normalized, sourceExtensions)) {
      return false;
    }
    if (pathExclusions.has(normalized)) {
      return false;
    }
    return !prefixExclusions.some((prefix) => normalized.startsWith(prefix));
  };
}

function walkFiles(root, skipDirectoryNames) {
  const files = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (skipDirectoryNames.has(entry.name)) {
        continue;
      }
      files.push(...walkFiles(fullPath, skipDirectoryNames));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export function scanRepositoryRoots({
  repoRoot,
  roots,
  sourceExtensions,
  scanText,
  shouldScanFile = makeShouldScanFile({ sourceExtensions }),
  skipDirectoryNames = new Set(["node_modules", ".next"]),
}) {
  const findings = [];
  for (const root of roots) {
    const absoluteRoot = join(repoRoot, root);
    if (!statSync(absoluteRoot, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }

    for (const absolutePath of walkFiles(absoluteRoot, skipDirectoryNames)) {
      const filePath = toPosix(relative(repoRoot, absolutePath));
      if (!shouldScanFile(filePath)) {
        continue;
      }
      findings.push(...scanText(filePath, readFileSync(absolutePath, "utf8")));
    }
  }
  return findings;
}
