#!/usr/bin/env node

import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

const pidFile = process.env.E2E_PROFILE_SERVER_PID_FILE;
if (!pidFile) {
  throw new Error("E2E_PROFILE_SERVER_PID_FILE is required.");
}

mkdirSync(dirname(pidFile), { mode: 0o700, recursive: true });
writeFileSync(pidFile, `${process.pid}\n`, { flag: "wx", mode: 0o600 });

function cleanupPidFile() {
  try {
    unlinkSync(pidFile);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      console.error(error instanceof Error ? error.message : error);
    }
  }
}

process.once("exit", cleanupPidFile);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cleanupPidFile();
    process.exit(0);
  });
}

await import("../server.mjs");
