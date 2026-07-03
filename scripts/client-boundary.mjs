import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { toPosix } from "./source-scan-utils.mjs";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];
const SOURCE_ROOTS = ["src"];

const CLIENT_DIRECTIVE = "use client";
const SERVER_DIRECTIVE = "use server";

const SERVER_ONLY_PACKAGES = new Set([
  "@prisma/client",
  "@prisma/adapter-better-sqlite3",
  "@prisma/adapter-pg",
  "better-sqlite3",
  "mammoth",
  "pdf-parse",
  "pg",
  "server-only",
  "stripe",
]);

const LAZY_ONLY_PACKAGES = new Set(["jspdf", "jszip", "pptxgenjs"]);

const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dns",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "readline",
  "stream",
  "string_decoder",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

function normalizeRelative(rootDir, filePath) {
  return toPosix(path.relative(rootDir, filePath));
}

function sourceKindFor(fileName) {
  if (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) {
    return ts.ScriptKind.TSX;
  }
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function isSourceFile(filePath) {
  const relative = toPosix(filePath);
  if (relative.includes("/src/generated/")) return false;
  if (relative.includes("/node_modules/") || relative.includes("/.next/")) {
    return false;
  }
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(relative)) return false;
  return SOURCE_EXTENSIONS.some((extension) => relative.endsWith(extension));
}

function walkSourceFiles(rootDir, dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        fullPath === path.join(rootDir, "src", "generated")
      ) {
        continue;
      }
      files.push(...walkSourceFiles(rootDir, fullPath));
    } else if (entry.isFile() && isSourceFile(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function namedBindingsAreTypeOnly(namedBindings) {
  if (!namedBindings) return false;
  if (ts.isNamespaceImport(namedBindings)) return false;
  return namedBindings.elements.every((element) => element.isTypeOnly);
}

function importDeclarationIsTypeOnly(statement) {
  const clause = statement.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  return namedBindingsAreTypeOnly(clause.namedBindings);
}

function exportDeclarationIsTypeOnly(statement) {
  return Boolean(statement.isTypeOnly);
}

function lineFor(source, node) {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return line + 1;
}

function directiveForSource(source) {
  for (const statement of source.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    ) {
      if (
        statement.expression.text === CLIENT_DIRECTIVE ||
        statement.expression.text === SERVER_DIRECTIVE
      ) {
        return statement.expression.text;
      }
      continue;
    }
    return null;
  }
  return null;
}

export function collectClientBoundaryImports(
  sourceText,
  fileName = "source.ts",
) {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourceKindFor(fileName),
  );
  const imports = [];

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push({
        kind: "import",
        specifier: statement.moduleSpecifier.text,
        typeOnly: importDeclarationIsTypeOnly(statement),
        line: lineFor(source, statement),
      });
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push({
        kind: "export",
        specifier: statement.moduleSpecifier.text,
        typeOnly: exportDeclarationIsTypeOnly(statement),
        line: lineFor(source, statement),
      });
    }
  }

  return {
    isClientEntry: directiveForSource(source) === CLIENT_DIRECTIVE,
    isServerEntry: directiveForSource(source) === SERVER_DIRECTIVE,
    imports,
  };
}

function candidatePaths(basePath) {
  const candidates = [];
  if (SOURCE_EXTENSIONS.includes(path.extname(basePath))) {
    candidates.push(basePath);
  } else {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(`${basePath}${extension}`);
    }
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(path.join(basePath, `index${extension}`));
    }
  }
  return candidates;
}

