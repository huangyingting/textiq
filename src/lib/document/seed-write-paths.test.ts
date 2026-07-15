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
  "upsert",
  "createMany",
  "update",
  "updateMany",
]);
const PROJECTORS = new Set([
  "projectDocumentContent",
  "projectDocumentMarkdown",
]);

type ProjectionAnalysis = {
  directCanonicalFields: Array<{
    field: "content" | "contentJson";
    projected: boolean;
  }>;
  projectorCalls: number;
  unresolvedCanonicalSources: number;
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
  allowFixtureProjectors?: boolean;
  checker?: ts.TypeChecker;
  source: ts.SourceFile;
};

function emptyAnalysis(): ProjectionAnalysis {
  return {
    directCanonicalFields: [],
    projectorCalls: 0,
    unresolvedCanonicalSources: 0,
  };
}

function mergeAnalysis(
  target: ProjectionAnalysis,
  source: ProjectionAnalysis,
): void {
  target.directCanonicalFields.push(...source.directCanonicalFields);
  target.projectorCalls += source.projectorCalls;
  target.unresolvedCanonicalSources += source.unresolvedCanonicalSources;
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
    return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
      ? node.name.text
      : undefined;
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
  checker: ts.TypeChecker | undefined,
): ts.Symbol | undefined {
  if (!checker) return undefined;
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function declarationForIdentifier(
  identifier: ts.Identifier,
  context: ScanContext,
): ts.Declaration | undefined {
  const semantic = resolvedSymbol(identifier, context.checker)
    ?.declarations?.[0];
  if (semantic) return semantic;

  let match: ts.Declaration | undefined;
  const visit = (node: ts.Node): void => {
    if (match) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === identifier.text
    ) {
      match = node;
      return;
    }
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === identifier.text
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(context.source);
  return match;
}

function normalizedSourcePath(node: ts.Node): string {
  return node.getSourceFile().fileName.replaceAll("\\", "/");
}

function isGeneratedDocumentDeclaration(node: ts.Node): boolean {
  return normalizedSourcePath(node).endsWith(
    "/src/generated/prisma/models/Document.ts",
  );
}

function typeReferencesDocumentModel(
  type: ts.Type,
  seen = new Set<ts.Type>(),
): boolean {
  if (seen.has(type)) return false;
  seen.add(type);

  const declarations = [
    ...(type.symbol?.declarations ?? []),
    ...(type.aliasSymbol?.declarations ?? []),
  ];
  if (declarations.some(isGeneratedDocumentDeclaration)) return true;

  const reference = type as ts.TypeReference;
  const typeArguments = [
    ...(reference.typeArguments ?? []),
    ...(type.aliasTypeArguments ?? []),
  ];
  if (
    typeArguments.some((argument) =>
      typeReferencesDocumentModel(argument, seen),
    )
  ) {
    return true;
  }
  return type.isUnionOrIntersection()
    ? type.types.some((member) => typeReferencesDocumentModel(member, seen))
    : false;
}

function isDocumentDelegateExpression(
  expression: ts.Expression,
  context: ScanContext,
  seen = new Set<ts.Node>(),
): boolean {
  const candidate = unwrapExpression(expression);
  if (seen.has(candidate)) return false;
  seen.add(candidate);

  if (
    ts.isPropertyAccessExpression(candidate) &&
    candidate.name.text === "document"
  ) {
    return true;
  }
  if (
    ts.isElementAccessExpression(candidate) &&
    candidate.argumentExpression &&
    ts.isStringLiteral(candidate.argumentExpression) &&
    candidate.argumentExpression.text === "document"
  ) {
    return true;
  }
  if (context.checker) {
    const type = context.checker.getTypeAtLocation(candidate);
    if (typeReferencesDocumentModel(type)) return true;
  }
  if (!ts.isIdentifier(candidate)) return false;

  const declaration = declarationForIdentifier(candidate, context);
  if (declaration && ts.isVariableDeclaration(declaration)) {
    return Boolean(
      declaration.initializer &&
      isDocumentDelegateExpression(declaration.initializer, context, seen),
    );
  }
  if (declaration && ts.isBindingElement(declaration)) {
    const sourceName = declaration.propertyName ?? declaration.name;
    return (
      (ts.isIdentifier(sourceName) || ts.isStringLiteral(sourceName)) &&
      sourceName.text === "document"
    );
  }
  return false;
}

function isDocumentWriteCall(
  node: ts.CallExpression,
  context: ScanContext,
): node is ts.CallExpression & {
  expression: ts.PropertyAccessExpression;
} {
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    !WRITE_METHODS.has(node.expression.name.text)
  ) {
    return false;
  }

  const signatureDeclaration = context.checker
    ?.getResolvedSignature(node)
    ?.getDeclaration();
  return Boolean(
    (signatureDeclaration &&
      isGeneratedDocumentDeclaration(signatureDeclaration)) ||
    isDocumentDelegateExpression(node.expression.expression, context),
  );
}

