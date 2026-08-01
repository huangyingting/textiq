import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  checkEnvInventory,
  checkRouteInventory,
  checkRuntimeConfigDefaults,
  collectApiRouteKeys,
  parseRouteMatrixKeys,
  parseRuntimeConfigNames,
  parseRuntimeConfigRows,
  scanEnvReads,
  scanEnvReadsInText,
} from "./check-docs-source-inventory.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

function fixtureRoot(name, testContext) {
  return createTestFixtureRoot(name, testContext);
}

test("docs source inventory: extracts env reads from direct and constant-key access", () => {
  const reads = scanEnvReadsInText(
    "src/example.ts",
    `
      export const FEATURE_FLAG_ENV = "FEATURE_FLAG";
      const value = process.env.AUTH_SECRET;
      const other = process.env["DATABASE_URL"];
      const enabled = env[FEATURE_FLAG_ENV];
      const port = env.PORT;
      // process.env.COMMENT_ONLY must not count.
    `,
  );

  assert.deepEqual([...reads.keys()].sort(), [
    "AUTH_SECRET",
    "DATABASE_URL",
    "FEATURE_FLAG",
    "PORT",
  ]);
});

test("docs source inventory: ignores lowercase and non-source env-like reads", () => {
  const reads = scanEnvReadsInText(
    "src/example.txt",
    `
      const lower = process.env.not_uppercase;
      const mixed = process.env["MixedCase"];
      const bracketLower = process.env["not_uppercase"];
      const valid = process.env.FEATURE_FLAG;
    `,
  );

  assert.deepEqual([...reads.keys()], ["FEATURE_FLAG"]);
});

test("docs source inventory: ignores constants that do not resolve to uppercase env names", () => {
  const reads = scanEnvReadsInText(
    "src/example.ts",
    `
      const lower = "not_uppercase";
      const missing = env[UNKNOWN_ENV_CONST];
      const invalid = env[lower];
    `,
  );

  assert.deepEqual([...reads.keys()], []);
});

test("docs source inventory: extracts env names from abuse-budget config entries", () => {
  const reads = scanEnvReadsInText(
    "src/lib/abuse-budget.ts",
    `
      export const ABUSE_BUDGET_NAMESPACES = [{
        limitEnv: "not_uppercase",
        windowEnv: "USER_GENERATION_RATE_WINDOW_MS",
        limitEnv: "USER_GENERATION_RATE_LIMIT",
      }];
    `,
  );

  assert.deepEqual([...reads.keys()].sort(), [
    "USER_GENERATION_RATE_LIMIT",
    "USER_GENERATION_RATE_WINDOW_MS",
  ]);
});

test("docs source inventory: extracts env names from configurable env key fields", () => {
  const reads = scanEnvReadsInText(
    "scripts/check-line-coverage.mjs",
    `
      export const LINE_COVERAGE_STAGES = [{
        envKey: "SOURCE_LINE_COVERAGE_MIN",
      }];
    `,
  );

  assert.deepEqual([...reads.keys()].sort(), ["SOURCE_LINE_COVERAGE_MIN"]);
});

test("docs source inventory: parses runtime-config table names", () => {
  const names = parseRuntimeConfigNames(`
| Name | Context |
| --- | --- |
| \`AUTH_SECRET\` | App server |
| not a row | no |
| \`DATABASE_URL\` | Prisma |
`);

  assert.deepEqual(names, ["AUTH_SECRET", "DATABASE_URL"]);
});

test("docs source inventory: parses runtime-config table rows", () => {
  const rows = parseRuntimeConfigRows(`
| Variable | Read by | Default |
| --- | --- | --- |
| \`AUTH_SECRET\` | App server | None |
| not a row | no | ignored |
| \`COVERAGE_BREADTH_MAX_GAP_FILES\` | Test tooling | \`0\` |
`);

  assert.deepEqual(rows.get("AUTH_SECRET"), [
    "`AUTH_SECRET`",
    "App server",
    "None",
  ]);
  assert.deepEqual(rows.get("COVERAGE_BREADTH_MAX_GAP_FILES"), [
    "`COVERAGE_BREADTH_MAX_GAP_FILES`",
    "Test tooling",
    "`0`",
  ]);
});

