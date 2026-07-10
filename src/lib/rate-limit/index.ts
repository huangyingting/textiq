/* node:coverage disable */
/**
 * Shared, server-side rate limiting primitives for the public `/api` routes
 * (#96). These build on the pure fixed-window limiter in `@/lib/rate-limit/core`
 * and add the request-facing concerns that the limiter itself stays agnostic of:
 *
 *  - Extracting a caller identity from proxy headers (`getClientIp`).
 *  - Hashing that identity so the persisted key never stores a raw IP
 *    (`hashIdentifier`).
 *  - Namespacing keys per limiter so independent limits never collide
 *    (`rateLimitSubject`).
 *  - A `RateLimitHit`-backed {@link RateLimitStore} so a window survives across
 *    instances and — crucially for anonymous generation (#96, criterion 2) — is
 *    keyed server-side by hashed IP and therefore harder to reset than a local
 *    cookie.
 *  - A `Retry-After` seconds helper for 429 responses (criterion 4).
 *
 * Everything except {@link prismaRateLimitStore} is a pure function so it can be
 * unit-tested deterministically with no Next.js or database dependency.
 */
/* node:coverage enable */

import crypto from "node:crypto";
import net from "node:net";

import {
  type RateLimitStore,
  type RateLimitWindow,
  type RateLimitOptions,
  type RateLimitResult,
} from "@/lib/rate-limit/core";
import { logInfo } from "@/lib/log";
import { prisma } from "@/lib/prisma";

type RateLimitPrismaClient = Pick<typeof prisma, "rateLimitHit">;

type IpFamily = "ipv4" | "ipv6";

export type ClientIpSource =
  | "forwarded-for"
  | "real-ip"
  | "remote-address"
  | "missing";

export type ClientIpDiagnosticReason =
  | "forwarded-header-ignored"
  | "forwarded-header-invalid"
  | "remote-address-invalid";

export interface ClientIpDiagnostic {
  readonly reason: ClientIpDiagnosticReason;
  readonly selectedSource: ClientIpSource;
  readonly forwardedForCount: number;
  readonly hasRealIp: boolean;
  readonly hasRemoteAddress: boolean;
  readonly trustedProxyConfigured: boolean;
  readonly remoteAddressTrusted?: boolean;
}

export interface ClientIpOptions {
  /**
   * Platform-provided immediate peer address. In Next.js route handlers this is
   * usually supplied via `TRUSTED_PROXY_REMOTE_ADDR_HEADER`.
   */
  readonly remoteAddress?: string | null;
  /**
   * Trusted reverse-proxy addresses or CIDRs. Overrides
   * `TRUSTED_PROXY_CIDRS`; pass an empty array to explicitly trust none.
   */
  readonly trustedProxyCidrs?: readonly string[];
  /**
   * Header that contains the immediate peer address. Overrides
   * `TRUSTED_PROXY_REMOTE_ADDR_HEADER`.
   */
  readonly remoteAddressHeader?: string | null;
  /** Optional safe diagnostics sink. Raw IPs are never included. */
  readonly onDiagnostic?: (diagnostic: ClientIpDiagnostic) => void;
}

interface TrustedProxyMatcher {
  readonly configured: boolean;
  isTrusted(ip: string): boolean;
}

const CLIENT_IP_LOG_SCOPE = "rate-limit.client-ip";
const LOCAL_DEV_TRUSTED_PROXY_CIDRS = ["127.0.0.0/8", "::1/128"] as const;

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function trustedProxyCidrsFromEnv(): readonly string[] {
  const configured = splitCsv(process.env.TRUSTED_PROXY_CIDRS);
  if (configured.length > 0) {
    return configured;
  }
  return process.env.NODE_ENV === "production"
    ? []
    : LOCAL_DEV_TRUSTED_PROXY_CIDRS;
}

function normalizeHeaderName(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  return /^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(trimmed) ? trimmed : null;
}

function normalizeIp(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const unwrapped =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;
  return net.isIP(unwrapped) === 0 ? null : unwrapped;
}

function ipFamily(ip: string): IpFamily | null {
  const version = net.isIP(ip);
  if (version === 4) return "ipv4";
  if (version === 6) return "ipv6";
  return null;
}

function createTrustedProxyMatcher(
  trustedProxyCidrs: readonly string[],
): TrustedProxyMatcher {
  const blockList = new net.BlockList();
  let configured = false;
  for (const entry of trustedProxyCidrs) {
    const [addressPart, prefixPart] = entry.split("/", 2);
    const address = normalizeIp(addressPart);
    const family = address ? ipFamily(address) : null;
    if (!address || !family) continue;
    try {
      if (prefixPart === undefined) {
        blockList.addAddress(address, family);
      } else {
        const prefix = Number.parseInt(prefixPart, 10);
        const maxPrefix = family === "ipv4" ? 32 : 128;
        if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
          continue;
        }
        blockList.addSubnet(address, prefix, family);
      }
      configured = true;
    } catch {
      // Invalid trust entries are ignored so they cannot accidentally expand
      // the trust boundary.
    }
  }
  return {
    configured,
    isTrusted(ip: string): boolean {
      const family = ipFamily(ip);
      return family ? blockList.check(ip, family) : false;
    },
  };
}

