#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import { toPosix } from "./source-scan-utils.mjs";

export const GENERATED_START = "<!-- ui-matrix-inventory:start -->";
export const GENERATED_END = "<!-- ui-matrix-inventory:end -->";

const README_PATH = join("e2e", "ui-matrix", "README.md");
const DOCX_SPEC = "e2e/import/import-roundtrip.spec.ts";
const DOCX_PROFILE_SPEC = "import/import-roundtrip.spec.ts";
const PLAYWRIGHT_TEST = Object.freeze({ kind: "playwright-test" });
const LOCAL_CALLABLE = Object.freeze({ kind: "local-callable" });
const TEST_REGISTRATION_MODIFIERS = new Set(["fail", "fixme", "only", "skip"]);
const KNOWN_TEST_API_MEMBERS = new Set([
  "afterAll",
  "afterEach",
  "beforeAll",
  "beforeEach",
  "describe",
  "extend",
  "info",
  "setTimeout",
  "slow",
  "step",
  "use",
]);
const REQUIRED_PROFILE_ANNOTATION = "@required-profile";

function unsupportedPlaywright(reason) {
  return { kind: "unsupported-playwright", reason };
}

function isPlaywrightRelated(value) {
  return (
    value === PLAYWRIGHT_TEST ||
    value?.kind === "playwright-module" ||
    value?.kind === "unsupported-playwright" ||
    value?.kind === "unsupported-playwright-module"
  );
}

function walkFiles(
  root,
  skipDirectoryNames = new Set(["node_modules", ".next"]),
) {
  const files = [];
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return files;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (skipDirectoryNames.has(entry.name)) {
      continue;
    }
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, skipDirectoryNames));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export function collectPlaywrightSpecs(repoRoot = process.cwd()) {
  return walkFiles(join(repoRoot, "e2e"))
    .map((filePath) => toPosix(relative(repoRoot, filePath)))
    .filter((filePath) => filePath.endsWith(".spec.ts"))
    .sort();
}

function compareSets(actual, documented) {
  const actualSet = new Set(actual);
  const documentedSet = new Set(documented);
  return {
    missing: actual.filter((item) => !documentedSet.has(item)),
    stale: documented.filter((item) => !actualSet.has(item)),
  };
}

function markdownTable(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(
      header.length,
      3,
      ...rows.map((row) => String(row[column] ?? "").length),
    ),
  );
  const formatRow = (row) =>
    `| ${row.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join(" | ")} |`;
  return [
    formatRow(headers),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map(formatRow),
  ].join("\n");
}

function statusSummaryRows(summary) {
  return Object.entries(summary.bySubsystem)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([subsystem, counts]) => [
      subsystem,
      counts.total,
      counts.automated,
      counts.manual,
      counts.blocked,
      counts.catalog,
    ]);
}

function joinList(values) {
  return values.join(", ");
}

function codeList(values) {
  return joinList(values.map((value) => `\`${value}\``));
}

export function summarizeSpecInventory(specInventory) {
  return specInventory.reduce(
    (summary, entry) => {
      summary.total += 1;
      summary.byRunMode[entry.runMode] =
        (summary.byRunMode[entry.runMode] ?? 0) + 1;
      for (const owner of entry.owners) {
        summary.byOwner[owner] = (summary.byOwner[owner] ?? 0) + 1;
      }
      return summary;
    },
    { total: 0, byRunMode: {}, byOwner: {} },
  );
}

export function renderInventoryMarkdown({
  specInventory,
  manualGaps,
  caseSummary,
}) {
  const specSummary = summarizeSpecInventory(specInventory);
  const runModeRows = Object.entries(specSummary.byRunMode)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mode, count]) => [mode, count]);
  const specRows = specInventory.map((entry) => [
    `\`${entry.spec}\``,
    joinList(entry.owners),
    entry.runMode,
    codeList(entry.prerequisites),
    joinList(entry.roles),
    joinList(entry.devices),
    entry.ciStatus,
  ]);
  const gapRows = manualGaps.map((gap) => [
    gap.id,
    gap.owner,
    gap.status,
    gap.gap,
    joinList(gap.sourceRefs.map((source) => `\`${source}\``)),
  ]);
  const mappedTestRows = specInventory.flatMap((entry) =>
    (entry.tests ?? []).map((mappedTest) => [
      `\`${entry.spec}\``,
      `\`${mappedTest.test}\``,
      mappedTest.surface,
      mappedTest.viewport,
      mappedTest.auth,
      mappedTest.profile,
      mappedTest.ciTier,
      mappedTest.status,
    ]),
  );
  const expectedTestRows = specInventory.flatMap((entry) =>
    (entry.expectedTests ?? []).map((expectedTest) => [
      `\`${entry.spec}\``,
      `\`${expectedTest.test}\``,
      codeList(expectedTest.profiles),
    ]),
  );

  return [
    GENERATED_START,
    "## Source-backed catalog distribution",
    "",
    "The 500-case catalog is generated from `e2e/ui-matrix/cases.ts`; this README section is rendered and checked by `scripts/check-ui-matrix-inventory.mjs`.",
    "",
    markdownTable(
      ["Subsystem", "Total", "Automated", "Manual", "Blocked", "Catalog"],
      [
        ...statusSummaryRows(caseSummary),
        [
          "Total",
          caseSummary.total,
          caseSummary.byStatus.automated,
          caseSummary.byStatus.manual,
          caseSummary.byStatus.blocked,
          caseSummary.byStatus.catalog,
        ],
      ],
    ),
    "",
    "`automated` means covered by a representative runnable spec in this directory or the deterministic profile. `manual` means human exploratory or release-gate validation is still expected. `blocked` means product hooks, deterministic fixture coverage, or stable selectors are missing. `catalog` means planned coverage that is not currently a release gate.",
    "",
    "## Playwright spec inventory",
    "",
    `The repository currently has ${specSummary.total} Playwright specs under \`e2e/\`. Every \`e2e/**/*.spec.ts\` file must appear here, and stale rows fail the inventory check.`,
    "",
    markdownTable(["Run mode", "Specs"], runModeRows),
    "",
    markdownTable(
      [
        "Spec",
        "Owners",
        "Run mode",
        "Prerequisites / gates",
        "Roles",
        "Devices / viewports",
        "CI status",
      ],
      specRows,
    ),
    "",
    "## Mapped deterministic tests",
    "",
    "These test-level rows record exact Playwright identity and execution metadata for deterministic coverage that must not drift back to manual or advisory classification.",
    "",
    markdownTable(
      [
        "Spec",
        "Test",
        "Surface",
        "Viewport",
        "Auth",
        "Profile",
        "CI tier",
        "Status",
      ],
      mappedTestRows,
    ),
    "",
    "## Authoritative test registration contracts",
    "",
    "Mapped specs with an exact contract must contain only the proven Playwright registrations below. Dynamic or otherwise unresolved registrations fail the scanner instead of being ignored.",
    "",
    markdownTable(["Spec", "Test identity", "Profiles"], expectedTestRows),
    "",
    "## Known manual, blocked, and catalog gaps",
    "",
    markdownTable(["ID", "Owner", "Status", "Gap", "Sources"], gapRows),
    "",
    "## Drift guard",
    "",
    "Run `npm run ui-matrix:check` after adding, renaming, or removing any `e2e/**/*.spec.ts` file. Use `npm run ui-matrix:write` to refresh this generated README section after changing `e2e/ui-matrix/inventory.ts` or `e2e/ui-matrix/cases.ts`.",
    GENERATED_END,
  ].join("\n");
}

