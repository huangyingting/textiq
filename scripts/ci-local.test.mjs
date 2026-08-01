import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  CI_LOCAL_ENV,
  CI_LOCAL_STAGES,
  mergedCiEnv,
  runLocalCi,
  stageBanner,
} from "./ci-local.mjs";

test("ci local mirrors the GitHub CI quality gate order", () => {
  assert.deepEqual(
    CI_LOCAL_STAGES.map((stage) => stage.command.join(" ")),
    [
      "npm run security:audit",
      "npm run db:schema:check",
      "npm run db:generate",
      "npm test",
      "npm run typecheck",
      "npm run typecheck:unused",
      "npm run lint",
      "npm run docs:check",
      "npm run format:check",
      "npm run build",
    ],
  );
});

test("ci local forces documented SQLite CI environment", () => {
  assert.deepEqual(CI_LOCAL_ENV.DB_PROVIDER, "sqlite");
  assert.equal(
    mergedCiEnv({ DB_PROVIDER: "postgres" }).DATABASE_URL,
    "file:./prisma/dev.db",
  );
});

test("ci local stage banner includes stage position", () => {
  assert.match(
    stageBanner(0, CI_LOCAL_STAGES.length, CI_LOCAL_STAGES[0]),
    /\[ci:local 1\/10\]/,
  );
});

test("ci local runs stages with forced env and stops on failure", () => {
  const ok = runLocalCi({
    stages: [
      {
        name: "Env check",
        command: [
          process.execPath,
          "-e",
          "if (process.env.DB_PROVIDER !== 'sqlite') process.exit(7)",
        ],
        hint: "env should be forced",
      },
    ],
    env: { DB_PROVIDER: "postgres" },
  });
  assert.equal(ok, 0);

  const failed = runLocalCi({
    stages: [
      {
        name: "Failure",
        command: [process.execPath, "-e", "process.exit(9)"],
        hint: "intentional failure",
      },
      {
        name: "Skipped",
        command: [process.execPath, "-e", "process.exit(0)"],
        hint: "should not run",
      },
    ],
  });
  assert.equal(failed, 9);
});

test("ci local CLI returns the first failing stage exit code", () => {
  const result = spawnSync(process.execPath, ["scripts/ci-local.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: "" },
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stage failed: Dependency security/);
});
