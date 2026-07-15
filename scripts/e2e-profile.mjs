#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { resolveE2EOriginConfig } from "./e2e-origin.mjs";

const installBrowserArgs = [
  "playwright",
  "install",
  ...(process.env.E2E_INSTALL_BROWSER_DEPS === "1" ? ["--with-deps"] : []),
  "chromium",
];

export const E2E_PROFILE_STEPS = [
  ["Generate Prisma client", "npm", ["run", "db:generate"]],
  ["Push SQLite schema", "npm", ["run", "db:push"]],
  ["Seed deterministic profile", "npm", ["run", "db:seed:e2e"]],
  ["Install Chromium", "npx", installBrowserArgs],
  ["Run deterministic E2E profile", "npx", ["playwright", "test"]],
];

export function buildE2EProfileEnv(
  processEnv = process.env,
  { runId = `${process.pid}-${randomUUID()}` } = {},
) {
  const origin = resolveE2EOriginConfig(processEnv);
  if (!origin.origin.startsWith("http://")) {
    throw new Error(
      "The self-contained E2E server requires an http:// E2E_BASE_URL.",
    );
  }

  return {
    ...processEnv,
    DB_PROVIDER: processEnv.DB_PROVIDER ?? "sqlite",
    DATABASE_URL: processEnv.DATABASE_URL ?? "file:./prisma/dev.db",
    AUTH_SECRET: processEnv.AUTH_SECRET ?? "ci-placeholder",
    AUTH_LOGIN_RATE_LIMIT: processEnv.AUTH_LOGIN_RATE_LIMIT ?? "100",
    E2E_BASE_URL: origin.origin,
    AUTH_URL: origin.origin,
    NEXT_PUBLIC_APP_URL: origin.origin,
    HOST: origin.serverHost,
    PORT: origin.port,
    E2E_PROFILE_DIST_DIR: join(".next", "e2e-profile", runId),
    E2E_PROFILE: "1",
    E2E_WEB_SERVER: "1",
    E2E_PROFILE_SERVER: processEnv.E2E_PROFILE_SERVER ?? "dev",
    E2E_WEB_SERVER_COMMAND:
      processEnv.E2E_WEB_SERVER_COMMAND ?? "node server.mjs",
    E2E_WEB_SERVER_TIMEOUT_MS: processEnv.E2E_WEB_SERVER_TIMEOUT_MS ?? "480000",
    E2E_REUSE_EXISTING_SERVER: "0",
  };
}

export function runE2EProfile({
  argv = process.argv,
  processEnv = process.env,
  runCommand = spawnSync,
  stdout = console.log,
  cleanup = (path) => rmSync(path, { force: true, recursive: true }),
  captureConfig = captureE2EProfileConfigFiles,
  restoreConfig = restoreE2EProfileConfigFiles,
  exit = process.exit,
} = {}) {
  const env = buildE2EProfileEnv(processEnv);
  const configSnapshot = captureConfig();

  if (argv.includes("--list")) {
    for (const [label, command, args] of E2E_PROFILE_STEPS) {
      stdout(`${label}: ${command} ${args.join(" ")}`);
    }
    return;
  }

  let exitCode;
  try {
    for (const [label, command, args] of E2E_PROFILE_STEPS) {
      stdout(`\n[e2e-profile] ${label}`);
      const result = runCommand(command, args, { stdio: "inherit", env });
      if (result.status !== 0) {
        exitCode = result.status ?? 1;
        break;
      }
    }
  } finally {
    cleanup(env.E2E_PROFILE_DIST_DIR);
    restoreConfig(configSnapshot, env.E2E_PROFILE_DIST_DIR);
  }

  if (exitCode !== undefined) {
    exit(exitCode);
  }
}

export function captureE2EProfileConfigFiles(repoRoot = process.cwd()) {
  return Object.fromEntries(
    ["tsconfig.json", "next-env.d.ts"].map((relativePath) => {
      const path = join(repoRoot, relativePath);
      return [path, existsSync(path) ? readFileSync(path, "utf8") : undefined];
    }),
  );
}

export function restoreE2EProfileConfigFiles(snapshot, distDir) {
  const tsconfigPath = Object.keys(snapshot).find((path) =>
    path.endsWith("tsconfig.json"),
  );
  const nextEnvPath = Object.keys(snapshot).find((path) =>
    path.endsWith("next-env.d.ts"),
  );

  if (tsconfigPath && snapshot[tsconfigPath] !== undefined) {
    restoreTsconfig(tsconfigPath, snapshot[tsconfigPath], distDir);
  }
  if (nextEnvPath) {
    restoreNextEnv(nextEnvPath, snapshot[nextEnvPath], distDir);
  }
}

export function removeGeneratedTypeIncludes(config, distDir) {
  const generatedIncludes = new Set([
    `${distDir}/types/**/*.ts`,
    `${distDir}/dev/types/**/*.ts`,
  ]);

  return {
    ...config,
    include: Array.isArray(config.include)
      ? config.include.filter((entry) => !generatedIncludes.has(entry))
      : config.include,
  };
}

function restoreTsconfig(path, originalContent, distDir) {
  if (!existsSync(path)) {
    return;
  }

  const currentContent = readFileSync(path, "utf8");
  if (currentContent === originalContent) {
    return;
  }

  try {
    const original = JSON.parse(originalContent);
    const current = removeGeneratedTypeIncludes(
      JSON.parse(currentContent),
      distDir,
    );
    if (isDeepStrictEqual(current, original)) {
      writeFileSync(path, originalContent);
    }
  } catch {
    // Leave concurrently edited configuration untouched.
  }
}

function restoreNextEnv(path, originalContent, distDir) {
  if (!existsSync(path)) {
    return;
  }

  const currentContent = readFileSync(path, "utf8");
  if (!currentContent.includes(distDir)) {
    return;
  }
  if (originalContent === undefined) {
    rmSync(path, { force: true });
  } else {
    writeFileSync(path, originalContent);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runE2EProfile();
}
