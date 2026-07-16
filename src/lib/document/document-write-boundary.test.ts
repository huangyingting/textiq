import assert from "node:assert/strict";
import { test } from "node:test";

import ts from "typescript";

import {
  scanRepositoryRoots,
  shouldScanSourceFile,
} from "../../../scripts/source-scan-utils.mjs";

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);
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
const WRITE_PORT_PATH = "src/lib/document/document-write-port.ts";

type BoundaryViolation = {
  filePath: string;
  line: number;
  message: string;
};

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

function accessName(expression: ts.Expression): string | undefined {
  const candidate = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(candidate)) {
    return candidate.name.text;
  }
  if (
    ts.isElementAccessExpression(candidate) &&
    candidate.argumentExpression &&
    (ts.isStringLiteral(candidate.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(candidate.argumentExpression))
  ) {
    return candidate.argumentExpression.text;
  }
  return undefined;
}

function accessReceiver(expression: ts.Expression): ts.Expression | undefined {
  const candidate = unwrapExpression(expression);
  return ts.isPropertyAccessExpression(candidate) ||
    ts.isElementAccessExpression(candidate)
    ? candidate.expression
    : undefined;
}

function bindingPropertyName(element: ts.BindingElement): string | undefined {
  const property = element.propertyName ?? element.name;
  return ts.isIdentifier(property) ||
    ts.isStringLiteral(property) ||
    ts.isNoSubstitutionTemplateLiteral(property)
    ? property.text
    : undefined;
}

function collectDocumentDelegateAliases(source: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();
  const declarations: ts.VariableDeclaration[] = [];

  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, collect);
  };
  collect(source);

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements) {
          if (
            bindingPropertyName(element) === "document" &&
            ts.isIdentifier(element.name) &&
            !aliases.has(element.name.text)
          ) {
            aliases.add(element.name.text);
            changed = true;
          }
        }
        continue;
      }
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }
      const initializer = unwrapExpression(declaration.initializer);
      const isDocumentAccess = accessName(initializer) === "document";
      const isDelegateAlias =
        ts.isIdentifier(initializer) && aliases.has(initializer.text);
      if (
        (isDocumentAccess || isDelegateAlias) &&
        !aliases.has(declaration.name.text)
      ) {
        aliases.add(declaration.name.text);
        changed = true;
      }
    }
  }

  return aliases;
}

function isDocumentDelegateExpression(
  expression: ts.Expression,
  aliases: ReadonlySet<string>,
): boolean {
  const candidate = unwrapExpression(expression);
  return (
    accessName(candidate) === "document" ||
    (ts.isIdentifier(candidate) && aliases.has(candidate.text))
  );
}

function analyzeSource(
  source: ts.SourceFile,
  filePath: string,
): BoundaryViolation[] {
  if (filePath === WRITE_PORT_PATH) return [];

  const aliases = collectDocumentDelegateAliases(source);
  const violations: BoundaryViolation[] = [];
  const seen = new Set<number>();

  const report = (node: ts.Node, message: string): void => {
    const position = node.getStart(source);
    if (seen.has(position)) return;
    seen.add(position);
    const { line } = source.getLineAndCharacterOfPosition(position);
    violations.push({ filePath, line: line + 1, message });
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const receiver = accessReceiver(node);
      const method = accessName(node);
      if (
        receiver &&
        isDocumentDelegateExpression(receiver, aliases) &&
        (method === undefined || WRITE_METHODS.has(method))
      ) {
        report(
          node,
          method
            ? `raw Prisma Document.${method} access is forbidden outside the document write port`
            : "dynamic raw Prisma Document mutation access is forbidden outside the document write port",
        );
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function parseFixture(sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    "document-write-boundary.fixture.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function productionBoundaryViolations(): BoundaryViolation[] {
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
    scanText: (filePath: string, sourceText: string) =>
      analyzeSource(
        ts.createSourceFile(
          filePath,
          sourceText,
          ts.ScriptTarget.Latest,
          true,
          filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
            ? ts.ScriptKind.TSX
            : ts.ScriptKind.TS,
        ),
        filePath,
      ),
  });
}

test("all production Document mutations cross the owned write port", () => {
  assert.deepEqual(productionBoundaryViolations(), []);
});

test("an any-aliased raw Document delegate fails closed", () => {
  const violations = analyzeSource(
    parseFixture(`
      import { prisma } from "@/lib/prisma";
      const documents: any = prisma.document;
      void documents.update({
        where: { id: "doc" },
        data: { content: "forged", contentJson: {} },
      });
    `),
    "document-write-boundary.fixture.ts",
  );

  assert.ok(violations.length >= 1);
  assert.match(
    violations.map(({ message }) => message).join("\n"),
    /delegate aliasing|Document\.update/,
  );
});

test("transaction and destructured delegate aliases fail closed", () => {
  const violations = analyzeSource(
    parseFixture(`
      import { prisma } from "@/lib/prisma";
      void prisma.$transaction(async (tx) => {
        void tx.document.updateMany({ where: { id: "direct" }, data: {} });
        const { document: documents } = tx;
        void documents["update"]({ where: { id: "alias" }, data: {} });
      });
    `),
    "document-write-boundary.fixture.ts",
  );

  assert.equal(violations.length, 2);
  assert.ok(violations.every(({ message }) => message.includes("forbidden")));
});

test("dynamic mutation access through a raw delegate fails closed", () => {
  const violations = analyzeSource(
    parseFixture(`
      import { prisma } from "@/lib/prisma";
      const documents = prisma["document"];
      declare const method: string;
      void documents[method]({ where: { id: "doc" }, data: {} });
    `),
    "document-write-boundary.fixture.ts",
  );

  assert.ok(
    violations.some(({ message }) => message.includes("dynamic raw Prisma")),
  );
});

test("the owned port is the sole raw mutation adapter", () => {
  const source = parseFixture(`
    declare const db: {
      document: { update(args: unknown): Promise<unknown> };
    };
    void db.document.update({ data: {} });
  `);

  assert.deepEqual(analyzeSource(source, WRITE_PORT_PATH), []);
  assert.equal(
    analyzeSource(source, "src/lib/document/not-the-port.ts").length,
    1,
  );
});
