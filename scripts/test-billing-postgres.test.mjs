import assert from "node:assert/strict";
import test from "node:test";

import {
  createScopedDatabaseName,
  createScopedPostgresTarget,
  dropScopedPostgresDatabase,
  isPostgresBillingHarnessEnabled,
  main,
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

test("createScopedDatabaseName generates valid scoped names from a base name", () => {
  const name = createScopedDatabaseName("textiq_test", "abcdef1234567890");
  assert.equal(name, "billing_test_textiq_test_abcdef1234");
  assert.ok(name.length <= 63);
});

test("createScopedDatabaseName normalizes special characters and trims underscores", () => {
  const name = createScopedDatabaseName("My-DB!!test", "aabbccddee112233");
  assert.match(name, /^billing_test_my_db_test_/);
  assert.ok(name.length <= 63);
});

test("createScopedDatabaseName generates unique names via default token", () => {
  const a = createScopedDatabaseName("ci_test");
  const b = createScopedDatabaseName("ci_test");
  assert.ok(a.startsWith("billing_test_ci_test_"));
  assert.notEqual(a, b);
});

test("createScopedPostgresTarget uses default scopedDatabaseNameFactory", () => {
  const target = createScopedPostgresTarget(
    "postgresql://localhost:5432/ci_test_db",
  );
  assert.match(target.scopedDatabaseName, /^billing_test_ci_test_db_/);
  assert.match(target.scopedDatabaseUrl, /postgresql:\/\/localhost:5432\//);
});

test("createScopedPostgresTarget throws for unparseable DATABASE_URL", () => {
  assert.throws(
    () => createScopedPostgresTarget("not a url at all"),
    /must be a valid postgres URL/,
  );
});

test("createScopedPostgresTarget throws when database name is absent from URL", () => {
  assert.throws(
    () =>
      createScopedPostgresTarget(
        "postgresql://localhost:5432/",
        () => "billing_test_ci_fixed",
      ),
    /must include a database name/,
  );
});

test("createScopedPostgresTarget throws when scoped name is not a valid identifier", () => {
  assert.throws(
    () =>
      createScopedPostgresTarget(
        "postgresql://localhost:5432/ci_test",
        () => "invalid-name-with-hyphens",
      ),
    /Invalid Postgres identifier/,
  );
});

test("dropScopedPostgresDatabase terminates connections and drops the database", async () => {
  const calls = [];
  const mockClient = {
    connect: async () => {
      calls.push("connect");
    },
    query: async (sql, params) => {
      calls.push({ sql, params: params ?? null });
    },
    end: async () => {
      calls.push("end");
    },
  };

  const target = {
    scopedDatabaseName: "billing_test_ci_abcdef1234",
    cleanupDatabaseUrl: "postgresql://localhost:5432/postgres",
  };

  await dropScopedPostgresDatabase(target, {
    pgClientFactory: () => mockClient,
  });

  assert.equal(calls[0], "connect");
  assert.ok(typeof calls[1].sql === "string");
  assert.ok(calls[1].sql.includes("pg_terminate_backend"));
  assert.deepEqual(calls[1].params, [target.scopedDatabaseName]);
  assert.ok(calls[2].sql.includes("DROP DATABASE IF EXISTS"));
  assert.ok(calls[2].sql.includes('"billing_test_ci_abcdef1234"'));
  assert.equal(calls[3], "end");
  assert.equal(calls.length, 4);
});

test("dropScopedPostgresDatabase still calls end() when connect throws", async () => {
  const endCalls = [];
  const mockClient = {
    connect: async () => {
      throw new Error("connection refused");
    },
    query: async () => {},
    end: async () => {
      endCalls.push("end");
    },
  };

  const target = {
    scopedDatabaseName: "billing_test_ci_abcdef1234",
    cleanupDatabaseUrl: "postgresql://localhost:5432/postgres",
  };

  await assert.rejects(
    () =>
      dropScopedPostgresDatabase(target, { pgClientFactory: () => mockClient }),
    /connection refused/,
  );
  assert.equal(endCalls.length, 1);
});

test("dropScopedPostgresDatabase still calls end() when a query throws", async () => {
  const calls = [];
  const mockClient = {
    connect: async () => {
      calls.push("connect");
    },
    query: async () => {
      calls.push("query-throw");
      throw new Error("query failed");
    },
    end: async () => {
      calls.push("end");
    },
  };

  const target = {
    scopedDatabaseName: "billing_test_ci_abcdef1234",
    cleanupDatabaseUrl: "postgresql://localhost:5432/postgres",
  };

  await assert.rejects(
    () =>
      dropScopedPostgresDatabase(target, { pgClientFactory: () => mockClient }),
    /query failed/,
  );
  assert.ok(calls.includes("end"));
});

test("postgres billing harness propagates spawn error, writes to stderr, and still cleans up", async () => {
  const cleanupTargets = [];
  const stderr = captureOutput();

  const status = await runPostgresBillingHarness({
    env: {
      ENABLE_POSTGRES_BILLING_TESTS: "1",
      DATABASE_URL: "postgresql://localhost:5432/textiq_test",
    },
    stdout: captureOutput().stream,
    stderr: stderr.stream,
    spawn: () => ({ error: new Error("spawn ENOENT"), status: null }),
    dropDatabase: async (target) => {
      cleanupTargets.push(target.scopedDatabaseName);
    },
    scopedDatabaseNameFactory: () => "textiq_test_billing_test_fixed",
  });

  assert.equal(status, 1);
  assert.equal(cleanupTargets.length, 1);
  assert.match(stderr.lines.join(""), /spawn ENOENT/);
});

test("postgres billing harness propagates non-Error spawn throws and covers toErrorMessage string path", async () => {
  const stderr = captureOutput();

  const status = await runPostgresBillingHarness({
    env: {
      ENABLE_POSTGRES_BILLING_TESTS: "1",
      DATABASE_URL: "postgresql://localhost:5432/textiq_test",
    },
    stdout: captureOutput().stream,
    stderr: stderr.stream,
    spawn: () => ({ error: "raw string error", status: null }),
    dropDatabase: async () => {},
    scopedDatabaseNameFactory: () => "textiq_test_billing_test_fixed",
  });

  assert.equal(status, 1);
  assert.match(stderr.lines.join(""), /raw string error/);
});

test("postgres billing harness reports cleanup failure and escalates to exit code 1 on success run", async () => {
  const stderr = captureOutput();
  const stdout = captureOutput();

  const status = await runPostgresBillingHarness({
    env: {
      ENABLE_POSTGRES_BILLING_TESTS: "1",
      DATABASE_URL: "postgresql://localhost:5432/textiq_test",
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
    spawn: () => ({ status: 0 }),
    dropDatabase: async () => {
      throw new Error("cleanup ECONNREFUSED");
    },
    scopedDatabaseNameFactory: () => "textiq_test_billing_test_fixed",
  });

  assert.equal(status, 1);
  assert.match(stderr.lines.join(""), /Failed to clean up database/);
  assert.match(stderr.lines.join(""), /cleanup ECONNREFUSED/);
});

test("postgres billing harness cleanup failure does not override a non-zero exit code", async () => {
  const stderr = captureOutput();

  const status = await runPostgresBillingHarness({
    env: {
      ENABLE_POSTGRES_BILLING_TESTS: "1",
      DATABASE_URL: "postgresql://localhost:5432/textiq_test",
    },
    stdout: captureOutput().stream,
    stderr: stderr.stream,
    spawn: (command, args) => {
      const label = `${command} ${args.join(" ")}`;
      if (label.includes("db push")) return { status: 3 };
      return { status: 0 };
    },
    dropDatabase: async () => {
      throw new Error("also failed");
    },
    scopedDatabaseNameFactory: () => "textiq_test_billing_test_fixed",
  });

  assert.equal(status, 3);
});

test("postgres billing harness uses default scopedDatabaseNameFactory when not provided", async () => {
  const cleanupTargets = [];

  const status = await runPostgresBillingHarness({
    env: {
      ENABLE_POSTGRES_BILLING_TESTS: "1",
      DATABASE_URL: "postgresql://localhost:5432/ci_test_db",
    },
    stdout: captureOutput().stream,
    stderr: captureOutput().stream,
    spawn: () => ({ status: 0 }),
    dropDatabase: async (target) => {
      cleanupTargets.push(target);
    },
    // intentionally omitting scopedDatabaseNameFactory to exercise the default
  });

  assert.equal(status, 0);
  assert.equal(cleanupTargets.length, 1);
  assert.match(
    cleanupTargets[0].scopedDatabaseName,
    /^billing_test_ci_test_db_/,
  );
});

test("main() sets process.exitCode via runPostgresBillingHarness skip path", async () => {
  const stdout = captureOutput();
  const prevExitCode = process.exitCode;
  try {
    await main({
      env: {},
      stdout: stdout.stream,
      stderr: captureOutput().stream,
    });
    assert.equal(process.exitCode, 0);
    assert.match(stdout.lines.join(""), /Skipping/);
  } finally {
    process.exitCode = prevExitCode;
  }
});
