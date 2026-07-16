import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import ts from "typescript";

import {
  scanRepositoryRoots,
  shouldScanSourceFile,
} from "../../../scripts/source-scan-utils.mjs";

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
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);
const CANONICAL_FIELDS = new Set(["content", "contentJson"]);
const CONTENT_PROJECTION_PATH = "/src/lib/document/content-projection.ts";
const DOCUMENT_MODEL_PATH = "/src/generated/prisma/models/Document.ts";
const BACKFILL_PATH = "/src/lib/document/content-projection-backfill.ts";

type CanonicalField = "content" | "contentJson";

type ProjectorEvidence = {
  key: string;
  sourceKey: string;
};

type ProjectionAnalysis = {
  directCanonicalFields: Array<{
    field: CanonicalField;
    projectedContent?: ProjectorEvidence;
  }>;
  projectorCalls: ProjectorEvidence[];
  unresolvedSources: string[];
};

type WriteAudit = {
  filePath: string;
  line: number;
  method: string;
  branch: string;
  receiver: string;
  projection: "atomic" | "projected-cas" | "not-content-bearing";
};

type ScanContext = {
  checker: ts.TypeChecker;
  source: ts.SourceFile;
};

type WriteAccess = ts.PropertyAccessExpression | ts.ElementAccessExpression;
type Bindings = ReadonlyMap<ts.Symbol, ts.Expression>;

const EMPTY_BINDINGS: Bindings = new Map();

function emptyAnalysis(): ProjectionAnalysis {
  return {
    directCanonicalFields: [],
    projectorCalls: [],
    unresolvedSources: [],
  };
}

function mergeAnalysis(
  left: ProjectionAnalysis,
  right: ProjectionAnalysis,
): ProjectionAnalysis {
  return {
    directCanonicalFields: [
      ...left.directCanonicalFields,
      ...right.directCanonicalFields,
    ],
    projectorCalls: [...left.projectorCalls, ...right.projectorCalls],
    unresolvedSources: [...left.unresolvedSources, ...right.unresolvedSources],
  };
}

