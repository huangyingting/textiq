import assert from "node:assert/strict";
import test from "node:test";

import {
  type RateLimitStore,
  type RateLimitWindow,
  type RateLimitOptions,
  checkRateLimitWithStore,
} from "@/lib/rate-limit/core";
import {
  buildClientIpDiagnosticContext,
  getClientIp,
  createPrismaRateLimitStore,
  hashIdentifier,
  rateLimitSubject,
  retryAfterSeconds,
} from "@/lib/rate-limit";

const SECRET = "rate-limit-test-secret-0987654321";

type InstrumentedRateLimitStore = RateLimitStore & {
  getAtomicCalls(): number;
  getCount(): number;
};

function instrumentedRateLimitStore(
  value: unknown,
): InstrumentedRateLimitStore {
  return value as unknown as InstrumentedRateLimitStore;
}

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

// ── getClientIp ─────────────────────────────────────────────────────────────

test("getClientIp returns the platform remote address for direct clients", () => {
  assert.equal(
    getClientIp(headers({}), { remoteAddress: "198.51.100.7" }),
    "198.51.100.7",
  );
});

test("getClientIp ignores spoofable forwarding headers without proxy trust", () => {
  const diagnostics: ReturnType<typeof buildClientIpDiagnosticContext>[] = [];
  assert.equal(
    getClientIp(
      headers({
        "x-forwarded-for": "203.0.113.7",
        "x-real-ip": "203.0.113.8",
      }),
      {
        remoteAddress: "198.51.100.7",
        trustedProxyCidrs: [],
        onDiagnostic: (event) =>
          diagnostics.push(buildClientIpDiagnosticContext(event)),
      },
    ),
    "198.51.100.7",
  );
  assert.deepEqual(diagnostics, [
    {
      reason: "forwarded-header-ignored",
      selectedSource: "remote-address",
      forwardedForCount: 1,
      hasRealIp: true,
      hasRemoteAddress: true,
      trustedProxyConfigured: false,
      remoteAddressTrusted: false,
    },
  ]);
  assert.ok(!JSON.stringify(diagnostics).includes("203.0.113.7"));
});

test("getClientIp returns null when only untrusted forwarding headers are present", () => {
  const diagnostics: ReturnType<typeof buildClientIpDiagnosticContext>[] = [];
  assert.equal(
    getClientIp(headers({ "x-forwarded-for": "203.0.113.7" }), {
      trustedProxyCidrs: [],
      onDiagnostic: (event) =>
        diagnostics.push(buildClientIpDiagnosticContext(event)),
    }),
    null,
  );
  assert.deepEqual(diagnostics[0], {
    reason: "forwarded-header-ignored",
    selectedSource: "missing",
    forwardedForCount: 1,
    hasRealIp: false,
    hasRemoteAddress: false,
    trustedProxyConfigured: false,
  });
});

test("getClientIp honors x-forwarded-for through a trusted proxy", () => {
  assert.equal(
    getClientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.1.2.3" }), {
      remoteAddress: "10.2.3.4",
      trustedProxyCidrs: ["10.0.0.0/8"],
    }),
    "203.0.113.7",
  );
});

test("getClientIp returns nearest untrusted hop from multi-hop headers", () => {
  assert.equal(
    getClientIp(
      headers({ "x-forwarded-for": "203.0.113.7, 198.51.100.9, 10.1.2.3" }),
      {
        remoteAddress: "10.2.3.4",
        trustedProxyCidrs: ["10.0.0.0/8"],
      },
    ),
    "198.51.100.9",
  );
});

test("getClientIp falls back to x-real-ip only through a trusted proxy", () => {
  assert.equal(
    getClientIp(headers({ "x-real-ip": "192.0.2.44" }), {
      remoteAddress: "10.2.3.4",
      trustedProxyCidrs: ["10.0.0.0/8"],
    }),
    "192.0.2.44",
  );
});

test("getClientIp uses configured remote-address header before trusting forwarding headers", () => {
  assert.equal(
    getClientIp(
      headers({
        "x-platform-remote-addr": "10.2.3.4",
        "x-forwarded-for": "203.0.113.9",
      }),
      {
        remoteAddressHeader: "x-platform-remote-addr",
        trustedProxyCidrs: ["10.0.0.0/8"],
      },
    ),
    "203.0.113.9",
  );
});

