import assert from "node:assert/strict";
import test from "node:test";

import {
  checkRateLimit,
  checkRateLimitWithStore,
  type RateLimitStore,
  type RateLimitWindow,
} from "@/lib/rate-limit/core";

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
  return {
    map,
    writes: 0,
    async get(key) {
      const window = map.get(key);
      // Return a copy so callers can't mutate the stored window in place.
      return window ? { ...window } : undefined;
    },
    async set(key, window) {
      this.writes += 1;
      map.set(key, { ...window });
    },
  };
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
