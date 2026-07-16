#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { Client as PgClient } from "pg";

export const POSTGRES_BILLING_TEST_GENERATOR = "billingPostgresTestClient";
export const POSTGRES_BILLING_TEST_SCRIPT = "test:billing:postgres:integration";
export const POSTGRES_BILLING_TEST_CLIENT_MODULE =
  ".test-generated/prisma-postgres-billing/client.ts";

const SAFE_TEST_TARGET_PATTERN = /(?:^|[_-])(test|ci)(?:$|[_-])/i;
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isPostgresBillingHarnessEnabled(env = process.env) {
  return (
    env.ENABLE_POSTGRES_BILLING_TESTS === "1" ||
    env.CI_ENABLE_POSTGRES_BILLING_TESTS === "1"
  );
}

function isTestScopedName(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    SAFE_TEST_TARGET_PATTERN.test(value)
  );
}

function databaseNameFromUrl(url) {
  return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
}

export function createScopedDatabaseName(
  baseDatabaseName,
  token = randomUUID().replaceAll("-", ""),
) {
  const normalizedBase = baseDatabaseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const suffix = token.slice(0, 10).toLowerCase();
  return `billing_test_${normalizedBase}_${suffix}`.slice(0, 63);
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid Postgres identifier "${identifier}".`);
  }
  return `"${identifier}"`;
}

export function createScopedPostgresTarget(
  databaseUrl,
  scopedDatabaseNameFactory = (baseDatabaseName) =>
    createScopedDatabaseName(baseDatabaseName),
) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new Error(
      `[test:billing:postgres] DATABASE_URL must be a valid postgres URL: ${toErrorMessage(error)}`,
    );
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      "[test:billing:postgres] DATABASE_URL must use postgres:// or postgresql://.",
    );
  }

  const baseDatabaseName = databaseNameFromUrl(parsed);
  if (!baseDatabaseName) {
    throw new Error(
      "[test:billing:postgres] DATABASE_URL must include a database name.",
    );
  }

  const existingSchema = parsed.searchParams.get("schema");
  if (
    !isTestScopedName(baseDatabaseName) &&
    !isTestScopedName(existingSchema)
  ) {
    throw new Error(
      `[test:billing:postgres] Refusing DATABASE_URL database "${baseDatabaseName}" because it is not test-scoped. Use a database or schema name containing "test" or "ci".`,
    );
  }

  const scopedDatabaseName = scopedDatabaseNameFactory(baseDatabaseName);
  quoteIdentifier(scopedDatabaseName);

  const scoped = new URL(parsed.toString());
  scoped.pathname = `/${encodeURIComponent(scopedDatabaseName)}`;
  scoped.searchParams.delete("schema");

  const cleanup = new URL(parsed.toString());
  cleanup.pathname = "/postgres";
  cleanup.searchParams.delete("schema");

  return {
    baseDatabaseName,
    scopedDatabaseName,
    scopedDatabaseUrl: scoped.toString(),
    cleanupDatabaseUrl: cleanup.toString(),
  };
}

export async function dropScopedPostgresDatabase(
  target,
  {
    pgClientFactory = (connectionString) => new PgClient({ connectionString }),
  } = {},
) {
  const identifier = quoteIdentifier(target.scopedDatabaseName);
  const client = pgClientFactory(target.cleanupDatabaseUrl);

  try {
    await client.connect();
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [target.scopedDatabaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${identifier}`);
  } finally {
    await client.end();
  }
}

function runCommand({ command, args, env, spawn = spawnSync }) {
  const result = spawn(command, args, { stdio: "inherit", env });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

export async function runPostgresBillingHarness({
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  spawn = spawnSync,
  dropDatabase = dropScopedPostgresDatabase,
  scopedDatabaseNameFactory = (baseDatabaseName) =>
    createScopedDatabaseName(baseDatabaseName),
} = {}) {
  if (!isPostgresBillingHarnessEnabled(env)) {
    stdout.write(
      "[test:billing:postgres] Skipping (set ENABLE_POSTGRES_BILLING_TESTS=1 to enable).\n",
    );
    return 0;
  }

  if (!env.DATABASE_URL) {
    stderr.write(
      "[test:billing:postgres] DATABASE_URL is required when ENABLE_POSTGRES_BILLING_TESTS=1.\n",
    );
    return 1;
  }

  let target;
  try {
    target = createScopedPostgresTarget(
      env.DATABASE_URL,
      scopedDatabaseNameFactory,
    );
  } catch (error) {
    stderr.write(`${toErrorMessage(error)}\n`);
    return 1;
  }

  const commandEnv = {
    ...env,
    DB_PROVIDER: "postgres",
    DATABASE_URL: target.scopedDatabaseUrl,
    POSTGRES_TEST_PRISMA_CLIENT_MODULE: POSTGRES_BILLING_TEST_CLIENT_MODULE,
  };
  const commands = [
    {
      label: "Generating isolated Postgres Prisma client",
      command: "npx",
      args: [
        "prisma",
        "generate",
        "--schema",
        "prisma/schema.prisma",
        "--generator",
        POSTGRES_BILLING_TEST_GENERATOR,
      ],
    },
    {
      label: "Provisioning scoped Postgres database",
      command: "npx",
      args: ["prisma", "db", "push", "--schema", "prisma/schema.prisma"],
    },
    {
      label: "Running Postgres billing integration tests",
      command: "npm",
      args: ["run", POSTGRES_BILLING_TEST_SCRIPT],
      envOverrides: {
        DB_PROVIDER: "sqlite",
      },
    },
  ];

  let exitCode = 0;

  try {
    for (const step of commands) {
      stdout.write(`[test:billing:postgres] ${step.label}...\n`);
      const stepStatus = runCommand({
        command: step.command,
        args: step.args,
        env: step.envOverrides
          ? { ...commandEnv, ...step.envOverrides }
          : commandEnv,
        spawn,
      });
      if (stepStatus !== 0) {
        exitCode = stepStatus;
        break;
      }
    }
  } catch (error) {
    stderr.write(`[test:billing:postgres] ${toErrorMessage(error)}\n`);
    exitCode = 1;
  } finally {
    stdout.write(
      `[test:billing:postgres] Cleaning up scoped database "${target.scopedDatabaseName}"...\n`,
    );
    try {
      await dropDatabase(target);
    } catch (error) {
      stderr.write(
        `[test:billing:postgres] Failed to clean up database "${target.scopedDatabaseName}": ${toErrorMessage(error)}\n`,
      );
      if (exitCode === 0) {
        exitCode = 1;
      }
    }
  }

  return exitCode;
}

export async function main(options = {}) {
  process.exitCode = await runPostgresBillingHarness(options);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
