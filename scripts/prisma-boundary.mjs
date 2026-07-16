import ts from "typescript";

import {
  makeShouldScanFile,
  scanRepositoryRoots,
} from "./source-scan-utils.mjs";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "delete",
  "deleteMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);
const INTERNAL_IMPORTERS = new Set([
  "prisma/script-prisma-client.ts",
  "src/lib/document/document-write-port.ts",
  "src/lib/maintenance/invite-link-retention-write-port.ts",
  "src/lib/prisma.ts",
]);
const ESCAPE_OWNERS = new Set([
  "src/lib/document/document-write-port.ts",
  "src/lib/prisma-internal.ts",
]);
const MESSAGES = {
  "raw-internal-import":
    "Only the Prisma facade and owned write adapters may import prisma-internal.",
  "test-raw-import":
    "The raw Prisma test helper is forbidden in production modules.",
  "raw-client-import":
    "Generated PrismaClient ownership is confined to prisma-internal.",
  "unsafe-cast":
    "Casting the restricted Prisma surface or Document delegate to an unsafe type is forbidden.",
  "unsafe-assignment":
    "Assigning the restricted Document delegate into an any/unknown binding is forbidden.",
  "unsafe-parameter-transfer":
    "Passing the restricted Document delegate to an any/unknown parameter is forbidden.",
  "dynamic-model-access":
    "Dynamic Prisma model access cannot target Document mutations.",
  "reflective-access":
    "Reflective access cannot recover raw Document mutation capabilities.",
  suppression:
    "TypeScript/ESLint suppression cannot bypass the restricted Prisma Document surface.",
};