function stringArrayVariable(sourceText, fileName, variableName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let values = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      values = node.initializer.elements
        .filter(ts.isStringLiteralLike)
        .map((element) => element.text);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

function scriptKind(fileName) {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticMemberName(node) {
  const target = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(target)) {
    return target.name.text;
  }
  if (
    ts.isElementAccessExpression(target) &&
    target.argumentExpression &&
    ts.isStringLiteralLike(target.argumentExpression)
  ) {
    return target.argumentExpression.text;
  }
  return undefined;
}

function hasTestCallback(node) {
  return node.arguments.slice(1).some((argument) => {
    const target = unwrapExpression(argument);
    return (
      ts.isArrowFunction(target) ||
      ts.isFunctionExpression(target) ||
      ts.isIdentifier(target)
    );
  });
}

class BindingScope {
  constructor(parent, { functionScope = false } = {}) {
    this.parent = parent;
    this.functionScope = functionScope;
    this.bindings = new Map();
  }

  declare(name) {
    if (!this.bindings.has(name)) {
      this.bindings.set(name, { value: undefined });
    }
  }

  binding(name) {
    if (this.bindings.has(name)) return this.bindings.get(name);
    return this.parent?.binding(name);
  }

  set(name, value) {
    const binding = this.bindings.get(name);
    if (binding) binding.value = value;
  }
}

function nearestFunctionScope(scope) {
  for (let current = scope; current; current = current.parent) {
    if (current.functionScope) return current;
  }
  return scope;
}

function declareBindingName(name, scope) {
  if (ts.isIdentifier(name)) {
    scope.declare(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      declareBindingName(element.name, scope);
    }
  }
}

function declarationFromStatement(statement) {
  if (
    ts.isVariableStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement)
  ) {
    return statement;
  }
  return undefined;
}

function variableDeclarationScope(declarationList, scope) {
  return declarationList.flags & ts.NodeFlags.BlockScoped
    ? scope
    : nearestFunctionScope(scope);
}

function predeclareStatements(statements, scope) {
  for (const statement of statements) {
    const declaration = declarationFromStatement(statement);
    if (!declaration) continue;
    if (ts.isVariableStatement(declaration)) {
      for (const item of declaration.declarationList.declarations) {
        declareBindingName(
          item.name,
          variableDeclarationScope(declaration.declarationList, scope),
        );
      }
    } else if (
      (ts.isFunctionDeclaration(declaration) ||
        ts.isClassDeclaration(declaration) ||
        ts.isImportEqualsDeclaration(declaration)) &&
      declaration.name
    ) {
      scope.declare(declaration.name.text);
    } else if (ts.isImportDeclaration(declaration)) {
      const importClause = declaration.importClause;
      if (!importClause || importClause.isTypeOnly) continue;
      if (importClause.name) scope.declare(importClause.name.text);
      const bindings = importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        scope.declare(bindings.name.text);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly) scope.declare(element.name.text);
        }
      }
    }
  }
}

