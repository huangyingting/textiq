/**
 * Pure fixed-window rate-limit primitives — dependency-free canonical home.
 *
 * These types and functions implement the fixed-window decision logic shared by
 * the Prisma/IP-aware facade (`@/lib/rate-limit`) and external consumers such
 * as `abuse-budget.ts` and `ai/generation-route.ts`.
 *
 * No Node.js builtins, no environment access, no crypto — pure computation.
 */

export interface RateLimitWindow {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /* node:coverage ignore next -- Interface fields are erased; tsx maps the final field as uncovered. */
  now: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

/**
 * Async store abstraction for the fixed-window limiter. The route backs this
 * with a `RateLimitHit` table so the limit is shared across instances; tests
 * back it with an in-memory fake. `get` returns the subject's current window
 * (or `undefined`); `set` persists a window for the subject.
 *
 * Cost-bearing stores should implement the optional `atomicIncrement` method
 * to eliminate the get→compute→set race that can allow a small overshoot under
 * concurrency. When present, {@link checkRateLimitWithStore} delegates to it
 * instead of the two-phase read-modify-write (#482).
 */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitWindow | undefined>;
  set(key: string, window: RateLimitWindow): Promise<void>;
  /**
   * Optional atomic increment (#482).
   *
   * Performs a single DB-level operation that increments the window count by 1
   * when `count < limit` and the window has not expired, or resets the window
   * when it has expired.
   *
   * Returns the resulting {@link RateLimitResult} directly. When this method is
   * present, {@link checkRateLimitWithStore} uses it instead of the two-phase
   * get → compute → set path, eliminating the race where two concurrent
   * requests each read the same count and both succeed past the limit.
   *
   * Guarantee: the number of allowed increments within a window is bounded to
   * exactly `limit`. An overshoot of ≥1 is not possible as long as the
   * underlying DB operation is atomic (conditional `updateMany` + upsert).
   */
  atomicIncrement?(
    key: string,
    options: RateLimitOptions,
  ): Promise<RateLimitResult>;
}

/* @preserve node:coverage ignore start -- computeRateLimit behavior is covered through public limiters; tsx maps this documentation/signature as uncovered. */
/**
 * Pure fixed-window decision. Given the current window for a subject (or
 * `undefined` when there is none), returns the {@link RateLimitResult} plus the
 * window that should be persisted (`next`) — or `null` when nothing should be
 * written (the request was blocked, so the stored window is left untouched).
 *
 * The window is first-request-anchored: the first hit sets
 * `resetAt = now + windowMs`, and the window resets once `now >= resetAt`. This
 * logic is shared by the in-memory {@link checkRateLimit} and the async,
 * store-backed {@link checkRateLimitWithStore} so both behave identically.
 */
function computeRateLimit(
  existing: RateLimitWindow | undefined,
  { limit, windowMs, now }: RateLimitOptions,
): { result: RateLimitResult; next: RateLimitWindow | null } {
  /* @preserve node:coverage ignore stop */
  if (!existing || now >= existing.resetAt) {
    const next: RateLimitWindow = { count: 1, resetAt: now + windowMs };
    return {
      result: {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        limit,
        resetAt: next.resetAt,
      },
      next,
    };
  }

  if (existing.count >= limit) {
    return {
      result: {
        allowed: false,
        remaining: 0,
        limit,
        resetAt: existing.resetAt,
      },
      next: null,
    };
  }

  const next: RateLimitWindow = {
    count: existing.count + 1,
    resetAt: existing.resetAt,
  };
  return {
    result: {
      allowed: true,
      remaining: Math.max(0, limit - next.count),
      limit,
      resetAt: existing.resetAt,
    },
    next,
  };
}

/**
 * Fixed-window rate limiter backed by an in-memory `Map`. Records the request
 * in `store[key]` when allowed; the window resets once `now >= resetAt`.
 */
export function checkRateLimit(
  store: Map<string, RateLimitWindow>,
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const { result, next } = computeRateLimit(store.get(key), options);
  if (next) {
    store.set(key, next);
  }
  return result;
}

/**
 * Store-backed counterpart of {@link checkRateLimit}. When the store provides
 * {@link RateLimitStore.atomicIncrement}, delegates to it for an atomically
 * bounded guarantee (no overshoot, #482). Otherwise falls back to the
 * read-modify-write path.
 *
 * The atomic path ensures that exactly `limit` requests succeed per window
 * even under high concurrency across multiple instances.
 */
export async function checkRateLimitWithStore(
  store: RateLimitStore,
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  if (store.atomicIncrement) {
    return store.atomicIncrement(key, options);
  }
  const { result, next } = computeRateLimit(await store.get(key), options);
  if (next) {
    await store.set(key, next);
  }
  return result;
}
