import assert from "node:assert/strict";
import { once } from "node:events";
import {
  linkSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import {
  chromium,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

import {
  assertProfileCredentialGate,
  credentialGatedRequest,
  unauthenticatedRequest,
} from "../../../e2e/helpers/credential-gate";
import { readSecureFile } from "../../../scripts/e2e-credential-gate.mjs";

const root = resolve(".tmp", "test-fixtures", "credential-gate-helper");

before(() => {
  rmSync(root, { force: true, recursive: true });
  mkdirSync(root, { mode: 0o700, recursive: true });
});

after(() => {
  rmSync(root, { force: true, recursive: true });
});

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{
  close: () => Promise<void>;
  origin: string;
}> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    close: async () => {
      server.close();
      await once(server, "close");
    },
    origin: `http://127.0.0.1:${address.port}`,
  };
}

test(
  "credential trust files reject symlinks and hard links",
  { skip: process.platform !== "linux" },
  async () => {
    const target = resolve(root, "identity-target.json");
    const identity = resolve(root, "listener-identity.json");
    const hardLink = resolve(root, "identity-hard-link.json");
    rmSync(identity, { force: true });
    rmSync(hardLink, { force: true });
    writeFileSync(target, "{}\n", { mode: 0o600 });
    symlinkSync(target, identity);
    assert.throws(() => readSecureFile(identity, "listener identity"));
    rmSync(identity);
    writeFileSync(identity, "{}\n", { mode: 0o600 });
    linkSync(identity, hardLink);
    assert.throws(
      () => readSecureFile(identity, "listener identity"),
      /descriptor-safe/,
    );
  },
);

test("non-profile credentials do not require the deterministic gate", async () => {
  await assert.doesNotReject(assertProfileCredentialGate({}));
});

