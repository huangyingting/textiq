import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ABUSE_BUDGET_NAMESPACES,
  InMemoryAbuseBudgetStore,
  abuseBudgetSubject,
  assertUniqueAbuseBudgetNamespaces,
  checkAbuseBudget,
  checkIpRateLimit,
  getAbuseBudgetNamespace,
  getClientSubject,
  requireAbuseBudgetSecret,
} from "@/lib/abuse-budget";

const SECRET = "abuse-budget-test-secret";

test("abuse-budget registry namespaces are unique and documented", () => {
  assert.doesNotThrow(() => assertUniqueAbuseBudgetNamespaces());
  for (const entry of ABUSE_BUDGET_NAMESPACES) {
    assert.match(entry.namespace, /^[a-z0-9.-]+$/);
    assert.ok(entry.owner);
    assert.ok(entry.rationale);
    assert.ok(entry.limitEnv);
    assert.ok(entry.windowEnv);
    assert.ok(entry.defaultLimit > 0);
    assert.ok(entry.defaultWindowMs > 0);
  }
});

test("getAbuseBudgetNamespace returns the configured signup budget", () => {
  assert.deepEqual(getAbuseBudgetNamespace("auth.signup.email"), {
    namespace: "auth.signup.email",
    owner: "auth",
    rationale: "Throttle account-creation bursts by submitted address.",
    limitEnv: "AUTH_SIGNUP_RATE_LIMIT",
    windowEnv: "AUTH_SIGNUP_RATE_WINDOW_MS",
    defaultLimit: 5,
    defaultWindowMs: 60_000,
  });
});

test("share passcode attempts have a dedicated public abuse budget", () => {
  assert.deepEqual(getAbuseBudgetNamespace("public.share-passcode.ip"), {
    namespace: "public.share-passcode.ip",
    owner: "public",
    rationale: "Throttle repeated public share passcode attempts per link.",
    limitEnv: "PUBLIC_SHARE_PASSCODE_RATE_LIMIT",
    windowEnv: "PUBLIC_SHARE_PASSCODE_RATE_WINDOW_MS",
    defaultLimit: 10,
    defaultWindowMs: 60_000,
  });
});

test("assertUniqueAbuseBudgetNamespaces rejects drift duplicates", () => {
  assert.throws(
    () =>
      assertUniqueAbuseBudgetNamespaces([
        { namespace: "auth.login.email" },
        { namespace: "auth.login.email" },
      ]),
    /Duplicate abuse-budget namespace: auth\.login\.email/,
  );
});

test("abuseBudgetSubject hashes raw subjects and namespaces keys", () => {
  const subject = abuseBudgetSubject(
    "auth.login.email",
    "person@example.com",
    SECRET,
  );

  assert.equal(subject.subjectHash.length, 32);
  assert.ok(!subject.key.includes("person@example.com"));
  assert.equal(subject.key, `auth.login.email:${subject.subjectHash}`);
});

test("checkAbuseBudget works with deterministic in-memory store", async () => {
  process.env.AUTH_LOGIN_RATE_LIMIT = "2";
  process.env.AUTH_LOGIN_RATE_WINDOW_MS = "1000";
  try {
    const store = new InMemoryAbuseBudgetStore();
    const base = {
      namespace: "auth.login.email" as const,
      subject: "person@example.com",
      secret: SECRET,
      store,
    };

    assert.equal((await checkAbuseBudget({ ...base, now: 0 })).allowed, true);
    assert.equal((await checkAbuseBudget({ ...base, now: 10 })).allowed, true);
    const blocked = await checkAbuseBudget({ ...base, now: 20 });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.result.allowed, false);
    assert.equal(blocked.subjectHash.length, 32);
    assert.equal(blocked.key, `auth.login.email:${blocked.subjectHash}`);
    assert.equal(blocked.retryAfterSeconds, 1);
  } finally {
    delete process.env.AUTH_LOGIN_RATE_LIMIT;
    delete process.env.AUTH_LOGIN_RATE_WINDOW_MS;
  }
});