test("docs source inventory: compares documented defaults with source contracts", () => {
  const expectedDefaults = new Map([["COVERAGE_BREADTH_MAX_GAP_FILES", "0"]]);

  assert.deepEqual(
    checkRuntimeConfigDefaults(
      "| `COVERAGE_BREADTH_MAX_GAP_FILES` | Test tooling | `0` |",
      expectedDefaults,
    ),
    [],
  );
  assert.deepEqual(
    checkRuntimeConfigDefaults(
      "| `COVERAGE_BREADTH_MAX_GAP_FILES` | Test tooling | `167` |",
      expectedDefaults,
    ),
    [
      {
        name: "COVERAGE_BREADTH_MAX_GAP_FILES",
        expected: "0",
        actual: "167",
      },
    ],
  );
});

test("docs source inventory: parses only route matrix rows from the Matrix section", () => {
  const routes = parseRouteMatrixKeys(`
## Classifications
| \`authenticated-session\` | meaning |

## Matrix
| Route | Classification |
| --- | --- |
| \`brand\` | \`authenticated-session\` |
| \`auth/[...nextauth]\` | \`framework-auth\` |

## Related
| \`not-a-route\` | ignored |
`);

  assert.deepEqual(routes, ["auth/[...nextauth]", "brand"]);
});

test("docs source inventory: scans configured source roots and skips generated or test files", () => {
  const root = fixtureRoot("docs-source-env-scan");
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  mkdirSync(join(root, "src", "generated"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "src", "lib", "config.ts"),
    "process.env.AUTH_SECRET;",
  );
  writeFileSync(
    join(root, "src", "lib", "config.test.ts"),
    "process.env.TEST_ONLY;",
  );
  writeFileSync(
    join(root, "src", "lib", "notes.md"),
    "process.env.NOT_SOURCE;",
  );
  writeFileSync(
    join(root, "src", "generated", "client.ts"),
    "process.env.GENERATED;",
  );
  writeFileSync(join(root, "scripts", "tool.mjs"), "env.PORT;");
  writeFileSync(join(root, "server.mjs"), "process.env.DATABASE_URL;");

  assert.deepEqual([...scanEnvReads(root).keys()].sort(), [
    "AUTH_SECRET",
    "DATABASE_URL",
    "PORT",
  ]);
});

test("docs source inventory: compares env documentation with scanned source reads", () => {
  const root = fixtureRoot("docs-source-env-inventory");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs", "operations"), { recursive: true });
  writeFileSync(join(root, "src", "config.ts"), "process.env.AUTH_SECRET;");
  writeFileSync(
    join(root, "docs", "operations", "runtime-config.md"),
    "| Name | Context |\n| --- | --- |\n| `DATABASE_URL` | db |\n",
  );

  const inventory = checkEnvInventory(root);

  assert.deepEqual(inventory.missing, ["AUTH_SECRET"]);
  assert.deepEqual(inventory.stale, ["DATABASE_URL"]);
  assert.deepEqual(inventory.reads.get("AUTH_SECRET"), ["src/config.ts:1"]);
});

test("docs source inventory: compares API routes with the security matrix", () => {
  const root = fixtureRoot("docs-source-route-inventory");
  mkdirSync(join(root, "src", "app", "api", "documents", "[id]"), {
    recursive: true,
  });
  mkdirSync(join(root, "docs", "security"), { recursive: true });
  writeFileSync(
    join(root, "src", "app", "api", "documents", "[id]", "route.ts"),
    "export function GET() {}",
  );
  writeFileSync(
    join(root, "docs", "security", "api-route-security-matrix.md"),
    "## Matrix\n| Route | Classification |\n| --- | --- |\n| `stale` | old |\n",
  );

  assert.deepEqual(collectApiRouteKeys(root), ["documents/[id]"]);
  assert.deepEqual(checkRouteInventory(root), {
    missing: ["documents/[id]"],
    stale: ["stale"],
  });
});

test("docs source inventory: returns no routes when the API tree is absent", () => {
  const root = fixtureRoot("docs-source-no-api-routes");

  assert.deepEqual(collectApiRouteKeys(root), []);
});

