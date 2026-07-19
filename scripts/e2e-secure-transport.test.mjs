import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import {
  connect as createNetConnection,
  createServer as createNetServer,
} from "node:net";
import {
  closeSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";

import {
  buildE2EProfileEnv,
  e2EPlaywrightProcessEnv,
  provisionE2ETlsIdentity,
} from "./e2e-profile.mjs";
import {
  assertE2EConnectionOwnedByProcess,
  waitForOwnedE2EConnection,
} from "./e2e-listener-ownership.mjs";
import {
  E2E_CAPABILITY_ENDPOINT,
  E2E_GATE_CAPABILITY_HEADER,
  assertLiveE2ECredentialGate,
  openVerifiedProxyChannel,
  requestOnVerifiedProxyChannel,
  sendE2ERequestOverVerifiedProxy,
} from "./e2e-credential-gate.mjs";
import {
  proxyResponseHeaders,
  rewriteE2ERedirectLocation,
  startE2EWebServer,
} from "./e2e-web-server.mjs";

let portSequence = 4300;

test("HTTPS transport forwards credentials only after pinned same-channel authentication", async (t) => {
  const fixture = await createTransportFixture();
  t.after(() => fixture.close());
  const response = await sendE2ERequestOverVerifiedProxy({
    body: Buffer.from("upload"),
    env: fixture.env,
    headers: { cookie: "session=normal", "content-type": "text/plain" },
    method: "POST",
    url: `${fixture.env.E2E_BASE_URL}/api/upload?kind=docx`,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.requests, [
    {
      body: "upload",
      cookie: "session=normal",
      method: "POST",
      url: "/api/upload?kind=docx",
    },
  ]);
  const identity = JSON.parse(
    readFileSync(fixture.env.E2E_PROFILE_IDENTITY_FILE, "utf8"),
  );
  assert.equal(identity.schemaVersion, 4);
  assert.equal(identity.spkiPin, fixture.env.E2E_PROFILE_TLS_SPKI_PIN);
  assert.equal("nonce" in identity, false);
  assert.equal("privateKey" in identity, false);
  assert.equal(
    readdirSync(dirname(fixture.env.E2E_PROFILE_TLS_CERT_FILE)).some((name) =>
      /key|secret|capability/i.test(name),
    ),
    false,
  );
  assert.equal(
    Object.values(fixture.env).some((value) =>
      String(value).includes("BEGIN PRIVATE KEY"),
    ),
    false,
  );
  assert.equal(
    process.argv.some((value) => value.includes("BEGIN PRIVATE KEY")),
    false,
  );
});

test("redirect containment rewrites only normalized internal app targets", () => {
  const appOrigin = new URL("http://localhost:4402");
  const externalOrigin = new URL("https://localhost:4400");
  for (const [location, expected] of [
    [
      "/login?next=%2Fapp#reauth",
      "https://localhost:4400/login?next=%2Fapp#reauth",
    ],
    ["settings/../login", "https://localhost:4400/login"],
    [
      "http://localhost:4402/app?from=login#ready",
      "https://localhost:4400/app?from=login#ready",
    ],
    [
      "https://localhost:4400/app?from=auth",
      "https://localhost:4400/app?from=auth",
    ],
    ["?next=%2Fapp", "https://localhost:4400/?next=%2Fapp"],
  ]) {
    assert.equal(
      rewriteE2ERedirectLocation(location, appOrigin, externalOrigin),
      expected,
    );
  }

  for (const location of [
    "http://evil.example/escape",
    "https://evil.example/escape",
    "//evil.example/escape",
    "http://user:pass@localhost:4402/app",
    "http://localhost:4400/app",
    "https://localhost:4402/app",
    "http://127.0.0.1:4402/app",
    "javascript:alert(1)",
    "http:\\\\evil.example\\escape",
    "http:%2f%2fevil.example/escape",
    "http://localhost%2eevil.example:4402/app",
    "/safe%5c..%5cescape",
  ]) {
    assert.throws(
      () => rewriteE2ERedirectLocation(location, appOrigin, externalOrigin),
      /rejected/,
      location,
    );
  }

  assert.equal(
    proxyResponseHeaders({
      appOrigin,
      externalOrigin,
      headers: { location: "/login" },
      rawHeaders: ["LoCaTiOn", "/login"],
    }).location,
    "https://localhost:4400/login",
  );
  assert.throws(
    () =>
      proxyResponseHeaders({
        appOrigin,
        externalOrigin,
        headers: { location: "/login, /escape" },
        rawHeaders: ["Location", "/login", "location", "/escape"],
      }),
    /multiple upstream Location/,
  );
});

test("runtime login redirects stay pinned and unsafe or duplicate Location latches", async (t) => {
  const login = await createTransportFixture({
    onRequest(_request, response) {
      response.writeHead(302, {
        Location: "/api/auth/signin?callbackUrl=%2Fapp",
      });
      response.end();
    },
  });
  t.after(() => login.close());
  const loginResponse = await rawPinnedRequest(login, "/app");
  assert.equal(loginResponse.status, 302);
  assert.equal(
    loginResponse.headers.location,
    `${login.env.E2E_BASE_URL}/api/auth/signin?callbackUrl=%2Fapp`,
  );

  for (const locations of [
    ["https://evil.example/escape"],
    ["/login", "https://evil.example/escape"],
  ]) {
    const fixture = await createTransportFixture({
      onRequest(_request, response) {
        response.setHeader("Location", locations);
        response.writeHead(302);
        response.end();
      },
    });
    t.after(() => fixture.close());
    const rejected = await rawPinnedRequest(fixture, "/redirect");
    assert.equal(rejected.status, 503);
    assert.equal("location" in rejected.headers, false);
    const latched = await rawPinnedRequest(fixture, "/after-redirect");
    assert.equal(latched.status, 503);
  }
});

test("actual accepted upstream socket ownership is required before any request byte", async (t) => {
  let proof;
  const fixture = await createTransportFixture({
    waitForOwnedConnection: async (candidate) => {
      proof = candidate;
      throw new Error(
        "The accepted E2E connection ownership belongs to an unauthorized peer.",
      );
    },
  });
  t.after(() => fixture.close());
  const response = await sendE2ERequestOverVerifiedProxy({
    body: Buffer.from("never-forward"),
    env: fixture.env,
    headers: { cookie: "session=peer-owner" },
    method: "POST",
    url: `${fixture.env.E2E_BASE_URL}/api/peer-owner`,
  });
  assert.equal(response.status, 503);
  assert.equal(fixture.requests.length, 0);
  assert.equal(proof.host, "127.0.0.1");
  assert.equal(
    proof.port,
    Number(new URL(fixture.env.E2E_PROFILE_APP_URL).port),
  );
  assert.equal(Number.isSafeInteger(proof.clientPort), true);
});

test("Linux peer verifier attributes the accepted server-side inode to the app PID", () => {
  const serverPort = 4402;
  const clientPort = 51_234;
  const tcpTable = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    `0: 0100007F:${hexPort(serverPort)} 0100007F:${hexPort(clientPort)} 01 00000000:00000000 00:00000000 00000000 1000 0 4242 1`,
  ].join("\n");
  const verified = assertE2EConnectionOwnedByProcess({
    clientPort,
    host: "127.0.0.1",
    pid: 123,
    port: serverPort,
    readDirectory: () => ["7"],
    readFile: (path) => (path === "/proc/net/tcp" ? tcpTable : ""),
    readLink: () => "socket:[4242]",
  });
  assert.deepEqual(verified.inodes, ["4242"]);
  assert.deepEqual(verified.ownerPids, [123]);
  assert.throws(
    () =>
      assertE2EConnectionOwnedByProcess({
        clientPort,
        host: "127.0.0.1",
        pid: 123,
        port: serverPort,
        readDirectory: () => ["7"],
        readFile: (path) => (path === "/proc/net/tcp" ? tcpTable : ""),
        readLink: () => "socket:[9999]",
      }),
    /not owned by checked PIDs/,
  );
});

test("real unauthorized accepted peer receives zero bytes when ownership proof fails", async (t) => {
  if (process.platform !== "linux") return;
  const port = await reserveFreePort();
  const hostileProgram = [
    'const net=require("node:net")',
    "let bytes=0",
    'const server=net.createServer(socket=>socket.on("data",chunk=>{bytes+=chunk.length}))',
    `server.listen(${port},"127.0.0.1",()=>console.log("READY"))`,
    'process.on("SIGTERM",()=>{server.closeAllConnections?.();server.close(()=>{console.log(`BYTES ${bytes}`);process.exit(0)})})',
  ].join(";");
  const hostile = spawn(process.execPath, ["-e", hostileProgram], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => {
    if (hostile.exitCode === null) hostile.kill("SIGTERM");
  });
  let output = "";
  hostile.stdout.setEncoding("utf8");
  hostile.stdout.on("data", (chunk) => {
    output += chunk;
  });
  await waitForOutput(() => output.includes("READY"));

  const socket = createNetConnection({ host: "127.0.0.1", port });
  await new Promise((resolvePromise, rejectPromise) => {
    socket.once("connect", resolvePromise);
    socket.once("error", rejectPromise);
  });
  socket.pause();
  await assert.rejects(
    waitForOwnedE2EConnection({
      clientPort: socket.localPort,
      host: "127.0.0.1",
      includeDescendants: false,
      pid: process.pid,
      port,
      timeoutMs: 100,
    }),
    /could not be attributed/,
  );
  socket.destroy();
  hostile.kill("SIGTERM");
  await new Promise((resolvePromise) => hostile.once("exit", resolvePromise));
  assert.match(output, /BYTES 0/);
});

test("request capabilities reject forgery, replay, and request/channel mutation", async (t) => {
  const cases = [
    "replay",
    "method",
    "path",
    "body",
    "origin",
    "channel",
    "signature",
  ];
  let rejected = 0;
  for (const mutation of cases) {
    const fixture = await createTransportFixture();
    t.after(() => fixture.close());
    const channel = await openVerifiedProxyChannel(fixture.config);
    const body = Buffer.from("bound-body");
    const target = new URL("/api/bound?x=1", fixture.env.E2E_BASE_URL);
    const capability = await issueCapability(
      channel,
      fixture.config,
      target,
      "POST",
      body,
    );
    let requestChannel = channel;
    let requestBody = body;
    let requestMethod = "POST";
    let requestPath = `${target.pathname}${target.search}`;
    let requestHost = target.host;
    if (mutation === "method") requestMethod = "PUT";
    if (mutation === "path") requestPath = "/api/other?x=1";
    if (mutation === "body") requestBody = Buffer.from("mutated");
    if (mutation === "origin") requestHost = `127.0.0.1:${target.port}`;
    if (mutation === "channel") {
      requestChannel = await openVerifiedProxyChannel(fixture.config);
    }
    const requestCapability =
      mutation === "signature"
        ? capability.replace(
            /\.([A-Za-z0-9_-])/,
            (_match, first) => `.${first === "A" ? "B" : "A"}`,
          )
        : capability;
    const first = await requestOnVerifiedProxyChannel(
      requestChannel,
      fixture.config,
      {
        body: requestBody,
        headers: {
          [E2E_GATE_CAPABILITY_HEADER]: requestCapability,
          "content-length": String(requestBody.length),
          host: requestHost,
        },
        method: requestMethod,
        path: requestPath,
        timeoutMs: 5_000,
      },
    );
    if (mutation === "replay") {
      assert.equal(first.status, 200);
      const replay = await requestOnVerifiedProxyChannel(
        channel,
        fixture.config,
        {
          body,
          headers: {
            [E2E_GATE_CAPABILITY_HEADER]: capability,
            "content-length": String(body.length),
            host: target.host,
          },
          method: "POST",
          path: `${target.pathname}${target.search}`,
          timeoutMs: 5_000,
        },
      );
      assert.equal(replay.status, 503);
    } else {
      assert.equal(first.status, 503, mutation);
    }
    rejected += 1;
    requestChannel.agent.destroy();
    requestChannel.socket.destroy();
    if (requestChannel !== channel) {
      channel.agent.destroy();
      channel.socket.destroy();
    }
  }
  assert.equal(rejected, 7);
});

test("simultaneous capability consumption forwards exactly one request", async (t) => {
  const fixture = await createTransportFixture();
  t.after(() => fixture.close());
  const channel = await openVerifiedProxyChannel(fixture.config);
  const body = Buffer.from("single-consumer");
  const target = new URL("/api/concurrent", fixture.env.E2E_BASE_URL);
  const capability = await issueCapability(
    channel,
    fixture.config,
    target,
    "POST",
    body,
  );
  const rawRequest = [
    `POST ${target.pathname} HTTP/1.1`,
    `Host: ${target.host}`,
    `Content-Length: ${body.length}`,
    `${E2E_GATE_CAPABILITY_HEADER}: ${capability}`,
    "Connection: keep-alive",
    "",
    body.toString(),
  ].join("\r\n");
  channel.socket.write(rawRequest.repeat(8));
  await Promise.race([
    new Promise((resolvePromise) =>
      channel.socket.once("close", resolvePromise),
    ),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  assert.equal(
    fixture.requests.filter((request) => request.url === target.pathname)
      .length,
    1,
  );
  channel.agent.destroy();
  channel.socket.destroy();
});

test("forged public identity and nonce fields cannot authorize credentials", async (t) => {
  const fixture = await createTransportFixture();
  t.after(() => fixture.close());
  const identity = JSON.parse(
    readFileSync(fixture.env.E2E_PROFILE_IDENTITY_FILE, "utf8"),
  );
  writeFileSync(
    fixture.env.E2E_PROFILE_IDENTITY_FILE,
    `${JSON.stringify({
      ...identity,
      nonce: "f".repeat(64),
      signature: "forged",
    })}\n`,
    { mode: 0o600 },
  );
  await assert.rejects(
    assertLiveE2ECredentialGate({ env: fixture.env }),
    /tampered|signature/,
  );
  assert.equal(fixture.requests.length, 0);
});

test("compromise latch cannot be restored after signed-record tampering", async (t) => {
  const fixture = await createTransportFixture();
  t.after(() => fixture.close());
  const healthy = readFileSync(fixture.env.E2E_PROFILE_COMPROMISE_FILE, "utf8");
  writeFileSync(
    fixture.env.E2E_PROFILE_COMPROMISE_FILE,
    `${JSON.stringify({ state: "healthy", forged: true })}\n`,
    { mode: 0o600 },
  );
  const first = await rawPinnedRequest(fixture, "/after-tamper");
  assert.equal(first.status, 503);
  const latched = JSON.parse(
    readFileSync(fixture.env.E2E_PROFILE_COMPROMISE_FILE, "utf8"),
  );
  assert.equal(latched.state, "compromised");
  writeFileSync(fixture.env.E2E_PROFILE_COMPROMISE_FILE, healthy, {
    mode: 0o600,
  });

  const restored = await rawPinnedRequest(fixture, "/after-restore");
  assert.equal(restored.status, 503);
  assert.equal(fixture.requests.length, 0);
});

test("HTTP latch terminates existing WSS and blocks new WSS, HTTP, and API", async (t) => {
  const fixture = await createTransportFixture({
    onUpgrade(_request, socket) {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
    },
  });
  t.after(() => fixture.close());
  const existingWss = await sendPinnedWebSocket(
    fixture,
    "session=existing-wss",
  );
  await new Promise((resolvePromise) =>
    existingWss.socket.once("data", resolvePromise),
  );
  const existingWssClosed = socketTermination(existingWss.socket);

  fixture.transport.state.compromiseLatch.latch("E2E_UNSAFE_UPSTREAM_REDIRECT");
  await withTimeout(
    existingWssClosed,
    5_000,
    "existing WSS termination after HTTP latch",
  );
  await assertBlockedWebSocket(fixture, "session=new-wss");
  assert.throws(() => fixture.transport.state.compromiseLatch.assertHealthy());
  await assert.rejects(
    sendE2ERequestOverVerifiedProxy({
      env: fixture.env,
      method: "GET",
      url: `${fixture.env.E2E_BASE_URL}/after-http-latch-api`,
    }),
    /compromised/,
  );
});

test("proxy takeover and prior-run certificates receive zero credential bytes", async (t) => {
  const plaintext = await createTransportFixture();
  t.after(() => plaintext.close());
  await assertLiveE2ECredentialGate({ env: plaintext.env });
  await closeServer(plaintext.transport.server);
  const rawChunks = [];
  const hostilePlaintext = createNetServer((socket) => {
    socket.on("data", (chunk) => {
      rawChunks.push(Buffer.from(chunk));
      socket.destroy();
    });
  });
  await listen(
    hostilePlaintext,
    Number(new URL(plaintext.env.E2E_BASE_URL).port),
  );
  await assert.rejects(
    sendE2ERequestOverVerifiedProxy({
      body: Buffer.from("credential-body"),
      env: plaintext.env,
      headers: { cookie: "session=plaintext-takeover" },
      method: "POST",
      url: `${plaintext.env.E2E_BASE_URL}/api/takeover`,
      timeoutMs: 1_000,
    }),
  );
  await closeServer(hostilePlaintext);
  const raw = Buffer.concat(rawChunks).toString("latin1");
  assert.doesNotMatch(raw, /plaintext-takeover|credential-body|cookie:/i);

  const prior = await createTransportFixture();
  const reusedCertificate = Buffer.from(prior.certificate);
  const reusedKey = Buffer.from(prior.reusableKey);
  await prior.close();
  const current = await createTransportFixture();
  t.after(() => current.close());
  await assertLiveE2ECredentialGate({ env: current.env });
  await closeServer(current.transport.server);
  let requests = 0;
  const hostileTls = createHttpsServer(
    { cert: reusedCertificate, key: reusedKey },
    (_request, response) => {
      requests += 1;
      response.end();
    },
  );
  await listen(hostileTls, Number(new URL(current.env.E2E_BASE_URL).port));
  await assert.rejects(
    sendE2ERequestOverVerifiedProxy({
      env: current.env,
      headers: { cookie: "session=reused-cert" },
      method: "GET",
      url: `${current.env.E2E_BASE_URL}/api/reused`,
      timeoutMs: 1_000,
    }),
  );
  assert.equal(requests, 0);
  reusedKey.fill(0);
  await closeServer(hostileTls);

  const websocket = await createTransportFixture();
  t.after(() => websocket.close());
  await assertLiveE2ECredentialGate({ env: websocket.env });
  await closeServer(websocket.transport.server);
  const websocketChunks = [];
  const hostileWebSocket = createNetServer((socket) => {
    socket.on("data", (chunk) => {
      websocketChunks.push(Buffer.from(chunk));
      socket.destroy();
    });
  });
  await listen(
    hostileWebSocket,
    Number(new URL(websocket.env.E2E_BASE_URL).port),
  );
  await assert.rejects(sendPinnedWebSocket(websocket, "session=wss-takeover"));
  await closeServer(hostileWebSocket);
  assert.doesNotMatch(
    Buffer.concat(websocketChunks).toString("latin1"),
    /wss-takeover|cookie:|upgrade: websocket/i,
  );
});

test("real Chromium rejects a separately trusted nonmatching certificate before credentials", async (t) => {
  const hostileIdentity = await createTransportFixture();
  const current = await createTransportFixture();
  t.after(async () => {
    await current.close();
    await hostileIdentity.close();
  });
  const nssDatabase = `sql:${join(
    current.env.E2E_PROFILE_BROWSER_HOME,
    ".pki",
    "nssdb",
  )}`;
  const imported = spawnSync(
    "certutil",
    [
      "-A",
      "-d",
      nssDatabase,
      "-n",
      "TextIQ hostile separately trusted CA",
      "-t",
      "C,,",
      "-i",
      hostileIdentity.env.E2E_PROFILE_TLS_CA_CERT_FILE,
    ],
    { encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);

  const browser = await launchPinnedChromium(current);
  let hostileServer;
  t.after(async () => {
    await browser.close();
    await closeServer(hostileServer);
  });
  const context = await browser.newContext({
    baseURL: current.env.E2E_BASE_URL,
  });
  await context.addCookies([
    secureSessionCookie(current, "exclusive-browser-identity"),
  ]);
  const page = await context.newPage();
  assert.equal((await page.goto("/"))?.status(), 200);

  await closeServer(current.transport.server);
  let hostileRequests = 0;
  hostileServer = createHttpsServer(
    {
      cert: hostileIdentity.certificate,
      key: hostileIdentity.reusableKey,
    },
    (_request, response) => {
      hostileRequests += 1;
      response.end();
    },
  );
  await listen(hostileServer, Number(new URL(current.env.E2E_BASE_URL).port));
  await assert.rejects(
    page.goto("/api/auth/session", { timeout: 5_000, waitUntil: "commit" }),
  );
  assert.equal(hostileRequests, 0);
});

test("WSS and app-listener takeover never expose cookies before upstream ownership proof", async (t) => {
  let upgradedCookie;
  const websocket = await createTransportFixture({
    onUpgrade(request, socket) {
      upgradedCookie = request.headers.cookie;
      socket.end(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
    },
  });
  t.after(() => websocket.close());
  const channel = await openVerifiedProxyChannel(websocket.config);
  channel.socket.write(
    `GET /collab HTTP/1.1\r\nHost: ${websocket.config.origin.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nCookie: session=wss-normal\r\n\r\n`,
  );
  const upgradeResponse = await new Promise((resolvePromise) =>
    channel.socket.once("data", resolvePromise),
  );
  assert.match(upgradeResponse.toString("latin1"), /101 Switching Protocols/);
  assert.equal(upgradedCookie, "session=wss-normal");
  channel.agent.destroy();
  channel.socket.destroy();

  let hostileBytes = 0;
  let originalApp;
  let hostileApp;
  const takeover = await createTransportFixture({
    beforeUpstreamConnect: async () => {
      if (hostileApp) return;
      await closeServer(originalApp);
      hostileApp = createHttpServer((request, response) => {
        request.on("data", (chunk) => {
          hostileBytes += chunk.length;
        });
        response.end();
      });
      await listen(
        hostileApp,
        Number(new URL(takeover.env.E2E_PROFILE_APP_URL).port),
      );
    },
    captureApp(server) {
      originalApp = server;
    },
  });
  t.after(async () => {
    await closeServer(hostileApp);
    await takeover.close();
  });
  const response = await sendE2ERequestOverVerifiedProxy({
    body: Buffer.from("must-not-forward"),
    env: takeover.env,
    headers: { cookie: "session=app-takeover" },
    method: "POST",
    url: `${takeover.env.E2E_BASE_URL}/api/takeover`,
  });
  assert.equal(response.status, 503);
  assert.equal(hostileBytes, 0);
  assert.equal(takeover.requests.length, 0);
});

test("real Chromium WSS takeover reaches the ownership barrier but exposes zero upgrade bytes", async (t) => {
  const barrier = deferred();
  const release = deferred();
  let armed = false;
  let originalApp;
  const fixture = await createTransportFixture({
    beforeUpstreamConnect: async () => {
      if (!armed) return;
      barrier.resolve();
      await release.promise;
    },
    captureApp(server) {
      originalApp = server;
    },
  });
  const browser = await launchPinnedChromium(fixture);
  let hostileApp;
  t.after(async () => {
    release.resolve();
    await browser.close();
    await closeServer(hostileApp);
    await fixture.close();
  });
  const context = await browser.newContext({
    baseURL: fixture.env.E2E_BASE_URL,
  });
  await context.addCookies([
    secureSessionCookie(fixture, "chromium-wss-session"),
  ]);
  const page = await context.newPage();
  await page.goto("/");

  armed = true;
  const websocketResult = page.evaluate(
    (url) =>
      new Promise((resolvePromise) => {
        const websocket = new WebSocket(url);
        websocket.addEventListener("open", () => resolvePromise("open"), {
          once: true,
        });
        websocket.addEventListener("error", () => resolvePromise("error"), {
          once: true,
        });
        websocket.addEventListener("close", () => resolvePromise("close"), {
          once: true,
        });
      }),
    fixture.env.E2E_BASE_URL.replace("https:", "wss:") + "/collab/hostile",
  );
  await withTimeout(barrier.promise, 5_000, "Chromium WSS ownership barrier");

  await closeServer(originalApp);
  const hostile = hostileByteServer();
  hostileApp = hostile.server;
  await listen(
    hostileApp,
    Number(new URL(fixture.env.E2E_PROFILE_APP_URL).port),
  );
  release.resolve();

  assert.notEqual(
    await withTimeout(websocketResult, 5_000, "Chromium WSS rejection"),
    "open",
  );
  await withTimeout(
    hostile.connected,
    5_000,
    "hostile WSS upstream connection",
  );
  assert.equal(hostile.connections(), 1);
  assert.equal(hostile.bytes(), 0);
  assert.equal(hostile.raw().length, 0);
  assert.equal(hostile.raw().includes("cookie:"), false);
  assert.equal(hostile.raw().includes("upgrade:"), false);
  assert.equal(readCompromiseState(fixture), "compromised");
  assert.throws(() => fixture.transport.state.compromiseLatch.assertHealthy());
  await assert.rejects(
    sendE2ERequestOverVerifiedProxy({
      env: fixture.env,
      method: "GET",
      url: `${fixture.env.E2E_BASE_URL}/after-wss-latch-api`,
    }),
    /compromised/,
  );
  await assertBlockedWebSocket(fixture, "session=after-wss-latch");
});

test("real Chromium sends no HTTP credentials after a plaintext proxy takeover and the run latches", async (t) => {
  const fixture = await createTransportFixture();
  const browser = await launchPinnedChromium(fixture);
  let hostileProxy;
  t.after(async () => {
    await browser.close();
    await closeServer(hostileProxy);
    await fixture.close();
  });
  const context = await browser.newContext({
    baseURL: fixture.env.E2E_BASE_URL,
  });
  await context.addCookies([
    secureSessionCookie(fixture, "chromium-proxy-takeover"),
  ]);
  const page = await context.newPage();

  await assertLiveE2ECredentialGate({ env: fixture.env });
  await closeServer(fixture.transport.server);
  const hostile = hostileByteServer({ closeOnData: true });
  hostileProxy = hostile.server;
  await listen(hostileProxy, Number(new URL(fixture.env.E2E_BASE_URL).port));

  await assert.rejects(
    page.goto("/api/auth/session", {
      timeout: 5_000,
      waitUntil: "commit",
    }),
  );
  await withTimeout(
    hostile.connected,
    5_000,
    "hostile plaintext proxy connection",
  );
  const raw = hostile.raw();
  assert.equal(hostile.connections() >= 1, true);
  assert.equal(hostile.bytes() > 0, true);
  assert.doesNotMatch(raw, /chromium-proxy-takeover|cookie:|GET |POST /i);
  await assert.rejects(
    assertLiveE2ECredentialGate({ env: fixture.env }),
    /TLS|socket|closed|identity|certificate|compromised/i,
  );
  assert.equal(readCompromiseState(fixture), "compromised");
});

test("real Chromium and the authenticated API wrapper contain unsafe redirects and preserve safe HTTPS redirects", async (t) => {
  const hostileRequests = [];
  const hostile = createHttpServer((request, response) => {
    hostileRequests.push({
      cookie: request.headers.cookie,
      url: request.url,
    });
    response.end("hostile");
  });
  await listen(hostile, await reserveFreePort());
  t.after(() => closeServer(hostile));
  const hostileAddress = hostile.address();
  const hostileUrl = `http://127.0.0.1:${hostileAddress.port}/stolen`;

  for (const client of ["browser", "api"]) {
    for (const kind of [
      "external",
      "scheme-relative",
      "duplicate",
      "userinfo",
      "scheme",
      "encoded-host",
    ]) {
      const fixture = await createTransportFixture({
        onRequest(_request, response) {
          if (kind === "duplicate") {
            response.setHeader("Location", ["/safe", hostileUrl]);
          } else {
            const external = new URL(fixture.env.E2E_BASE_URL);
            response.setHeader(
              "Location",
              {
                external: hostileUrl,
                "scheme-relative": `//127.0.0.1:${hostileAddress.port}/stolen`,
                userinfo: `https://user:pass@${external.host}/stolen`,
                scheme: "javascript:location='stolen'",
                "encoded-host": `https://${external.hostname.replace(
                  ".",
                  "%2e",
                )}:${external.port}/stolen`,
              }[kind],
            );
          }
          response.writeHead(302);
          response.end();
        },
      });
      let browser;
      try {
        let status;
        if (client === "browser") {
          browser = await launchPinnedChromium(fixture);
          const context = await browser.newContext({
            baseURL: fixture.env.E2E_BASE_URL,
          });
          await context.addCookies([
            secureSessionCookie(fixture, `redirect-${client}-${kind}-session`),
          ]);
          const response = await (await context.newPage()).goto("/redirect");
          status = response?.status();
        } else {
          const response = await sendE2ERequestOverVerifiedProxy({
            env: fixture.env,
            headers: { cookie: `session=redirect-${client}-${kind}` },
            method: "GET",
            url: `${fixture.env.E2E_BASE_URL}/redirect`,
          });
          status = response.status;
        }
        assert.equal(status, 503, `${client} ${kind}`);
        assert.equal(readCompromiseState(fixture), "compromised");
      } finally {
        await browser?.close();
        await fixture.close();
      }
    }
  }
  assert.deepEqual(hostileRequests, []);

  const safe = await createTransportFixture({
    onRequest(request, response) {
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/safe?from=redirect" });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>safe</title><h1>safe</h1>");
    },
  });
  const safeBrowser = await launchPinnedChromium(safe);
  t.after(async () => {
    await safeBrowser.close();
    await safe.close();
  });
  const safeContext = await safeBrowser.newContext({
    baseURL: safe.env.E2E_BASE_URL,
  });
  await safeContext.addCookies([
    secureSessionCookie(safe, "safe-redirect-session"),
  ]);
  const safePage = await safeContext.newPage();
  const followed = await safePage.goto("/redirect");
  assert.equal(followed?.status(), 200);
  assert.equal(safePage.url(), `${safe.env.E2E_BASE_URL}/safe?from=redirect`);
  assert.equal(
    safe.requests.filter((request) => request.url === "/safe?from=redirect")
      .length,
    1,
  );

  const apiRedirect = await sendE2ERequestOverVerifiedProxy({
    env: safe.env,
    headers: { cookie: "session=safe-api-redirect" },
    method: "GET",
    url: `${safe.env.E2E_BASE_URL}/redirect`,
  });
  assert.equal(apiRedirect.status, 302);
  assert.equal(
    apiRedirect.headers.location,
    `${safe.env.E2E_BASE_URL}/safe?from=redirect`,
  );
});

test("barrier-controlled app HTTP takeover accepts a socket but receives zero request bytes", async (t) => {
  const barrier = deferred();
  const release = deferred();
  let originalApp;
  let hostileApp;
  const fixture = await createTransportFixture({
    beforeUpstreamConnect: async () => {
      barrier.resolve();
      await release.promise;
    },
    captureApp(server) {
      originalApp = server;
    },
  });
  t.after(async () => {
    release.resolve();
    await closeServer(hostileApp);
    await fixture.close();
  });

  const pending = sendE2ERequestOverVerifiedProxy({
    body: Buffer.from("barrier-body"),
    env: fixture.env,
    headers: { cookie: "session=barrier-http-takeover" },
    method: "POST",
    url: `${fixture.env.E2E_BASE_URL}/api/barrier-takeover`,
  });
  await withTimeout(barrier.promise, 5_000, "HTTP ownership barrier");
  await closeServer(originalApp);
  const hostile = hostileByteServer();
  hostileApp = hostile.server;
  await listen(
    hostileApp,
    Number(new URL(fixture.env.E2E_PROFILE_APP_URL).port),
  );
  release.resolve();

  const response = await pending;
  assert.equal(response.status, 503);
  await withTimeout(
    hostile.connected,
    5_000,
    "hostile HTTP upstream connection",
  );
  assert.equal(hostile.connections(), 1);
  assert.equal(hostile.bytes(), 0);
  assert.equal(hostile.raw(), "");
  assert.equal(fixture.requests.length, 0);
  assert.equal(readCompromiseState(fixture), "compromised");
});

async function createTransportFixture({
  beforeUpstreamConnect,
  captureApp,
  onRequest,
  onUpgrade,
  waitForOwnedConnection,
} = {}) {
  const externalPort = portSequence;
  portSequence += 3;
  const runId = `secure-transport-${externalPort}`;
  const env = buildE2EProfileEnv(
    { E2E_PROFILE_PORT: String(externalPort) },
    {
      repoRoot: process.cwd(),
      runId,
      runNonce: "c".repeat(64),
    },
  );
  const tls = provisionE2ETlsIdentity(env);
  const key = readFileSync(tls.keyDescriptor);
  closeSync(tls.keyDescriptor);
  const reusableKey = Buffer.from(key);
  mkdirSync(dirname(env.E2E_PROFILE_SERVER_PID_FILE), {
    mode: 0o700,
    recursive: true,
  });
  writeFileSync(env.E2E_PROFILE_SERVER_PID_FILE, `${process.pid}\n`, {
    mode: 0o600,
  });
  const requests = [];
  const appSockets = new Set();
  const app = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      requests.push({
        body: Buffer.concat(chunks).toString(),
        cookie: request.headers.cookie,
        method: request.method,
        url: request.url,
      });
      if (onRequest) {
        onRequest(request, response);
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  app.on("connection", (socket) => {
    appSockets.add(socket);
    socket.once("close", () => appSockets.delete(socket));
  });
  if (onUpgrade) app.on("upgrade", onUpgrade);
  captureApp?.(app);
  await listen(app, Number(new URL(env.E2E_PROFILE_APP_URL).port));
  const certificate = readFileSync(env.E2E_PROFILE_TLS_CERT_FILE);
  const transport = await startE2EWebServer({
    beforeUpstreamConnect,
    certificate,
    env,
    privateKey: key,
    stdout: () => {},
    waitForOwnedConnection,
  });
  return {
    app,
    certificate,
    config: transport.state.config,
    env,
    requests,
    reusableKey,
    transport,
    async close() {
      transport.state.capabilityKey.fill(0);
      reusableKey.fill(0);
      for (const socket of appSockets) socket.destroy();
      await closeServer(transport.server);
      await closeServer(app);
      rmSync(dirname(env.E2E_PROFILE_SERVER_PID_FILE), {
        force: true,
        recursive: true,
      });
    },
  };
}

async function issueCapability(channel, config, target, method, body) {
  const commitment = {
    bodyHash: createHash("sha256").update(body).digest("hex"),
    host: target.host,
    method,
    origin: target.origin,
    path: target.pathname,
    query: target.search,
  };
  const encoded = Buffer.from(JSON.stringify(commitment));
  const response = await requestOnVerifiedProxyChannel(channel, config, {
    body: encoded,
    headers: {
      "content-length": String(encoded.length),
      "content-type": "application/json",
      host: target.host,
    },
    method: "POST",
    path: E2E_CAPABILITY_ENDPOINT,
    timeoutMs: 5_000,
  });
  assert.equal(response.status, 201);
  return JSON.parse(response.body.toString("utf8")).capability;
}

async function rawPinnedRequest(fixture, path) {
  const channel = await openVerifiedProxyChannel(fixture.config);
  try {
    return await requestOnVerifiedProxyChannel(channel, fixture.config, {
      headers: { host: fixture.config.origin.host },
      method: "GET",
      path,
      timeoutMs: 5_000,
    });
  } finally {
    channel.agent.destroy();
    channel.socket.destroy();
  }
}

async function sendPinnedWebSocket(fixture, cookie) {
  const channel = await openVerifiedProxyChannel(fixture.config);
  channel.socket.write(
    `GET /collab HTTP/1.1\r\nHost: ${fixture.config.origin.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nCookie: ${cookie}\r\n\r\n`,
  );
  return channel;
}

async function launchPinnedChromium(fixture) {
  return chromium.launch({
    headless: true,
    env: e2EPlaywrightProcessEnv(fixture.env),
    args: [
      `--host-resolver-rules=MAP ${fixture.env.E2E_PROFILE_HOSTNAME} 127.0.0.1`,
      "--no-first-run",
    ],
  });
}

function secureSessionCookie(fixture, value) {
  return {
    httpOnly: true,
    name: "__Secure-authjs.session-token",
    sameSite: "Lax",
    secure: true,
    url: fixture.env.E2E_BASE_URL,
    value,
  };
}

function hostileByteServer({ closeOnData = false } = {}) {
  let byteCount = 0;
  let connectionCount = 0;
  const chunks = [];
  const connected = deferred();
  const server = createNetServer((socket) => {
    connectionCount += 1;
    connected.resolve();
    socket.on("data", (chunk) => {
      byteCount += chunk.length;
      chunks.push(Buffer.from(chunk));
      if (closeOnData) socket.destroy();
    });
  });
  return {
    bytes: () => byteCount,
    connected: connected.promise,
    connections: () => connectionCount,
    raw: () => Buffer.concat(chunks).toString("latin1"),
    server,
  };
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function socketTermination(socket) {
  return new Promise((resolvePromise) => {
    for (const event of ["close", "end", "error"]) {
      socket.once(event, resolvePromise);
    }
  });
}

async function assertBlockedWebSocket(fixture, cookie) {
  let channel;
  try {
    channel = await sendPinnedWebSocket(fixture, cookie);
    await withTimeout(
      socketTermination(channel.socket),
      5_000,
      "blocked WSS termination",
    );
  } catch {
    // TLS or the upgrade may be rejected before a channel is returned.
  } finally {
    channel?.agent.destroy();
    channel?.socket.destroy();
  }
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_resolvePromise, rejectPromise) => {
      const timeout = setTimeout(
        () => rejectPromise(new Error(`Timed out waiting for ${label}.`)),
        timeoutMs,
      );
      timeout.unref?.();
    }),
  ]);
}

function readCompromiseState(fixture) {
  return JSON.parse(
    readFileSync(fixture.env.E2E_PROFILE_COMPROMISE_FILE, "utf8"),
  ).state;
}

function listen(server, port) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  server.closeAllConnections?.();
  return new Promise((resolvePromise) => server.close(resolvePromise));
}

function hexPort(port) {
  return port.toString(16).toUpperCase().padStart(4, "0");
}

async function reserveFreePort() {
  const server = createNetServer();
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const address = server.address();
  await closeServer(server);
  return address.port;
}

async function waitForOutput(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error("Timed out waiting for hostile peer fixture output.");
}