function combineAlternatives(
  left: ProjectionAnalysis[],
  right: ProjectionAnalysis[],
): ProjectionAnalysis[] {
  return left.flatMap((leftAnalysis) =>
    right.map((rightAnalysis) => mergeAnalysis(leftAnalysis, rightAnalysis)),
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
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

function propertyName(node: ts.ObjectLiteralElementLike): string | undefined {
  if (
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    if (
      ts.isIdentifier(node.name) ||
      ts.isStringLiteral(node.name) ||
      ts.isNoSubstitutionTemplateLiteral(node.name) ||
      ts.isNumericLiteral(node.name)
    ) {
      return node.name.text;
    }
  }
  return undefined;
}

function objectProperty(
  expression: ts.Expression,
  name: string,
): ts.Expression | undefined {
  const object = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(object)) return undefined;
  const property = object.properties.find(
    (candidate) => propertyName(candidate) === name,
  );
  if (property && ts.isPropertyAssignment(property)) {
    return property.initializer;
  }
  if (property && ts.isShorthandPropertyAssignment(property)) {
    return property.name;
  }
  return undefined;
}

function resolvedSymbol(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  const seen = new Set<ts.Symbol>();
  while (symbol && symbol.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) {
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol;
}

function normalizedSourcePath(node: ts.Node): string {
  return node.getSourceFile().fileName.replaceAll("\\", "/");
}

function nodeKey(node: ts.Node): string {
  return `${normalizedSourcePath(node)}:${node.pos}:${node.end}`;
}

function isConstVariableDeclaration(
  declaration: ts.VariableDeclaration,
): boolean {
  return Boolean(
    ts.isVariableDeclarationList(declaration.parent) &&
    declaration.parent.flags & ts.NodeFlags.Const,
  );
}

function isDocumentWriteCall(
  node: ts.CallExpression,
  context: ScanContext,
): node is ts.CallExpression & {
  expression: WriteAccess;
} {
  const method = writeMethodName(node.expression);
  if (!method || !WRITE_METHODS.has(method)) {
    return false;
  }
  const declaration = context.checker
    .getResolvedSignature(node)
    ?.getDeclaration();
  return Boolean(
    declaration &&
    normalizedSourcePath(declaration).endsWith(DOCUMENT_MODEL_PATH),
  );
}

function writeMethodName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteral(expression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
  ) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

function projectorName(
  call: ts.CallExpression,
  context: ScanContext,
): "projectDocumentContent" | "projectDocumentMarkdown" | undefined {
  const symbol = resolvedSymbol(call.expression, context.checker);
  if (
    (symbol?.name === "projectDocumentContent" ||
      symbol?.name === "projectDocumentMarkdown") &&
    symbol.declarations?.some((declaration) =>
      normalizedSourcePath(declaration).endsWith(CONTENT_PROJECTION_PATH),
    )
  ) {
    return symbol.name;
  }
  return undefined;
}

function valueOrigin(
  expression: ts.Expression,
  context: ScanContext,
  stack = new Set<ts.Node>(),
): string {
  const candidate = unwrapExpression(expression);
  if (stack.has(candidate)) return nodeKey(candidate);
  stack.add(candidate);

  try {
    if (ts.isIdentifier(candidate)) {
      const symbol = resolvedSymbol(candidate, context.checker);
      const declaration = symbol?.declarations?.[0];
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        isConstVariableDeclaration(declaration)
      ) {
        return valueOrigin(declaration.initializer, context, stack);
      }
      return symbol
        ? `symbol:${nodeKey(symbol.declarations?.[0] ?? candidate)}`
        : `node:${nodeKey(candidate)}`;
    }
    if (ts.isPropertyAccessExpression(candidate)) {
      return `property:${valueOrigin(candidate.expression, context, stack)}:${candidate.name.text}`;
    }
    if (
      ts.isElementAccessExpression(candidate) &&
      candidate.argumentExpression &&
      (ts.isStringLiteral(candidate.argumentExpression) ||
        ts.isNoSubstitutionTemplateLiteral(candidate.argumentExpression))
    ) {
      return `property:${valueOrigin(candidate.expression, context, stack)}:${candidate.argumentExpression.text}`;
    }
    if (
      ts.isStringLiteral(candidate) ||
      ts.isNumericLiteral(candidate) ||
      ts.isNoSubstitutionTemplateLiteral(candidate)
    ) {
      return `literal:${candidate.kind}:${candidate.text}`;
    }
    return `node:${nodeKey(candidate)}`;
  } finally {
    stack.delete(candidate);
  }
}

function projectorEvidence(
  call: ts.CallExpression,
  context: ScanContext,
  callPath: readonly ts.CallExpression[],
): ProjectorEvidence | undefined {
  const name = projectorName(call, context);
  if (!name) return undefined;
  const key = [...callPath, call].map(nodeKey).join(" -> ");
  return {
    key,
    sourceKey:
      name === "projectDocumentContent" && call.arguments[0]
        ? valueOrigin(call.arguments[0], context)
        : `approved:${key}`,
  };
}

function typeMayContainCanonicalFields(
  type: ts.Type,
  context: ScanContext,
  seen = new Set<ts.Type>(),
): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (
    type.flags &
    (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)
  ) {
    return true;
  }
  if (type.flags & ts.TypeFlags.Never) return false;
  if (type.isUnionOrIntersection()) {
    return type.types.some((member) =>
      typeMayContainCanonicalFields(member, context, seen),
    );
  }
  if (
    type.flags &
    (ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.ESSymbolLike |
      ts.TypeFlags.Null |
      ts.TypeFlags.Undefined |
      ts.TypeFlags.Void)
  ) {
    return false;
  }
  if (
    context.checker.getPropertyOfType(type, "content") ||
    context.checker.getPropertyOfType(type, "contentJson") ||
    context.checker.getIndexTypeOfType(type, ts.IndexKind.String)
  ) {
    return true;
  }
  const elementType = context.checker.getIndexTypeOfType(
    type,
    ts.IndexKind.Number,
  );
  if (
    elementType &&
    typeMayContainCanonicalFields(elementType, context, seen)
  ) {
    return true;
  }
  if (type.flags & ts.TypeFlags.Object) {
    return context.checker.getPropertiesOfType(type).length === 0;
  }
  return true;
}