test("docs source inventory CLI reports pass and drift results", (t) => {
  const scriptPath = join(
    process.cwd(),
    "scripts",
    "check-docs-source-inventory.mjs",
  );
  const passRoot = fixtureRoot("docs-source-cli-pass", t);
  const failRoot = fixtureRoot("docs-source-cli-fail", t);

  for (const root of [passRoot, failRoot]) {
    mkdirSync(join(root, "src", "app", "api", "status"), { recursive: true });
    mkdirSync(join(root, "docs", "operations"), { recursive: true });
    mkdirSync(join(root, "docs", "security"), { recursive: true });
    writeFileSync(
      join(root, "src", "app", "api", "status", "route.ts"),
      "export function GET() { return Response.json({ ok: true }); }\n",
    );
  }
  writeFileSync(
    join(passRoot, "docs", "operations", "runtime-config.md"),
    "| Name | Context |\n| --- | --- |\n",
  );
  writeFileSync(
    join(passRoot, "docs", "security", "api-route-security-matrix.md"),
    "## Matrix\n| Route | Classification |\n| --- | --- |\n| `status` | public |\n",
  );
  writeFileSync(
    join(failRoot, "src", "config.ts"),
    "process.env.AUTH_SECRET;\n",
  );
  writeFileSync(
    join(failRoot, "docs", "operations", "runtime-config.md"),
    "| Name | Context |\n| --- | --- |\n| `STALE_ENV` | stale |\n",
  );
  writeFileSync(
    join(failRoot, "docs", "security", "api-route-security-matrix.md"),
    "## Matrix\n| Route | Classification |\n| --- | --- |\n| `stale` | old |\n",
  );

  const passed = spawnSync(process.execPath, [scriptPath], {
    cwd: passRoot,
    encoding: "utf8",
  });
  assert.equal(passed.status, 0);
  assert.match(passed.stdout, /passed/);

  const failed = spawnSync(process.execPath, [scriptPath], {
    cwd: failRoot,
    encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Runtime config inventory drift/);
  assert.match(failed.stderr, /API route security matrix drift/);

  const missingOnlyRoot = fixtureRoot("docs-source-cli-missing-only", t);
  mkdirSync(join(missingOnlyRoot, "docs", "operations"), { recursive: true });
  mkdirSync(join(missingOnlyRoot, "docs", "security"), { recursive: true });
  mkdirSync(join(missingOnlyRoot, "src"), { recursive: true });
  writeFileSync(
    join(missingOnlyRoot, "src", "config.ts"),
    "process.env.AUTH_SECRET;\n",
  );
  writeFileSync(
    join(missingOnlyRoot, "docs", "operations", "runtime-config.md"),
    "| Name | Context |\n| --- | --- |\n",
  );
  writeFileSync(
    join(missingOnlyRoot, "docs", "security", "api-route-security-matrix.md"),
    "## Matrix\n| Route | Classification |\n| --- | --- |\n",
  );
  const missingOnly = spawnSync(process.execPath, [scriptPath], {
    cwd: missingOnlyRoot,
    encoding: "utf8",
  });
  assert.equal(missingOnly.status, 1);
  assert.doesNotMatch(missingOnly.stderr, /Env rows that no source file reads/);

  const defaultMismatchRoot = fixtureRoot(
    "docs-source-cli-default-mismatch",
    t,
  );
  mkdirSync(join(defaultMismatchRoot, "docs", "operations"), {
    recursive: true,
  });
  mkdirSync(join(defaultMismatchRoot, "docs", "security"), {
    recursive: true,
  });
  mkdirSync(join(defaultMismatchRoot, "src"), { recursive: true });
  writeFileSync(
    join(defaultMismatchRoot, "docs", "operations", "runtime-config.md"),
    "| Name | Context | Default |\n| --- | --- | --- |\n| `COVERAGE_BREADTH_MAX_GAP_FILES` | Test tooling | `167` |\n",
  );
  writeFileSync(
    join(
      defaultMismatchRoot,
      "docs",
      "security",
      "api-route-security-matrix.md",
    ),
    "## Matrix\n| Route | Classification |\n| --- | --- |\n",
  );

  const defaultMismatch = spawnSync(process.execPath, [scriptPath], {
    cwd: defaultMismatchRoot,
    encoding: "utf8",
  });
  assert.equal(defaultMismatch.status, 1);
  assert.match(
    defaultMismatch.stderr,
    /COVERAGE_BREADTH_MAX_GAP_FILES: documented "167", expected "0"/,
  );
});