function predeclareVarDeclarations(node, functionScope) {
  const visit = (child) => {
    if (child !== node && ts.isFunctionLike(child)) return;
    if (
      ts.isVariableDeclaration(child) &&
      ts.isVariableDeclarationList(child.parent) &&
      !(child.parent.flags & ts.NodeFlags.BlockScoped)
    ) {
      declareBindingName(child.name, functionScope);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
}

function createModuleValue(exports) {
  return { kind: "playwright-module", exports };
}

function createPlaywrightScanner({ repoRoot, entryFileName, entrySourceText }) {
  const moduleCache = new Map();

  const resolveModuleFile = (fromFileName, moduleSpecifier) => {
    if (!repoRoot || !moduleSpecifier.startsWith(".")) return undefined;
    const unresolved = resolve(
      repoRoot,
      dirname(fromFileName),
      moduleSpecifier,
    );
    const relativeUnresolved = toPosix(relative(repoRoot, unresolved));
    if (
      relativeUnresolved === ".." ||
      relativeUnresolved.startsWith("../") ||
      !relativeUnresolved.startsWith("e2e/")
    ) {
      return undefined;
    }
    const candidates = extname(unresolved)
      ? [unresolved]
      : [
          unresolved,
          ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map(
            (extension) => `${unresolved}${extension}`,
          ),
          ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map((extension) =>
            join(unresolved, `index${extension}`),
          ),
        ];
    const resolved = candidates.find((candidate) =>
      statSync(candidate, { throwIfNoEntry: false })?.isFile(),
    );
    return resolved ? toPosix(relative(repoRoot, resolved)) : undefined;
  };

  const moduleValue = (fromFileName, moduleSpecifier) => {
    if (moduleSpecifier === "@playwright/test") {
      return createModuleValue(
        new Map([
          ["default", PLAYWRIGHT_TEST],
          ["test", PLAYWRIGHT_TEST],
        ]),
      );
    }
    const resolvedFileName = resolveModuleFile(fromFileName, moduleSpecifier);
    if (!resolvedFileName) return undefined;
    return createModuleValue(moduleExports(resolvedFileName));
  };

  const resolveValue = (node, scope) => {
    if (!node) return undefined;
    const target = unwrapExpression(node);
    if (ts.isAwaitExpression(target)) {
      return resolveValue(target.expression, scope);
    }
    if (ts.isIdentifier(target)) {
      return scope.binding(target.text)?.value;
    }
    if (
      ts.isArrowFunction(target) ||
      ts.isFunctionExpression(target) ||
      ts.isFunctionDeclaration(target)
    ) {
      return LOCAL_CALLABLE;
    }
    if (ts.isConditionalExpression(target)) {
      const whenTrue = resolveValue(target.whenTrue, scope);
      const whenFalse = resolveValue(target.whenFalse, scope);
      if (whenTrue === whenFalse) return whenTrue;
      if (isPlaywrightRelated(whenTrue) || isPlaywrightRelated(whenFalse)) {
        return unsupportedPlaywright("conditional Playwright alias");
      }
      return undefined;
    }
    if (
      ts.isPropertyAccessExpression(target) ||
      ts.isElementAccessExpression(target)
    ) {
      const memberName = staticMemberName(target);
      const owner = resolveValue(target.expression, scope);
      if (memberName === undefined) {
        return isPlaywrightRelated(owner)
          ? unsupportedPlaywright("computed Playwright member")
          : undefined;
      }
      if (owner?.kind === "playwright-module") {
        return owner.exports.get(memberName);
      }
      if (owner?.kind === "unsupported-playwright-module") {
        return unsupportedPlaywright(owner.reason);
      }
      if (owner === PLAYWRIGHT_TEST) {
        if (TEST_REGISTRATION_MODIFIERS.has(memberName)) {
          return PLAYWRIGHT_TEST;
        }
        if (KNOWN_TEST_API_MEMBERS.has(memberName)) {
          return LOCAL_CALLABLE;
        }
        return unsupportedPlaywright(
          `unrecognized Playwright test member ${JSON.stringify(memberName)}`,
        );
      }
      if (owner?.kind === "unsupported-playwright") {
        return unsupportedPlaywright(owner.reason);
      }
      return undefined;
    }
    if (ts.isCallExpression(target)) {
      if (
        target.expression.kind === ts.SyntaxKind.ImportKeyword &&
        target.arguments[0] &&
        ts.isStringLiteralLike(target.arguments[0]) &&
        target.arguments[0].text === "@playwright/test"
      ) {
        return {
          kind: "unsupported-playwright-module",
          reason: "dynamic Playwright import",
        };
      }
      const path = testMemberPath(target.expression, scope);
      if (path?.length === 1 && path[0] === "extend") {
        return PLAYWRIGHT_TEST;
      }
    }
    return undefined;
  };

  const testMemberPath = (node, scope) => {
    const target = unwrapExpression(node);
    if (resolveValue(target, scope) === PLAYWRIGHT_TEST) return [];
    if (
      !ts.isPropertyAccessExpression(target) &&
      !ts.isElementAccessExpression(target)
    ) {
      return undefined;
    }
    const memberName = staticMemberName(target);
    if (memberName === undefined) return undefined;
    const ownerPath = testMemberPath(target.expression, scope);
    return ownerPath ? [...ownerPath, memberName] : undefined;
  };

  const scanSource = (sourceText, fileName, collectRegistrations) => {
    const sourceFile = ts.createSourceFile(
      fileName,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(fileName),
    );
    const registrations = [];
    const unsupported = [];
    const sourceScope = new BindingScope(undefined, { functionScope: true });
    const lineOf = (node) =>
      sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const reportUnsupported = (node, reason) => {
      if (collectRegistrations) {
        unsupported.push({ reason, line: lineOf(node) });
      }
    };

    const setImportBindings = (node, scope) => {
      if (!node.importClause || node.importClause.isTypeOnly) return;
      const source = node.moduleSpecifier;
      if (!ts.isStringLiteralLike(source)) return;
      const importedModule = moduleValue(fileName, source.text);
      if (!importedModule) return;
      const importClause = node.importClause;
      if (importClause.name) {
        scope.set(
          importClause.name.text,
          importedModule.exports.get("default"),
        );
      }
      const bindings = importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        scope.set(bindings.name.text, importedModule);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          scope.set(
            element.name.text,
            importedModule.exports.get(
              element.propertyName?.text ?? element.name.text,
            ),
          );
        }
      }
    };

    const invalidateAssignmentTarget = (node, scope) => {
      const target = unwrapExpression(node);
      if (ts.isIdentifier(target)) {
        const binding = scope.binding(target.text);
        if (binding) binding.value = undefined;
        return;
      }
      if (
        ts.isPropertyAccessExpression(target) ||
        ts.isElementAccessExpression(target)
      ) {
        invalidateAssignmentTarget(target.expression, scope);
        return;
      }
      if (
        ts.isArrayLiteralExpression(target) ||
        ts.isObjectLiteralExpression(target)
      ) {
        for (const child of target.elements ?? target.properties) {
          if (ts.isSpreadElement(child) || ts.isSpreadAssignment(child)) {
            invalidateAssignmentTarget(child.expression, scope);
          } else if (ts.isShorthandPropertyAssignment(child)) {
            invalidateAssignmentTarget(child.name, scope);
          } else if (
            ts.isPropertyAssignment(child) ||
            ts.isBindingElement(child)
          ) {
            invalidateAssignmentTarget(
              ts.isBindingElement(child) ? child.name : child.initializer,
              scope,
            );
          } else if (ts.isIdentifier(child)) {
            invalidateAssignmentTarget(child, scope);
          }
        }
      }
    };

    const bindingIdentifiers = (node, identifiers = []) => {
      const target = unwrapExpression(node);
      if (ts.isIdentifier(target)) {
        identifiers.push(target);
      } else if (
        ts.isObjectBindingPattern(target) ||
        ts.isArrayBindingPattern(target)
      ) {
        for (const element of target.elements) {
          if (!ts.isOmittedExpression(element)) {
            bindingIdentifiers(element.name, identifiers);
          }
        }
      } else if (ts.isObjectLiteralExpression(target)) {
        for (const property of target.properties) {
          if (ts.isShorthandPropertyAssignment(property)) {
            identifiers.push(property.name);
          } else if (
            ts.isPropertyAssignment(property) ||
            ts.isSpreadAssignment(property)
          ) {
            bindingIdentifiers(
              property.initializer ?? property.expression,
              identifiers,
            );
          }
        }
      } else if (ts.isArrayLiteralExpression(target)) {
        for (const element of target.elements) {
          if (!ts.isOmittedExpression(element)) {
            bindingIdentifiers(element, identifiers);
          }
        }
      } else if (
        ts.isBinaryExpression(target) &&
        target.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        bindingIdentifiers(target.left, identifiers);
      }
      return identifiers;
    };

    const destructuredMemberValue = (owner, memberName) => {
      if (owner?.kind === "playwright-module") {
        return owner.exports.get(memberName);
      }
      if (owner?.kind === "unsupported-playwright-module") {
        return unsupportedPlaywright(owner.reason);
      }
      if (owner === PLAYWRIGHT_TEST) {
        if (TEST_REGISTRATION_MODIFIERS.has(memberName)) {
          return PLAYWRIGHT_TEST;
        }
        if (KNOWN_TEST_API_MEMBERS.has(memberName)) {
          return LOCAL_CALLABLE;
        }
        return unsupportedPlaywright(
          `unrecognized Playwright test member ${JSON.stringify(memberName)}`,
        );
      }
      if (owner?.kind === "unsupported-playwright") {
        return unsupportedPlaywright(owner.reason);
      }
      return undefined;
    };

    const bindingPatternEntries = (pattern) => {
      if (!ts.isObjectBindingPattern(pattern)) {
        return {
          entries: [],
          unsafeReason: "destructive Playwright destructuring",
        };
      }
      const entries = [];
      for (const element of pattern.elements) {
        if (element.dotDotDotToken) {
          return { entries, unsafeReason: "rest Playwright destructuring" };
        }
        if (element.initializer) {
          return { entries, unsafeReason: "default Playwright destructuring" };
        }
        if (!ts.isIdentifier(element.name)) {
          return {
            entries,
            unsafeReason: "destructive Playwright destructuring",
          };
        }
        if (
          element.propertyName &&
          ts.isComputedPropertyName(element.propertyName)
        ) {
          return {
            entries,
            unsafeReason: "computed Playwright destructuring",
          };
        }
        const propertyName = element.propertyName ?? element.name;
        if (
          !ts.isIdentifier(propertyName) &&
          !ts.isStringLiteralLike(propertyName)
        ) {
          return {
            entries,
            unsafeReason: "destructive Playwright destructuring",
          };
        }
        entries.push({
          memberName: propertyName.text,
          target: element.name,
        });
      }
      return { entries, unsafeReason: undefined };
    };

    const assignmentPatternEntries = (pattern) => {
      if (!ts.isObjectLiteralExpression(pattern)) {
        return {
          entries: [],
          unsafeReason: "destructive Playwright destructuring assignment",
        };
      }
      const entries = [];
      for (const property of pattern.properties) {
        if (ts.isSpreadAssignment(property)) {
          return {
            entries,
            unsafeReason: "rest Playwright destructuring assignment",
          };
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          if (property.objectAssignmentInitializer) {
            return {
              entries,
              unsafeReason: "default Playwright destructuring assignment",
            };
          }
          entries.push({
            memberName: property.name.text,
            target: property.name,
          });
          continue;
        }
        if (!ts.isPropertyAssignment(property)) {
          return {
            entries,
            unsafeReason: "destructive Playwright destructuring assignment",
          };
        }
        if (ts.isComputedPropertyName(property.name)) {
          return {
            entries,
            unsafeReason: "computed Playwright destructuring assignment",
          };
        }
        if (
          !ts.isIdentifier(property.name) &&
          !ts.isStringLiteralLike(property.name)
        ) {
          return {
            entries,
            unsafeReason: "destructive Playwright destructuring assignment",
          };
        }
        const target = unwrapExpression(property.initializer);
        if (
          ts.isBinaryExpression(target) &&
          target.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ) {
          return {
            entries,
            unsafeReason: "default Playwright destructuring assignment",
          };
        }
        if (!ts.isIdentifier(target)) {
          return {
            entries,
            unsafeReason: "destructive Playwright destructuring assignment",
          };
        }
        entries.push({ memberName: property.name.text, target });
      }
      return { entries, unsafeReason: undefined };
    };

    const applyDestructuring = ({
      pattern,
      sourceValue,
      scope,
      targetScope,
      assignment,
    }) => {
      if (!isPlaywrightRelated(sourceValue)) return false;
      const { entries, unsafeReason } = assignment
        ? assignmentPatternEntries(pattern)
        : bindingPatternEntries(pattern);
      if (unsafeReason) {
        reportUnsupported(pattern, unsafeReason);
        for (const identifier of bindingIdentifiers(pattern)) {
          const binding = scope.binding(identifier.text);
          if (binding) binding.value = unsupportedPlaywright(unsafeReason);
        }
        return true;
      }
      for (const { memberName, target } of entries) {
        const memberValue = destructuredMemberValue(sourceValue, memberName);
        if (assignment) {
          const binding = scope.binding(target.text);
          if (!binding || binding.value !== undefined) {
            const reason = `reassigned or ambiguous Playwright destructuring target ${target.text}`;
            reportUnsupported(target, reason);
            if (binding) binding.value = unsupportedPlaywright(reason);
          } else {
            binding.value = memberValue;
          }
        } else {
          targetScope.set(target.text, memberValue);
        }
      }
      return true;
    };

    const memberRoot = (node, scope) => {
      const path = [];
      let target = unwrapExpression(node);
      while (
        ts.isPropertyAccessExpression(target) ||
        ts.isElementAccessExpression(target)
      ) {
        path.unshift(staticMemberName(target));
        target = unwrapExpression(target.expression);
      }
      if (!ts.isIdentifier(target)) return undefined;
      const binding = scope.binding(target.text);
      return binding ? { binding, path, value: binding.value } : undefined;
    };

    const invalidatePlaywrightMutation = (node, scope) => {
      const root = memberRoot(node, scope);
      if (!root || !isPlaywrightRelated(root.value)) return false;
      if (
        root.value?.kind === "playwright-module" &&
        root.path.length > 0 &&
        root.path[0] !== undefined &&
        root.path[0] !== "test" &&
        root.path[0] !== "default"
      ) {
        return false;
      }
      const reason = "mutated Playwright test registration provenance";
      reportUnsupported(node, reason);
      root.binding.value =
        root.value?.kind === "playwright-module" ||
        root.value?.kind === "unsupported-playwright-module"
          ? { kind: "unsupported-playwright-module", reason }
          : unsupportedPlaywright(reason);
      return true;
    };

    const processStatements = (statements, scope) => {
      predeclareStatements(statements, scope);
      for (const statement of statements) visit(statement, scope);
    };

    const visitFunction = (node, parentScope) => {
      const functionScope = new BindingScope(parentScope, {
        functionScope: true,
      });
      if (ts.isFunctionExpression(node) && node.name) {
        functionScope.declare(node.name.text);
      }
      for (const parameter of node.parameters ?? []) {
        declareBindingName(parameter.name, functionScope);
      }
      if (node.body && ts.isBlock(node.body)) {
        predeclareVarDeclarations(node.body, functionScope);
        for (const parameter of node.parameters ?? []) {
          if (parameter.initializer)
            visit(parameter.initializer, functionScope);
        }
        processStatements(node.body.statements, functionScope);
      } else if (node.body) {
        visit(node.body, functionScope);
      }
    };

    const visit = (node, scope) => {
      if (ts.isSourceFile(node)) {
        predeclareVarDeclarations(node, scope);
        processStatements(node.statements, scope);
        return;
      }
      if (ts.isBlock(node)) {
        processStatements(node.statements, new BindingScope(scope));
        return;
      }
      if (ts.isFunctionLike(node)) {
        if (ts.isFunctionDeclaration(node) && node.name) {
          const binding = scope.binding(node.name.text);
          if (binding) binding.value = LOCAL_CALLABLE;
        }
        visitFunction(node, scope);
        return;
      }
      if (
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node)
      ) {
        const loopScope = new BindingScope(scope);
        const initializer = node.initializer;
        if (initializer && ts.isVariableDeclarationList(initializer)) {
          for (const declaration of initializer.declarations) {
            declareBindingName(
              declaration.name,
              variableDeclarationScope(initializer, loopScope),
            );
          }
        }
        if (initializer) visit(initializer, loopScope);
        if (ts.isForStatement(node)) {
          if (node.condition) visit(node.condition, loopScope);
          if (node.incrementor) visit(node.incrementor, loopScope);
        } else {
          visit(node.expression, loopScope);
        }
        visit(node.statement, loopScope);
        return;
      }
      if (ts.isSwitchStatement(node)) {
        visit(node.expression, scope);
        const switchScope = new BindingScope(scope);
        predeclareStatements(
          node.caseBlock.clauses.flatMap((clause) => [...clause.statements]),
          switchScope,
        );
        for (const clause of node.caseBlock.clauses) {
          if (clause.expression) visit(clause.expression, switchScope);
          for (const statement of clause.statements) {
            visit(statement, switchScope);
          }
        }
        return;
      }
      if (ts.isCatchClause(node)) {
        const catchScope = new BindingScope(scope);
        if (node.variableDeclaration) {
          declareBindingName(node.variableDeclaration.name, catchScope);
          if (node.variableDeclaration.initializer) {
            visit(node.variableDeclaration.initializer, catchScope);
          }
        }
        processStatements(node.block.statements, catchScope);
        return;
      }
      if (ts.isImportDeclaration(node)) {
        setImportBindings(node, scope);
        return;
      }
      if (ts.isVariableDeclaration(node)) {
        if (node.initializer) visit(node.initializer, scope);
        if (ts.isIdentifier(node.name)) {
          const declarationList = node.parent;
          const targetScope = ts.isVariableDeclarationList(declarationList)
            ? variableDeclarationScope(declarationList, scope)
            : scope;
          targetScope.declare(node.name.text);
          targetScope.set(
            node.name.text,
            resolveValue(node.initializer, scope),
          );
        } else {
          const initializer = resolveValue(node.initializer, scope);
          const targetScope = ts.isVariableDeclarationList(node.parent)
            ? variableDeclarationScope(node.parent, scope)
            : scope;
          applyDestructuring({
            pattern: node.name,
            sourceValue: initializer,
            scope,
            targetScope,
            assignment: false,
          });
        }
        return;
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        visit(node.right, scope);
        const target = unwrapExpression(node.left);
        if (ts.isIdentifier(target)) {
          const binding = scope.binding(target.text);
          const assignedValue = resolveValue(node.right, scope);
          if (binding) {
            if (
              isPlaywrightRelated(binding.value) ||
              isPlaywrightRelated(assignedValue)
            ) {
              const reason = "reassigned Playwright alias";
              reportUnsupported(node.left, reason);
              binding.value = unsupportedPlaywright(reason);
            } else {
              binding.value = assignedValue;
            }
          } else if (isPlaywrightRelated(assignedValue)) {
            reportUnsupported(
              node.left,
              `ambiguous Playwright alias assignment ${target.text}`,
            );
          }
        } else if (
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          (ts.isObjectLiteralExpression(target) ||
            ts.isArrayLiteralExpression(target))
        ) {
          const assignedValue = resolveValue(node.right, scope);
          if (
            !applyDestructuring({
              pattern: target,
              sourceValue: assignedValue,
              scope,
              targetScope: scope,
              assignment: true,
            })
          ) {
            invalidateAssignmentTarget(node.left, scope);
          }
        } else {
          if (!invalidatePlaywrightMutation(node.left, scope)) {
            invalidateAssignmentTarget(node.left, scope);
          }
        }
        return;
      }
      if (
        (ts.isPrefixUnaryExpression(node) ||
          ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        if (!invalidatePlaywrightMutation(node.operand, scope)) {
          invalidateAssignmentTarget(node.operand, scope);
        }
        return;
      }
      if (ts.isCallExpression(node)) {
        const path = testMemberPath(node.expression, scope);
        const registrationPath =
          path &&
          (path.length === 0 ||
            (path.length === 1 && TEST_REGISTRATION_MODIFIERS.has(path[0]))) &&
          hasTestCallback(node);
        const calleeValue = resolveValue(node.expression, scope);
        if (collectRegistrations && registrationPath) {
          const title = node.arguments[0];
          if (title && ts.isStringLiteralLike(title)) {
            registrations.push({
              title: title.text,
              line: lineOf(node),
            });
          } else {
            reportUnsupported(
              node,
              "nonliteral or missing Playwright test title",
            );
          }
        } else if (
          collectRegistrations &&
          calleeValue?.kind === "unsupported-playwright"
        ) {
          reportUnsupported(node, calleeValue.reason);
        } else if (
          collectRegistrations &&
          ts.isIdentifier(unwrapExpression(node.expression)) &&
          /^(?:spec|test)$/i.test(unwrapExpression(node.expression).text) &&
          calleeValue === undefined &&
          hasTestCallback(node)
        ) {
          reportUnsupported(
            node,
            `unknown test-like binding ${unwrapExpression(node.expression).text}`,
          );
        }
      }
      ts.forEachChild(node, (child) => visit(child, scope));
    };

    visit(sourceFile, sourceScope);
    return {
      sourceFile,
      sourceScope,
      registrations,
      unsupported,
      resolveValue,
    };
  };

  const moduleExports = (fileName) => {
    const cached = moduleCache.get(fileName);
    if (cached) return cached;
    const exports = new Map();
    moduleCache.set(fileName, exports);
    const sourceText =
      fileName === entryFileName && entrySourceText !== undefined
        ? entrySourceText
        : readFileSync(join(repoRoot, fileName), "utf8");
    const analysis = scanSource(sourceText, fileName, false);
    const { sourceFile, sourceScope, resolveValue } = analysis;

    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement)) {
        const source = statement.moduleSpecifier;
        const exportedModule =
          source && ts.isStringLiteralLike(source)
            ? moduleValue(fileName, source.text)
            : undefined;
        if (!statement.exportClause) {
          for (const [name, value] of exportedModule?.exports ?? []) {
            if (name !== "default") exports.set(name, value);
          }
        } else if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            const importedName =
              element.propertyName?.text ?? element.name.text;
            const value = exportedModule
              ? exportedModule.exports.get(importedName)
              : sourceScope.binding(importedName)?.value;
            if (value) exports.set(element.name.text, value);
          }
        }
        continue;
      }
      if (ts.isExportAssignment(statement)) {
        const value = resolveValue(statement.expression, sourceScope);
        if (value) exports.set("default", value);
        continue;
      }
      const isExported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!isExported) continue;
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue;
          const value = sourceScope.binding(declaration.name.text)?.value;
          if (value) exports.set(declaration.name.text, value);
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement)) &&
        statement.name
      ) {
        const value = sourceScope.binding(statement.name.text)?.value;
        if (value) exports.set(statement.name.text, value);
      }
    }
    return exports;
  };

  return {
    scan() {
      const { registrations, unsupported } = scanSource(
        entrySourceText,
        entryFileName,
        true,
      );
      return { registrations, unsupported };
    },
  };
}

