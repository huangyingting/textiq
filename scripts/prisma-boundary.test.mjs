import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  analyzePrismaBoundarySource,
  formatPrismaBoundaryFindings,
  runPrismaBoundaryCheck,
} from "./prisma-boundary.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

function kinds(source, filePath = "src/lib/unsafe.ts") {
  return analyzePrismaBoundarySource(source, filePath).map(
    (finding) => finding.kind,
  );
}

test("owned Prisma internal imports are allowlisted narrowly", () => {
  const source =
    'import { documentWriteDelegate } from "@/lib/prisma-internal";';

  assert.deepEqual(
    kinds(source, "src/lib/document/document-write-port.ts"),
    [],
  );
  assert.deepEqual(kinds(source), ["raw-internal-import"]);
});

test("generated PrismaClient ownership stays in prisma-internal", () => {
  assert.deepEqual(
    kinds(
      'import { PrismaClient } from "@/generated/prisma/client"; new PrismaClient();',
    ),
    ["raw-client-import"],
  );
});

test("raw test helpers and alternate internal import spellings stay test-only", () => {
  assert.deepEqual(kinds('import { prisma } from "@/test/prisma-raw";'), [
    "test-raw-import",
  ]);
  assert.deepEqual(
    kinds('import { documentWriteDelegate } from "@/lib/prisma-internal.ts";'),
    ["raw-internal-import"],
  );
  assert.deepEqual(
    kinds(
      'import { PrismaClient } from "@/generated/prisma/client.ts";',
      "src/lib/prisma.test.ts",
    ),
    [],
  );
});

test("Tank escape: destructured mutation through an any cast is rejected", () => {
  assert.ok(
    kinds(`
      import { prisma } from "@/lib/prisma";
      const { update } = prisma.document as any;
      void update({ where: { id: "doc" }, data: { content: "forged" } });
    `).includes("unsafe-cast"),
  );
});

test("unknown, assertion, element, and nested cast forms are rejected", () => {
  const findings = kinds(`
    import { prisma as db } from "@/lib/prisma";
    const nested = { delegate: (db satisfies typeof db)!.document } as unknown;
    const element = <any>db["document"];
    void nested;
    void element;
  `);

  assert.equal(findings.filter((kind) => kind === "unsafe-cast").length, 2);
});

test("raw Prisma type assertions cannot recover mutation members", () => {
  assert.ok(
    kinds(`
      import { Prisma } from "@/generated/prisma/client";
      import { prisma } from "@/lib/prisma";
      const raw = prisma as Prisma.TransactionClient;
      void raw.document.update({ where: { id: "doc" }, data: {} });
    `).includes("unsafe-cast"),
  );
});

test("direct any delegate initialization is rejected", () => {
  assert.ok(
    kinds(`
      import { prisma } from "@/lib/prisma";
      const documents: any = prisma.document;
      void documents;
    `).includes("unsafe-assignment"),
  );
});

test("Tank escape: reassigned any delegate is rejected", () => {
  assert.ok(
    kinds(`
      import { prisma } from "@/lib/prisma";
      let documents: any;
      documents = prisma.document;
      void documents.update({ where: { id: "doc" }, data: { content: "forged" } });
    `).includes("unsafe-assignment"),
  );
});

test("script clients receive the same restricted delegate", () => {
  assert.ok(
    kinds(
      `
        import { createScriptPrismaClient as createClient } from "./script-prisma-client";
        const db = createClient();
        const documents: unknown = db["document"];
        void documents;
      `,
      "prisma/seed.ts",
    ).includes("unsafe-assignment"),
  );
});

test("Tank escape: parameter transfer to any is rejected", () => {
  assert.ok(
    kinds(`
      import { prisma } from "@/lib/prisma";
      function mutate(documents: any) {
        return documents.update({ data: { content: "forged" } });
      }
      void mutate(prisma.document);
    `).includes("unsafe-parameter-transfer"),
  );
});

test("function-expression and arrow parameters are checked syntactically", () => {
  const findings = kinds(`
    import { prisma } from "@/lib/prisma";
    const mutate = function (documents: unknown) { void documents; };
    const remove = (documents: any) => void documents;
    mutate(prisma.document);
    remove(prisma.document);
  `);

  assert.equal(
    findings.filter((kind) => kind === "unsafe-parameter-transfer").length,
    2,
  );
});

test("Tank escape: dynamic model mutation access is rejected", () => {
  assert.ok(
    kinds(`
      import { prisma } from "@/lib/prisma";
      const model: any = "document";
      void prisma[model].update({ data: { content: "forged" } });
    `).includes("dynamic-model-access"),
  );
});

test("suppression and reflection cannot recover mutation capabilities", () => {
  const findings = kinds(`
    import { prisma } from "@/lib/prisma";
    // @ts-ignore
    void prisma.document.update({ data: {} });
    void Reflect.get(prisma.document, "update")({ data: {} });
  `);

  assert.ok(findings.includes("suppression"));
  assert.ok(findings.includes("reflective-access"));
});

test("nocheck and dynamic Reflect access are rejected while safe reflection is ignored", () => {
  const findings = kinds(`
    // @ts-nocheck
    import { prisma } from "@/lib/prisma";
    void Reflect.get(prisma, key);
    void Reflect.get(prisma.document, "findMany");
  `);

  assert.ok(findings.includes("suppression"));
  assert.ok(findings.includes("reflective-access"));
  assert.equal(
    findings.filter((kind) => kind === "reflective-access").length,
    1,
  );
});

test("valid restricted queries and unrelated any values pass", () => {
  assert.deepEqual(
    kinds(`
      import { prisma } from "@/lib/prisma";
      const payload: any = JSON.parse("{}");
      void payload;
      void prisma.document.findMany({ select: { id: true } });
      void prisma.$transaction(async (tx) =>
        tx.document.findUnique({ where: { id: "doc" } })
      );
    `),
    [],
  );
});

test("transaction function expressions and alternate source kinds parse cleanly", () => {
  assert.deepEqual(
    kinds(
      `
        import { prisma } from "@/lib/prisma";
        void prisma.$transaction(function (tx) {
          return tx.document.findFirst({ where: { id: "doc" } });
        });
      `,
      "src/lib/query.tsx",
    ),
    [],
  );
  assert.deepEqual(
    kinds("export const value = true;", "scripts/value.mjs"),
    [],
  );
});

test("repository scan and formatter report concrete import violations", (t) => {
  const root = createTestFixtureRoot("prisma-boundary-run", t);
  mkdirSync(path.join(root, "src", "lib"), { recursive: true });
  writeFileSync(
    path.join(root, "src", "lib", "safe.ts"),
    'import { prisma } from "@/lib/prisma"; void prisma.document.findMany();\n',
  );
  writeFileSync(
    path.join(root, "src", "lib", "unsafe.ts"),
    'import { raw } from "@/lib/prisma-internal"; void raw;\n',
  );
  writeFileSync(
    path.join(root, "src", "lib", "ignored.test.ts"),
    'import { raw } from "@/lib/prisma-internal"; void raw;\n',
  );

  const report = runPrismaBoundaryCheck(root);
  assert.deepEqual(
    report.violations.map((finding) => finding.kind),
    ["raw-internal-import"],
  );
  assert.match(formatPrismaBoundaryFindings(report), /src\/lib\/unsafe\.ts:1/);
  assert.equal(formatPrismaBoundaryFindings({ violations: [] }), "");
});