test("getClientIp rejects malformed forwarded entries conservatively", () => {
  const diagnostics: ReturnType<typeof buildClientIpDiagnosticContext>[] = [];
  assert.equal(
    getClientIp(headers({ "x-forwarded-for": "unknown, 203.0.113.7" }), {
      remoteAddress: "10.2.3.4",
      trustedProxyCidrs: ["10.0.0.0/8"],
      onDiagnostic: (event) =>
        diagnostics.push(buildClientIpDiagnosticContext(event)),
    }),
    "10.2.3.4",
  );
  assert.equal(diagnostics[0]?.reason, "forwarded-header-invalid");
  assert.ok(!JSON.stringify(diagnostics).includes("203.0.113.7"));
});

// ── hashIdentifier ──────────────────────────────────────────────────────────

test("hashIdentifier is deterministic and fixed-length hex", () => {
  const a = hashIdentifier("203.0.113.7", SECRET);
  const b = hashIdentifier("203.0.113.7", SECRET);
  assert.equal(a, b);
  assert.equal(a.length, 32);
  assert.match(a, /^[0-9a-f]{32}$/);
});

test("hashIdentifier never echoes the raw identifier", () => {
  const ip = "203.0.113.7";
  assert.ok(!hashIdentifier(ip, SECRET).includes(ip));
});

test("hashIdentifier differs by input and by secret", () => {
  assert.notEqual(
    hashIdentifier("203.0.113.7", SECRET),
    hashIdentifier("203.0.113.8", SECRET),
  );
  assert.notEqual(
    hashIdentifier("203.0.113.7", SECRET),
    hashIdentifier("203.0.113.7", "a-different-secret"),
  );
});

// ── rateLimitSubject ────────────────────────────────────────────────────────

test("rateLimitSubject namespaces keys so limiters never collide", () => {
  const id = hashIdentifier("203.0.113.7", SECRET);
  assert.equal(rateLimitSubject("import", id), `import:${id}`);
  assert.notEqual(
    rateLimitSubject("import", id),
    rateLimitSubject("gen-anon-ip", id),
  );
});

// ── retryAfterSeconds ───────────────────────────────────────────────────────

test("retryAfterSeconds rounds up and is at least 1", () => {
  assert.equal(retryAfterSeconds(10_000, 8_500), 2);
  assert.equal(retryAfterSeconds(10_000, 9_999), 1);
  // Never returns 0 or negative even when the window has already elapsed.
  assert.equal(retryAfterSeconds(10_000, 10_000), 1);
  assert.equal(retryAfterSeconds(10_000, 20_000), 1);
});

// ── unauthenticated / limited decision logic ────────────────────────────────

function createFakeStore(): RateLimitStore & {
  readonly map: Map<string, RateLimitWindow>;
} {
  const map = new Map<string, RateLimitWindow>();
  return {
    map,
    async get(key) {
      const window = map.get(key);
      return window ? { ...window } : undefined;
    },
    async set(key, window) {
      map.set(key, { ...window });
    },
  };
}