export function playwrightTestTitles(sourceText, fileName, { repoRoot } = {}) {
  return playwrightTestRegistrations(sourceText, fileName, {
    repoRoot,
  }).registrations.map((registration) => registration.title);
}

export function playwrightTestRegistrations(
  sourceText,
  fileName,
  { repoRoot } = {},
) {
  return createPlaywrightScanner({
    repoRoot,
    entryFileName: fileName,
    entrySourceText: sourceText,
  }).scan();
}

function normalizedTestIdentity(title) {
  return title.replace(/\s*@required-profile\b/g, "").trim();
}

function registrationProfiles(title) {
  return [
    "deterministic-profile",
    ...(title.includes(REQUIRED_PROFILE_ANNOTATION)
      ? ["required-profile"]
      : []),
  ];
}

function sortedProfiles(profiles) {
  return [...profiles].sort();
}

export function validateMappedTestContract({
  sourceText,
  fileName,
  inventoryEntry,
  repoRoot,
}) {
  const findings = [];
  const expectedTests = inventoryEntry.expectedTests ?? [];
  if (expectedTests.length === 0 && inventoryEntry.expectedTestCount == null) {
    return findings;
  }

  const { registrations, unsupported } = playwrightTestRegistrations(
    sourceText,
    fileName,
    { repoRoot },
  );
  for (const candidate of unsupported) {
    findings.push({
      rule: "unsupported-test-registration",
      item: `${fileName}:${candidate.line}: ${candidate.reason}`,
    });
  }

  const expectedCount =
    inventoryEntry.expectedTestCount ?? expectedTests.length;
  if (expectedCount !== expectedTests.length) {
    findings.push({
      rule: "expected-test-contract-count-mismatch",
      item: `${fileName}: declared ${expectedCount}, mapped ${expectedTests.length}`,
    });
  }
  if (registrations.length !== expectedCount) {
    findings.push({
      rule: "test-registration-count-drift",
      item: `${fileName}: expected ${expectedCount}, proven ${registrations.length}, unsupported ${unsupported.length}`,
    });
  }

  const expectedByTitle = new Map();
  for (const expected of expectedTests) {
    const entries = expectedByTitle.get(expected.test) ?? [];
    entries.push(expected);
    expectedByTitle.set(expected.test, entries);
  }
  for (const [title, entries] of expectedByTitle) {
    if (entries.length > 1) {
      findings.push({
        rule: "duplicate-expected-test-contract",
        item: `${fileName}: ${title}`,
      });
    }
  }

  const actualByTitle = new Map();
  for (const registration of registrations) {
    const title = normalizedTestIdentity(registration.title);
    const entries = actualByTitle.get(title) ?? [];
    entries.push(registration);
    actualByTitle.set(title, entries);
  }
  for (const [title, entries] of actualByTitle) {
    if (entries.length > 1) {
      findings.push({
        rule: "duplicate-test-registration",
        item: `${fileName}: ${title} (${entries.length})`,
      });
    }
  }

  for (const expected of expectedTests) {
    const actual = actualByTitle.get(expected.test) ?? [];
    if (actual.length === 0) {
      findings.push({
        rule: "missing-expected-test-registration",
        item: `${fileName}: ${expected.test}`,
      });
      continue;
    }
    if (
      JSON.stringify(sortedProfiles(registrationProfiles(actual[0].title))) !==
      JSON.stringify(sortedProfiles(expected.profiles))
    ) {
      findings.push({
        rule: "test-profile-classification-drift",
        item: `${fileName}: ${expected.test}; expected ${sortedProfiles(expected.profiles).join("+")}, actual ${sortedProfiles(registrationProfiles(actual[0].title)).join("+")}`,
      });
    }
  }
  for (const title of actualByTitle.keys()) {
    if (!expectedByTitle.has(title)) {
      findings.push({
        rule: "unexpected-test-registration",
        item: `${fileName}: ${title}`,
      });
    }
  }

  return findings;
}