export function resolveLocalImport(
  rootDir,
  importerFile,
  specifier,
  existingFiles,
) {
  let basePath;
  if (specifier.startsWith("@/")) {
    basePath = path.join(rootDir, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    basePath = path.resolve(path.dirname(importerFile), specifier);
  } else {
    return null;
  }

  for (const candidate of candidatePaths(basePath)) {
    const resolved = path.resolve(candidate);
    if (existingFiles?.has(resolved)) return resolved;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }
  return null;
}

function packageNameForSpecifier(specifier) {
  if (specifier.startsWith("node:")) return "node:";
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

function violationForSpecifier(specifier) {
  if (specifier.startsWith("node:")) {
    return "Node built-in modules are server-only; keep them out of client bundles.";
  }
  const packageName = packageNameForSpecifier(specifier);
  if (NODE_BUILTINS.has(packageName)) {
    return "Node built-in modules are server-only; keep them out of client bundles.";
  }
  if (SERVER_ONLY_PACKAGES.has(packageName)) {
    return `${packageName} is server-only and must not be statically imported by a client bundle.`;
  }
  if (LAZY_ONLY_PACKAGES.has(packageName)) {
    return `${packageName} is export-heavy; lazy-load it inside the export action instead of statically importing it.`;
  }
  return null;
}

export function evaluateClientBoundary({ rootDir, sourceFiles, fileContents }) {
  const absoluteFiles = sourceFiles.map((file) => path.resolve(file));
  const sourceFileSet = new Set(absoluteFiles);
  const parsedByFile = new Map();
  const clientRoots = [];

  for (const file of absoluteFiles) {
    const sourceText =
      fileContents?.get(file) ??
      fileContents?.get(normalizeRelative(rootDir, file)) ??
      fs.readFileSync(file, "utf8");
    const parsed = collectClientBoundaryImports(sourceText, file);
    parsedByFile.set(file, parsed);
    if (parsed.isClientEntry) clientRoots.push(file);
  }

  const queue = clientRoots.map((file) => ({ file, chain: [file] }));
  const visited = new Set();
  const findings = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.file)) continue;
    visited.add(current.file);

    const parsed = parsedByFile.get(current.file);
    if (!parsed) continue;
    if (parsed.isServerEntry) continue;

    for (const imported of parsed.imports) {
      if (imported.typeOnly) continue;

      const reason = violationForSpecifier(imported.specifier);
      if (reason) {
        findings.push({
          file: normalizeRelative(rootDir, current.file),
          line: imported.line,
          specifier: imported.specifier,
          reason,
          chain: current.chain.map((file) => normalizeRelative(rootDir, file)),
        });
      }

      const resolved = resolveLocalImport(
        rootDir,
        current.file,
        imported.specifier,
        sourceFileSet,
      );
      if (!resolved || !sourceFileSet.has(resolved)) continue;
      if (!visited.has(resolved)) {
        queue.push({ file: resolved, chain: [...current.chain, resolved] });
      }
    }
  }

  findings.sort((a, b) =>
    `${a.file}:${a.line}:${a.specifier}`.localeCompare(
      `${b.file}:${b.line}:${b.specifier}`,
    ),
  );

  return {
    clientRoots: clientRoots
      .map((file) => normalizeRelative(rootDir, file))
      .sort(),
    checkedFiles: [...visited]
      .map((file) => normalizeRelative(rootDir, file))
      .sort(),
    violations: findings,
  };
}

export function sourceFilesForRoot(rootDir) {
  return SOURCE_ROOTS.flatMap((sourceRoot) =>
    walkSourceFiles(rootDir, path.join(rootDir, sourceRoot)),
  ).sort();
}

export function formatClientBoundaryFindings(report) {
  if (report.violations.length === 0) return "";
  return [
    "Client bundle dependency boundary violations:",
    ...report.violations.map((finding) => {
      const chain = finding.chain.map((file) => `    - ${file}`).join("\n");
      return `- ${finding.file}:${finding.line} imports \"${finding.specifier}\"\n  ${finding.reason}\n  client import path:\n${chain}`;
    }),
  ].join("\n");
}

export function runClientBoundaryCheck(rootDir = process.cwd()) {
  const sourceFiles = sourceFilesForRoot(rootDir);
  const report = evaluateClientBoundary({ rootDir, sourceFiles });
  return { sourceFiles, report };
}

export const _testOnly = { isSourceFile };