function typeIsOpaque(type: ts.Type, context: ScanContext): boolean {
  if (
    type.flags &
    (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)
  ) {
    return true;
  }
  if (type.isUnionOrIntersection()) {
    return type.types.some((member) => typeIsOpaque(member, context));
  }
  return Boolean(context.checker.getIndexTypeOfType(type, ts.IndexKind.String));
}

function unresolvedSource(
  expression: ts.Expression,
  context: ScanContext,
): ProjectionAnalysis {
  const candidate = unwrapExpression(expression);
  const type = context.checker.getTypeAtLocation(candidate);
  const text = candidate
    .getText(candidate.getSourceFile())
    .replace(/\s+/g, " ")
    .trim();
  const label = text.length > 80 ? `${text.slice(0, 77)}...` : text;
  return {
    ...emptyAnalysis(),
    unresolvedSources: [
      `cannot prove whether data source \`${label}\` writes content/contentJson (type: ${context.checker.typeToString(type)}); use an object literal, a visible typed helper, or the canonical projector`,
    ],
  };
}

function returnedExpressions(
  declaration: ts.FunctionLikeDeclaration,
): ts.Expression[] {
  if (!declaration.body) return [];
  if (!ts.isBlock(declaration.body)) return [declaration.body];

  const expressions: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return expressions;
}

function projectedContentEvidence(
  expression: ts.Expression,
  context: ScanContext,
  callPath: readonly ts.CallExpression[],
  stack = new Set<ts.Node>(),
): ProjectorEvidence | undefined {
  const candidate = unwrapExpression(expression);
  if (stack.has(candidate)) return undefined;
  stack.add(candidate);

  try {
    if (
      !ts.isPropertyAccessExpression(candidate) ||
      candidate.name.text !== "content"
    ) {
      return undefined;
    }
    const receiver = unwrapExpression(candidate.expression);
    if (ts.isCallExpression(receiver)) {
      return projectorEvidence(receiver, context, callPath);
    }
    if (ts.isIdentifier(receiver)) {
      const declaration = resolvedSymbol(receiver, context.checker)
        ?.declarations?.[0];
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        isConstVariableDeclaration(declaration)
      ) {
        const initializer = unwrapExpression(declaration.initializer);
        return ts.isCallExpression(initializer)
          ? projectorEvidence(initializer, context, callPath)
          : undefined;
      }
    }
    return undefined;
  } finally {
    stack.delete(candidate);
  }
}