function isProjectorCall(
  expression: ts.Expression,
  context: ScanContext,
): expression is ts.CallExpression {
  const candidate = unwrapExpression(expression);
  if (!ts.isCallExpression(candidate)) return false;

  const symbol = resolvedSymbol(candidate.expression, context.checker);
  if (symbol) {
    return (
      PROJECTORS.has(symbol.name) &&
      Boolean(
        symbol.declarations?.some(
          (declaration) =>
            normalizedSourcePath(declaration).endsWith(
              "/src/lib/document/content-projection.ts",
            ) ||
            (context.allowFixtureProjectors &&
              declaration.getSourceFile() === context.source),
        ),
      )
    );
  }
  return (
    ts.isIdentifier(candidate.expression) &&
    PROJECTORS.has(candidate.expression.text)
  );
}

function expressionMayContainCanonicalFields(
  expression: ts.Expression,
  context: ScanContext,
): boolean {
  if (!context.checker) return true;
  const type = context.checker.getTypeAtLocation(expression);
  return Boolean(
    context.checker.getPropertyOfType(type, "content") ||
    context.checker.getPropertyOfType(type, "contentJson"),
  );
}

function isProjectedMember(
  expression: ts.Expression,
  context: ScanContext,
  seen = new Set<ts.Node>(),
): boolean {
  const candidate = unwrapExpression(expression);
  if (
    !ts.isPropertyAccessExpression(candidate) ||
    (candidate.name.text !== "content" && candidate.name.text !== "contentJson")
  ) {
    return false;
  }

  const receiver = unwrapExpression(candidate.expression);
  if (isProjectorCall(receiver, context)) return true;
  if (!ts.isIdentifier(receiver) || seen.has(receiver)) return false;
  seen.add(receiver);
  const declaration = declarationForIdentifier(receiver, context);
  return Boolean(
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    isProjectorCall(declaration.initializer, context),
  );
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

function analyzeProjection(
  expression: ts.Expression,
  context: ScanContext,
  seen = new Set<ts.Node>(),
): ProjectionAnalysis {
  const candidate = unwrapExpression(expression);
  if (seen.has(candidate)) return emptyAnalysis();
  seen.add(candidate);

  if (isProjectorCall(candidate, context)) {
    return {
      ...emptyAnalysis(),
      projectorCalls: 1,
    };
  }

  const analysis = emptyAnalysis();
  if (ts.isObjectLiteralExpression(candidate)) {
    for (const property of candidate.properties) {
      if (ts.isSpreadAssignment(property)) {
        mergeAnalysis(
          analysis,
          analyzeProjection(property.expression, context, seen),
        );
        continue;
      }
      const name = propertyName(property);
      if (name !== "content" && name !== "contentJson") continue;
      const initializer = ts.isPropertyAssignment(property)
        ? property.initializer
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : undefined;
      analysis.directCanonicalFields.push({
        field: name,
        projected: Boolean(
          initializer && isProjectedMember(initializer, context),
        ),
      });
    }
    return analysis;
  }

  if (ts.isArrayLiteralExpression(candidate)) {
    for (const element of candidate.elements) {
      if (!ts.isSpreadElement(element)) {
        mergeAnalysis(analysis, analyzeProjection(element, context, seen));
      } else {
        mergeAnalysis(
          analysis,
          analyzeProjection(element.expression, context, seen),
        );
      }
    }
    return analysis;
  }

  if (ts.isConditionalExpression(candidate)) {
    mergeAnalysis(
      analysis,
      analyzeProjection(candidate.whenTrue, context, seen),
    );
    mergeAnalysis(
      analysis,
      analyzeProjection(candidate.whenFalse, context, seen),
    );
    return analysis;
  }

  if (
    ts.isBinaryExpression(candidate) &&
    (candidate.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      candidate.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      candidate.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    mergeAnalysis(analysis, analyzeProjection(candidate.left, context, seen));
    mergeAnalysis(analysis, analyzeProjection(candidate.right, context, seen));
    return analysis;
  }

  if (ts.isIdentifier(candidate)) {
    const declaration = declarationForIdentifier(candidate, context);
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer
    ) {
      return analyzeProjection(declaration.initializer, context, seen);
    }
  }

  if (ts.isCallExpression(candidate)) {
    const declaration = resolvedSymbol(
      candidate.expression,
      context.checker,
    )?.declarations?.find(
      (
        item,
      ): item is
        | ts.FunctionDeclaration
        | ts.FunctionExpression
        | ts.ArrowFunction
        | ts.MethodDeclaration =>
        ts.isFunctionDeclaration(item) ||
        ts.isFunctionExpression(item) ||
        ts.isArrowFunction(item) ||
        ts.isMethodDeclaration(item),
    );
    if (declaration) {
      const returns = returnedExpressions(declaration);
      if (returns.length > 0) {
        for (const returned of returns) {
          mergeAnalysis(analysis, analyzeProjection(returned, context, seen));
        }
        return analysis;
      }
    }
  }

  if (expressionMayContainCanonicalFields(candidate, context)) {
    analysis.unresolvedCanonicalSources += 1;
  }
  return analysis;
}

function objectHasProperties(
  expression: ts.Expression | undefined,
  names: string[],
): boolean {
  if (!expression) return false;
  const candidate = unwrapExpression(expression);
  return (
    ts.isObjectLiteralExpression(candidate) &&
    names.every((name) =>
      candidate.properties.some((property) => propertyName(property) === name),
    )
  );
}

function classifyProjection(
  call: ts.CallExpression,
  data: ts.Expression,
  context: ScanContext,
): WriteAudit["projection"] {
  const analysis = analyzeProjection(data, context);
  if (
    analysis.directCanonicalFields.length === 0 &&
    analysis.unresolvedCanonicalSources === 0
  ) {
    if (analysis.projectorCalls === 0) return "not-content-bearing";
    if (analysis.projectorCalls === 1) return "atomic";
    throw new Error(
      `uses ${analysis.projectorCalls} canonical document projectors; use exactly one for the atomic data payload`,
    );
  }

  const directContent = analysis.directCanonicalFields;
  const where = objectProperty(call.arguments[0], "where");
  if (
    directContent.length === 1 &&
    directContent[0].field === "content" &&
    directContent[0].projected &&
    analysis.projectorCalls === 0 &&
    analysis.unresolvedCanonicalSources === 0 &&
    objectHasProperties(where, ["contentJson", "updatedAt"])
  ) {
    return "projected-cas";
  }

  const direct = directContent.map(({ field }) => field).join(", ");
  const problem = direct
    ? `writes ${direct} directly`
    : "contains a canonical-field source that could not be audited";
  throw new Error(
    `${problem}; use exactly one canonical document projector for the atomic data payload`,
  );
}

function dataBranches(
  call: ts.CallExpression & { expression: ts.PropertyAccessExpression },
): Array<{ branch: string; data?: ts.Expression }> {
  const method = call.expression.name.text;
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
  checker?: ts.TypeChecker,
  allowFixtureProjectors = false,
): { audits: WriteAudit[]; violations: string[] } {
  const context = { allowFixtureProjectors, checker, source };
  const audits: WriteAudit[] = [];
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isDocumentWriteCall(node, context)) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      for (const branch of dataBranches(node)) {
        const label = `${filePath}:${line + 1} document.${node.expression.name.text} ${branch.branch}`;
        if (!branch.data) {
          violations.push(`${label} must expose an auditable data payload`);
          continue;
        }
        try {
          audits.push({
            filePath,
            line: line + 1,
            method: node.expression.name.text,
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

function assertFixtureProjectionSafe(sourceText: string): WriteAudit[] {
  const source = ts.createSourceFile(
    "document-write-guard.fixture.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const result = auditSource(
    source,
    "document-write-guard.fixture.ts",
    undefined,
    true,
  );
  assert.deepEqual(result.violations, []);
  return result.audits;
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
          ts.isPropertyAccessExpression(node.expression) &&
          WRITE_METHODS.has(node.expression.name.text)
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

test("production document writes keep canonical projection atomic", () => {
  const unsafeAliasFixture = `
    declare const prisma: {
      document: { create(args: { data: Record<string, unknown> }): unknown };
    };
    const { document: documents } = prisma;
    documents.create({
      data: { content: "drift", contentJson: { root: { children: [] } } },
    });
  `;
  assert.throws(
    () => assertFixtureProjectionSafe(unsafeAliasFixture),
    /writes content, contentJson directly/,
  );

  const safeAliasFixture = `
    declare function projectDocumentContent(value: unknown): {
      content: string;
      contentJson: unknown;
    };
    declare const prisma: {
      document: { create(args: { data: Record<string, unknown> }): unknown };
    };
    const documents = prisma.document;
    documents.create({
      data: { ...projectDocumentContent({ root: { children: [] } }) },
    });
  `;
  const fixtureAudits = assertFixtureProjectionSafe(safeAliasFixture);
  assert.equal(fixtureAudits.length, 1);
  assert.equal(fixtureAudits[0].projection, "atomic");

  const relativePaths = productionSourceFiles();
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(resolve(process.cwd(), "tsconfig.json"), ts.sys.readFile)
      .config,
    ts.sys,
    process.cwd(),
  );
  const rootNames = relativePaths.map((filePath) =>
    resolve(process.cwd(), filePath),
  );
  const program = ts.createProgram({ rootNames, options: config.options });
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
});
