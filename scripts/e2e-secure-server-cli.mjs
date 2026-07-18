#!/usr/bin/env node

import { spawn } from "node:child_process";
import { closeSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { readSecureFile } from "./e2e-credential-gate.mjs";
import {
  resolveE2EWebServerConfig,
  startE2EWebServer,
  waitForOwnedE2EListener,
} from "./e2e-web-server.mjs";

const env = process.env;
if (env.E2E_PROFILE_EXTERNAL_SERVER !== "1") {
  throw new Error(
    "The secure E2E server must be launched by scripts/e2e-profile.mjs.",
  );
}

const keyDescriptor = Number(env.E2E_PROFILE_TLS_KEY_FD);
if (!Number.isSafeInteger(keyDescriptor) || keyDescriptor < 3) {
  throw new Error(
    "The secure E2E server requires an inherited protected TLS key descriptor.",
  );
}

let privateKey;
try {
  privateKey = readFileSync(keyDescriptor);
} finally {
  closeSync(keyDescriptor);
}

const config = resolveE2EWebServerConfig(env);
const certificate = readSecureFile(
  config.runtime.tlsCertFile,
  config.runtime.tlsCaCertFile,
  "TLS certificate",
);
const appEnv = { ...env, E2E_WEB_SERVER: "0" };
delete appEnv.E2E_PROFILE_TLS_KEY_FD;

const appProcess = spawn(
  process.execPath,
  [join("scripts", "e2e-app-server-cli.mjs")],
  {
    cwd: process.cwd(),
    env: appEnv,
    stdio: "inherit",
  },
);

let transport;
let shuttingDown = false;
let shutdownPromise;

try {
  await waitForSpawn(appProcess);
  await Promise.race([
    waitForOwnedE2EListener({
      host: config.bindHost,
      pid: appProcess.pid,
      port: Number(config.appOrigin.port),
      timeoutMs: Number(env.E2E_WEB_SERVER_TIMEOUT_MS ?? 480_000),
    }),
    rejectOnExit(appProcess),
  ]);
  transport = await startE2EWebServer({
    certificate,
    env,
    privateKey,
  });
} catch (error) {
  privateKey?.fill(0);
  await shutdown("startup-failure");
  throw error;
}

appProcess.once("exit", (code, signal) => {
  if (shuttingDown) return;
  console.error(
    `[e2e-transport] app process exited unexpectedly (code ${code ?? "none"}, signal ${signal ?? "none"}).`,
  );
  transport?.state?.compromiseLatch?.latch("E2E_APP_PROCESS_EXITED");
  void shutdown("app-exit").then(() => {
    process.exitCode = 1;
  });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0));
  });
}

async function shutdown(_reason) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    transport?.state?.capabilityKey?.fill(0);
    if (transport?.state) transport.state.privateKey = undefined;
    await closeServer(transport?.server);
    if (
      appProcess.exitCode === null &&
      appProcess.signalCode === null &&
      Number.isSafeInteger(appProcess.pid)
    ) {
      appProcess.kill("SIGTERM");
      await waitForExit(appProcess, 5_000);
      if (appProcess.exitCode === null && appProcess.signalCode === null) {
        process.kill(appProcess.pid, "SIGKILL");
      }
    }
    for (const path of [
      config.runtime.identityFile,
      config.runtime.credentialGateFile,
      config.runtime.compromiseFile,
      config.runtime.tlsCertFile,
      config.runtime.pidFile,
    ]) {
      safeUnlink(path);
    }
  })();
  return shutdownPromise;
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  server.closeAllConnections?.();
  return new Promise((resolvePromise) => server.close(resolvePromise));
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

function waitForSpawn(child) {
  if (Number.isSafeInteger(child.pid)) return Promise.resolve();
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("spawn", resolvePromise);
    child.once("error", rejectPromise);
  });
}

function rejectOnExit(child) {
  return new Promise((_resolvePromise, rejectPromise) => {
    child.once("exit", (code, signal) => {
      rejectPromise(
        new Error(
          `The deterministic E2E app exited before binding (code ${code ?? "none"}, signal ${signal ?? "none"}).`,
        ),
      );
    });
  });
}

function safeUnlink(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw error;
    }
  }
}
