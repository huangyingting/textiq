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

// ──────────────────────────────────────────────────────────────────────────────
// Facade-level atomic-consume regression tests (#1997 gate)
//
// These tests exercise checkAbuseBudget / checkIpRateLimit through
// InMemoryAbuseBudgetStore and must fail on the pre-ecec78bf optional-fallback
// implementation (where concurrent callers each saw stale count=0 and all
// returned allowed=true, allowing overshoot).
// ──────────────────────────────────────────────────────────────────────────────

test("checkAbuseBudget concurrent same-key allows exact limit and blocks excess atomically", async () => {
  process.env.COLLAB_FLUSH_RATE_LIMIT = "2";
  process.env.COLLAB_FLUSH_RATE_WINDOW_MS = "60000";
  try {
    const store = new InMemoryAbuseBudgetStore();
    const now = 1000;
    const base = {
      namespace: "collab.flush.room" as const,
      subject: "room-concurrent-9001",
      secret: SECRET,
      store,
      now,
    };

    const [r1, r2, r3] = await Promise.all([
      checkAbuseBudget(base),
      checkAbuseBudget(base),
      checkAbuseBudget(base),
    ]);

    const results = [r1, r2, r3];
    const allowed = results.filter((r) => r.allowed);
    const blocked = results.filter((r) => !r.allowed);

    // Derive limit from actual result (configured via env to 2)
    const limit = r1.result.limit;
    assert.equal(limit, 2);

    assert.equal(
      allowed.length,
      2,
      "exactly limit=2 concurrent requests allowed",
    );
    assert.equal(blocked.length, 1, "exactly one concurrent request blocked");

    // All results share the same key and subjectHash
    assert.ok(
      results.every((r) => r.key === r1.key),
      "all concurrent results share the same key",
    );
    assert.ok(
      results.every((r) => r.subjectHash === r1.subjectHash),
      "all concurrent results share the same subjectHash",
    );

    // Sorted remaining values of allowed results: [0, 1]
    const sortedRemaining = allowed
      .map((r) => r.result.remaining)
      .sort((a, b) => a - b);
    assert.deepEqual(sortedRemaining, [0, 1]);

    // All results carry the same resetAt (single shared window)
    const expectedResetAt = now + 60000;
    assert.ok(
      results.every((r) => r.result.resetAt === expectedResetAt),
      "all results share the same resetAt",
    );

    // Allowed results must not carry retryAfterSeconds
    assert.ok(
      allowed.every((r) => r.retryAfterSeconds === undefined),
      "allowed results omit retryAfterSeconds",
    );

    // Blocked result carries exact field values including retryAfterSeconds
    const blockedResult = blocked[0]!;
    assert.equal(blockedResult.result.remaining, 0);
    assert.equal(blockedResult.result.limit, limit);
    assert.equal(blockedResult.result.resetAt, expectedResetAt);
    assert.equal(
      blockedResult.retryAfterSeconds,
      Math.max(1, Math.ceil((expectedResetAt - now) / 1000)),
    );
  } finally {
    delete process.env.COLLAB_FLUSH_RATE_LIMIT;
    delete process.env.COLLAB_FLUSH_RATE_WINDOW_MS;
  }
});

test("checkIpRateLimit concurrent same-IP allows exact limit and blocks excess with normalized key", async () => {
  process.env.IMPORT_RATE_LIMIT = "2";
  process.env.IMPORT_RATE_WINDOW_MS = "60000";
  try {
    const store = new InMemoryAbuseBudgetStore();
    const now = 2000;
    const ipHeaders = new Headers({
      "x-forwarded-for": "203.0.113.50, 10.0.0.1",
    });
    const clientIp = {
      remoteAddress: "10.0.0.5",
      trustedProxyCidrs: ["10.0.0.0/8"],
    };

    // Confirm normalized IP extraction before the concurrent probe
    assert.equal(
      getClientSubject(ipHeaders, clientIp),
      "203.0.113.50",
      "trusted forwarded IP extracted correctly",
    );

    const base = {
      namespace: "import.ip" as const,
      headers: ipHeaders,
      secret: SECRET,
      store,
      now,
      clientIp,
    };

    const [r1, r2, r3] = await Promise.all([
      checkIpRateLimit(base),
      checkIpRateLimit(base),
      checkIpRateLimit(base),
    ]);

    const results = [r1, r2, r3];
    const allowed = results.filter((r) => r.allowed);
    const blocked = results.filter((r) => !r.allowed);

    // Derive limit from actual result
    const limit = r1.result.limit;
    assert.equal(limit, 2);

    assert.equal(allowed.length, 2);
    assert.equal(blocked.length, 1);

    // All results share the same key and subjectHash
    assert.ok(results.every((r) => r.key === r1.key));
    assert.ok(results.every((r) => r.subjectHash === r1.subjectHash));

    // Key is namespace-prefixed hashed identifier — never contains the raw IP
    assert.ok(
      !r1.key.includes("203.0.113.50"),
      "key must not contain the raw client IP",
    );
    assert.equal(r1.key, `import.ip:${r1.subjectHash}`);
    assert.equal(r1.subjectHash.length, 32);

    // Sorted remaining values of allowed results: [0, 1]
    const sortedRemaining = allowed
      .map((r) => r.result.remaining)
      .sort((a, b) => a - b);
    assert.deepEqual(sortedRemaining, [0, 1]);

    // ResetAt and limit are consistent across all results
    const expectedResetAt = now + 60000;
    assert.ok(results.every((r) => r.result.resetAt === expectedResetAt));
    assert.ok(results.every((r) => r.result.limit === limit));

    // Allowed results omit retryAfterSeconds
    assert.ok(allowed.every((r) => r.retryAfterSeconds === undefined));

    // Blocked result carries exact retryAfterSeconds
    const blockedResult = blocked[0]!;
    assert.equal(blockedResult.result.remaining, 0);
    assert.equal(blockedResult.result.resetAt, expectedResetAt);
    assert.equal(
      blockedResult.retryAfterSeconds,
      Math.max(1, Math.ceil((expectedResetAt - now) / 1000)),
    );
  } finally {
    delete process.env.IMPORT_RATE_LIMIT;
    delete process.env.IMPORT_RATE_WINDOW_MS;
  }
});

