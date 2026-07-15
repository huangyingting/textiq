import assert from "node:assert/strict";
import test from "node:test";

import {
  createScopedPostgresTarget,
  isPostgresBillingHarnessEnabled,
  POSTGRES_BILLING_TEST_CLIENT_MODULE,
  POSTGRES_BILLING_TEST_GENERATOR,
  POSTGRES_BILLING_TEST_SCRIPT,
  runPostgresBillingHarness,
} from "./test-billing-postgres.mjs";

function captureOutput() {
  const lines = [];
  return {
    lines,
    stream: {
      write(line) {
        lines.push(String(line));
      },
    },
  };
}

test("postgres billing harness recognizes explicit opt-in flags", () => {
  assert.equal(isPostgresBillingHarnessEnabled({}), false);
  assert.equal(
    isPostgresBillingHarnessEnabled({ ENABLE_POSTGRES_BILLING_TESTS: "1" }),
    true,
  );
  assert.equal(
    isPostgresBillingHarnessEnabled({ CI_ENABLE_POSTGRES_BILLING_TESTS: "1" }),
    true,
  );
});

test("postgres billing harness creates scoped database URLs and enforces safety", () => {
  const target = createScopedPostgresTarget(
    "postgresql://localhost:5432/textiq_test?sslmode=disable",
    () => "textiq_test_billing_test_fixed",
  );

  assert.equal(target.scopedDatabaseName, "textiq_test_billing_test_fixed");
  assert.match(
    target.scopedDatabaseUrl,
    /postgresql:\/\/localhost:5432\/textiq_test_billing_test_fixed/,
  );
  assert.match(
    target.cleanupDatabaseUrl,
    /postgresql:\/\/localhost:5432\/postgres/,
  );
  assert.equal(
    new URL(target.cleanupDatabaseUrl).searchParams.get("schema"),
    null,
  );

  assert.throws(
    () =>
      createScopedPostgresTarget(
        "postgresql://localhost:5432/textiq_prod",
        () => "textiq_prod_billing_test_fixed",
      ),
    /Refusing DATABASE_URL database/,
  );
  assert.throws(
    () =>
      createScopedPostgresTarget(
        "mysql://localhost:3306/textiq_test",
        () => "textiq_test_billing_test_fixed",
      ),
    /must use postgres/i,
  );
});

test("postgres billing harness skips cleanly when opt-in flag is absent", async () => {
  let spawnCalls = 0;
  let cleanupCalls = 0;
  const stdout = captureOutput();
  const stderr = captureOutput();

  const status = await runPostgresBillingHarness({
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    spawn: () => {
      spawnCalls += 1;
      return { status: 0 };
    },
    dropDatabase: async () => {
      cleanupCalls += 1;
    },
  });

  assert.equal(status, 0);
  assert.equal(spawnCalls, 0);
  assert.equal(cleanupCalls, 0);
  assert.match(stdout.lines.join(""), /Skipping/);
  assert.equal(stderr.lines.length, 0);
});

test("postgres billing harness fails fast when enabled without DATABASE_URL", async () => {
  let spawnCalls = 0;
  let cleanupCalls = 0;
  const stderr = captureOutput();

  const status = await runPostgresBillingHarness({
    env: { ENABLE_POSTGRES_BILLING_TESTS: "1" },
    stdout: captureOutput().stream,
    stderr: stderr.stream,
    spawn: () => {
      spawnCalls += 1;
      return { status: 0 };
    },
    dropDatabase: async () => {
      cleanupCalls += 1;
    },
  });

  assert.equal(status, 1);
  assert.equal(spawnCalls, 0);
  assert.equal(cleanupCalls, 0);
  assert.match(stderr.lines.join(""), /DATABASE_URL is required/);
});

