import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

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

export function shouldScanSourceFile(filePath, sourceExtensions) {
  const normalized = toPosix(filePath);
  if (!sourceExtensions.has(extensionOf(normalized))) {
    return false;
  }
  return (
    !normalized.includes("/node_modules/") && !normalized.includes("/.next/")
  );
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
  shouldScanFile = (filePath) =>
    shouldScanSourceFile(filePath, sourceExtensions),
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