function analyzeProjection(
  expression: ts.Expression,
  context: ScanContext,
  bindings: Bindings = EMPTY_BINDINGS,
  callPath: readonly ts.CallExpression[] = [],
  stack = new Set<ts.Node>(),
): ProjectionAnalysis[] {
  const candidate = unwrapExpression(expression);
  if (stack.has(candidate)) {
    return typeMayContainCanonicalFields(
      context.checker.getTypeAtLocation(candidate),
      context,
    )
      ? [unresolvedSource(candidate, context)]
      : [emptyAnalysis()];
  }
  stack.add(candidate);

  try {
    if (ts.isCallExpression(candidate)) {
      const evidence = projectorEvidence(candidate, context, callPath);
      if (evidence) {
        return [{ ...emptyAnalysis(), projectorCalls: [evidence] }];
      }
    }

    if (ts.isObjectLiteralExpression(candidate)) {
      let alternatives = [emptyAnalysis()];
      for (const property of candidate.properties) {
        if (ts.isSpreadAssignment(property)) {
          alternatives = combineAlternatives(
            alternatives,
            analyzeProjection(
              property.expression,
              context,
              bindings,
              callPath,
              stack,
            ),
          );
          continue;
        }

        const name = propertyName(property);
        if (!name) {
          alternatives = alternatives.map((analysis) =>
            mergeAnalysis(analysis, unresolvedSource(candidate, context)),
          );
          continue;
        }
        if (!CANONICAL_FIELDS.has(name)) continue;

        const field = name as CanonicalField;
        const initializer = ts.isPropertyAssignment(property)
          ? property.initializer
          : ts.isShorthandPropertyAssignment(property)
            ? property.name
            : undefined;
        alternatives = alternatives.map((analysis) => ({
          ...analysis,
          directCanonicalFields: [
            ...analysis.directCanonicalFields,
            {
              field,
              projectedContent:
                field === "content" && initializer
                  ? projectedContentEvidence(
                      initializer,
                      context,
                      callPath,
                      stack,
                    )
                  : undefined,
            },
          ],
        }));
      }
      return alternatives;
    }

    if (ts.isArrayLiteralExpression(candidate)) {
      if (candidate.elements.length === 0) return [emptyAnalysis()];
      return candidate.elements.flatMap((element) =>
        analyzeProjection(
          ts.isSpreadElement(element) ? element.expression : element,
          context,
          bindings,
          callPath,
          stack,
        ),
      );
    }

    if (ts.isConditionalExpression(candidate)) {
      return [
        ...analyzeProjection(
          candidate.whenTrue,
          context,
          bindings,
          callPath,
          stack,
        ),
        ...analyzeProjection(
          candidate.whenFalse,
          context,
          bindings,
          callPath,
          stack,
        ),
      ];
    }

    if (
      ts.isBinaryExpression(candidate) &&
      (candidate.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        candidate.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        candidate.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      const right = analyzeProjection(
        candidate.right,
        context,
        bindings,
        callPath,
        stack,
      );
      return candidate.operatorToken.kind ===
        ts.SyntaxKind.AmpersandAmpersandToken
        ? [emptyAnalysis(), ...right]
        : [
            ...analyzeProjection(
              candidate.left,
              context,
              bindings,
              callPath,
              stack,
            ),
            ...right,
          ];
    }

    if (ts.isIdentifier(candidate)) {
      const symbol = resolvedSymbol(candidate, context.checker);
      const binding = symbol && bindings.get(symbol);
      if (binding) {
        return analyzeProjection(binding, context, bindings, callPath, stack);
      }
      if (typeIsOpaque(context.checker.getTypeAtLocation(candidate), context)) {
        return [unresolvedSource(candidate, context)];
      }
      const declaration = symbol?.declarations?.[0];
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        isConstVariableDeclaration(declaration)
      ) {
        return analyzeProjection(
          declaration.initializer,
          context,
          bindings,
          callPath,
          stack,
        );
      }
    }

    if (ts.isCallExpression(candidate)) {
      const declaration = context.checker
        .getResolvedSignature(candidate)
        ?.getDeclaration();
      if (
        declaration &&
        (ts.isFunctionDeclaration(declaration) ||
          ts.isFunctionExpression(declaration) ||
          ts.isArrowFunction(declaration) ||
          ts.isMethodDeclaration(declaration)) &&
        declaration.body
      ) {
        const returns = returnedExpressions(declaration);
        if (returns.length > 0) {
          const callBindings = new Map(bindings);
          for (const [index, parameter] of declaration.parameters.entries()) {
            if (!ts.isIdentifier(parameter.name)) continue;
            const symbol = resolvedSymbol(parameter.name, context.checker);
            const argument =
              candidate.arguments[index] ?? parameter.initializer;
            if (symbol && argument) {
              callBindings.set(symbol, argument);
            }
          }
          return returns.flatMap((returned) =>
            analyzeProjection(
              returned,
              context,
              callBindings,
              [...callPath, candidate],
              stack,
            ),
          );
        }
      }
    }

    return typeMayContainCanonicalFields(
      context.checker.getTypeAtLocation(candidate),
      context,
    )
      ? [unresolvedSource(candidate, context)]
      : [emptyAnalysis()];
  } finally {
    stack.delete(candidate);
  }
}

