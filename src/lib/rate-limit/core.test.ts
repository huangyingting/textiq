import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import {
  checkRateLimit,
  checkRateLimitWithStore,
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitStore,
  type RateLimitWindow,
} from "@/lib/rate-limit/core";
import { InMemoryAbuseBudgetStore } from "@/lib/abuse-budget";

/**
 * In-memory fake implementing the async {@link RateLimitStore} interface, used
 * the way the route's DB-backed store is used. `writes` lets tests assert when a
 * window is (and is not) persisted.
 */
function createFakeStore(): RateLimitStore & {
  readonly map: Map<string, RateLimitWindow>;
  writes: number;
} {
  const map = new Map<string, RateLimitWindow>();
  const store: RateLimitStore & {
    readonly map: Map<string, RateLimitWindow>;
    writes: number;
  } = {
    map,
    writes: 0,
    async get(key) {
      const window = map.get(key);
      // Return a copy so callers can't mutate the stored window in place.
      return window ? { ...window } : undefined;
    },
    async set(key, window) {
      store.writes += 1;
      map.set(key, { ...window });
    },
    atomicConsume(
      key: string,
      options: RateLimitOptions,
    ): Promise<RateLimitResult> {
      const { limit, windowMs, now } = options;
      const existing = map.get(key);
      if (!existing || now >= existing.resetAt) {
        const resetAt = now + windowMs;
        map.set(key, { count: 1, resetAt });
        store.writes++;
        return Promise.resolve({
          allowed: true,
          remaining: Math.max(0, limit - 1),
          limit,
          resetAt,
        });
      }
      if (existing.count >= limit) {
        return Promise.resolve({
          allowed: false,
          remaining: 0,
          limit,
          resetAt: existing.resetAt,
        });
      }
      const count = existing.count + 1;
      map.set(key, { count, resetAt: existing.resetAt });
      store.writes++;
      return Promise.resolve({
        allowed: true,
        remaining: Math.max(0, limit - count),
        limit,
        resetAt: existing.resetAt,
      });
    },
  };
  return store;
}

test("checkRateLimit allows up to the limit then blocks within the window", () => {
  const store = new Map<string, RateLimitWindow>();
  const base = { limit: 2, windowMs: 1000 };

  const first = checkRateLimit(store, "user-1", { ...base, now: 0 });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);

  const second = checkRateLimit(store, "user-1", { ...base, now: 100 });
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);

  const third = checkRateLimit(store, "user-1", { ...base, now: 200 });
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
});

test("checkRateLimit resets after the window elapses", () => {
  const store = new Map<string, RateLimitWindow>();
  const base = { limit: 1, windowMs: 1000 };

  assert.equal(
    checkRateLimit(store, "user-1", { ...base, now: 0 }).allowed,
    true,
  );
  assert.equal(
    checkRateLimit(store, "user-1", { ...base, now: 500 }).allowed,
    false,
  );
  assert.equal(
    checkRateLimit(store, "user-1", { ...base, now: 1000 }).allowed,
    true,
  );
});

test("checkRateLimit isolates different keys", () => {
  const store = new Map<string, RateLimitWindow>();
  const base = { limit: 1, windowMs: 1000, now: 0 };
  assert.equal(checkRateLimit(store, "user-a", base).allowed, true);
  assert.equal(checkRateLimit(store, "user-b", base).allowed, true);
  assert.equal(checkRateLimit(store, "user-a", base).allowed, false);
});

test("checkRateLimitWithStore allows up to the limit then blocks within the window", async () => {
  const store = createFakeStore();
  const base = { limit: 2, windowMs: 1000 };

  const first = await checkRateLimitWithStore(store, "user-1", {
    ...base,
    now: 0,
  });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);

  const second = await checkRateLimitWithStore(store, "user-1", {
    ...base,
    now: 100,
  });
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);

  const third = await checkRateLimitWithStore(store, "user-1", {
    ...base,
    now: 200,
  });
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);

  // The two allowed requests each persisted a window; the blocked one did not.
  assert.equal(store.writes, 2);
});

