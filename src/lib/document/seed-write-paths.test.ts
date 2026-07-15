import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import ts from "typescript";

const SEED_FILES = ["prisma/seed.ts", "prisma/seed-e2e.ts"];
const PROJECTORS = new Set([
  "projectDocumentContent",
  "projectDocumentMarkdown",
]);

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
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  const property = object.properties.find(
    (candidate) => propertyName(candidate) === name,
  );
  return property && ts.isPropertyAssignment(property)
    ? property.initializer
    : undefined;
}

function projectorName(spread: ts.SpreadAssignment): string | undefined {
  if (!ts.isCallExpression(spread.expression)) return undefined;
  return ts.isIdentifier(spread.expression.expression)
    ? spread.expression.expression.text
    : undefined;
}

function assertProjectedWrite(
  filePath: string,
  label: string,
  object: ts.ObjectLiteralExpression,
): void {
  const directCanonicalFields = object.properties
    .map(propertyName)
    .filter((name) => name === "content" || name === "contentJson");
  const projectors = object.properties
    .filter(ts.isSpreadAssignment)
    .map(projectorName)
    .filter((name): name is string => name !== undefined)
    .filter((name) => PROJECTORS.has(name));

  assert.deepEqual(
    directCanonicalFields,
    [],
    `${filePath} ${label} must not write content/contentJson independently`,
  );
  assert.equal(
    projectors.length,
    1,
    `${filePath} ${label} must use exactly one canonical document projector`,
  );
}

function writeExpression(
  call: ts.CallExpression,
  property: string,
): ts.Expression | undefined {
  const args = call.arguments[0];
  if (!args || !ts.isObjectLiteralExpression(args)) return undefined;
  return objectProperty(args, property);
}

function writeObject(
  call: ts.CallExpression,
  property: string,
): ts.ObjectLiteralExpression | undefined {
  const value = writeExpression(call, property);
  return value && ts.isObjectLiteralExpression(value) ? value : undefined;
}

function assertProjectedExpression(
  filePath: string,
  label: string,
  expression: ts.Expression,
): void {
  if (ts.isObjectLiteralExpression(expression)) {
    assertProjectedWrite(filePath, label, expression);
    return;
  }
  assert.ok(
    ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      PROJECTORS.has(expression.expression.text),
    `${filePath} ${label} must use a canonical document projector`,
  );
}

test("repository document seeds keep every create/upsert canonical projection atomic", async () => {
  let checkedWrites = 0;

  for (const relativePath of SEED_FILES) {
    const absolutePath = resolve(process.cwd(), relativePath);
    const sourceText = await readFile(absolutePath, "utf8");
    const source = ts.createSourceFile(
      absolutePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.getText(source) === "prisma.document"
      ) {
        const method = node.expression.name.text;
        if (method === "create") {
          const data = writeObject(node, "data");
          assert.ok(
            data,
            `${relativePath} document.create must use object data`,
          );
          assertProjectedWrite(relativePath, "document.create data", data);
          checkedWrites += 1;
        } else if (method === "upsert") {
          for (const branch of ["update", "create"]) {
            const data = writeObject(node, branch);
            assert.ok(
              data,
              `${relativePath} document.upsert ${branch} must be an object`,
            );
            assertProjectedWrite(
              relativePath,
              `document.upsert ${branch}`,
              data,
            );
            checkedWrites += 1;
          }
        } else if (method === "update" || method === "updateMany") {
          const data = writeExpression(node, "data");
          if (
            data &&
            (ts.isCallExpression(data) ||
              (ts.isObjectLiteralExpression(data) &&
                data.properties.some(
                  (property) =>
                    propertyName(property) === "content" ||
                    propertyName(property) === "contentJson" ||
                    (ts.isSpreadAssignment(property) &&
                      PROJECTORS.has(projectorName(property) ?? "")),
                )))
          ) {
            assertProjectedExpression(
              relativePath,
              `document.${method} data`,
              data,
            );
            checkedWrites += 1;
          }
        } else if (method === "createMany") {
          assert.fail(
            `${relativePath} document.createMany requires an explicit canonical projection audit`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  assert.equal(checkedWrites, 12);
});