function forwardedForEntries(headers: Headers): string[] {
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return [];
  return forwarded
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function emitClientIpDiagnostic(
  onDiagnostic: ClientIpOptions["onDiagnostic"],
  diagnostic: ClientIpDiagnostic,
): void {
  onDiagnostic?.(diagnostic);
}

export function buildClientIpDiagnosticContext(
  diagnostic: ClientIpDiagnostic,
): Record<string, unknown> {
  return {
    reason: diagnostic.reason,
    selectedSource: diagnostic.selectedSource,
    forwardedForCount: diagnostic.forwardedForCount,
    hasRealIp: diagnostic.hasRealIp,
    hasRemoteAddress: diagnostic.hasRemoteAddress,
    trustedProxyConfigured: diagnostic.trustedProxyConfigured,
    ...(diagnostic.remoteAddressTrusted === undefined
      ? {}
      : { remoteAddressTrusted: diagnostic.remoteAddressTrusted }),
  };
}

export function logClientIpDiagnostic(diagnostic: ClientIpDiagnostic): void {
  logInfo(
    CLIENT_IP_LOG_SCOPE,
    "client-ip-trust-decision",
    buildClientIpDiagnosticContext(diagnostic),
  );
}

/**
 * Extracts the originating client IP with an explicit trusted-proxy boundary.
 *
 * Forwarded headers are honored only when the immediate peer address is known
 * and falls inside `TRUSTED_PROXY_CIDRS` (or the supplied override). Otherwise
 * the function uses the platform-provided remote address, or returns `null` so
 * the caller can fall back to a conservative shared bucket.
 */
export function getClientIp(
  headers: Headers,
  options: ClientIpOptions = {},
): string | null {
  const entries = forwardedForEntries(headers);
  const realIp = normalizeIp(headers.get("x-real-ip"));
  const remoteHeader = normalizeHeaderName(
    options.remoteAddressHeader ?? process.env.TRUSTED_PROXY_REMOTE_ADDR_HEADER,
  );
  const remoteAddress = normalizeIp(
    options.remoteAddress ?? (remoteHeader ? headers.get(remoteHeader) : null),
  );
  const matcher = createTrustedProxyMatcher(
    options.trustedProxyCidrs ?? trustedProxyCidrsFromEnv(),
  );
  const hasForwardedHeaders =
    entries.length > 0 || headers.get("x-real-ip")?.trim() !== undefined;
  const hasRemoteAddress =
    (options.remoteAddress !== undefined && options.remoteAddress !== null) ||
    (remoteHeader !== null && headers.get(remoteHeader) !== null);

  const baseDiagnostic = {
    forwardedForCount: entries.length,
    hasRealIp: headers.get("x-real-ip")?.trim() !== undefined,
    hasRemoteAddress,
    trustedProxyConfigured: matcher.configured,
  } satisfies Pick<
    ClientIpDiagnostic,
    | "forwardedForCount"
    | "hasRealIp"
    | "hasRemoteAddress"
    | "trustedProxyConfigured"
  >;

  if (hasRemoteAddress && !remoteAddress) {
    emitClientIpDiagnostic(options.onDiagnostic, {
      ...baseDiagnostic,
      reason: "remote-address-invalid",
      selectedSource: "missing",
    });
  }

  if (!remoteAddress) {
    if (hasForwardedHeaders) {
      emitClientIpDiagnostic(options.onDiagnostic, {
        ...baseDiagnostic,
        reason: "forwarded-header-ignored",
        selectedSource: "missing",
      });
    }
    return null;
  }

  const remoteAddressTrusted = matcher.isTrusted(remoteAddress);
  if (!matcher.configured || !remoteAddressTrusted) {
    if (hasForwardedHeaders) {
      emitClientIpDiagnostic(options.onDiagnostic, {
        ...baseDiagnostic,
        reason: "forwarded-header-ignored",
        selectedSource: "remote-address",
        remoteAddressTrusted,
      });
    }
    return remoteAddress;
  }

  if (entries.length > 0) {
    const chain = entries.map(normalizeIp);
    if (chain.some((entry) => entry === null)) {
      emitClientIpDiagnostic(options.onDiagnostic, {
        ...baseDiagnostic,
        reason: "forwarded-header-invalid",
        selectedSource: "remote-address",
        remoteAddressTrusted,
      });
      return remoteAddress;
    }
    for (let index = chain.length - 1; index >= 0; index--) {
      const entry = chain[index]!;
      if (!matcher.isTrusted(entry)) {
        return entry;
      }
    }
    return chain[0] ?? remoteAddress;
  }

  if (headers.get("x-real-ip")?.trim() && !realIp) {
    emitClientIpDiagnostic(options.onDiagnostic, {
      ...baseDiagnostic,
      reason: "forwarded-header-invalid",
      selectedSource: "remote-address",
      remoteAddressTrusted,
    });
    return remoteAddress;
  }
  if (realIp) {
    return realIp;
  }
  return remoteAddress;
}

/**
 * Hashes a caller identity (e.g. an IP) with HMAC-SHA256 keyed by `secret` so
 * the stored rate-limit key is fixed-length and never contains the raw IP. The
 * digest is truncated to 32 hex chars — ample to avoid collisions for this use.
 */
export function hashIdentifier(identifier: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(identifier)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Builds a namespaced subject key for the shared `RateLimitHit` store so that
 * independent limiters (e.g. `import` vs `anon-gen`) never share a window even
 * when they hash the same IP.
 */
export function rateLimitSubject(scope: string, identifier: string): string {
  return `${scope}:${identifier}`;
}

/**
 * Computes the `Retry-After` value (in whole seconds, minimum 1) for a window
 * that resets at `resetAt`. Pure so it can be asserted exactly in tests.
 */
export function retryAfterSeconds(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

/* node:coverage disable */
/**
 * `RateLimitHit`-backed {@link RateLimitStore} with atomic increment (#482).
 *
 * Persisting the window in a row (instead of a per-instance Map) makes a limit
 * hold across instances and, for IP-keyed limits, survive a cookie reset.
 *
 * ## Atomicity guarantee (#482)
 *
 * The store implements `atomicIncrement` which collapses the previous
 * read-modify-write into a single conditional `updateMany` guarded by
 * `count < limit AND resetAt > now`. Prisma executes this as one DB-level
 * operation (a single UPDATE with a WHERE clause), so two concurrent requests
 * that both read count=N−1 cannot both succeed — exactly one UPDATE matches and
 * increments; the other sees 0 rows updated and is either blocked or starts a
 * new window (if expired).
 *
 * Bounded guarantee: the number of allowed requests within a window is bounded
 * to exactly `limit`. An overshoot of ≥1 at the critical boundary is not
 * possible under this scheme, as long as the underlying DB enforces row-level
 * write serialization (SQLite WAL mode, PostgreSQL MVCC).
 */
/* node:coverage enable */
export function createPrismaRateLimitStore(
  client: RateLimitPrismaClient,
): RateLimitStore {
  return {
    async get(key) {
      const row = await client.rateLimitHit.findUnique({
        where: { subject: key },
      });
      if (!row) {
        return undefined;
      }
      return { count: row.count, resetAt: row.resetAt.getTime() };
    },
    async set(key, window: RateLimitWindow) {
      const resetAt = new Date(window.resetAt);
      await client.rateLimitHit.upsert({
        where: { subject: key },
        create: { subject: key, count: window.count, resetAt },
        update: { count: window.count, resetAt },
      });
    },

    /**
     * Atomic conditional increment for the fixed-window rate limiter (#482).
     *
     * Decision tree (all in DB-level operations):
     *
     *  1. Try `updateMany WHERE subject=key AND count < limit AND resetAt > now,
     *     SET count = count + 1`.
     *     - If 1 row updated → allowed; re-read count and return.
     *  2. If 0 rows updated, fetch the current row:
     *     a. Row absent or expired (resetAt ≤ now) → upsert with count=1 and a
     *        fresh resetAt. Return allowed with count=1.
     *     b. Row present and not expired → blocked at limit.
     */
    async atomicIncrement(
      key: string,
      options: RateLimitOptions,
    ): Promise<RateLimitResult> {
      const { limit, windowMs, now } = options;
      const nowDate = new Date(now);
      const newResetAt = new Date(now + windowMs);

      // Phase 1: atomic conditional increment.
      const incremented = await client.rateLimitHit.updateMany({
        where: {
          subject: key,
          count: { lt: limit },
          resetAt: { gt: nowDate },
        },
        data: { count: { increment: 1 } },
      });

      if (incremented.count > 0) {
        // Read back to get the actual count after increment.
        const row = await client.rateLimitHit.findUnique({
          where: { subject: key },
        });
        const count = row?.count ?? 1;
        const resetAt = row?.resetAt.getTime() ?? now + windowMs;
        return {
          allowed: true,
          remaining: Math.max(0, limit - count),
          limit,
          resetAt,
        };
      }

      // Phase 2: no rows matched — either expired or blocked.
      const existing = await client.rateLimitHit.findUnique({
        where: { subject: key },
      });

      if (!existing || existing.resetAt.getTime() <= now) {
        // Window absent or expired — start a fresh window atomically.
        await client.rateLimitHit.upsert({
          where: { subject: key },
          create: { subject: key, count: 1, resetAt: newResetAt },
          update: { count: 1, resetAt: newResetAt },
        });
        return {
          allowed: true,
          remaining: Math.max(0, limit - 1),
          limit,
          resetAt: newResetAt.getTime(),
        };
      }

      // Row exists, window not expired, count >= limit → blocked.
      return {
        allowed: false,
        remaining: 0,
        limit,
        resetAt: existing.resetAt.getTime(),
      };
    },
  };
}

export const prismaRateLimitStore: RateLimitStore =
  createPrismaRateLimitStore(prisma);
