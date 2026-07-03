import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  allowedExportStars,
  allowedInternalFacadeImports,
  allowedSccs,
  facadeRules,
} from "./import-graph-allowlist.mjs";
import { toPosix } from "./source-scan-utils.mjs";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];
const SOURCE_ROOTS = ["src"];

function normalizeRelative(rootDir, filePath) {
  return toPosix(path.relative(rootDir, filePath));
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

function sourceKindFor(fileName) {
  if (fileName.endsWith(".tsx") || fileName.endsWith(".jsx"))
    return ts.ScriptKind.TSX;
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs"))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function collectImportsFromSource(sourceText, fileName = "source.ts") {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourceKindFor(fileName),
  );
  const imports = [];
  const exportStars = [];

  function recordModuleSpecifier(node, kind) {
    const specifier = node.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) return;
    imports.push({ kind, specifier: specifier.text });
  }

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      recordModuleSpecifier(statement, "import");
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      recordModuleSpecifier(statement, "export");
      if (
        statement.moduleSpecifier &&
        !statement.exportClause &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        exportStars.push(statement.moduleSpecifier.text);
      }
    }
  }

  return { imports, exportStars };
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

export function resolveImport(rootDir, importerFile, specifier, existingFiles) {
  let basePath;
  if (specifier.startsWith("@/")) {
    basePath = path.join(rootDir, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    basePath = path.resolve(path.dirname(importerFile), specifier);
  } else {
    return null;
  }

  for (const candidate of candidatePaths(basePath)) {
    const resolvedCandidate = path.resolve(candidate);
    if (existingFiles?.has(resolvedCandidate)) return resolvedCandidate;
    if (
      fs.existsSync(resolvedCandidate) &&
      fs.statSync(resolvedCandidate).isFile()
    ) {
      return resolvedCandidate;
    }
  }
  return null;
}

export function computeSccs(graph) {
  let index = 0;
  const stack = [];
  const indices = new Map();
  const lowlinks = new Map();
  const onStack = new Set();
  const sccs = [];

  function strongConnect(node) {
    indices.set(node, index);
    lowlinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!indices.has(neighbor)) {
        strongConnect(neighbor);
        lowlinks.set(
          node,
          Math.min(lowlinks.get(node), lowlinks.get(neighbor)),
        );
      } else if (onStack.has(neighbor)) {
        lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(neighbor)));
      }
    }

    if (lowlinks.get(node) === indices.get(node)) {
      const component = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
      } while (current !== node);
      if (component.length > 1 || (graph.get(node) ?? new Set()).has(node)) {
        sccs.push(component.sort());
      }
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) strongConnect(node);
  }
  return sccs.sort((a, b) =>
    signatureForScc(a).localeCompare(signatureForScc(b)),
  );
}

export function signatureForScc(paths) {
  return [...paths].sort().join(" | ");
}

function allowlistMap(entries, keyFn) {
  const map = new Map();
  for (const entry of entries) {
    map.set(keyFn(entry), entry);
  }
  return map;
}

function hasAllowedPrefix(file, prefixes) {
  return prefixes.some(
    (prefix) => file === prefix || file.startsWith(`${prefix}/`),
  );
}

