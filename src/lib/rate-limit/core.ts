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
 * All stores must implement `atomicConsume` to eliminate the get→compute→set
 * race that can allow overshoot under concurrency (#482, #1997).
 * {@link checkRateLimitWithStore} unconditionally delegates to it.
 */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitWindow | undefined>;
  set(key: string, window: RateLimitWindow): Promise<void>;
  /**
   * Required atomic consume operation (#482, #1997).
   *
   * Consumes exactly one request attempt for `key` and returns the authoritative
   * {@link RateLimitResult} in one concurrency-safe persistence operation
   * (missing/current/expired window handling included).
   *
   * In-memory implementations perform the read-modify-write as one synchronous
   * critical section (no await between read and write). Database-backed
   * implementations use compare-and-swap or equivalent to eliminate races where
   * concurrent requests observe stale state and both persist `count = 1`.
   */
  atomicConsume(
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
 * Store-backed counterpart of {@link checkRateLimit}. Unconditionally delegates
 * to {@link RateLimitStore.atomicConsume} for a concurrency-safe guarantee with
 * no overshoot (#482, #1997). The non-atomic read-modify-write fallback has been
 * removed; every store must implement `atomicConsume`.
 */
export async function checkRateLimitWithStore(
  store: RateLimitStore,
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  return store.atomicConsume(key, options);
}
