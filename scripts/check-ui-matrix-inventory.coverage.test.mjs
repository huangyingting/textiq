import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createTestFixtureRoot } from "./test-fixtures.mjs";

let inventoryModule;

async function inventory() {
  inventoryModule ??= await import("./check-ui-matrix-inventory.mjs");
  return inventoryModule;
}

test("ui matrix scanner covers conditional aliases, invalidations, and exports", async (t) => {
  const {
    playwrightTestRegistrations,
    validateMappedTestContract,
    validateUiMatrixInventory,
  } = await inventory();
  const root = createTestFixtureRoot("ui-matrix-scanner-coverage", t);
  mkdirSync(join(root, "e2e", "nested"), { recursive: true });
  writeFileSync(
    join(root, "e2e", "base.ts"),
    [
      'import { test as base } from "@playwright/test";',
      "export const test = base.extend({});",
      "export const alias = test;",
      "export default test;",
      "export function helper() {}",
      "export class Helper {}",
    ].join("\n"),
  );
  writeFileSync(join(root, "e2e", "star.ts"), 'export * from "./base";\n');
  writeFileSync(
    join(root, "e2e", "named.ts"),
    [
      'export { test as named, alias } from "./base";',
      'export { default as defaulted } from "./base";',
    ].join("\n"),
  );
  writeFileSync(
    join(root, "e2e", "bad.ts"),
    [
      'const modulePromise = import("@playwright/test");',
      "export const test = modulePromise.test;",
    ].join("\n"),
  );

  const source = [
    'import { test } from "@playwright/test";',
    'import * as pw from "@playwright/test";',
    'import { test as starTest } from "../star";',
    'import { named, defaulted } from "../named";',
    'import { test as unsupportedImport } from "../bad";',
    'import missing from "../../outside-e2e";',
    "const callback = async () => {};",
    'test("identifier callback", callback);',
    'starTest("star re-export", async () => {});',
    'named("named re-export", async () => {});',
    'defaulted("default re-export", async () => {});',
    "const same = true ? test : test;",
    'same("same conditional alias", async () => {});',
    "const conditional = true ? test : (() => {});",
    'conditional.only("unsupported conditional member", async () => {});',
    'unsupportedImport("unsupported import", async () => {});',
    'const unsupportedModule = await import("@playwright/test");',
    "const { test: destructuredUnsupportedModule } = unsupportedModule;",
    'destructuredUnsupportedModule("destructured unsupported module", async () => {});',
    "const { only, beforeEach } = test;",
    'only("destructured only", async () => {});',
    "beforeEach(async () => {});",
    "let register;",
    "({ test: register } = pw);",
    'register("assigned destructuring", async () => {});',
    "let already = () => {};",
    "({ test: already } = pw);",
    'already("ambiguous reassigned destructuring", async () => {});',
    "let defaultedTarget;",
    "({ test: defaultedTarget = missing } = pw);",
    "let shorthand;",
    "({ shorthand = missing } = pw);",
    "let propertyTarget = {};",
    "({ test: propertyTarget.value } = pw);",
    "({ method() {} } = pw);",
    "let fromArray;",
    "[fromArray = missing] = pw;",
    "let numeric;",
    "const { 0: numericAlias } = pw;",
    'numericAlias("numeric destructuring", async () => {});',
    "({ 0: numeric } = pw);",
    "const [arrayAlias] = test;",
    'arrayAlias("array destructuring", async () => {});',
    "const { register: unknownMember } = test;",
    'unknownMember("unknown member destructuring", async () => {});',
    "const { only: conditionalOnly } = conditional;",
    'conditionalOnly("unsupported conditional destructuring", async () => {});',
    "let local;",
    "local = () => {};",
    "let assignedPlaywright;",
    "assignedPlaywright = test;",
    'assignedPlaywright("assigned playwright", async () => {});',
    "ambiguousGlobal = test;",
    'ambiguousGlobal("ambiguous global", async () => {});',
    "let localObject = { nested: { value: 1 }, shorthand: 2 };",
    "let rest;",
    "({ nested: localObject.nested, shorthand, ...rest } = localObject);",
    "let index = 0;",
    "index++;",
    "for (let i = 0; i < 1; i++) { local = i; }",
    "const namedFunction = function localName() {};",
    "namedFunction();",
    "pw.expect = missing;",
    "test.only++;",
  ].join("\n");

  const scan = playwrightTestRegistrations(source, "e2e/nested/spec.spec.ts", {
    repoRoot: root,
  });

  assert.deepEqual(
    scan.registrations.map(({ title }) => title),
    [
      "identifier callback",
      "star re-export",
      "named re-export",
      "default re-export",
      "same conditional alias",
      "destructured only",
      "assigned destructuring",
    ],
  );
  assert.ok(
    scan.unsupported.some(({ reason }) =>
      reason.includes("conditional Playwright alias"),
    ),
  );
  assert.ok(
    scan.unsupported.some(({ reason }) =>
      reason.includes("ambiguous Playwright alias assignment"),
    ),
  );
  assert.ok(
    scan.unsupported.some(({ reason }) =>
      reason.includes("destructive Playwright destructuring assignment"),
    ),
  );
  assert.ok(
    scan.unsupported.some(({ reason }) =>
      reason.includes("unrecognized Playwright test member"),
    ),
  );

  const contractFindings = validateMappedTestContract({
    sourceText: source,
    fileName: "e2e/nested/spec.spec.ts",
    repoRoot: root,
    inventoryEntry: {
      expectedTestCount: 99,
      expectedTests: [
        { test: "identifier callback", profiles: ["deterministic-profile"] },
        { test: "identifier callback", profiles: ["deterministic-profile"] },
      ],
    },
  });
  assert.ok(
    contractFindings.some(
      ({ rule }) => rule === "duplicate-expected-test-contract",
    ),
  );
  assert.ok(
    contractFindings.some(
      ({ rule }) => rule === "test-registration-count-drift",
    ),
  );

  writeFileSync(join(root, "e2e", "nested", "spec.spec.ts"), source);
  const inventoryResult = validateUiMatrixInventory({
    repoRoot: root,
    specInventory: [
      {
        spec: "e2e/nested/spec.spec.ts",
        owners: ["presentation"],
        coverage: "fixture",
        runMode: "required-ci",
        prerequisites: [],
        roles: ["anonymous"],
        devices: ["Desktop Chrome"],
        ciStatus: "required",
        sourceRefs: ["e2e/nested/spec.spec.ts#L1"],
      },
    ],
    manualGaps: [],
    caseSummary: {
      total: 1,
      byStatus: { automated: 1, manual: 0, blocked: 0, catalog: 0 },
      bySubsystem: {
        presentation: {
          total: 1,
          automated: 1,
          manual: 0,
          blocked: 0,
          catalog: 0,
        },
      },
    },
    automatedSpecs: ["e2e/nested/spec.spec.ts"],
    readmeText: "missing generated markers",
  });
  assert.ok(
    inventoryResult.findings.some(({ rule }) => rule === "readme-marker-error"),
  );
});
