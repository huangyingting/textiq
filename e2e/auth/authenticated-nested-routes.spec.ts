import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";

import { login } from "../helpers/auth";
import { credentialGatedRequest } from "../helpers/credential-gate";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";

test.describe("authenticated nested app routes", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run nested route smoke",
  );
  test.setTimeout(180_000);

  test("dashboard-linked document, billing, and slide routes render after login @required-profile", async ({
    browser,
    page,
  }) => {
    const documentPath = profileDocPath();

    await login(page, profileOwnerCredentials());

    const documentCard = page.locator(`a[href="${documentPath}"]`).first();
    await expect(documentCard).toBeVisible({ timeout: 60_000 });
    await expect(documentCard).toHaveAttribute("href", documentPath);

    await page.goto(documentPath);
    await expect(page).toHaveURL(new RegExp(`${documentPath}$`), {
      timeout: 60_000,
    });
    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);

    await page.goto("/app/settings/billing");
    await expect(
      page.getByRole("heading", { name: /billing & plan/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);

    await page.goto(`${documentPath}/slides`);
    await expect(
      page.getByRole("dialog", { name: "Slide editor" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);

    const secondContext = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL,
    });
    try {
      const secondPage = await secondContext.newPage();
      await login(
        secondPage,
        profileOwnerCredentials(),
        "/app/settings/billing",
      );
      await expect(
        secondPage.getByRole("heading", { name: /billing & plan/i }),
      ).toBeVisible({ timeout: 60_000 });

      const [firstSession, secondSession] = await Promise.all([
        credentialGatedRequest(page).get("/api/auth/session"),
        credentialGatedRequest(secondPage).get("/api/auth/session"),
      ]);
      expect(firstSession.status()).toBe(200);
      expect(secondSession.status()).toBe(200);
    } finally {
      await secondContext.close();
    }
  });

  test("real HTTPS login keeps the Auth.js session cookie secure and isolates the proxy key @required-profile", async ({
    page,
  }) => {
    const setCookieHeaderPromises: Array<
      Promise<Array<{ name: string; value: string }>>
    > = [];
    const captureResponseHeaders = (response: {
      headersArray(): Promise<Array<{ name: string; value: string }>>;
    }) => {
      setCookieHeaderPromises.push(response.headersArray());
    };
    page.on("response", captureResponseHeaders);
    await page.goto("/login");
    await page
      .locator('input[name="email"]')
      .fill(profileOwnerCredentials().email);
    await page
      .locator('input[name="password"]')
      .fill(profileOwnerCredentials().password);
    await Promise.all([
      page.waitForURL(/\/app(\/|$|\?)/, { waitUntil: "commit" }),
      page.getByRole("button", { name: /log in/i }).click(),
    ]);
    page.off("response", captureResponseHeaders);

    const responseHeaders = (await Promise.all(setCookieHeaderPromises)).flat();
    const browserCookies = await page
      .context()
      .cookies(process.env.E2E_BASE_URL);
    const sessionCookies = browserCookies.filter((cookie) =>
      cookie.name.includes("session-token"),
    );
    expect(sessionCookies.length).toBeGreaterThan(0);
    for (const cookie of sessionCookies) {
      expect(cookie.name).toMatch(/^__Secure-authjs\.session-token(?:\.\d+)?$/);
      expect(cookie.secure).toBe(true);
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe("Lax");
      expect(cookie.path).toBe("/");
      expect(cookie.domain).toBe(new URL(process.env.E2E_BASE_URL!).hostname);
      expect(cookie.domain).not.toBe("localhost");
      const setCookie = responseHeaders.find(
        (header) =>
          header.name.toLowerCase() === "set-cookie" &&
          header.value.startsWith(`${cookie.name}=${cookie.value}`),
      )?.value;
      expect(setCookie).toBeDefined();
      expect(setCookie).toMatch(/;\s*Path=\//i);
      expect(setCookie).toMatch(/;\s*HttpOnly(?:;|$)/i);
      expect(setCookie).toMatch(/;\s*Secure(?:;|$)/i);
      expect(setCookie).toMatch(/;\s*SameSite=Lax(?:;|$)/i);
      expect(setCookie).not.toMatch(/;\s*Domain=/i);
    }

    const sessionResponse =
      await credentialGatedRequest(page).get("/api/auth/session");
    expect(sessionResponse.status()).toBe(200);
    expect((await sessionResponse.json()).user.email).toBe(
      profileOwnerCredentials().email,
    );
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app(?:\/|$|\?)/);

    const hostileRequests: Array<{
      cookie: string | undefined;
      host: string | undefined;
      url: string | undefined;
    }> = [];
    const ipv4 = await listenHostile("127.0.0.1", hostileRequests);
    const ipv6 = await listenHostile("::1", hostileRequests);
    try {
      const ipv4Port = serverPort(ipv4);
      const ipv6Port = serverPort(ipv6);
      for (const url of [
        `http://localhost:${ipv4Port}/plaintext-localhost`,
        `http://127.0.0.1:${ipv4Port}/ipv4-loopback`,
        `http://[::1]:${ipv6Port}/ipv6-loopback`,
        `http://external.localhost:${ipv6Port}/external-origin`,
      ]) {
        const probe = await page.context().newPage();
        await probe.goto(url);
        await probe.close();
      }
    } finally {
      await Promise.all([closeServer(ipv4), closeServer(ipv6)]);
    }
    expect(hostileRequests).toHaveLength(4);
    for (const request of hostileRequests) {
      expect(request.cookie).toBeUndefined();
    }
  });

  test("running secure profile isolates the private-key descriptor from runner, app, Playwright, and Chromium @required-profile", () => {
    assertProfilePrivateKeyIsolation();
  });
});

