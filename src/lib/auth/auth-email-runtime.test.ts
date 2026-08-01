import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  createRuntimeAuthEmailDeliveryPort,
  isAuthEmailConfigurationReady,
} from "@/lib/auth/auth-email-runtime";

const MANAGED_ENV = [
  "NODE_ENV",
  "AUTH_EMAIL_DELIVERY",
  "AUTH_EMAIL_FROM",
  "RESEND_API_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;
const saved: Record<string, string | undefined> = {};
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  for (const name of MANAGED_ENV) {
    saved[name] = env[name];
    delete env[name];
  }
});

afterEach(() => {
  for (const name of MANAGED_ENV) {
    if (saved[name] === undefined) delete env[name];
    else env[name] = saved[name];
  }
});

function configureResend(): void {
  env.AUTH_EMAIL_DELIVERY = "resend";
  env.AUTH_EMAIL_FROM = "TextIQ <auth@example.com>";
  env.RESEND_API_KEY = "re_secret";
  env.NEXT_PUBLIC_APP_URL = "https://textiq.example";
}

test("development defaults to console while production fails closed", async () => {
  env.NODE_ENV = "development";
  assert.equal(isAuthEmailConfigurationReady(), true);

  env.NODE_ENV = "production";
  assert.equal(isAuthEmailConfigurationReady(), false);
  await assert.rejects(
    () =>
      createRuntimeAuthEmailDeliveryPort().send({
        kind: "password-reset",
        to: "ada@example.com",
        resetUrl: "https://textiq.example/reset-password?token=secret",
      }),
    /not configured/,
  );
});

test("production requires Resend credentials, sender, and canonical HTTPS origin", () => {
  env.NODE_ENV = "production";
  configureResend();
  assert.equal(isAuthEmailConfigurationReady(), true);

  env.AUTH_EMAIL_FROM = "TextIQ\nBcc: attacker@example.com";
  assert.equal(isAuthEmailConfigurationReady(), false);
  env.AUTH_EMAIL_FROM = "TextIQ <auth@example.com>";

  env.AUTH_EMAIL_FROM = "not-an-email";
  assert.equal(isAuthEmailConfigurationReady(), false);
  env.AUTH_EMAIL_FROM = "TextIQ <auth@example.com>";

  env.RESEND_API_KEY = "wrong-provider-key";
  assert.equal(isAuthEmailConfigurationReady(), false);
  env.RESEND_API_KEY = "re_secret";

  env.NEXT_PUBLIC_APP_URL = "http://textiq.example";
  assert.equal(isAuthEmailConfigurationReady(), false);
  env.NEXT_PUBLIC_APP_URL = "https://textiq.example/path";
  assert.equal(isAuthEmailConfigurationReady(), false);

  env.NEXT_PUBLIC_APP_URL = "https://textiq.example/";
  assert.equal(isAuthEmailConfigurationReady(), true);
  env.AUTH_EMAIL_DELIVERY = "smtp";
  assert.equal(isAuthEmailConfigurationReady(), false);
});

test("Resend adapter sends minimal reset and verification messages", async () => {
  env.NODE_ENV = "production";
  configureResend();
  const requests: Array<{ input: string; init: RequestInit }> = [];
  const port = createRuntimeAuthEmailDeliveryPort({
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init: init ?? {} });
      return new Response(null, { status: 202 });
    },
  });

  await port.send({
    kind: "password-reset",
    to: "ada@example.com",
    resetUrl:
      "https://textiq.example/reset-password?token=one&return=<settings>",
  });
  await port.send({
    kind: "email-verification",
    to: "ada@example.com",
    verifyUrl: "https://textiq.example/verify-email/two",
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.input, "https://api.resend.com/emails");
  assert.equal(requests[0]?.init.method, "POST");
  assert.deepEqual(requests[0]?.init.headers, {
    Authorization: "Bearer re_secret",
    "Content-Type": "application/json",
  });
  const resetBody = JSON.parse(String(requests[0]?.init.body)) as Record<
    string,
    unknown
  >;
  assert.equal(resetBody.from, "TextIQ <auth@example.com>");
  assert.deepEqual(resetBody.to, ["ada@example.com"]);
  assert.equal(resetBody.subject, "Reset your TextIQ password");
  assert.match(String(resetBody.text), /token=one&return=<settings>/);
  assert.match(String(resetBody.html), /token=one&amp;return=&lt;settings&gt;/);
  assert.doesNotMatch(String(resetBody.html), /token=one&return=<settings>/);

  const verifyBody = JSON.parse(String(requests[1]?.init.body)) as Record<
    string,
    unknown
  >;
  assert.equal(verifyBody.subject, "Verify your TextIQ email");
  assert.match(String(verifyBody.text), /verify-email\/two/);
  assert.equal(requests[0]?.init.signal instanceof AbortSignal, true);
});

test("Resend adapter fails on provider rejection without reading its body", async () => {
  env.NODE_ENV = "production";
  configureResend();
  let bodyRead = false;
  const port = createRuntimeAuthEmailDeliveryPort({
    fetchImpl: async () =>
      ({
        ok: false,
        text: async () => {
          bodyRead = true;
          return "provider secret";
        },
      }) as Response,
  });

  await assert.rejects(
    () =>
      port.send({
        kind: "email-verification",
        to: "ada@example.com",
        verifyUrl: "https://textiq.example/verify-email/secret",
      }),
    /provider rejected delivery/,
  );
  assert.equal(bodyRead, false);
});

test("Resend adapter aborts a delivery that exceeds its deadline", async () => {
  env.NODE_ENV = "production";
  configureResend();
  const port = createRuntimeAuthEmailDeliveryPort({
    timeoutMs: 5,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  });

  await assert.rejects(
    () =>
      port.send({
        kind: "password-reset",
        to: "ada@example.com",
        resetUrl: "https://textiq.example/reset-password?token=secret",
      }),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError",
  );
});