export function validateDocxDeterministicProfileMapping({
  playwrightConfigText,
  importSpecText,
  specInventory,
  manualGaps,
  repoRoot,
}) {
  const findings = [];
  const profileSpecs = stringArrayVariable(
    playwrightConfigText,
    "playwright.config.ts",
    "deterministicProfileSpecs",
  );
  const inventoryEntry = specInventory.find(
    (entry) => entry.spec === DOCX_SPEC,
  );
  if (inventoryEntry) {
    findings.push(
      ...validateMappedTestContract({
        sourceText: importSpecText,
        fileName: DOCX_SPEC,
        inventoryEntry,
        repoRoot,
      }),
    );
  }
  const docxTests = playwrightTestTitles(importSpecText, DOCX_SPEC, {
    repoRoot,
  }).filter((title) => /\bDOCX\b/.test(title));
  const mappedTests = (inventoryEntry?.tests ?? []).filter((mappedTest) =>
    /\bDOCX\b/.test(mappedTest.test),
  );

  if (!profileSpecs.includes(DOCX_PROFILE_SPEC)) {
    findings.push({
      rule: "docx-spec-not-in-deterministic-profile",
      item: DOCX_SPEC,
    });
  }
  if (!inventoryEntry) {
    findings.push({ rule: "docx-spec-not-in-inventory", item: DOCX_SPEC });
    return findings;
  }
  if (docxTests.length !== 1) {
    findings.push({
      rule: "docx-test-count-drift",
      item: `${DOCX_SPEC}: expected 1, proven ${docxTests.length}`,
    });
  }
  if (inventoryEntry.runMode !== "required-ci") {
    findings.push({
      rule: "docx-required-ci-tier-drift",
      item: inventoryEntry.runMode,
    });
  }
  if (
    !/\brequired\b/i.test(inventoryEntry.ciStatus) ||
    /\b(?:advisory|manual)\b/i.test(inventoryEntry.ciStatus)
  ) {
    findings.push({
      rule: "docx-required-ci-status-drift",
      item: inventoryEntry.ciStatus,
    });
  }

  const sourceCompare = compareSets(
    docxTests,
    mappedTests.map((mappedTest) => mappedTest.test),
  );
  for (const title of sourceCompare.missing) {
    findings.push({ rule: "docx-test-not-in-inventory", item: title });
  }
  for (const title of sourceCompare.stale) {
    findings.push({ rule: "stale-docx-test-inventory", item: title });
  }
  for (const title of docxTests) {
    if (!title.includes("@required-profile")) {
      findings.push({
        rule: "docx-test-required-profile-annotation-drift",
        item: title,
      });
    }
  }
  for (const mappedTest of mappedTests) {
    if (
      mappedTest.ciTier !== "required" ||
      mappedTest.status !== "automated" ||
      mappedTest.viewport !== "Desktop Chrome" ||
      mappedTest.auth !== "seeded owner" ||
      !mappedTest.profile.includes("normal deterministic profile") ||
      mappedTest.surface.length === 0
    ) {
      findings.push({
        rule: "docx-test-execution-metadata-drift",
        item: mappedTest.test,
      });
    }
  }
  for (const gap of manualGaps) {
    if (/\bDOCX\b/i.test(`${gap.id} ${gap.gap}`)) {
      findings.push({
        rule: "docx-still-classified-as-gap",
        item: gap.id,
      });
    }
  }
  return findings;
}