async function listenHostile(
  host: string,
  requests: Array<{
    cookie: string | undefined;
    host: string | undefined;
    url: string | undefined;
  }>,
): Promise<Server> {
  const server = createServer((request, response) => {
    requests.push({
      cookie: request.headers.cookie,
      host: request.headers.host,
      url: request.url,
    });
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("hostile");
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, host, resolvePromise);
  });
  return server;
}

function serverPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Hostile cookie listener did not expose a TCP port.");
  }
  return address.port;
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  server.closeAllConnections?.();
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

function assertProfilePrivateKeyIsolation(): void {
  if (process.platform !== "linux") {
    throw new Error("The secure profile key-isolation attack requires Linux.");
  }
  const identityFile = requiredEnv("E2E_PROFILE_IDENTITY_FILE");
  const runtimeDirectory = requiredEnv("E2E_PROFILE_SERVER_PID_FILE").replace(
    /\/[^/]+$/,
    "",
  );
  const identity = JSON.parse(readFileSync(identityFile, "utf8")) as {
    appPid: number;
    proxyPid: number;
  };
  const runnerPid = findAncestor(process.pid, (command) =>
    command.includes("scripts/e2e-profile.mjs"),
  );
  if (!runnerPid) {
    throw new Error("Unable to locate the deterministic profile runner.");
  }
  const processTree = descendantsOf(runnerPid);
  expect(processTree.has(identity.proxyPid)).toBe(true);
  expect(processTree.has(identity.appPid)).toBe(true);
  expect(processTree.has(process.pid)).toBe(true);

  for (const pid of processTree) {
    const commandLine = readProcFile(pid, "cmdline");
    const environment = readProcFile(pid, "environ");
    expect(commandLine).not.toContain("BEGIN PRIVATE KEY");
    expect(environment).not.toContain("BEGIN PRIVATE KEY");
    expect(commandLine).not.toContain(".proxy-key-");
    if (pid !== identity.proxyPid) {
      expect(environment).not.toContain("E2E_PROFILE_TLS_KEY_FD=");
    }
    for (const target of descriptorTargets(pid)) {
      expect(target).not.toContain(".proxy-key-");
    }
  }

  const runtimeFiles = readdirSync(runtimeDirectory);
  expect(runtimeFiles.some((name) => /private|proxy-key/i.test(name))).toBe(
    false,
  );
  for (const name of runtimeFiles) {
    const path = `${runtimeDirectory}/${name}`;
    if (!statSync(path).isFile()) continue;
    const content = readFileSync(path);
    expect(content.includes(Buffer.from("BEGIN PRIVATE KEY"))).toBe(false);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for this profile test.`);
  return value;
}

function findAncestor(
  startPid: number,
  predicate: (command: string) => boolean,
): number | undefined {
  let pid = startPid;
  while (pid > 1) {
    const command = readProcFile(pid, "cmdline").replaceAll("\0", " ");
    if (predicate(command)) return pid;
    pid = parentPid(pid);
  }
  return undefined;
}

function descendantsOf(rootPid: number): Set<number> {
  const parentByPid = new Map<number, number>();
  for (const name of readdirSync("/proc")) {
    if (!/^[1-9]\d*$/.test(name)) continue;
    const pid = Number(name);
    try {
      parentByPid.set(pid, parentPid(pid));
    } catch {
      // Processes may exit while /proc is enumerated.
    }
  }
  const result = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of parentByPid) {
      if (!result.has(pid) && result.has(parent)) {
        result.add(pid);
        changed = true;
      }
    }
  }
  return result;
}

function parentPid(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const closingName = stat.lastIndexOf(")");
  return Number(stat.slice(closingName + 2).split(" ")[1]);
}

function readProcFile(pid: number, name: "cmdline" | "environ"): string {
  try {
    return readFileSync(`/proc/${pid}/${name}`, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "";
    }
    throw error;
  }
}

function descriptorTargets(pid: number): string[] {
  try {
    return readdirSync(`/proc/${pid}/fd`).flatMap((descriptor) => {
      try {
        return [readlinkSync(`/proc/${pid}/fd/${descriptor}`)];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}