function approvedSnapshotOrigin(
  expression: ts.Expression,
  context: ScanContext,
): string | undefined {
  const candidate = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(candidate)) {
    const equals = objectProperty(candidate, "equals");
    return equals ? valueOrigin(equals, context) : undefined;
  }
  if (ts.isCallExpression(candidate)) {
    const symbol = resolvedSymbol(candidate.expression, context.checker);
    if (
      symbol?.name === "contentJsonSnapshotFilter" &&
      symbol.declarations?.some((declaration) =>
        normalizedSourcePath(declaration).endsWith(BACKFILL_PATH),
      ) &&
      candidate.arguments[0]
    ) {
      return valueOrigin(candidate.arguments[0], context);
    }
    return undefined;
  }
  return valueOrigin(candidate, context);
}

function classifyAlternative(
  call: ts.CallExpression,
  analysis: ProjectionAnalysis,
  context: ScanContext,
): WriteAudit["projection"] {
  if (analysis.unresolvedSources.length > 0) {
    throw new Error(analysis.unresolvedSources.join("; "));
  }

  const projectors = new Map(
    analysis.projectorCalls.map((evidence) => [evidence.key, evidence]),
  );
  const direct = analysis.directCanonicalFields;
  if (direct.length === 0) {
    if (projectors.size === 0) return "not-content-bearing";
    if (projectors.size === 1) return "atomic";
    throw new Error(
      `uses ${projectors.size} canonical projectors in one data branch; use exactly one projection result`,
    );
  }
  if (projectors.size > 0) {
    throw new Error(
      "mixes a canonical projector spread with direct content/contentJson fields",
    );
  }

  if (
    direct.length === 1 &&
    direct[0].field === "content" &&
    direct[0].projectedContent
  ) {
    const args = call.arguments[0];
    const where = args && objectProperty(args, "where");
    const contentJson = where && objectProperty(where, "contentJson");
    const updatedAt = where && objectProperty(where, "updatedAt");
    if (
      updatedAt &&
      contentJson &&
      approvedSnapshotOrigin(contentJson, context) ===
        direct[0].projectedContent.sourceKey
    ) {
      return "projected-cas";
    }
    throw new Error(
      "writes projected content without binding where.contentJson and where.updatedAt to the projector input snapshot",
    );
  }

  throw new Error(
    `writes ${direct.map(({ field }) => field).join(", ")} without one proven canonical projection result`,
  );
}

function classifyProjection(
  call: ts.CallExpression,
  data: ts.Expression,
  context: ScanContext,
): WriteAudit["projection"] {
  const projections = new Set<WriteAudit["projection"]>();
  for (const analysis of analyzeProjection(data, context)) {
    projections.add(classifyAlternative(call, analysis, context));
  }
  if (projections.size === 1) return [...projections][0]!;
  if (
    projections.size === 2 &&
    projections.has("atomic") &&
    projections.has("not-content-bearing")
  ) {
    return "atomic";
  }
  throw new Error(
    `has incompatible data branches: ${[...projections].sort().join(", ")}`,
  );
}

function dataBranches(
  call: ts.CallExpression & { expression: WriteAccess },
): Array<{ branch: string; data?: ts.Expression }> {
  const method = writeMethodName(call.expression);
  const args = call.arguments[0];
  if (!args) return [{ branch: "data" }];
  if (method === "upsert") {
    return [
      { branch: "create", data: objectProperty(args, "create") },
      { branch: "update", data: objectProperty(args, "update") },
    ];
  }
  return [{ branch: "data", data: objectProperty(args, "data") }];
}