export function replaceGeneratedInventorySection(readme, rendered) {
  const startIndex = readme.indexOf(GENERATED_START);
  const endIndex = readme.indexOf(GENERATED_END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `${README_PATH} must contain ${GENERATED_START} and ${GENERATED_END} markers`,
    );
  }
  return `${readme.slice(0, startIndex)}${rendered}${readme.slice(endIndex + GENERATED_END.length)}`;
}

function referencePath(sourceRef) {
  return sourceRef.split("#")[0];
}

function validateReferences(repoRoot, specInventory, manualGaps) {
  const references = new Set();
  for (const entry of specInventory) {
    references.add(entry.spec);
    for (const sourceRef of entry.sourceRefs)
      references.add(referencePath(sourceRef));
  }
  for (const gap of manualGaps) {
    for (const sourceRef of gap.sourceRefs)
      references.add(referencePath(sourceRef));
  }
  return [...references]
    .filter((sourceRef) => sourceRef.length > 0)
    .filter((sourceRef) => !existsSync(join(repoRoot, sourceRef)))
    .sort();
}

function validateUniqueSpecs(specInventory) {
  const seen = new Set();
  return specInventory
    .map((entry) => entry.spec)
    .filter((spec) => {
      if (seen.has(spec)) return true;
      seen.add(spec);
      return false;
    })
    .sort();
}

