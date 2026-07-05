#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

const EXECUTE_CONFIRM_VALUE = "delete-expired";
const DEFAULT_BATCH_SIZE = 100;

export function buildRetentionCliConfig(argv, env = process.env) {
  const config = {
    dryRun: true,
    batchSize: DEFAULT_BATCH_SIZE,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      config.dryRun = true;
      continue;
    }
    if (arg === "--execute") {
      config.dryRun = false;
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      config.batchSize = parsePositiveInteger(
        arg.slice("--batch-size=".length),
        "--batch-size",
      );
      continue;
    }
    if (arg.startsWith("--auth-token-retention-days=")) {
      config.authTokenRetentionMs =
        parsePositiveInteger(
          arg.slice("--auth-token-retention-days=".length),
          "--auth-token-retention-days",
        ) *
        24 *
        60 *
        60 *
        1000;
      continue;
    }
    if (arg.startsWith("--rate-limit-retention-hours=")) {
      config.rateLimitRetentionMs =
        parsePositiveInteger(
          arg.slice("--rate-limit-retention-hours=".length),
          "--rate-limit-retention-hours",
        ) *
        60 *
        60 *
        1000;
      continue;
    }
    if (arg.startsWith("--asset-retention-days=")) {
      config.assetRetentionMs =
        parsePositiveInteger(
          arg.slice("--asset-retention-days=".length),
          "--asset-retention-days",
        ) *
        24 *
        60 *
        60 *
        1000;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (
    !config.dryRun &&
    env.RETENTION_RUNNER_CONFIRM !== EXECUTE_CONFIRM_VALUE
  ) {
    throw new Error(
      `Unsafe config: --execute requires RETENTION_RUNNER_CONFIRM=${EXECUTE_CONFIRM_VALUE}`,
    );
  }

  return config;
}

function parsePositiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number(value);
}

function createJsonLogger() {
  return {
    info(event, context) {
      console.log(JSON.stringify({ event, ...context }));
    },
    error(event, error, context) {
      console.error(
        JSON.stringify({
          event,
          ...context,
          errorName: error instanceof Error ? error.name : "Error",
        }),
      );
    },
  };
}

async function main() {
  let config;
  try {
    config = buildRetentionCliConfig(process.argv.slice(2));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "maintenance.retention.config_failed",
        error: error instanceof Error ? error.message : "Invalid config",
      }),
    );
    process.exitCode = 1;
    return;
  }

  let prismaClient;
  try {
    const [{ runOperationalRetention }, { prisma }] = await Promise.all([
      import("../src/lib/maintenance/retention-runner.ts"),
      import("../src/lib/prisma.ts"),
    ]);
    prismaClient = prisma;
    const result = await runOperationalRetention({
      ...config,
      logger: createJsonLogger(),
    });
    console.log(
      JSON.stringify({ event: "maintenance.retention.result", result }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "maintenance.retention.failed",
        errorName: error instanceof Error ? error.name : "Error",
      }),
    );
    process.exitCode = 1;
  } finally {
    await prismaClient?.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