function auditSource(
  source: ts.SourceFile,
  filePath: string,
  checker: ts.TypeChecker,
): { audits: WriteAudit[]; violations: string[] } {
  const context = { checker, source };
  const audits: WriteAudit[] = [];
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isDocumentWriteCall(node, context)) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      for (const branch of dataBranches(node)) {
        const method = writeMethodName(node.expression)!;
        const label = `${filePath}:${line + 1} document.${method} ${branch.branch}`;
        if (!branch.data) {
          violations.push(`${label} must expose an auditable data payload`);
          continue;
        }
        try {
          audits.push({
            filePath,
            line: line + 1,
            method,
            branch: branch.branch,
            receiver: node.expression.expression.getText(source),
            projection: classifyProjection(node, branch.data, context),
          });
        } catch (error) {
          violations.push(`${label} ${(error as Error).message}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { audits, violations };
}

function compilerOptions(): ts.CompilerOptions {
  const config = ts.readConfigFile(
    resolve(process.cwd(), "tsconfig.json"),
    ts.sys.readFile,
  );
  assert.equal(config.error, undefined);
  return ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd())
    .options;
}

function auditFixture(sourceText: string): {
  audits: WriteAudit[];
  violations: string[];
} {
  const fixturePath = resolve(
    process.cwd(),
    "src/lib/document/document-write-guard.fixture.ts",
  );
  const options = {
    ...compilerOptions(),
    noUnusedLocals: false,
    noUnusedParameters: false,
  };
  const defaultHost = ts.createCompilerHost(options, true);
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (fileName) =>
      resolve(fileName) === fixturePath || defaultHost.fileExists(fileName),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNew) =>
      resolve(fileName) === fixturePath
        ? ts.createSourceFile(
            fixturePath,
            sourceText,
            languageVersion,
            true,
            ts.ScriptKind.TS,
          )
        : defaultHost.getSourceFile(
            fileName,
            languageVersion,
            onError,
            shouldCreateNew,
          ),
    readFile: (fileName) =>
      resolve(fileName) === fixturePath
        ? sourceText
        : defaultHost.readFile(fileName),
  };
  const program = ts.createProgram({
    rootNames: [fixturePath],
    options,
    host,
  });
  const source = program.getSourceFile(fixturePath);
  assert.ok(source, "fixture must be loaded by a TypeScript Program");
  const diagnostics = [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ];
  assert.equal(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    }),
    "",
  );
  return auditSource(
    source,
    "document-write-guard.fixture.ts",
    program.getTypeChecker(),
  );
}

function productionSourceFiles(): string[] {
  return scanRepositoryRoots({
    repoRoot: process.cwd(),
    roots: ["src", "prisma", "scripts"],
    sourceExtensions: SOURCE_EXTENSIONS,
    shouldScanFile: (filePath: string) =>
      shouldScanSourceFile(filePath, SOURCE_EXTENSIONS) &&
      !filePath.startsWith("src/generated/") &&
      !/(^|\/)(?:__tests__|__mocks__|test|tests|mocks)(\/|$)/.test(filePath) &&
      !/\.(?:test|spec|mock)(?:-[^.]+)?\.[cm]?[jt]sx?$/.test(filePath) &&
      !/-test-fixtures?\.[cm]?[jt]sx?$/.test(filePath) &&
      !/\.d\.[cm]?ts$/.test(filePath),
    scanText: (filePath: string, sourceText: string) => {
      const source = ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.Latest,
        false,
        filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS,
      );
      let containsWriteCall = false;
      const visit = (node: ts.Node): void => {
        if (containsWriteCall) return;
        if (
          ts.isCallExpression(node) &&
          Boolean(
            writeMethodName(node.expression) &&
            WRITE_METHODS.has(writeMethodName(node.expression)!),
          )
        ) {
          containsWriteCall = true;
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return containsWriteCall ? [filePath] : [];
    },
  });
}

test("delegate discovery is semantic across aliases and transaction callbacks", () => {
  const result = auditFixture(`
    import { projectDocumentContent as canonical } from "./content-projection";
    import { prisma } from "@/lib/prisma";

    declare const contentJson: unknown;
    const unrelated = {
      document: {
        create(args: { data: unknown }) {
          return args;
        },
      },
    };
    unrelated.document.create({
      data: { content: "drift", contentJson: { root: { children: [] } } },
    });

    async function writeDocuments() {
      const documents = prisma.document;
      await documents.create({
        data: { ownerId: "owner", ...canonical(contentJson) },
      });

      const { document: renamed } = prisma;
      await renamed["update"]({
        where: { id: "doc" },
        data: canonical(contentJson),
      });

      await prisma.$transaction(async (transaction) => {
        const transactionDocuments = transaction.document;
        await transactionDocuments.updateMany({
          where: { id: "doc" },
          data: canonical(contentJson),
        });
      });
    }
  `);

  assert.deepEqual(result.violations, []);
  assert.equal(result.audits.length, 3);
  assert.deepEqual(
    result.audits.map(({ projection }) => projection),
    ["atomic", "atomic", "atomic"],
  );
});

test("trusted-looking helpers and shadowed projector names cannot forge provenance", () => {
  const result = auditFixture(`
    import type { Prisma } from "@/generated/prisma/client";
    import { prisma } from "@/lib/prisma";

    function renamedMaliciousHelper(value: unknown) {
      return {
        content: "forged",
        contentJson: value as Prisma.InputJsonValue,
      };
    }

    function projectDocumentContent(value: unknown) {
      return {
        content: "shadowed",
        contentJson: value as Prisma.InputJsonValue,
      };
    }

    async function writeDocuments() {
      await prisma.document.update({
        where: { id: "renamed" },
        data: renamedMaliciousHelper({ root: { children: [] } }),
      });
      await prisma.document.update({
        where: { id: "shadowed" },
        data: projectDocumentContent({ root: { children: [] } }),
      });
    }
  `);

  assert.equal(result.audits.length, 0);
  assert.equal(result.violations.length, 2);
  assert.ok(
    result.violations.every((violation) =>
      violation.includes(
        "writes content, contentJson without one proven canonical projection result",
      ),
    ),
  );
});

test("dynamic data and unknown spreads fail closed with their static types", () => {
  const result = auditFixture(`
    import type { Prisma } from "@/generated/prisma/client";
    import { prisma } from "@/lib/prisma";

    declare const anyPayload: any;
    declare const unknownPayload: unknown;
    declare const recordPayload: Record<string, unknown>;
    declare const dynamicBatch: Prisma.DocumentCreateManyInput[];
    const initializedAny: any = { title: "opaque" };
    const initializedRecord: Record<string, unknown> = { title: "opaque" };

    function typedLaunder(payload: { title?: string }) {
      return payload;
    }

    async function writeDocuments() {
      await prisma.document.update({
        where: { id: "any" },
        data: anyPayload,
      });
      await prisma.document.update({
        where: { id: "unknown" },
        data: unknownPayload as never,
      });
      await prisma.document.update({
        where: { id: "record" },
        data: recordPayload as never,
      });
      await prisma.document.update({
        where: { id: "spread" },
        data: { title: "still opaque", ...recordPayload } as never,
      });
      await prisma.document.update({
        where: { id: "initialized-any" },
        data: initializedAny,
      });
      await prisma.document.update({
        where: { id: "initialized-record" },
        data: { ...initializedRecord } as never,
      });
      await prisma.document.createMany({
        data: dynamicBatch,
      });
      await prisma.document.update({
        where: { id: "laundered" },
        data: typedLaunder(anyPayload),
      });
    }
  `);

  assert.equal(result.audits.length, 0);
  assert.equal(result.violations.length, 8);
  assert.match(result.violations.join("\n"), /type: any/);
  assert.match(result.violations.join("\n"), /type: unknown/);
  assert.match(result.violations.join("\n"), /type: Record<string, unknown>/);
  assert.ok(
    result.violations.every((violation) =>
      violation.includes("cannot prove whether data source"),
    ),
  );
});

test("real imported projectors and visible typed helper spreads are accepted", () => {
  const result = auditFixture(`
    import { projectDocumentContent as canonical } from "./content-projection";
    import { prisma } from "@/lib/prisma";

    type SafeMetadata = {
      shareEmbedEnabled?: boolean;
      title?: string;
    };

    declare const contentJson: unknown;
    declare const metadata: SafeMetadata;

    function buildData(value: unknown) {
      return { ...metadata, ...canonical(value) };
    }

    async function writeDocuments() {
      const projected = canonical(contentJson);
      await prisma.document.update({
        where: { id: "helper" },
        data: buildData(contentJson),
      });
      await prisma.document.update({
        where: { id: "spread" },
        data: { ...metadata, ...projected },
      });
    }
  `);

  assert.deepEqual(result.violations, []);
  assert.deepEqual(
    result.audits.map(({ projection }) => projection),
    ["atomic", "atomic"],
  );
});

test("comments and strings do not create projector evidence", () => {
  const result = auditFixture(`
    import { prisma } from "@/lib/prisma";

    async function renameDocument() {
      // projectDocumentContent({ content: "not executable" })
      const title = "projectDocumentContent content contentJson";
      await prisma.document.update({
        where: { id: "doc" },
        data: { title },
      });
    }
  `);

  assert.deepEqual(result.violations, []);
  assert.equal(result.audits.length, 1);
  assert.equal(result.audits[0].projection, "not-content-bearing");
});

test("projected CAS writes must guard the same contentJson snapshot", () => {
  const result = auditFixture(`
    import type { Prisma } from "@/generated/prisma/client";
    import { projectDocumentContent } from "./content-projection";
    import { prisma } from "@/lib/prisma";

    declare const first: unknown;
    declare const second: Prisma.InputJsonValue;

    async function writeDocument() {
      const projected = projectDocumentContent(first);
      await prisma.document.updateMany({
        where: {
          id: "doc",
          updatedAt: new Date(),
          contentJson: { equals: second },
        },
        data: { content: projected.content },
      });
    }
  `);

  assert.equal(result.audits.length, 0);
  assert.equal(result.violations.length, 1);
  assert.match(
    result.violations[0],
    /without binding where\.contentJson and where\.updatedAt to the projector input snapshot/,
  );
});

test("production document writes keep canonical projection atomic", () => {
  const relativePaths = productionSourceFiles();
  const rootNames = relativePaths.map((filePath) =>
    resolve(process.cwd(), filePath),
  );
  const program = ts.createProgram({
    rootNames,
    options: compilerOptions(),
  });
  const checker = program.getTypeChecker();
  const audits: WriteAudit[] = [];
  const violations: string[] = [];

  for (const [index, absolutePath] of rootNames.entries()) {
    const source = program.getSourceFile(absolutePath);
    assert.ok(
      source,
      `TypeScript program must include ${relativePaths[index]}`,
    );
    const result = auditSource(source, relativePaths[index], checker);
    audits.push(...result.audits);
    violations.push(...result.violations);
  }

  assert.deepEqual(violations, []);
  assert.ok(
    audits.length > 0,
    "expected production document writes to be audited",
  );
  const onboarding = audits.filter(
    (audit) =>
      audit.filePath === "src/lib/onboarding/seed-sample-document.ts" &&
      audit.method === "create",
  );
  assert.equal(onboarding.length, 1);
  assert.equal(onboarding[0].receiver, "db.document");
  assert.equal(onboarding[0].projection, "atomic");

  const backfill = audits.filter(
    (audit) =>
      audit.filePath === "src/lib/document/content-projection-backfill.ts" &&
      audit.method === "updateMany",
  );
  assert.equal(backfill.length, 1);
  assert.equal(backfill[0].projection, "projected-cas");
});