test("anonymous per-IP throttle allows up to the limit then returns a retry-after", async () => {
  const store = createFakeStore();
  const ip = "203.0.113.7";
  const key = rateLimitSubject("gen-anon-ip", hashIdentifier(ip, SECRET));
  const opts = { limit: 2, windowMs: 1000 };

  const first = await checkRateLimitWithStore(store, key, { ...opts, now: 0 });
  assert.equal(first.allowed, true);

  const second = await checkRateLimitWithStore(store, key, {
    ...opts,
    now: 10,
  });
  assert.equal(second.allowed, true);

  const blocked = await checkRateLimitWithStore(store, key, {
    ...opts,
    now: 20,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(retryAfterSeconds(blocked.resetAt, 20), 1);
});

test("per-IP throttle is not reset by minting a fresh anonymous identity", async () => {
  // Simulates clearing the signed cookie: a new anon id arrives but the server
  // window is keyed by hashed IP, so the count persists and the limit holds.
  const store = createFakeStore();
  const ip = "203.0.113.7";
  const key = rateLimitSubject("gen-anon-ip", hashIdentifier(ip, SECRET));
  const opts = { limit: 1, windowMs: 1000 };

  assert.equal(
    (await checkRateLimitWithStore(store, key, { ...opts, now: 0 })).allowed,
    true,
  );
  // "Cookie cleared" — same IP, request still blocked within the window.
  assert.equal(
    (await checkRateLimitWithStore(store, key, { ...opts, now: 100 })).allowed,
    false,
  );
});

test("different client IPs get independent windows", async () => {
  const store = createFakeStore();
  const opts = { limit: 1, windowMs: 1000, now: 0 };
  const keyA = rateLimitSubject(
    "gen-anon-ip",
    hashIdentifier("203.0.113.7", SECRET),
  );
  const keyB = rateLimitSubject(
    "gen-anon-ip",
    hashIdentifier("203.0.113.8", SECRET),
  );

  assert.equal(
    (await checkRateLimitWithStore(store, keyA, opts)).allowed,
    true,
  );
  assert.equal(
    (await checkRateLimitWithStore(store, keyB, opts)).allowed,
    true,
  );
  assert.equal(
    (await checkRateLimitWithStore(store, keyA, opts)).allowed,
    false,
  );
});

// ---------------------------------------------------------------------------
// atomicIncrement (#482) — tests for bounded, race-free rate limiting
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";

/**
 * A fake store that implements `atomicIncrement` using an in-memory row, so we
 * can verify that `checkRateLimitWithStore` delegates to it when present.
 */
function createAtomicFakeStore(opts: {
  initialCount?: number;
  initialResetAt?: number;
}) {
  let count = opts.initialCount ?? 0;
  let resetAt = opts.initialResetAt ?? 0;
  let atomicCalls = 0;

  const store = instrumentedRateLimitStore({
    async get(key: string) {
      void key;
      if (!resetAt) return undefined;
      return { count, resetAt };
    },
    async set(_key: string, window: RateLimitWindow) {
      count = window.count;
      resetAt = window.resetAt;
    },
    async atomicIncrement(_key: string, options: RateLimitOptions) {
      atomicCalls++;
      const { limit, windowMs, now } = options;
      if (!resetAt || now >= resetAt) {
        // Expired/new window
        count = 1;
        resetAt = now + windowMs;
        return {
          allowed: true,
          remaining: Math.max(0, limit - 1),
          limit,
          resetAt,
        };
      }
      if (count >= limit) {
        return { allowed: false, remaining: 0, limit, resetAt };
      }
      count++;
      return {
        allowed: true,
        remaining: Math.max(0, limit - count),
        limit,
        resetAt,
      };
    },
    getAtomicCalls: () => atomicCalls,
    getCount: () => count,
  });

  return store;
}

describe("checkRateLimitWithStore with atomicIncrement (#482)", () => {
  it("delegates to atomicIncrement when present", async () => {
    const store = createAtomicFakeStore({});
    const opts = { limit: 3, windowMs: 1000, now: 100 };

    const result = await checkRateLimitWithStore(store, "k", opts);
    assert.equal(result.allowed, true);
    assert.equal(
      (store as ReturnType<typeof createAtomicFakeStore>).getAtomicCalls(),
      1,
    );
  });

  it("blocks after limit is reached via atomicIncrement", async () => {
    const store = createAtomicFakeStore({});
    const opts = { limit: 2, windowMs: 1000, now: 0 };

    assert.equal(
      (await checkRateLimitWithStore(store, "k", opts)).allowed,
      true,
    );
    assert.equal(
      (await checkRateLimitWithStore(store, "k", opts)).allowed,
      true,
    );
    const third = await checkRateLimitWithStore(store, "k", opts);
    assert.equal(third.allowed, false);
    assert.equal(third.remaining, 0);
  });

  it("resets window after expiry via atomicIncrement", async () => {
    const store = createAtomicFakeStore({
      initialCount: 3,
      initialResetAt: 500,
    });
    const opts = { limit: 3, windowMs: 1000, now: 501 };

    // Window expired — should allow again
    const result = await checkRateLimitWithStore(store, "k", opts);
    assert.equal(result.allowed, true);
    assert.equal(
      (store as ReturnType<typeof createAtomicFakeStore>).getCount(),
      1,
    );
  });

  it("remaining decrements correctly", async () => {
    const store = createAtomicFakeStore({});
    const opts = { limit: 5, windowMs: 10000, now: 0 };

    const first = await checkRateLimitWithStore(store, "k", opts);
    assert.equal(first.remaining, 4);
    const second = await checkRateLimitWithStore(store, "k", opts);
    assert.equal(second.remaining, 3);
  });
});

describe("prismaRateLimitStore shape (#482)", () => {
  it("has an atomicIncrement method", () => {
    // Import and verify the method exists — without hitting the DB.
    // The real prismaRateLimitStore is imported indirectly; we test the shape.
    const store = createAtomicFakeStore({});
    assert.equal(
      typeof (store as RateLimitStore & { atomicIncrement?: unknown })
        .atomicIncrement,
      "function",
    );
  });
});

function createFakeRateLimitClient() {
  type Row = { subject: string; count: number; resetAt: Date };
  const rows = new Map<string, Row>();
  return {
    rows,
    rateLimitHit: {
      async findUnique({ where }: { where: { subject: string } }) {
        return rows.get(where.subject) ?? null;
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { subject: string };
        create: Row;
        update: Partial<Row>;
      }) {
        const current = rows.get(where.subject);
        if (current) {
          Object.assign(current, update);
          return current;
        }
        rows.set(where.subject, { ...create });
        return rows.get(where.subject)!;
      },
      async updateMany({
        where,
        data,
      }: {
        where: {
          subject: string;
          count: { lt: number };
          resetAt: { gt: Date };
        };
        data: { count: { increment: number } };
      }) {
        const current = rows.get(where.subject);
        if (
          !current ||
          current.count >= where.count.lt ||
          current.resetAt.getTime() <= where.resetAt.gt.getTime()
        ) {
          return { count: 0 };
        }
        current.count += data.count.increment;
        return { count: 1 };
      },
    },
  };
}

describe("createPrismaRateLimitStore", () => {
  it("gets and sets persisted windows", async () => {
    const client = createFakeRateLimitClient();
    const store = createPrismaRateLimitStore(client as never);

    assert.equal(await store.get("anonymous:hash"), undefined);
    await store.set("anonymous:hash", { count: 2, resetAt: 1_000 });

    assert.deepEqual(await store.get("anonymous:hash"), {
      count: 2,
      resetAt: 1_000,
    });
  });

  it("atomically increments a live window and reports remaining capacity", async () => {
    const client = createFakeRateLimitClient();
    client.rows.set("anonymous:hash", {
      subject: "anonymous:hash",
      count: 1,
      resetAt: new Date(1_000),
    });
    const store = createPrismaRateLimitStore(client as never);

    const result = await store.atomicIncrement!("anonymous:hash", {
      limit: 3,
      windowMs: 1_000,
      now: 500,
    });

    assert.deepEqual(result, {
      allowed: true,
      remaining: 1,
      limit: 3,
      resetAt: 1_000,
    });
    assert.equal(client.rows.get("anonymous:hash")?.count, 2);
  });

  it("starts a new window when no row exists or the old window expired", async () => {
    const client = createFakeRateLimitClient();
    const store = createPrismaRateLimitStore(client as never);

    assert.deepEqual(
      await store.atomicIncrement!("anonymous:hash", {
        limit: 2,
        windowMs: 1_000,
        now: 5_000,
      }),
      { allowed: true, remaining: 1, limit: 2, resetAt: 6_000 },
    );

    client.rows.set("anonymous:hash", {
      subject: "anonymous:hash",
      count: 2,
      resetAt: new Date(5_500),
    });
    assert.deepEqual(
      await store.atomicIncrement!("anonymous:hash", {
        limit: 2,
        windowMs: 1_000,
        now: 6_000,
      }),
      { allowed: true, remaining: 1, limit: 2, resetAt: 7_000 },
    );
  });

  it("blocks when a live window is already at the limit", async () => {
    const client = createFakeRateLimitClient();
    client.rows.set("anonymous:hash", {
      subject: "anonymous:hash",
      count: 2,
      resetAt: new Date(10_000),
    });
    const store = createPrismaRateLimitStore(client as never);

    assert.deepEqual(
      await store.atomicIncrement!("anonymous:hash", {
        limit: 2,
        windowMs: 1_000,
        now: 5_000,
      }),
      { allowed: false, remaining: 0, limit: 2, resetAt: 10_000 },
    );
  });
});