export function validateUiMatrixInventory({
  repoRoot = process.cwd(),
  specInventory,
  manualGaps,
  caseSummary,
  automatedSpecs,
  readmeText,
}) {
  const findings = [];
  const actualSpecs = collectPlaywrightSpecs(repoRoot);
  const documentedSpecs = specInventory.map((entry) => entry.spec).sort();
  const { missing, stale } = compareSets(actualSpecs, documentedSpecs);
  const duplicateSpecs = validateUniqueSpecs(specInventory);
  const missingReferences = validateReferences(
    repoRoot,
    specInventory,
    manualGaps,
  );
  const automatedCompare = compareSets(
    [...new Set(automatedSpecs)].sort(),
    documentedSpecs,
  );

  for (const spec of missing) {
    findings.push({ rule: "missing-spec-inventory", item: spec });
  }
  for (const spec of stale) {
    findings.push({ rule: "stale-spec-inventory", item: spec });
  }
  for (const spec of duplicateSpecs) {
    findings.push({ rule: "duplicate-spec-inventory", item: spec });
  }
  for (const sourceRef of missingReferences) {
    findings.push({ rule: "missing-source-reference", item: sourceRef });
  }
  for (const spec of automatedCompare.missing) {
    findings.push({ rule: "automated-spec-not-in-inventory", item: spec });
  }

  const rendered = renderInventoryMarkdown({
    specInventory,
    manualGaps,
    caseSummary,
  });
  if (typeof readmeText === "string") {
    let expected;
    try {
      expected = replaceGeneratedInventorySection(readmeText, rendered);
    } catch (error) {
      findings.push({ rule: "readme-marker-error", item: error.message });
    }
    if (expected && expected !== readmeText) {
      findings.push({ rule: "readme-inventory-drift", item: README_PATH });
    }
  }

  return { findings, rendered };
}

