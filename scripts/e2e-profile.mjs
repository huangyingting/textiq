#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const configuredBaseUrl = process.env.E2E_BASE_URL ?? process.env.BASE_URL;
const profileServer = process.env.E2E_PROFILE_SERVER ?? "dev";

const env = {
  ...process.env,
  DB_PROVIDER: process.env.DB_PROVIDER ?? "sqlite",
  DATABASE_URL: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "ci-placeholder",
  PORT: process.env.PORT ?? portFromUrl(configuredBaseUrl) ?? "4000",
  E2E_PROFILE: "1",
  E2E_WEB_SERVER: "1",
  E2E_PROFILE_SERVER: profileServer,
  E2E_WEB_SERVER_COMMAND: process.env.E2E_WEB_SERVER_COMMAND ?? "npm run dev",
  E2E_WEB_SERVER_TIMEOUT_MS: process.env.E2E_WEB_SERVER_TIMEOUT_MS ?? "480000",
  E2E_REUSE_EXISTING_SERVER: process.env.E2E_REUSE_EXISTING_SERVER ?? "0",
};

const installBrowserArgs = [
  "playwright",
  "install",
  ...(process.env.E2E_INSTALL_BROWSER_DEPS === "1" ? ["--with-deps"] : []),
  "chromium",
];

const steps = [
  ["Generate Prisma client", "npm", ["run", "db:generate"]],
  ["Push SQLite schema", "npm", ["run", "db:push"]],
  ["Seed deterministic profile", "npm", ["run", "db:seed:e2e"]],
  ["Install Chromium", "npx", installBrowserArgs],
  ["Run deterministic E2E profile", "npx", ["playwright", "test"]],
];

if (process.argv.includes("--list")) {
  for (const [label, command, args] of steps) {
    console.log(`${label}: ${command} ${args.join(" ")}`);
  }
  process.exit(0);
}

for (const [label, command, args] of steps) {
  console.log(`\n[e2e-profile] ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function portFromUrl(value) {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).port || undefined;
  } catch {
    return undefined;
  }
}