test("checkAbuseBudget expired-window resets fresh via public facade and authoritative store state", async () => {
  const store = new InMemoryAbuseBudgetStore();
  const ns = getAbuseBudgetNamespace("account.export.user");
  const limit = ns.defaultLimit;
  const windowMs = ns.defaultWindowMs;
  const subject = "export-user-expired-7777";

  // First call at t=0 to derive the deterministic key through the public facade
  const first = await checkAbuseBudget({
    namespace: "account.export.user",
    subject,
    secret: SECRET,
    store,
    now: 0,
  });
  assert.equal(first.allowed, true);
  const key = first.key;

  // Seed an exhausted-and-expired window via the public set API (no private cast)
  await store.set(key, { count: limit, resetAt: 100 });

  // Advance time to exactly the boundary — atomicConsume resets when now >= resetAt
  const now2 = 100;

  const reset = await checkAbuseBudget({
    namespace: "account.export.user",
    subject,
    secret: SECRET,
    store,
    now: now2,
  });

  assert.equal(reset.allowed, true);
  assert.equal(reset.result.remaining, limit - 1);
  assert.equal(reset.result.limit, limit);
  assert.equal(reset.result.resetAt, now2 + windowMs);

  // Authoritative stored state via the intentional public get API
  const stored = await store.get(key);
  assert.deepEqual(stored, { count: 1, resetAt: now2 + windowMs });
});

test("checkAbuseBudget namespace isolation: same subject yields same hash but independent budgets", async () => {
  process.env.AUTH_LOGIN_RATE_LIMIT = "1";
  process.env.AUTH_LOGIN_RATE_WINDOW_MS = "60000";
  process.env.AUTH_SIGNUP_RATE_LIMIT = "2";
  process.env.AUTH_SIGNUP_RATE_WINDOW_MS = "60000";
  try {
    const store = new InMemoryAbuseBudgetStore();
    const subject = "isolation-subject-5555";
    const now = 0;

    const r1a = await checkAbuseBudget({
      namespace: "auth.login.email",
      subject,
      secret: SECRET,
      store,
      now,
    });
    const r2a = await checkAbuseBudget({
      namespace: "auth.signup.email",
      subject,
      secret: SECRET,
      store,
      now,
    });

    // Same subject + secret → same subjectHash regardless of namespace
    assert.equal(r1a.subjectHash, r2a.subjectHash);

    // Different namespaces → different namespace-prefixed keys
    assert.notEqual(r1a.key, r2a.key);
    assert.equal(r1a.key, `auth.login.email:${r1a.subjectHash}`);
    assert.equal(r2a.key, `auth.signup.email:${r2a.subjectHash}`);

    assert.equal(r1a.allowed, true);
    assert.equal(r2a.allowed, true);
    assert.equal(r1a.result.limit, 1);
    assert.equal(r2a.result.limit, 2);

    // Exhaust auth.login.email (limit=1)
    const r1b = await checkAbuseBudget({
      namespace: "auth.login.email",
      subject,
      secret: SECRET,
      store,
      now,
    });
    assert.equal(
      r1b.allowed,
      false,
      "auth.login.email is exhausted at limit=1",
    );

    // auth.signup.email has an independent budget — second call still allowed
    const r2b = await checkAbuseBudget({
      namespace: "auth.signup.email",
      subject,
      secret: SECRET,
      store,
      now,
    });
    assert.equal(
      r2b.allowed,
      true,
      "auth.signup.email retains independent budget after auth.login.email is blocked",
    );

    // Stored state is independent at different keys via the public get API
    const stored1 = await store.get(r1a.key);
    const stored2 = await store.get(r2a.key);
    assert.ok(stored1 !== undefined && stored1.count === 1);
    assert.ok(stored2 !== undefined && stored2.count === 2);
  } finally {
    delete process.env.AUTH_LOGIN_RATE_LIMIT;
    delete process.env.AUTH_LOGIN_RATE_WINDOW_MS;
    delete process.env.AUTH_SIGNUP_RATE_LIMIT;
    delete process.env.AUTH_SIGNUP_RATE_WINDOW_MS;
  }
});
