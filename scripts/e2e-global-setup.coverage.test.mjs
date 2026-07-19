import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import {
  closeSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import test from "node:test";

import {
  assertE2ECredentialGate,
  establishE2ECredentialGate,
  precompileE2EProfile,
  runE2EGlobalSetup,
  runE2EPrecompileProcess,
} from "./e2e-global-setup.mjs";
import { buildE2EProfileEnv, provisionE2ETlsIdentity } from "./e2e-profile.mjs";
import { startE2EWebServer } from "./e2e-web-server.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

test("global setup delegates injected gates and rejects direct Playwright runs", async () => {
  const calls = [];
  const injectedEnv = {
    ...buildE2EProfileEnv(
      { E2E_PROFILE_PORT: "4890" },
      {
        repoRoot: process.cwd(),
        runId: "global-injected",
        runNonce: "9".repeat(64),
      },
    ),
    E2E_PROFILE_EXTERNAL_SERVER: "1",
    E2E_PROFILE_TLS_SPKI_PIN: "A".repeat(43) + "=",
  };
  const cleanup = await runE2EGlobalSetup({
    env: injectedEnv,
    assertGate: async (config, options) =>
      calls.push(["gate", config, options.env]),
    precompile: async ({ env }) => calls.push(["precompile", env]),
  });
  assert.equal(typeof cleanup, "function");
  assert.deepEqual(
    calls.map(([name]) => name),
    ["gate", "precompile"],
  );
  await assert.rejects(runE2EGlobalSetup({ env: {} }), /must be started/);
  await assert.rejects(establishE2ECredentialGate({ env: {} }));
  await assert.rejects(assertE2ECredentialGate({}, { env: {} }));
});

test("global setup authenticated transport fetches through the verified proxy", async (t) => {
  const root = createTestFixtureRoot("global-setup-transport");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const basePort = 4800 + (process.pid % 200);
  const env = buildE2EProfileEnv(
    {
      E2E_PROFILE_PORT: String(basePort),
      E2E_PROFILE_PRECOMPILE_ROUTES: JSON.stringify([
        { method: "GET", path: "/app", status: 200 },
        { method: "POST", path: "/api/warm", status: 204 },
      ]),
    },
    {
      repoRoot: root,
      runId: "global-setup-transport",
      runNonce: "8".repeat(64),
    },
  );
  mkdirSync(join(root, ".next", "e2e-profile", "global-setup-transport"), {
    recursive: true,
  });
  writeFileSync(env.E2E_PROFILE_SERVER_PID_FILE, `${process.pid}\n`, {
    mode: 0o600,
  });

  const requests = [];
  const app = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.once("end", () => {
      requests.push({
        body: Buffer.concat(chunks).toString("utf8"),
        cookie: request.headers.cookie ?? "",
        method: request.method,
        url: request.url,
      });
      if (request.url === "/api/auth/csrf") {
        response.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": "authjs.csrf-token=csrf; Secure; Path=/",
        });
        response.end(JSON.stringify({ csrfToken: "csrf" }));
      } else if (request.url === "/api/auth/callback/credentials") {
        response.writeHead(302, {
          location: "/app",
          "set-cookie": "__Secure-authjs.session-token=session; Secure; Path=/",
        });
        response.end();
      } else if (request.url === "/app") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<html>ok</html>");
      } else if (request.url === "/api/warm") {
        response.writeHead(204);
        response.end();
      } else {
        response.writeHead(404);
        response.end("missing");
      }
    });
  });
  app.listen(Number(new URL(env.E2E_PROFILE_APP_URL).port), "127.0.0.1");
  await once(app, "listening");
  t.after(() => app.close());

  const tlsIdentity = provisionE2ETlsIdentity(env, { repoRoot: root });
  const privateKey = readFileSync(tlsIdentity.keyDescriptor);
  closeSync(tlsIdentity.keyDescriptor);
  const secure = await startE2EWebServer({
    env,
    certificate: readFileSync(env.E2E_PROFILE_TLS_CERT_FILE),
    privateKey,
    stdout: () => {},
  });
  t.after(() => {
    for (const socket of secure.state.activeSockets) socket.destroy();
    secure.server.close();
  });

  env.E2E_PROFILE_EXTERNAL_SERVER = "1";
  const cleanup = await runE2EGlobalSetup({ env });
  assert.equal(typeof cleanup, "function");
  assert.ok(requests.some((request) => request.url === "/api/auth/csrf"));
  assert.ok(
    requests.some(
      (request) =>
        request.url === "/api/auth/callback/credentials" &&
        request.body.includes("csrfToken=csrf"),
    ),
  );
  assert.ok(
    requests.some(
      (request) => request.url === "/app" && request.cookie.includes("session"),
    ),
  );
  assert.ok(
    requests.some(
      (request) => request.url === "/api/warm" && request.method === "POST",
    ),
  );

  await precompileE2EProfile({
    env: { ...env, E2E_PROFILE_PRECOMPILE_ROUTES: "[]" },
  });
  await runE2EPrecompileProcess({
    env: { ...env, E2E_PROFILE_PRECOMPILE_ROUTES: "[]" },
  });
});