function sourceKind(filePath) {
  if (/\.(?:tsx|jsx)$/.test(filePath)) return ts.ScriptKind.TSX;
  if (/\.(?:js|mjs|cjs)$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function lineFor(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function normalizeSpecifier(specifier) {
  return specifier.replace(/\.[cm]?[jt]sx?$/, "");
}

function isInternalSpecifier(specifier) {
  const normalized = normalizeSpecifier(specifier);
  return (
    normalized === "@/lib/prisma-internal" ||
    normalized.endsWith("/src/lib/prisma-internal") ||
    normalized.endsWith("/lib/prisma-internal") ||
    normalized === "./prisma-internal"
  );
}

function isGeneratedClientSpecifier(specifier) {
  const normalized = normalizeSpecifier(specifier);
  return (
    normalized === "@/generated/prisma/client" ||
    normalized.endsWith("/src/generated/prisma/client") ||
    normalized.endsWith("/generated/prisma/client") ||
    normalized === "@prisma/client"
  );
}

function namedImports(statement, importedName) {
  const bindings = statement.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return [];
  return bindings.elements.filter(
    (element) =>
      element.propertyName?.text === importedName ||
      element.name.text === importedName,
  );
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function accessName(expression) {
  const current = unwrap(expression);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  const argument = ts.isElementAccessExpression(current)
    ? current.argumentExpression
    : undefined;
  return argument &&
    (ts.isStringLiteral(argument) ||
      ts.isNoSubstitutionTemplateLiteral(argument))
    ? argument.text
    : undefined;
}

function isUnsafeType(typeNode) {
  return (
    typeNode?.kind === ts.SyntaxKind.AnyKeyword ||
    typeNode?.kind === ts.SyntaxKind.UnknownKeyword
  );
}

function isRawPrismaType(typeNode, source) {
  return Boolean(
    typeNode &&
    /(?:PrismaClient|TransactionClient|DocumentDelegate)\b/.test(
      typeNode.getText(source),
    ),
  );
}

function unsafeParameterIndexes(parameters) {
  return parameters
    .map((parameter, index) => (isUnsafeType(parameter.type) ? index : -1))
    .filter((index) => index >= 0);
}

function isTestPath(filePath) {
  return (
    /(^|\/)(?:test|tests|__tests__|__mocks__)(\/|$)/.test(filePath) ||
    /\.(?:test|spec|mock)(?:-[^.]+)?\.[cm]?[jt]sx?$/.test(filePath)
  );
}

export function analyzePrismaBoundarySource(
  sourceText,
  filePath = "source.ts",
) {
  const source = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourceKind(filePath),
  );
  const findings = [];
  const roots = new Set();
  const scriptFactories = new Set();
  const unsafeBindings = new Set();
  const unsafeFunctions = new Map();
  const report = (node, kind) =>
    findings.push({
      filePath,
      line: lineFor(source, node),
      kind,
      message: MESSAGES[kind],
    });

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (
      isInternalSpecifier(specifier) &&
      !INTERNAL_IMPORTERS.has(filePath) &&
      !isTestPath(filePath)
    ) {
      report(statement, "raw-internal-import");
    }
    if (specifier === "@/test/prisma-raw" && !isTestPath(filePath)) {
      report(statement, "test-raw-import");
    }
    if (
      isGeneratedClientSpecifier(specifier) &&
      namedImports(statement, "PrismaClient").length > 0 &&
      filePath !== "src/lib/prisma-internal.ts" &&
      !isTestPath(filePath)
    ) {
      report(statement, "raw-client-import");
    }
    if (specifier === "@/lib/prisma") {
      for (const element of namedImports(statement, "prisma")) {
        roots.add(element.name.text);
      }
    }
    if (
      specifier === "./script-prisma-client" ||
      specifier.endsWith("/script-prisma-client")
    ) {
      for (const element of namedImports(
        statement,
        "createScriptPrismaClient",
      )) {
        scriptFactories.add(element.name.text);
      }
    }
  }

  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (isUnsafeType(node.type)) unsafeBindings.add(node.name.text);
      const initializer = node.initializer
        ? unwrap(node.initializer)
        : undefined;
      if (
        initializer &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        scriptFactories.has(initializer.expression.text)
      ) {
        roots.add(node.name.text);
      }
      if (
        initializer &&
        (ts.isArrowFunction(initializer) ||
          ts.isFunctionExpression(initializer))
      ) {
        const indexes = unsafeParameterIndexes(initializer.parameters);
        if (indexes.length > 0) unsafeFunctions.set(node.name.text, indexes);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      const indexes = unsafeParameterIndexes(node.parameters);
      if (indexes.length > 0) unsafeFunctions.set(node.name.text, indexes);
    }
    if (
      ts.isCallExpression(node) &&
      accessName(node.expression) === "$transaction"
    ) {
      const operation = node.arguments[0]
        ? unwrap(node.arguments[0])
        : undefined;
      const parameter =
        operation &&
        (ts.isArrowFunction(operation) || ts.isFunctionExpression(operation))
          ? operation.parameters[0]
          : undefined;
      if (parameter && ts.isIdentifier(parameter.name)) {
        roots.add(parameter.name.text);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const isRoot = (expression) => {
    const current = unwrap(expression);
    return ts.isIdentifier(current) && roots.has(current.text);
  };
  const isDocument = (expression) => {
    const current = unwrap(expression);
    return (
      (ts.isPropertyAccessExpression(current) ||
        ts.isElementAccessExpression(current)) &&
      accessName(current) === "document" &&
      isRoot(current.expression)
    );
  };
  const containsRestrictedAccess = (node) => {
    let found = false;
    const visit = (candidate) => {
      if (found) return;
      if (
        ts.isExpression(candidate) &&
        (isRoot(candidate) || isDocument(candidate))
      ) {
        found = true;
        return;
      }
      ts.forEachChild(candidate, visit);
    };
    visit(node);
    return found;
  };

  if (!ESCAPE_OWNERS.has(filePath)) {
    const visit = (node) => {
      if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        (isUnsafeType(node.type) || isRawPrismaType(node.type, source)) &&
        containsRestrictedAccess(node.expression)
      ) {
        report(node, "unsafe-cast");
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        isUnsafeType(node.type) &&
        node.initializer &&
        isDocument(node.initializer)
      ) {
        report(node, "unsafe-assignment");
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        const left = unwrap(node.left);
        if (
          ts.isIdentifier(left) &&
          unsafeBindings.has(left.text) &&
          isDocument(node.right)
        ) {
          report(node, "unsafe-assignment");
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(unwrap(node.expression))
      ) {
        for (const index of unsafeFunctions.get(unwrap(node.expression).text) ??
          []) {
          const argument = node.arguments[index];
          if (argument && isDocument(argument)) {
            report(argument, "unsafe-parameter-transfer");
          }
        }
      }
      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        WRITE_METHODS.has(accessName(node) ?? "")
      ) {
        const receiver = unwrap(node.expression);
        const argument = ts.isElementAccessExpression(receiver)
          ? receiver.argumentExpression
          : undefined;
        if (
          argument &&
          isRoot(receiver.expression) &&
          !ts.isStringLiteral(argument) &&
          !ts.isNoSubstitutionTemplateLiteral(argument)
        ) {
          report(node, "dynamic-model-access");
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(unwrap(node.expression)) &&
        unwrap(node.expression).expression.getText(source) === "Reflect" &&
        unwrap(node.expression).name.text === "get"
      ) {
        const target = node.arguments[0];
        const key = node.arguments[1];
        const keyName =
          key &&
          (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))
            ? key.text
            : undefined;
        if (
          target &&
          (isRoot(target) || isDocument(target)) &&
          (keyName === undefined ||
            keyName === "document" ||
            WRITE_METHODS.has(keyName))
        ) {
          report(node, "reflective-access");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    if (roots.size > 0) {
      const lines = sourceText.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!/@ts-nocheck|@ts-ignore|eslint-disable/.test(line)) continue;
        const nearby = lines.slice(index, index + 4).join("\n");
        if (
          /@ts-nocheck/.test(line) ||
          (/document|\[[^\]]+\]/.test(nearby) &&
            /create|delete|update|upsert/.test(nearby))
        ) {
          findings.push({
            filePath,
            line: index + 1,
            kind: "suppression",
            message: MESSAGES.suppression,
          });
        }
      }
    }
  }

  return findings.sort((left, right) =>
    `${left.filePath}:${left.line}:${left.kind}`.localeCompare(
      `${right.filePath}:${right.line}:${right.kind}`,
    ),
  );
}

export function runPrismaBoundaryCheck(repoRoot) {
  const shouldScanFile = makeShouldScanFile({
    sourceExtensions: SOURCE_EXTENSIONS,
    excludedPrefixes: ["src/generated/", "src/test/", "type-tests/", ".tmp/"],
  });
  return {
    violations: scanRepositoryRoots({
      repoRoot,
      roots: ["src", "prisma", "scripts"],
      sourceExtensions: SOURCE_EXTENSIONS,
      shouldScanFile: (filePath) =>
        shouldScanFile(filePath) &&
        !isTestPath(filePath) &&
        !/\.d\.[cm]?ts$/.test(filePath),
      scanText: (filePath, sourceText) =>
        analyzePrismaBoundarySource(sourceText, filePath),
    }),
  };
}

export function formatPrismaBoundaryFindings(report) {
  return report.violations
    .map(
      ({ filePath, line, kind, message }) =>
        `${filePath}:${line} [${kind}] ${message}`,
    )
    .join("\n");
}