export function evaluateImportGraph({
  rootDir,
  sourceFiles,
  fileContents,
  allowlists = {
    sccs: allowedSccs,
    exportStars: allowedExportStars,
    internalFacadeImports: allowedInternalFacadeImports,
  },
  facades = facadeRules,
}) {
  const graph = new Map();
  const exportStarFindings = [];
  const internalFacadeImportMap = new Map();
  const sourceFileSet = new Set(sourceFiles.map((file) => path.resolve(file)));
  const resolvedFacadeByPath = new Map(
    facades.map((rule) => [path.resolve(rootDir, rule.facade), rule]),
  );

  for (const file of sourceFiles) {
    const absFile = path.resolve(file);
    const relativeFile = normalizeRelative(rootDir, absFile);
    graph.set(relativeFile, graph.get(relativeFile) ?? new Set());

    const sourceText =
      fileContents?.get(absFile) ??
      fileContents?.get(relativeFile) ??
      fs.readFileSync(absFile, "utf8");
    const parsed = collectImportsFromSource(sourceText, absFile);

    for (const specifier of parsed.exportStars) {
      exportStarFindings.push({ file: relativeFile, specifier });
    }

    for (const imported of parsed.imports) {
      const resolved = resolveImport(
        rootDir,
        absFile,
        imported.specifier,
        sourceFileSet,
      );
      if (!resolved || !sourceFileSet.has(path.resolve(resolved))) continue;
      const relativeResolved = normalizeRelative(rootDir, resolved);
      graph.get(relativeFile).add(relativeResolved);

      const facadeRule = resolvedFacadeByPath.get(path.resolve(resolved));
      if (facadeRule) {
        const importerIsInternal = hasAllowedPrefix(relativeFile, [
          facadeRule.domainRoot,
        ]);
        const importerIsFacade = relativeFile === facadeRule.facade;
        const importerIsPublic = (facadeRule.publicConsumers ?? []).includes(
          relativeFile,
        );
        if (importerIsInternal && !importerIsFacade && !importerIsPublic) {
          internalFacadeImportMap.set(
            `${relativeFile} -> ${facadeRule.facade}`,
            {
              file: relativeFile,
              specifier: imported.specifier,
              facade: facadeRule.facade,
            },
          );
        }
      }
    }
  }

  const allowedSccMap = allowlistMap(
    allowlists.sccs,
    (entry) => entry.signature,
  );
  const allowedExportStarMap = allowlistMap(
    allowlists.exportStars,
    (entry) => `${entry.file} -> ${entry.specifier}`,
  );
  const allowedFacadeImportMap = allowlistMap(
    allowlists.internalFacadeImports,
    (entry) => `${entry.file} -> ${entry.facade}`,
  );

  const sccs = computeSccs(graph).map((paths) => ({
    paths,
    signature: signatureForScc(paths),
  }));
  const internalFacadeImports = [...internalFacadeImportMap.values()].sort(
    (a, b) =>
      `${a.file} -> ${a.facade}`.localeCompare(`${b.file} -> ${b.facade}`),
  );

  return {
    sccs,
    exportStars: exportStarFindings,
    internalFacadeImports,
    violations: {
      sccs: sccs.filter((scc) => !allowedSccMap.has(scc.signature)),
      exportStars: exportStarFindings.filter(
        (finding) =>
          !allowedExportStarMap.has(`${finding.file} -> ${finding.specifier}`),
      ),
      internalFacadeImports: internalFacadeImports.filter(
        (finding) =>
          !allowedFacadeImportMap.has(`${finding.file} -> ${finding.facade}`),
      ),
    },
  };
}

export function sourceFilesForRoot(rootDir) {
  return SOURCE_ROOTS.flatMap((sourceRoot) =>
    walkSourceFiles(rootDir, path.join(rootDir, sourceRoot)),
  ).sort();
}

export function formatFindings(report) {
  const sections = [];
  if (report.violations.sccs.length > 0) {
    sections.push(
      [
        "Import graph SCCs (add a temporary allowedSccs entry only with a reason):",
        ...report.violations.sccs.map(
          (scc) =>
            `- ${scc.signature}\n  files:\n${scc.paths.map((file) => `    - ${file}`).join("\n")}`,
        ),
      ].join("\n"),
    );
  }
  if (report.violations.exportStars.length > 0) {
    sections.push(
      [
        "Unapproved export * barrels (replace with explicit named re-exports):",
        ...report.violations.exportStars.map(
          (finding) =>
            `- ${finding.file}: export * from "${finding.specifier}"`,
        ),
      ].join("\n"),
    );
  }
  if (report.violations.internalFacadeImports.length > 0) {
    sections.push(
      [
        "Internal facade imports (same-domain internals should import leaf modules):",
        ...report.violations.internalFacadeImports.map(
          (finding) =>
            `- ${finding.file}: ${finding.specifier} resolves to ${finding.facade}`,
        ),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

export function runImportGraphCheck(rootDir = process.cwd()) {
  const sourceFiles = sourceFilesForRoot(rootDir);
  const report = evaluateImportGraph({ rootDir, sourceFiles });
  return { sourceFiles, report };
}

export const _testOnly = { isSourceFile };
