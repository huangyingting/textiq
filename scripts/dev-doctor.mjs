#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { access } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";
import dotenv from "dotenv";

const REQUIRED_NODE_MAJOR = 22;
const NODE_POLICY_HINT =
  "Use Node.js 22 or newer; package.json engines and .nvmrc codify this policy.";
const SECRET_NAME_RE = /SECRET|TOKEN|PASSWORD|KEY/i;

export function checkNodeVersion(version = process.versions.node) {
  const [majorText] = version.replace(/^v/, "").split(".");
  const major = Number(majorText);
  if (!Number.isInteger(major)) {
    return fail(
      "node",
      `Cannot parse Node.js version ${version}.`,
      NODE_POLICY_HINT,
    );
  }
  if (major < REQUIRED_NODE_MAJOR) {
    return fail(
      "node",
      `Node.js ${version} is too old; CI uses Node.js ${REQUIRED_NODE_MAJOR}.`,
      NODE_POLICY_HINT,
    );
  }
  return ok(
    "node",
    major === REQUIRED_NODE_MAJOR
      ? `Node.js ${version} matches CI.`
      : `Node.js ${version} is newer than CI's Node.js ${REQUIRED_NODE_MAJOR}.`,
  );
}

export function describeEnvValue(name, env) {
  if (!env[name]) return "unset";
  return SECRET_NAME_RE.test(name) ? "set (redacted)" : `set to ${env[name]}`;
}

export function checkEnvironment(env = process.env) {
  const provider = env.DB_PROVIDER || "sqlite";
  const checks = [];
  if (!["sqlite", "postgres"].includes(provider)) {
    checks.push(
      fail(
        "env.DB_PROVIDER",
        `DB_PROVIDER is ${describeEnvValue("DB_PROVIDER", env)}; expected sqlite or postgres.`,
        "Set DB_PROVIDER=sqlite for local development.",
      ),
    );
  } else {
    checks.push(ok("env.DB_PROVIDER", `DB_PROVIDER resolves to ${provider}.`));
  }

  if (provider === "postgres" && !env.DATABASE_URL) {
    checks.push(
      fail(
        "env.DATABASE_URL",
        "DATABASE_URL is unset for DB_PROVIDER=postgres.",
        "Set DATABASE_URL to a postgresql:// URL.",
      ),
    );
  } else {
    checks.push(
      ok(
        "env.DATABASE_URL",
        env.DATABASE_URL
          ? `DATABASE_URL is ${describeEnvValue("DATABASE_URL", env)}.`
          : "DATABASE_URL is unset; SQLite defaults to file:./prisma/dev.db.",
      ),
    );
  }

  if (!env.AUTH_SECRET) {
    checks.push(
      warn(
        "env.AUTH_SECRET",
        "AUTH_SECRET is unset; auth routes may fail locally.",
        "Run npm run dev:setup to create a local .env.",
      ),
    );
  } else {
    checks.push(ok("env.AUTH_SECRET", "AUTH_SECRET is set (redacted)."));
  }
  return checks;
}

export function checkGeneratedPrismaClient(repoRoot = process.cwd()) {
  const candidates = [
    "src/generated/prisma/client.ts",
    "src/generated/prisma/client.js",
    "src/generated/prisma/index.js",
  ];
  if (candidates.some((candidate) => existsSync(join(repoRoot, candidate)))) {
    return ok("prisma.client", "Generated Prisma client is present.");
  }
  return fail(
    "prisma.client",
    "Generated Prisma client is missing.",
    "Run npm run db:generate.",
  );
}

export function checkSqliteSchema(
  repoRoot = process.cwd(),
  { verifyDrift = false } = {},
) {
  const sqliteSchema = join(repoRoot, "prisma", "schema.sqlite.prisma");
  if (!existsSync(sqliteSchema)) {
    return fail(
      "prisma.sqliteSchema",
      "SQLite Prisma schema is missing.",
      "Run npm run db:schema:sqlite.",
    );
  }
  if (verifyDrift) {
    const result = spawnSync(
      process.execPath,
      ["scripts/gen-sqlite-schema.mjs", "--check"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    if (result.status !== 0) {
      return fail(
        "prisma.sqliteSchema",
        "SQLite Prisma schema has drift from prisma/schema.prisma.",
        "Run npm run db:schema:sqlite.",
      );
    }
  }
  return ok("prisma.sqliteSchema", "SQLite Prisma schema file is present.");
}

export function checkPlaywrightBrowser() {
  const executablePath = chromium.executablePath();
  if (existsSync(executablePath)) {
    return ok(
      "playwright.chromium",
      "Playwright Chromium browser is installed.",
    );
  }
  return fail(
    "playwright.chromium",
    "Playwright Chromium browser is missing.",
    "Run npx playwright install chromium.",
  );
}

export async function checkPort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(
        warn(
          "port.app",
          `Port ${port} is already in use on ${host}.`,
          `Use PORT=${Number(port) + 1} npm run dev, or stop the process using that port.`,
        ),
      );
    });
    server.once("listening", () => {
      server.close(() => {
        resolve(ok("port.app", `Port ${port} is available on ${host}.`));
      });
    });
    server.listen(port, host);
  });
}

export function summarize(results) {
  return {
    failures: results.filter((result) => result.status === "fail").length,
    warnings: results.filter((result) => result.status === "warn").length,
  };
}

function loadLocalEnv(repoRoot) {
  const envPath = join(repoRoot, ".env");
  if (statSync(envPath, { throwIfNoEntry: false })?.isFile()) {
    dotenv.config({ path: envPath, quiet: true });
  }
}

function ok(name, message) {
  return { status: "ok", name, message };
}

function warn(name, message, hint) {
  return { status: "warn", name, message, hint };
}

function fail(name, message, hint) {
  return { status: "fail", name, message, hint };
}

async function canAccessRepoRoot(repoRoot) {
  await access(repoRoot);
}

export async function runDoctor({
  repoRoot = process.cwd(),
  env = process.env,
} = {}) {
  await canAccessRepoRoot(repoRoot);
  loadLocalEnv(repoRoot);
  const port = Number(env.PORT || 4000);
  return [
    checkNodeVersion(process.versions.node),
    ...checkEnvironment(env),
    checkGeneratedPrismaClient(repoRoot),
    checkSqliteSchema(repoRoot, { verifyDrift: true }),
    await checkPort(port),
    checkPlaywrightBrowser(),
  ];
}

function printResults(results) {
  for (const result of results) {
    const label =
      result.status === "ok" ? "✓" : result.status === "warn" ? "!" : "✗";
    console.log(`${label} ${result.name}: ${result.message}`);
    if (result.hint) console.log(`  Hint: ${result.hint}`);
  }
  const { failures, warnings } = summarize(results);
  console.log(`\nDoctor complete: ${failures} failed, ${warnings} warning(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runDoctor();
  printResults(results);
  process.exitCode = summarize(results).failures > 0 ? 1 : 0;
}