test("checkRateLimitWithStore resets after the window elapses", async () => {
  const store = createFakeStore();
  const base = { limit: 1, windowMs: 1000 };

  assert.equal(
    (await checkRateLimitWithStore(store, "user-1", { ...base, now: 0 }))
      .allowed,
    true,
  );
  assert.equal(
    (await checkRateLimitWithStore(store, "user-1", { ...base, now: 500 }))
      .allowed,
    false,
  );
  assert.equal(
    (await checkRateLimitWithStore(store, "user-1", { ...base, now: 1000 }))
      .allowed,
    true,
  );
});

test("checkRateLimitWithStore isolates different keys and persists per subject", async () => {
  const store = createFakeStore();
  const base = { limit: 1, windowMs: 1000, now: 0 };

  assert.equal(
    (await checkRateLimitWithStore(store, "user-a", base)).allowed,
    true,
  );
  assert.equal(
    (await checkRateLimitWithStore(store, "user-b", base)).allowed,
    true,
  );
  assert.equal(
    (await checkRateLimitWithStore(store, "user-a", base)).allowed,
    false,
  );

  assert.equal(store.map.get("user-a")?.count, 1);
  assert.equal(store.map.get("user-b")?.count, 1);
});

// ---------------------------------------------------------------------------
// atomicConsume concurrency (#1997) — deterministic race-safety tests
//
// Because JavaScript is single-threaded and atomicConsume performs read-modify-
// write with no await between them, concurrent Promise.all calls execute each
// atomicConsume synchronously in sequence. The tests below would fail on the
// prior get→compute→set fallback where both concurrent calls observe stale state
// (both see count=0, both write count=1, both report allowed=true).
// ---------------------------------------------------------------------------

describe("checkRateLimitWithStore atomicConsume concurrency (#1997)", () => {
  it("concurrent new-window limit=1 allows exactly one request", async () => {
    const store = new InMemoryAbuseBudgetStore();
    const opts = { limit: 1, windowMs: 1000, now: 0 };
    const [r1, r2] = await Promise.all([
      checkRateLimitWithStore(store, "key", opts),
      checkRateLimitWithStore(store, "key", opts),
    ]);
    assert.equal(
      [r1, r2].filter((r) => r.allowed).length,
      1,
      "exactly one concurrent request should be allowed at limit=1",
    );
    // Exact post-state: count=1, resetAt=now+windowMs=0+1000=1000
    assert.deepEqual(store.windows.get("key"), { count: 1, resetAt: 1000 });
  });

  it("concurrent live-window limit=2 allows exactly two of three requests", async () => {
    const store = new InMemoryAbuseBudgetStore();
    const opts = { limit: 2, windowMs: 1000, now: 0 };
    const [r1, r2, r3] = await Promise.all([
      checkRateLimitWithStore(store, "key", opts),
      checkRateLimitWithStore(store, "key", opts),
      checkRateLimitWithStore(store, "key", opts),
    ]);
    assert.equal(
      [r1, r2, r3].filter((r) => r.allowed).length,
      2,
      "exactly two concurrent requests should be allowed at limit=2",
    );
    assert.equal(store.windows.get("key")?.count, 2);
  });

  it("expired window resets to authoritative count=1 with correct resetAt", async () => {
    const store = new InMemoryAbuseBudgetStore();
    // Pre-seed an expired window.
    store.windows.set("key", { count: 5, resetAt: 500 });
    const result = await checkRateLimitWithStore(store, "key", {
      limit: 3,
      windowMs: 1000,
      now: 1000,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 2);
    assert.equal(store.windows.get("key")?.count, 1);
    assert.equal(store.windows.get("key")?.resetAt, 2000);
  });

  it("parity: in-memory and atomic fake agree on remaining after sequential hits", async () => {
    const inMemory = new InMemoryAbuseBudgetStore();
    const fake = createFakeStore();
    const opts = { limit: 3, windowMs: 1000, now: 0 };

    for (const store of [inMemory, fake]) {
      const r1 = await checkRateLimitWithStore(store, "k", opts);
      const r2 = await checkRateLimitWithStore(store, "k", opts);
      const r3 = await checkRateLimitWithStore(store, "k", opts);
      const r4 = await checkRateLimitWithStore(store, "k", opts);
      assert.equal(r1.allowed, true);
      assert.equal(r1.remaining, 2);
      assert.equal(r2.allowed, true);
      assert.equal(r2.remaining, 1);
      assert.equal(r3.allowed, true);
      assert.equal(r3.remaining, 0);
      assert.equal(r4.allowed, false);
      assert.equal(r4.remaining, 0);
    }
  });
});
