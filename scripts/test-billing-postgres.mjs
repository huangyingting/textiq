#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const enabled =
  process.env.ENABLE_POSTGRES_BILLING_TESTS === "1" ||
  process.env.CI_ENABLE_POSTGRES_BILLING_TESTS === "1";

if (!enabled) {
  process.stdout.write(
    "[test:billing:postgres] Skipping (set ENABLE_POSTGRES_BILLING_TESTS=1 to enable).\n",
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  process.stderr.write(
    "[test:billing:postgres] DATABASE_URL is required when ENABLE_POSTGRES_BILLING_TESTS=1.\n",
  );
  process.exit(1);
}

const result = spawnSync("npm", ["run", "test:billing"], {
  stdio: "inherit",
  env: {
    ...process.env,
    DB_PROVIDER: "postgres",
  },
});

process.exit(result.status ?? 1);