test("postgres billing harness refuses non-test DATABASE_URL targets", async () => {
  let spawnCalls = 0;
  let cleanupCalls = 0;
  const stderr = captureOutput();

  const status = await runPostgresBillingHarness({
    env: {
      ENABLE_POSTGRES_BILLING_TESTS: "1",
      DATABASE_URL: "postgresql://localhost:5432/textiq_prod",
    },
    stdout: captureOutput().stream,
    stderr: stderr.stream,
    spawn: () => {
      spawnCalls += 1;
      return { status: 0 };
    },
    dropDatabase: async () => {
      cleanupCalls += 1;
    },
    scopedDatabaseNameFactory: () => "textiq_test_billing_test_fixed",
  });

  assert.equal(status, 1);
  assert.equal(spawnCalls, 0);
  assert.equal(cleanupCalls, 0);
  assert.match(stderr.lines.join(""), /Refusing DATABASE_URL database/);
});

test("postgres billing harness runs generator, db push, and integration tests with cleanup", async () => {
  const commandCalls = [];
  const cleanupTargets = [];
  const stdout = captureOutput();

  const status = await runPostgresBillingHarness({
    env: {
      ENABLE_POSTGRES_BILLING_TESTS: "1",
      DATABASE_URL: "postgresql://localhost:5432/textiq_test",
    },
    stdout: stdout.stream,
    stderr: captureOutput().stream,
    spawn: (command, args, options) => {
      commandCalls.push({ command, args, options });
      return { status: 0 };
    },
    dropDatabase: async (target) => {
      cleanupTargets.push(target);
    },
    scopedDatabaseNameFactory: () => "textiq_test_billing_test_fixed",
  });

  assert.equal(status, 0);
  assert.deepEqual(
    commandCalls.map((call) => `${call.command} ${call.args.join(" ")}`),
    [
      `npx prisma generate --schema prisma/schema.prisma --generator ${POSTGRES_BILLING_TEST_GENERATOR}`,
      "npx prisma db push --schema prisma/schema.prisma",
      `npm run ${POSTGRES_BILLING_TEST_SCRIPT}`,
    ],
  );

  assert.deepEqual(
    commandCalls.map((call) => call.options.env.DB_PROVIDER),
    ["postgres", "postgres", "sqlite"],
  );

  for (const call of commandCalls) {
    assert.equal(
      call.options.env.POSTGRES_TEST_PRISMA_CLIENT_MODULE,
      POSTGRES_BILLING_TEST_CLIENT_MODULE,
    );
    assert.match(
      call.options.env.DATABASE_URL,
      /postgresql:\/\/localhost:5432\/textiq_test_billing_test_fixed/,
    );
  }

  assert.equal(cleanupTargets.length, 1);
  assert.equal(
    cleanupTargets[0].scopedDatabaseName,
    "textiq_test_billing_test_fixed",
  );
  assert.equal(
    new URL(cleanupTargets[0].cleanupDatabaseUrl).searchParams.get("schema"),
    null,
  );
  assert.equal(
    new URL(cleanupTargets[0].cleanupDatabaseUrl).pathname,
    "/postgres",
  );
  assert.match(stdout.lines.join(""), /Cleaning up scoped database/);
});

test("postgres billing harness still cleans up scoped database after command failure", async () => {
  const commandCalls = [];
  const cleanupTargets = [];

  const status = await runPostgresBillingHarness({
    env: {
      ENABLE_POSTGRES_BILLING_TESTS: "1",
      DATABASE_URL: "postgresql://localhost:5432/textiq_test",
    },
    stdout: captureOutput().stream,
    stderr: captureOutput().stream,
    spawn: (command, args) => {
      commandCalls.push(`${command} ${args.join(" ")}`);
      if (commandCalls.length === 2) {
        return { status: 7 };
      }
      return { status: 0 };
    },
    dropDatabase: async (target) => {
      cleanupTargets.push(target.scopedDatabaseName);
    },
    scopedDatabaseNameFactory: () => "textiq_test_billing_test_fixed",
  });

  assert.equal(status, 7);
  assert.equal(commandCalls.length, 2);
  assert.deepEqual(cleanupTargets, ["textiq_test_billing_test_fixed"]);
});