test("credential-gated request verbs fail before resolving a Playwright request context", async () => {
  const names = [
    "E2E_PROFILE",
    "E2E_BASE_URL",
    "BASE_URL",
    "E2E_PROFILE_READINESS_URL",
    "E2E_PROFILE_RUN_ID",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  process.env.E2E_PROFILE = "1";
  delete process.env.E2E_BASE_URL;
  delete process.env.BASE_URL;
  delete process.env.E2E_PROFILE_READINESS_URL;
  delete process.env.E2E_PROFILE_RUN_ID;
  let requestContextReads = 0;
  let networkCalls = 0;
  const owner = {
    get request() {
      requestContextReads += 1;
      return Object.fromEntries(
        ["delete", "fetch", "get", "head", "patch", "post", "put"].map(
          (method) => [
            method,
            async () => {
              networkCalls += 1;
              throw new Error("network must not be reached");
            },
          ],
        ),
      );
    },
  };
  const gated = credentialGatedRequest(
    owner as unknown as Parameters<typeof credentialGatedRequest>[0],
  );

  try {
    for (const send of [
      () => gated.delete("/private"),
      () => gated.fetch("/private"),
      () => gated.get("/private"),
      () => gated.head("/private"),
      () => gated.patch("/private"),
      () => gated.post("/private"),
      () => gated.put("/private"),
    ]) {
      await assert.rejects(
        send(),
        /E2E_PROFILE_RUN_ID is required and must be a safe run id\./,
      );
    }
    assert.equal(requestContextReads, 0);
    assert.equal(networkCalls, 0);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("credential-gated requests disable automatic redirects for every operation", async () => {
  const previousProfile = process.env.E2E_PROFILE;
  delete process.env.E2E_PROFILE;
  const calls: Array<{ method: string; maxRedirects: number | undefined }> = [];
  const api = Object.fromEntries(
    ["delete", "fetch", "get", "head", "patch", "post", "put"].map((method) => [
      method,
      async (_url: string, options: { maxRedirects?: number } | undefined) => {
        calls.push({ method, maxRedirects: options?.maxRedirects });
        return {};
      },
    ]),
  );
  const gated = credentialGatedRequest({
    request: api,
  } as unknown as Parameters<typeof credentialGatedRequest>[0]);

  try {
    await gated.delete("/private", { maxRedirects: 12 });
    await gated.fetch("/private", { maxRedirects: 12 });
    await gated.get("/private", { maxRedirects: 12 });
    await gated.head("/private", { maxRedirects: 12 });
    await gated.patch("/private", { maxRedirects: 12 });
    await gated.post("/private", { maxRedirects: 12 });
    await gated.put("/private", { maxRedirects: 12 });
    assert.deepEqual(
      calls,
      ["delete", "fetch", "get", "head", "patch", "post", "put"].map(
        (method) => ({ method, maxRedirects: 0 }),
      ),
    );
  } finally {
    if (previousProfile === undefined) delete process.env.E2E_PROFILE;
    else process.env.E2E_PROFILE = previousProfile;
  }
});

test("credential-gated requests allow safe headers but reject caller credentials after the gate", async () => {
  const previousProfile = process.env.E2E_PROFILE;
  delete process.env.E2E_PROFILE;
  const calls: Array<Record<string, string> | undefined> = [];
  const gated = credentialGatedRequest({
    request: {
      get: async (
        _url: string,
        options: { headers?: Record<string, string> } | undefined,
      ) => {
        calls.push(options?.headers);
        return {};
      },
    },
  } as unknown as Parameters<typeof credentialGatedRequest>[0]);

  try {
    const safeAlias = { Accept: "application/json" };
    await gated.get("/private", {
      headers: { ...safeAlias, "X-Request-Mode": "e2e" },
    });
    assert.deepEqual(calls, [
      { accept: "application/json", "x-request-mode": "e2e" },
    ]);

    const computedName = "X-Auth-Token";
    const credentialHeaders: Array<Record<string, string>> = [
      { Authorization: "******" },
      { cOoKiE: "session=caller-secret" },
      { "Proxy-Authorization": "Basic caller-secret" },
      { ...{ [computedName]: "caller-secret" } },
    ];
    for (const headers of credentialHeaders) {
      await assert.rejects(
        gated.get("/private", { headers }),
        /reject credential header/i,
      );
    }
    await assert.rejects(
      gated.get("/private", {
        headers: new Map() as unknown as Record<string, string>,
      }),
      /plain header object/,
    );
    assert.equal(calls.length, 1);
  } finally {
    if (previousProfile === undefined) delete process.env.E2E_PROFILE;
    else process.env.E2E_PROFILE = previousProfile;
  }
});

test("public request contexts use empty storage and are always disposed", async () => {
  const originalNewContext = playwrightRequest.newContext;
  const contextOptions: Parameters<typeof playwrightRequest.newContext>[0][] =
    [];
  let disposals = 0;
  const response = {
    body: async () => Buffer.from("public"),
    headers: () => ({ "content-type": "text/plain" }),
    headersArray: () => [{ name: "content-type", value: "text/plain" }],
    status: () => 200,
    statusText: () => "OK",
    url: () => "http://localhost:5222/public",
  };
  playwrightRequest.newContext = async (options) => {
    contextOptions.push(options);
    return {
      dispose: async () => {
        disposals += 1;
      },
      get: async (url: string) => {
        if (url === "/failure") throw new Error("request failed");
        if (url === "/snapshot-failure") {
          return {
            ...response,
            body: async () => {
              throw new Error("snapshot failed");
            },
          };
        }
        if (url === "/error") {
          return {
            ...response,
            status: () => 500,
            statusText: () => "Internal Server Error",
          };
        }
        return response;
      },
      head: async () => ({
        ...response,
        status: () => 302,
        statusText: () => "Found",
      }),
    } as unknown as APIRequestContext;
  };

  try {
    const publicRequest = unauthenticatedRequest({
      baseURL: "http://localhost:5222",
    });
    assert.equal((await publicRequest.get("/public")).status(), 200);
    assert.equal((await publicRequest.head("/public")).status(), 302);
    assert.equal((await publicRequest.get("/error")).status(), 500);
    await assert.rejects(publicRequest.get("/failure"), /request failed/);
    await assert.rejects(
      publicRequest.get("/snapshot-failure"),
      /snapshot failed/,
    );
    assert.equal(disposals, 5);
    assert.equal(contextOptions.length, 5);
    for (const options of contextOptions) {
      assert.deepEqual(options?.storageState, { cookies: [], origins: [] });
      assert.equal(options?.httpCredentials, undefined);
      assert.equal(options?.clientCertificates, undefined);
      assert.equal(options?.maxRedirects, 0);
    }
  } finally {
    playwrightRequest.newContext = originalNewContext;
  }
});

test("public request completion awaits context disposal", async () => {
  const originalNewContext = playwrightRequest.newContext;
  let releaseDispose: (() => void) | undefined;
  let settled = false;
  playwrightRequest.newContext = async () =>
    ({
      get: async () => ({
        body: async () => Buffer.from("public"),
        headers: () => ({}),
        headersArray: () => [],
        status: () => 200,
        statusText: () => "OK",
        url: () => "http://localhost:5222/public",
      }),
      dispose: () =>
        new Promise<void>((resolveDispose) => {
          releaseDispose = resolveDispose;
        }),
    }) as unknown as APIRequestContext;

  try {
    const pending = unauthenticatedRequest({
      baseURL: "http://localhost:5222",
    })
      .get("/public")
      .then(() => {
        settled = true;
      });
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.equal(settled, false);
    assert.equal(typeof releaseDispose, "function");
    releaseDispose?.();
    await pending;
    assert.equal(settled, true);
  } finally {
    playwrightRequest.newContext = originalNewContext;
  }
});

test("public probes stay isolated from a logged-in browser and reject credential headers before network", async (t) => {
  const received: Array<Record<string, string | string[] | undefined>> = [];
  const server = await listen((request, response) => {
    received.push(request.headers);
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("public");
  });
  t.after(server.close);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    extraHTTPHeaders: { Authorization: "Bearer browser-default" },
  });
  await context.addCookies([
    {
      domain: "127.0.0.1",
      name: "authjs.session-token",
      path: "/",
      value: "browser-session",
    },
  ]);

  const publicRequest = unauthenticatedRequest({ baseURL: server.origin });
  const response = await publicRequest.get("/public", {
    headers: { Accept: "text/plain" },
  });
  assert.equal(response.status(), 200);
  assert.equal(await response.text(), "public");
  assert.equal((await response.body()).toString("utf8"), "public");
  assert.equal(received.length, 1);
  assert.equal(received[0].cookie, undefined);
  assert.equal(received[0].authorization, undefined);
  assert.equal(received[0]["proxy-authorization"], undefined);

  const computedCredentialName = "X-Private-Token";
  const credentialAlias = { cOoKiE: "session=caller-secret" };
  const credentialHeaders: Array<Record<string, string>> = [
    { Authorization: "Bearer default-secret" },
    { ...credentialAlias },
    { "Proxy-Authorization": "Basic caller-secret" },
    { [computedCredentialName]: "caller-secret" },
  ];
  for (const extraHTTPHeaders of credentialHeaders) {
    assert.throws(
      () =>
        unauthenticatedRequest({
          baseURL: server.origin,
          extraHTTPHeaders,
        }),
      /reject credential header/i,
    );
  }
  assert.throws(
    () =>
      unauthenticatedRequest(
        context as unknown as Parameters<typeof unauthenticatedRequest>[0],
      ),
    /accepts options, not a BrowserContext or APIRequestContext/,
  );
  for (const headers of credentialHeaders) {
    await assert.rejects(
      publicRequest.get("/public", { headers }),
      /reject credential header/i,
    );
  }
  await assert.rejects(
    publicRequest.get(
      server.origin.replace("http://", "http://caller:secret@"),
    ),
    /credential-free same-origin URL/,
  );
  assert.equal(received.length, 1);
});

test("authenticated and public API redirects surface 3xx without reaching hostile or login targets", async (t) => {
  const hostileRequests: Array<{
    body: string;
    headers: Record<string, string | string[] | undefined>;
  }> = [];
  const hostile = await listen((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      hostileRequests.push({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: request.headers,
      });
      response.end("hostile");
    });
  });
  t.after(hostile.close);

  let loginRequests = 0;
  const ownedHeaders: Array<Record<string, string | string[] | undefined>> = [];
  const owned = await listen((request, response) => {
    const path = new URL(request.url ?? "/", "http://owned.invalid").pathname;
    if (path === "/login") {
      loginRequests += 1;
      response.end("login");
      return;
    }
    ownedHeaders.push(request.headers);
    const location =
      path === "/same-origin"
        ? "/login"
        : path === "/localhost-hostile"
          ? hostile.origin.replace("127.0.0.1", "localhost")
          : hostile.origin;
    response.writeHead(302, { location });
    response.end("redirect blocked");
  });
  t.after(owned.close);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const authContext = await browser.newContext({ baseURL: owned.origin });
  await authContext.addCookies([
    {
      domain: "127.0.0.1",
      name: "authjs.session-token",
      path: "/",
      value: "authenticated-session",
    },
  ]);
  const page = await authContext.newPage();
  const previousProfile = process.env.E2E_PROFILE;
  delete process.env.E2E_PROFILE;
  try {
    const authenticated = credentialGatedRequest(page);
    const publicRequest = unauthenticatedRequest({ baseURL: owned.origin });
    for (const path of [
      "/external-hostile",
      "/localhost-hostile",
      "/same-origin",
    ]) {
      const authenticatedResponse = await authenticated.get(path);
      assert.equal(authenticatedResponse.status(), 302);
      assert.equal(authenticatedResponse.headers().location?.length > 0, true);
      const publicResponse = await publicRequest.get(path);
      assert.equal(publicResponse.status(), 302);
      assert.equal(await publicResponse.text(), "redirect blocked");
    }
  } finally {
    if (previousProfile === undefined) delete process.env.E2E_PROFILE;
    else process.env.E2E_PROFILE = previousProfile;
  }

  assert.equal(hostileRequests.length, 0);
  assert.equal(loginRequests, 0);
  assert.equal(ownedHeaders.length, 6);
  const authenticatedHeaders = ownedHeaders.filter(
    (headers) => headers.cookie !== undefined,
  );
  const publicHeaders = ownedHeaders.filter(
    (headers) => headers.cookie === undefined,
  );
  assert.equal(authenticatedHeaders.length, 3);
  assert.equal(publicHeaders.length, 3);
  for (const headers of publicHeaders) {
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.authorization, undefined);
    assert.equal(headers["proxy-authorization"], undefined);
  }
  assert.deepEqual(hostileRequests, []);
});