/* node:coverage ignore next 79 */
async function loadDefaultInventory(repoRoot) {
  const inventoryModule = await import(
    pathToFileURL(join(repoRoot, "e2e", "ui-matrix", "inventory.ts")).href
  );
  const casesModule = await import(
    pathToFileURL(join(repoRoot, "e2e", "ui-matrix", "cases.ts")).href
  );
  const automatedSpecs = casesModule.UI_TEST_CASES.filter(
    (testCase) => testCase.status === "automated" && testCase.automation,
  ).map((testCase) => testCase.automation.spec);
  return {
    specInventory: inventoryModule.UI_MATRIX_SPEC_INVENTORY,
    manualGaps: inventoryModule.UI_MATRIX_MANUAL_GAPS,
    caseSummary: casesModule.summarizeUiCases(),
    automatedSpecs,
  };
}

async function formatMarkdown(markdown) {
  const prettier = await import("prettier");
  return await prettier.format(markdown, { parser: "markdown" });
}

function printFindings(findings) {
  console.error("UI matrix inventory drift detected:");
  for (const finding of findings) {
    console.error(`  - ${finding.rule}: ${finding.item}`);
  }
}

async function main() {
  const repoRoot = process.cwd();
  const write = process.argv.includes("--write");
  const readmePath = join(repoRoot, README_PATH);
  const readmeText = readFileSync(readmePath, "utf8");
  const data = await loadDefaultInventory(repoRoot);
  const result = validateUiMatrixInventory({
    repoRoot,
    ...data,
  });
  if (
    existsSync(join(repoRoot, "playwright.config.ts")) &&
    existsSync(join(repoRoot, DOCX_SPEC)) &&
    data.specInventory.some((entry) => entry.spec === DOCX_SPEC)
  ) {
    result.findings.push(
      ...validateDocxDeterministicProfileMapping({
        playwrightConfigText: readFileSync(
          join(repoRoot, "playwright.config.ts"),
          "utf8",
        ),
        importSpecText: readFileSync(join(repoRoot, DOCX_SPEC), "utf8"),
        specInventory: data.specInventory,
        manualGaps: data.manualGaps,
        repoRoot,
      }),
    );
  }
  for (const entry of data.specInventory) {
    if (
      entry.spec === DOCX_SPEC ||
      (entry.expectedTests == null && entry.expectedTestCount == null)
    ) {
      continue;
    }
    const specPath = join(repoRoot, entry.spec);
    if (!existsSync(specPath)) continue;
    result.findings.push(
      ...validateMappedTestContract({
        sourceText: readFileSync(specPath, "utf8"),
        fileName: entry.spec,
        inventoryEntry: entry,
        repoRoot,
      }),
    );
  }
  let expectedReadme;
  try {
    expectedReadme = await formatMarkdown(
      replaceGeneratedInventorySection(readmeText, result.rendered),
    );
  } catch (error) {
    result.findings.push({ rule: "readme-marker-error", item: error.message });
  }

  if (write) {
    if (!expectedReadme || result.findings.length > 0) {
      printFindings(result.findings);
      process.exitCode = 1;
      return;
    }
    writeFileSync(readmePath, expectedReadme);
    console.log(`${toPosix(README_PATH)} refreshed.`);
    return;
  }

  if (expectedReadme && expectedReadme !== readmeText) {
    result.findings.push({ rule: "readme-inventory-drift", item: README_PATH });
  }

  if (result.findings.length > 0) {
    printFindings(result.findings);
    process.exitCode = 1;
    return;
  }

  console.log("UI matrix inventory check passed.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
