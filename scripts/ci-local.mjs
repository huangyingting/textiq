#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const CI_LOCAL_ENV = {
  DB_PROVIDER: "sqlite",
  DATABASE_URL: "file:./prisma/dev.db",
  AUTH_SECRET: "ci-placeholder-secret-not-used-in-production",
};

export const CI_LOCAL_STAGES = [
  {
    name: "Dependency security",
    command: ["npm", "run", "security:audit"],
    hint: "Resolve production advisories or package provenance failures before release.",
  },
  {
    name: "SQLite schema drift",
    command: ["npm", "run", "db:schema:check"],
    hint: "Run npm run db:schema:sqlite and commit prisma/schema.sqlite.prisma.",
  },
  {
    name: "Prisma client generation",
    command: ["npm", "run", "db:generate"],
    hint: "Run npm run db:generate.",
  },
  { name: "Tests", command: ["npm", "test"], hint: "Run npm test." },
  {
    name: "TypeScript",
    command: ["npm", "run", "typecheck"],
    hint: "Run npm run typecheck.",
  },
  {
    name: "Unused TypeScript symbols",
    command: ["npm", "run", "typecheck:unused"],
    hint: "Run npm run typecheck:unused.",
  },
  { name: "Lint", command: ["npm", "run", "lint"], hint: "Run npm run lint." },
  {
    name: "Docs",
    command: ["npm", "run", "docs:check"],
    hint: "Run npm run docs:check.",
  },
  {
    name: "Formatting",
    command: ["npm", "run", "format:check"],
    hint: "Run npm run format, or npx prettier --write '<flagged path>'.",
  },
  {
    name: "Build",
    command: ["npm", "run", "build"],
    hint: "Run npm run build.",
  },
];

export function stageBanner(index, total, stage) {
  return `\n[ci:local ${index + 1}/${total}] ${stage.name}: ${stage.command.join(" ")}`;
}

export function mergedCiEnv(env = process.env) {
  return { ...env, ...CI_LOCAL_ENV };
}

export function runLocalCi({
  stages = CI_LOCAL_STAGES,
  env = process.env,
} = {}) {
  const runEnv = mergedCiEnv(env);
  for (const [index, stage] of stages.entries()) {
    console.log(stageBanner(index, stages.length, stage));
    const [command, ...args] = stage.command;
    const result = spawnSync(command, args, { stdio: "inherit", env: runEnv });
    if (result.status !== 0) {
      const exitCode = result.status ?? 1;
      console.error(`\nStage failed: ${stage.name}`);
      console.error(`Hint: ${stage.hint}`);
      return exitCode;
    }
  }
  console.log("\nci:local passed all stages.");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runLocalCi();
}