test("checkAbuseBudget omits retry advice while the subject is allowed", async () => {
  const store = new InMemoryAbuseBudgetStore();

  const result = await checkAbuseBudget({
    namespace: "auth.login.email",
    subject: "person@example.com",
    secret: SECRET,
    store,
    now: 0,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.retryAfterSeconds, undefined);
});

test("getAbuseBudgetNamespace rejects unknown namespaces defensively", () => {
  assert.throws(
    () => getAbuseBudgetNamespace("unknown.namespace" as never),
    /Unknown abuse-budget namespace: unknown\.namespace/,
  );
});

test("InMemoryAbuseBudgetStore returns copies and can be cleared", async () => {
  const store = new InMemoryAbuseBudgetStore();
  await store.set("key", { count: 1, resetAt: 1000 });

  const first = await store.get("key");
  assert.deepEqual(first, { count: 1, resetAt: 1000 });
  first!.count = 99;
  assert.deepEqual(await store.get("key"), { count: 1, resetAt: 1000 });

  store.clear();
  assert.equal(await store.get("key"), undefined);
});

test("checkIpRateLimit hashes the trusted forwarded client IP subject", async () => {
  process.env.PUBLIC_SHARE_RATE_LIMIT = "1";
  process.env.PUBLIC_SHARE_RATE_WINDOW_MS = "1000";
  try {
    const store = new InMemoryAbuseBudgetStore();
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    });
    const clientIp = {
      remoteAddress: "10.0.0.2",
      trustedProxyCidrs: ["10.0.0.0/8"],
    };
    assert.equal(getClientSubject(headers, clientIp), "203.0.113.10");

    const first = await checkIpRateLimit({
      namespace: "public.share.ip",
      headers,
      secret: SECRET,
      store,
      now: 0,
      clientIp,
    });
    const blocked = await checkIpRateLimit({
      namespace: "public.share.ip",
      headers,
      secret: SECRET,
      store,
      now: 10,
      clientIp,
    });

    assert.equal(first.allowed, true);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.key, first.key);
    assert.equal(blocked.retryAfterSeconds, 1);
  } finally {
    delete process.env.PUBLIC_SHARE_RATE_LIMIT;
    delete process.env.PUBLIC_SHARE_RATE_WINDOW_MS;
  }
});

test("checkIpRateLimit collapses untrusted spoofed forwarding headers", async () => {
  process.env.PUBLIC_SHARE_RATE_LIMIT = "1";
  process.env.PUBLIC_SHARE_RATE_WINDOW_MS = "1000";
  try {
    const store = new InMemoryAbuseBudgetStore();
    const spoofA = new Headers({ "x-forwarded-for": "203.0.113.10" });
    const spoofB = new Headers({ "x-forwarded-for": "203.0.113.11" });
    const clientIp = {
      remoteAddress: "198.51.100.2",
      trustedProxyCidrs: ["10.0.0.0/8"],
      onDiagnostic: () => undefined,
    };

    assert.equal(getClientSubject(spoofA, clientIp), "198.51.100.2");

    const first = await checkIpRateLimit({
      namespace: "public.share.ip",
      headers: spoofA,
      secret: SECRET,
      store,
      now: 0,
      clientIp,
    });
    const blocked = await checkIpRateLimit({
      namespace: "public.share.ip",
      headers: spoofB,
      secret: SECRET,
      store,
      now: 10,
      clientIp,
    });

    assert.equal(first.allowed, true);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.key, first.key);
  } finally {
    delete process.env.PUBLIC_SHARE_RATE_LIMIT;
    delete process.env.PUBLIC_SHARE_RATE_WINDOW_MS;
  }
});

test("checkIpRateLimit uses a shared unknown bucket when no IP is available", async () => {
  process.env.PUBLIC_SHARE_RATE_LIMIT = "1";
  process.env.PUBLIC_SHARE_RATE_WINDOW_MS = "1000";
  try {
    const store = new InMemoryAbuseBudgetStore();
    assert.equal(getClientSubject(new Headers({})), "unknown");

    const first = await checkIpRateLimit({
      namespace: "public.share.ip",
      headers: new Headers({}),
      secret: SECRET,
      store,
      now: 0,
      clientIp: { onDiagnostic: () => undefined },
    });
    const blocked = await checkIpRateLimit({
      namespace: "public.share.ip",
      headers: new Headers({}),
      secret: SECRET,
      store,
      now: 10,
      clientIp: { onDiagnostic: () => undefined },
    });

    assert.equal(first.allowed, true);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.key, first.key);
  } finally {
    delete process.env.PUBLIC_SHARE_RATE_LIMIT;
    delete process.env.PUBLIC_SHARE_RATE_WINDOW_MS;
  }
});

test("requireAbuseBudgetSecret reads the optional auth secret", () => {
  const original = process.env.AUTH_SECRET;
  try {
    process.env.AUTH_SECRET = "secret-value";
    assert.equal(requireAbuseBudgetSecret(), "secret-value");
    delete process.env.AUTH_SECRET;
    assert.equal(requireAbuseBudgetSecret(), undefined);
  } finally {
    if (original === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = original;
    }
  }
});
