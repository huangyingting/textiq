import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import test, { mock } from "node:test";

import { chromium } from "@playwright/test";

import {
  checkGeneratedPrismaClient,
  checkEnvironment,
  checkNodeVersion,
  checkPlaywrightBrowser,
  checkPort,
  checkSqliteSchema,
  describeEnvValue,
  runDoctor,
  summarize,
} from "./dev-doctor.mjs";
import { createTestFixtureRoot, testFixturePath } from "./test-fixtures.mjs";

function fixtureRoot(name, testContext) {
  return createTestFixtureRoot(name, testContext);
}

test("dev doctor accepts Node 22 and newer", () => {
  assert.equal(checkNodeVersion("22.11.0").status, "ok");
  assert.equal(checkNodeVersion("24.0.0").status, "ok");
  assert.equal(checkNodeVersion("20.12.0").status, "fail");
  assert.match(checkNodeVersion("not-a-version").message, /Cannot parse/);
});

test("repository metadata codifies the Node 22 runtime policy", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const nvmrc = readFileSync(".nvmrc", "utf8").trim();

  assert.equal(packageJson.engines.node, ">=22");
  assert.equal(nvmrc, "22");
  assert.match(checkNodeVersion("20.12.0").hint, /package\.json engines/);
});

test("dev doctor redacts secret-like environment values", () => {
  const env = {
    AUTH_SECRET: "super-secret",
    DATABASE_URL: "file:./prisma/dev.db",
  };
  assert.equal(describeEnvValue("AUTH_SECRET", env), "set (redacted)");
  assert.equal(
    describeEnvValue("DATABASE_URL", env),
    "set to file:./prisma/dev.db",
  );
});

test("dev doctor reports missing auth secret as a repairable warning", () => {
  const results = checkEnvironment({
    DB_PROVIDER: "sqlite",
    DATABASE_URL: "file:./prisma/dev.db",
  });
  assert.equal(summarize(results).failures, 0);
  assert.equal(summarize(results).warnings, 1);
  assert.match(results.at(-1).hint, /dev:setup/);
});

test("dev doctor fails postgres without DATABASE_URL", () => {
  const results = checkEnvironment({ DB_PROVIDER: "postgres" });
  assert.equal(
    results.some((result) => result.status === "fail"),
    true,
  );
});

test("dev doctor reports invalid providers and present auth secrets", () => {
  const results = checkEnvironment({
    DB_PROVIDER: "mysql",
    DATABASE_URL: "mysql://example",
    AUTH_SECRET: "secret",
  });

  assert.equal(results[0].status, "fail");
  assert.equal(results.at(-1).message, "AUTH_SECRET is set (redacted).");
});

test("dev doctor detects generated Prisma client presence and absence", () => {
  const root = fixtureRoot("dev-doctor-prisma-client");

  assert.equal(checkGeneratedPrismaClient(root).status, "fail");

  mkdirSync(join(root, "src", "generated", "prisma"), { recursive: true });
  writeFileSync(join(root, "src", "generated", "prisma", "index.js"), "");

  assert.equal(checkGeneratedPrismaClient(root).status, "ok");
});

test("dev doctor checks SQLite schema file presence without drift verification", () => {
  const root = fixtureRoot("dev-doctor-sqlite-schema");

  assert.equal(checkSqliteSchema(root).status, "fail");

  mkdirSync(join(root, "prisma"), { recursive: true });
  writeFileSync(
    join(root, "prisma", "schema.sqlite.prisma"),
    "datasource db {}",
  );

  assert.equal(checkSqliteSchema(root).status, "ok");
});

test("dev doctor reports SQLite schema drift when verification fails", () => {
  const root = fixtureRoot("dev-doctor-sqlite-drift");
  mkdirSync(join(root, "prisma"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "prisma", "schema.sqlite.prisma"),
    "datasource db {}",
  );
  writeFileSync(
    join(root, "scripts", "gen-sqlite-schema.mjs"),
    "process.exit(1);\n",
  );

  const result = checkSqliteSchema(root, { verifyDrift: true });

  assert.equal(result.status, "fail");
  assert.match(result.message, /drift/);
});

test("dev doctor reports missing Playwright Chromium installs", () => {
  mock.method(chromium, "executablePath", () =>
    testFixturePath("missing-chromium"),
  );

  const result = checkPlaywrightBrowser();

  assert.equal(result.status, "fail");
  assert.match(result.hint, /playwright install chromium/);
});

test("dev doctor reports installed Playwright Chromium", () => {
  const root = fixtureRoot("dev-doctor-chromium-present");
  const executable = join(root, "chromium");
  writeFileSync(executable, "");
  mock.method(chromium, "executablePath", () => executable);

  const result = checkPlaywrightBrowser();

  assert.equal(result.status, "ok");
});

test("dev doctor reports ports as available or already in use", async () => {
  const available = await checkPort(0);
  assert.equal(available.status, "ok");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const busy = await checkPort(port);
    assert.equal(busy.status, "warn");
    assert.match(busy.message, new RegExp(`Port ${port} is already in use`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("dev doctor loads local env and returns the full check list", async () => {
  const results = await runDoctor({
    repoRoot: process.cwd(),
    env: {
      DB_PROVIDER: "sqlite",
      DATABASE_URL: "file:./prisma/dev.db",
      AUTH_SECRET: "secret",
      PORT: "0",
    },
  });

  assert.equal(results.length, 8);
  assert.ok(results.some((result) => result.name === "playwright.chromium"));
});

test("dev doctor CLI prints results and exits nonzero for missing fixture setup", (t) => {
  const root = fixtureRoot("dev-doctor-cli", t);
  writeFileSync(join(root, ".env"), "AUTH_SECRET=local-secret\n");

  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "scripts", "dev-doctor.mjs")],
    {
      cwd: root,
      env: { ...process.env, DB_PROVIDER: "sqlite", DATABASE_URL: "" },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Doctor complete:/);
  assert.match(result.stdout, /AUTH_SECRET is set \(redacted\)/);
});
